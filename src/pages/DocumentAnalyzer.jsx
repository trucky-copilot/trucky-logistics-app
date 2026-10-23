import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSearch, Upload, XCircle, Loader2, Image,
  Truck, Users, FileText, X, ChevronRight, Lock, Sparkles, CheckCircle2, AlertTriangle, Calendar, Building, HelpCircle
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import ResultHeader from '@/components/doc-analyzer/ResultHeader';
import CategoryGrid from '@/components/doc-analyzer/CategoryGrid';
import KeyFindings from '@/components/doc-analyzer/KeyFindings';
import ActionBlock from '@/components/doc-analyzer/ActionBlock';
import LoadMatch from '@/components/doc-analyzer/LoadMatch';
import CarrierSelector from '@/components/doc-analyzer/CarrierSelector';
import { useOrganizationId } from '@/lib/AppStateContext';
import { filterByOrg } from '@/lib/orgScope';
import { useLanguage } from '@/lib/LanguageContext';
import { useDemo } from '@/lib/DemoContext';

const ACCEPTED_TYPES = '.txt,.pdf,.jpg,.jpeg,.png,.csv';

export default function DocumentAnalyzer() {
  const orgId = useOrganizationId();
  const { t, locale } = useLanguage();
  const { isDemoUser } = useDemo();
  const [documentText, setDocumentText] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [translating, setTranslating] = useState(false);
  // Caché en memoria: mantiene { es: analysis, en: analysis } para cambio instantáneo (0ms)
  const translationsCacheRef = useRef({ es: null, en: null });
  const [error, setError] = useState(null);
  // Contexto del usuario
  const [userRole, setUserRole] = useState(null);        // 'carrier' | 'dispatcher'
  const [dispatchMode, setDispatchMode] = useState(null); // 'single_carrier' | 'multi_carrier'
  const [selectedCarrierId, setSelectedCarrierId] = useState(null);
  const [contextLoaded, setContextLoaded] = useState(false);

  const navigate = useNavigate();

  // Cargar contexto del usuario al montar
  useEffect(() => {
    const loadContext = async () => {
      const user = await base44.auth.me();
      if (!user) return;

      const [profiles, dispatcherProfiles, carrierProfiles] = await Promise.all([
        base44.entities.UserProfile.filter({ usuario: user.email }),
        base44.entities.DispatcherProfile.filter({ user_id: user.email }),
        filterByOrg(base44.entities.CarrierProfile, orgId, { active: true }),
      ]);

      const profile = profiles[0];
      const dispProfile = dispatcherProfiles[0];

      setUserRole(profile?.rol || 'dispatcher');

      if (dispProfile) {
        setDispatchMode(dispProfile.dispatch_mode);
        // Sin fallback cross-tenant: solo el default explícito del dispatcher,
        // o null si no hay carrier propio (sin auto-seleccionar carrierProfiles[0]).
        setSelectedCarrierId(dispProfile.default_carrier || null);
      } else {
        setSelectedCarrierId(null);
      }

      setContextLoaded(true);
    };
    loadContext();
  }, [orgId]);

  /**
   * Traduce la totalidad del objeto de análisis en un solo lote (batch)
   * llamando a Google Translate a través de la función existente 'translateChat'.
   * Preserva prefijos de semáforo/icono (✓, ❌, ⚠, ℹ) aislando el texto antes de la API.
   */
  const translateAnalysis = async (sourceAnalysis, targetLang) => {
    if (!sourceAnalysis || targetLang === 'es') return sourceAnalysis;

    const texts = [];
    texts.push(sourceAnalysis.resumen_ejecutivo || '');
    texts.push(sourceAnalysis.foco_analisis || '');

    const catIndices = [];
    (sourceAnalysis.categorias || []).forEach((cat) => {
      const catIdx = {
        nameIdx: texts.length,
        recIdx: -1,
        hallazgos: []
      };
      texts.push(cat.categoria || '');

      if (cat.recomendacion) {
        catIdx.recIdx = texts.length;
        texts.push(cat.recomendacion);
      }

      (cat.hallazgos || []).forEach((h) => {
        const prefix = h.match(/^[❌⚠✓ℹ!]\s*/)?.[0] || '';
        const cleanText = h.replace(/^[❌⚠✓ℹ!]\s*/, '').trim();
        catIdx.hallazgos.push({ prefix, textIdx: texts.length });
        texts.push(cleanText);
      });
      catIndices.push(catIdx);
    });

    const puntosIndices = [];
    (sourceAnalysis.puntos_negociar || []).forEach((p) => {
      puntosIndices.push(texts.length);
      texts.push(p);
    });

    // Envío en lote con una sola petición HTTP (latencia típica < 300ms)
    const res = await base44.functions.invoke('translateChat', {
      messages: texts.map(t => ({ content: t })),
      targetLang
    });

    if (!res.data?.messages) {
      throw new Error(res.data?.error || 'Traducción fallida');
    }

    const translated = res.data.messages.map(m => m.content);

    return {
      ...sourceAnalysis,
      resumen_ejecutivo: translated[0] || sourceAnalysis.resumen_ejecutivo,
      foco_analisis: translated[1] || sourceAnalysis.foco_analisis,
      categorias: (sourceAnalysis.categorias || []).map((cat, i) => {
        const meta = catIndices[i];
        return {
          ...cat,
          categoria: translated[meta.nameIdx] || cat.categoria,
          recomendacion: meta.recIdx !== -1 ? translated[meta.recIdx] : cat.recomendacion,
          hallazgos: meta.hallazgos.map(h => `${h.prefix}${translated[h.textIdx]}`)
        };
      }),
      puntos_negociar: puntosIndices.map(idx => translated[idx])
    };
  };

  // Reacción instantánea cuando el usuario cambia el idioma en la barra lateral
  useEffect(() => {
    if (!translationsCacheRef.current.es) return;

    if (locale === 'es') {
      setAnalysis(translationsCacheRef.current.es);
    } else if (locale === 'en') {
      if (translationsCacheRef.current.en) {
        // 0 ms: Instantáneo desde memoria
        setAnalysis(translationsCacheRef.current.en);
      } else {
        // Primera traducción a inglés
        setTranslating(true);
        translateAnalysis(translationsCacheRef.current.es, 'en')
          .then(translated => {
            translationsCacheRef.current.en = translated;
            setAnalysis(translated);
          })
          .catch(err => console.error('Error al traducir análisis:', err))
          .finally(() => setTranslating(false));
      }
    }
  }, [locale]);

  const analyze = async () => {
    if (!documentText.trim() || loading) return;
    setLoading(true);
    setLoadingMsg(t.documents.extract);
    setError(null);
    setAnalysis(null);
    translationsCacheRef.current = { es: null, en: null };

    const t1 = setTimeout(() => setLoadingMsg(t.documents.validate), 3000);
    const t2 = setTimeout(() => setLoadingMsg(t.documents.verifyBroker), 6000);

    try {
      const res = await base44.functions.invoke('analyzeDocument', {
        documentText,
        selectedCarrierId,
      });

      clearTimeout(t1);
      clearTimeout(t2);

      if (res.data?.analysis) {
        const rawAnalysis = { ...res.data.analysis, cached: res.data.cached || false };
        // Guardamos la versión canónica en español
        translationsCacheRef.current = { es: rawAnalysis, en: null };

        if (locale === 'en') {
          setTranslating(true);
          try {
            const enAnalysis = await translateAnalysis(rawAnalysis, 'en');
            translationsCacheRef.current.en = enAnalysis;
            setAnalysis(enAnalysis);
          } catch (e) {
            console.error('Error al traducir al inglés:', e);
            setAnalysis(rawAnalysis);
          } finally {
            setTranslating(false);
          }
        } else {
          setAnalysis(rawAnalysis);
        }
      } else if (res.data?.error) {
        setError(res.data.error);
      }
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      setError(err?.message || 'Error al conectar con el servicio de análisis');
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    setFileName(file.name);
    setError(null);
    setAnalysis(null);
    translationsCacheRef.current = { es: null, en: null };

    if (ext === 'pdf') {
      setLoading(true);
      setLoadingMsg("Extrayendo texto de PDF localmente...");
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(item => item.str).join(' ') + '\n';
        }
        setDocumentText(text);
      } catch (err) {
        setError(`Error al leer PDF localmente: ${err.message}`);
      }
      setLoading(false);
    } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
      setLoading(true);
      setLoadingMsg(t.documents.process);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        const extractRes = await base44.functions.invoke('extractDocumentText', { file_url });
        const extracted = extractRes.data?.text;
        if (!extracted) throw new Error(extractRes.data?.error || 'No se pudo extraer el texto');
        setDocumentText(extracted);
      } catch {
        setError(t.documents.processError);
      }
      setLoading(false);
    } else if (['txt', 'csv'].includes(ext)) {
      const text = await file.text();
      setDocumentText(text);
    } else {
      setError(t.documents.unsupported);
    }
    e.target.value = '';
  };

  const handleLinkToLoad = () => {
    const summary = analysis?.resumen_ejecutivo || '';
    const params = new URLSearchParams({ from_doc: '1', doc_summary: summary.slice(0, 200) });
    navigate(`/cargas?${params.toString()}`);
  };

  // Badge de modo de análisis
  const roleBadge = userRole === 'carrier'
    ? { label: t.documents.carrierMode, icon: Truck, color: 'text-violet-400 bg-violet-400/10 border-violet-400/20' }
    : { label: t.documents.dispatcherMode, icon: Users, color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' };



  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <FileSearch className="w-5 h-5 text-primary" />
          {t.documents.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t.documents.subtitle}
        </p>
      </div>

      {/* Badge de rol */}
      {contextLoaded && userRole && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${roleBadge.color}`}>
          <roleBadge.icon className="w-3.5 h-3.5 flex-shrink-0" />
          {roleBadge.label}
        </div>
      )}

      {/* Selector de carrier (solo dispatchers multi-carrier) */}
      {contextLoaded && userRole === 'dispatcher' && dispatchMode === 'multi_carrier' && (
        <CarrierSelector
          selectedCarrierId={selectedCarrierId}
          onChange={setSelectedCarrierId}
        />
      )}

      {/* Input */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <label className="text-sm font-medium text-foreground">{t.documents.pasteOrUpload}</label>
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            {fileName
              ? <span className="text-primary max-w-32 truncate">{fileName}</span>
              : <span>{t.documents.upload}</span>
            }
            <input type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFile} />
          </label>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Image className="w-3 h-3 flex-shrink-0" />
          <span>{t.documents.accepted}</span>
        </div>

        <textarea
          value={documentText}
          onChange={e => setDocumentText(e.target.value)}
          placeholder={`${t.documents.placeholder}

RATE CONFIRMATION
Broker: XYZ Logistics LLC  MC: 123456
Carrier: ABC Trucking Inc
Route: PortMiami → Miami Yard
Rate: $950 | Payment: Net 30
Load #: RC-2024-001
Pickup: 04/26/2024 @ 08:00
Detention: $65/hr after 2hrs free
Equipment: 20ft Dry...`}
          rows={7}
          className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none font-mono"
        />

        <button
          onClick={analyze}
          disabled={!documentText.trim() || loading}
          className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {loadingMsg}
            </>
          ) : (
            <>
              <FileSearch className="w-4 h-4" />
              {t.documents.verify}
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 p-4 rounded-xl bg-red-400/10 border border-red-400/20">
          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">{error}</p>
            {error.includes('Solo proceso') && (
              <p className="text-xs mt-1 text-muted-foreground">{t.documents.sensitive}</p>
            )}
          </div>
        </div>
      )}

      {/* Resultados */}
      {analysis && (
        <div className="space-y-4 relative">
          {translating && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-primary/10 border border-primary/20 text-xs text-primary font-medium animate-pulse shadow-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {locale === 'en' ? 'Translating analysis with Google Translate...' : 'Traduciendo análisis con Google Translate...'}
            </div>
          )}

          {/* Encabezado y hallazgos principales visibles */}
          <ResultHeader analysis={analysis} onLinkToLoad={handleLinkToLoad} cached={analysis.cached} />
          <KeyFindings categorias={analysis.categorias} />

          {/* Si es usuario demo, mostramos el resto difuminado y la ventana/tarjeta de desbloqueo superpuesta */}
          {isDemoUser ? (
            <div className="relative mt-4">
              {/* Contenedor difuminado con las otras alertas y secciones */}
              <div className="filter blur-[6px] opacity-30 pointer-events-none select-none space-y-3">
                <CategoryGrid categorias={analysis.categorias} />
                <ActionBlock veredicto={analysis.veredicto} puntos_negociar={analysis.puntos_negociar} />
                <LoadMatch datos_extraidos={analysis.datos_extraidos} />
              </div>

              {/* Ventana flotante/superpuesta de desbloqueo */}
              <div className="absolute inset-0 flex items-center justify-center p-4 z-20">
                <div className="w-full max-w-lg p-6 md:p-8 rounded-3xl bg-[#0f0e1c]/95 border border-violet-500/40 shadow-2xl backdrop-blur-xl text-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-violet-600/30 to-indigo-600/10 border border-violet-500/40 flex items-center justify-center text-violet-300 shadow-xl shadow-violet-600/20">
                    <Lock className="w-7 h-7" />
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-xl font-bold text-white tracking-tight">
                      Desbloquea el análisis completo
                    </h3>
                    <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                      Obtén todos los detalles y toma decisiones con confianza.
                    </p>
                  </div>

                  <div className="space-y-2.5 text-left max-w-xs mx-auto text-xs text-zinc-300 pt-1">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 flex-shrink-0">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-zinc-200">Alertas críticas y cláusulas</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 flex-shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-zinc-200">Evaluación de rentabilidad</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 flex-shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-zinc-200">Historial de brokers y documentos</span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <a
                      href="https://trucky.site"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-violet-600/30 transition-all hover:scale-[1.02]"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Activar versión completa →</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <CategoryGrid categorias={analysis.categorias} />
              <ActionBlock veredicto={analysis.veredicto} puntos_negociar={analysis.puntos_negociar} />
              <LoadMatch datos_extraidos={analysis.datos_extraidos} />
            </>
          )}
        </div>
      )}
    </div>
  );
}