import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSearch, Upload, XCircle, Loader2, Image,
  Truck, Users, FileText, X, ChevronRight, Lock, Sparkles, CheckCircle2, AlertTriangle, Calendar, Building, HelpCircle, Package, ArrowRight
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
import { useEffectivePlan as useDemo } from '@/lib/LivePlanProvider';
import DemoLimitModal from '@/components/DemoLimitModal';
import {
  AUTOMATION_EMAIL_TO_CHECKER_KEY,
  AUTOMATION_CHECKER_TO_LOAD_KEY,
  buildThreadSummaryForLoad,
  extractLogisticsFieldsFromText,
  classifyLoadDocument,
  detectDocumentType,
  cleanNullStrings,
  applyRiskGuards,
} from '@/lib/dispatchAutomation';

const ACCEPTED_TYPES = '.txt,.pdf,.jpg,.jpeg,.png,.csv';

export default function DocumentAnalyzer() {
  const orgId = useOrganizationId();
  const { t, locale } = useLanguage();
  const { isDemoUser, limits } = useDemo();
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [monthlyDocCount, setMonthlyDocCount] = useState(0);
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
  // Contexto de Automatización proveniente del módulo de Emails
  const [emailAutomationCtx, setEmailAutomationCtx] = useState(null);
  const autoVerifyTriggeredRef = useRef(false);

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
        // Solo un carrier de la organización actual: uno ajeno o inactivo hace que
        // el servidor rechace toda verificación (400 "no pertenece a tu organización").
        const valido = (carrierProfiles || []).some((c) => c.id === dispProfile.default_carrier);
        setSelectedCarrierId(valido ? dispProfile.default_carrier : null);
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
        setAnalysis(translationsCacheRef.current.en);
      } else {
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

  // Cargar total de verificaciones de este mes
  useEffect(() => {
    if (!orgId) return;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startIso = startOfMonth.toISOString();

    base44.entities.DocumentVerification.filter({ organization_id: orgId })
      .then(docs => {
        const thisMonth = (docs || []).filter(d => (d.created_date || '') >= startIso);
        setMonthlyDocCount(thisMonth.length);
      })
      .catch(() => {});
  }, [orgId]);

  // Construcción de análisis local de respaldo cuando el backend o LLM no devuelven campos
  const buildLocalFallbackAnalysis = (rawText, autoCtx) => {
    const heur = extractLogisticsFieldsFromText(
      rawText,
      autoCtx?.emailSubject || '',
      autoCtx?.brokerName || ''
    );
    const rpm = heur.millas > 0 ? heur.tarifa_negociada / heur.millas : 0;
    return {
      resumen_ejecutivo: `Documento e hilo verificados para la ruta ${heur.origen} → ${heur.destino} (${heur.millas} mi) con tarifa de $${heur.tarifa_negociada.toLocaleString('en-US')}.`,
      semaforo_general: rpm >= 2.5 ? 'verde' : 'amarillo',
      veredicto: rpm >= 2.5 ? 'Aceptar' : 'Revisar antes de aceptar',
      alertas_criticas: [],
      puntos_negociar: [
        `Confirmar ventana de cita (${heur.citas}) con el broker ${heur.broker_nombre}`,
      ],
      categorias: [
        {
          categoriaKey: 'broker',
          categoria: 'Broker',
          semaforo: 'verde',
          hallazgos: [`✓ Broker detectado: ${heur.broker_nombre}`],
          datos_extraidos: { nombre: heur.broker_nombre, mc: 'Verificado en hilo', dot: '—' },
          recomendacion: 'Broker identificado en el hilo de correo',
        },
        {
          categoriaKey: 'date',
          categoria: 'Fechas y Operación',
          semaforo: 'verde',
          hallazgos: [
            `✓ Ruta: ${heur.origen} → ${heur.destino}`,
            `✓ Pickup: ${heur.fecha_carga} | Entrega: ${heur.fecha_entrega}`,
            `✓ Citas: ${heur.citas}`,
          ],
          datos_extraidos: {
            pickup: heur.fecha_carga,
            delivery: heur.fecha_entrega,
            ruta: `${heur.origen} → ${heur.destino}`,
            referencias: heur.numero_referencia || 'En correo',
          },
          recomendacion: 'Datos operativos listos para crear la carga',
        },
        {
          categoriaKey: 'rate',
          categoria: 'Rate y Condiciones de Pago',
          semaforo: rpm >= 2.5 ? 'verde' : 'amarillo',
          hallazgos: [
            `✓ Tarifa detectada: $${heur.tarifa_negociada.toLocaleString('en-US')} ($${rpm.toFixed(2)}/mi en ${heur.millas} mi)`,
          ],
          datos_extraidos: {
            tarifa: `$${heur.tarifa_negociada.toLocaleString('en-US')}`,
            por_milla: `$${rpm.toFixed(2)}/mi`,
            pago: 'Net 30',
          },
          recomendacion: 'Proceder con creación de carga y asignación de unidad',
        },
      ],
      datos_extraidos: {
        tipo_documento: 'rate_confirmation',
        origen: heur.origen,
        destino: heur.destino,
        millas: heur.millas,
        tarifa_total: heur.tarifa_negociada,
        tarifa_por_milla: Number(rpm.toFixed(2)),
        pickup_fecha: heur.fecha_carga,
        delivery_fecha: heur.fecha_entrega,
        appointment_window: heur.citas,
        broker_nombre: heur.broker_nombre,
        load_number: heur.numero_referencia,
        reference_number: heur.numero_referencia,
      },
      confidence_score: 90,
      foco_analisis: 'Modo Dispatcher — Automatización desde Correo y Documento Adjunto',
      analysis_source: 'new',
    };
  };

  const analyze = async (overrideText, overrideAutoCtx) => {
    const textToAnalyze = (overrideText !== undefined ? overrideText : documentText) || '';
    const activeAutoCtx = overrideAutoCtx !== undefined ? overrideAutoCtx : emailAutomationCtx;
    if (!textToAnalyze.trim() || loading) return;

    const maxDocs = limits?.DOCUMENTS_PER_MONTH ?? 3;
    if (!activeAutoCtx && monthlyDocCount >= maxDocs) {
      setShowLimitModal(true);
      return;
    }

    const isEsLocal = locale !== 'en';

    // H1: clasificar ANTES de analizar. Solo se analizan Rate Confirmations.
    const textForType = activeAutoCtx?.hasPdf
      ? textToAnalyze.split('=== HILO DE CORREO ASOCIADO ===')[0]
      : textToAnalyze;
    const docType = detectDocumentType(textForType);
    const NOT_RC = {
      bill_of_lading: isEsLocal ? 'un Bill of Lading' : 'a Bill of Lading',
      delivery_order: isEsLocal ? 'una Delivery Order' : 'a Delivery Order',
      rate_request: isEsLocal ? 'una solicitud de tarifa' : 'a rate request',
      market_report: isEsLocal ? 'un reporte de mercado' : 'a market report',
    };
    if (NOT_RC[docType]) {
      setAnalysis(null);
      setError(isEsLocal
        ? `Este documento no es un Rate Confirmation (parece ${NOT_RC[docType]}). El verificador solo analiza Rate Confirmations.`
        : `This document is not a Rate Confirmation (it looks like ${NOT_RC[docType]}). The checker only analyzes Rate Confirmations.`);
      return;
    }

    setLoading(true);
    setLoadingMsg(t.documents.extract);
    setError(null);
    setAnalysis(null);
    translationsCacheRef.current = { es: null, en: null };

    const t1 = setTimeout(() => setLoadingMsg(t.documents.validate), 3000);
    const t2 = setTimeout(() => setLoadingMsg(t.documents.verifyBroker), 6000);

    try {
      const res = await base44.functions.invoke('analyzeDocument', {
        documentText: textToAnalyze,
        selectedCarrierId,
      });

      clearTimeout(t1);
      clearTimeout(t2);

      if (res.data?.analysis) {
        setMonthlyDocCount(prev => prev + 1);
        // M6: nada de "null" literal en pantalla
        let rawAnalysis = cleanNullStrings(
          { ...res.data.analysis, cached: res.data.cached || false },
          locale === 'en' ? 'Not specified' : 'No especificado'
        );
        // Enriquecer datos_extraidos con heurística local si algún campo vino vacío por límite de tokens IA
        const fallbackLocal = buildLocalFallbackAnalysis(textToAnalyze, activeAutoCtx);
        rawAnalysis.datos_extraidos = {
          ...fallbackLocal.datos_extraidos,
          ...Object.fromEntries(
            Object.entries(rawAnalysis.datos_extraidos || {}).filter(([, v]) => v != null && v !== '')
          ),
        };

        // U3: penalidad / TONU no pagado / MC inválido = alerta crítica, en todos los planes
        rawAnalysis = applyRiskGuards(rawAnalysis, textForType);

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
      } else {
        // H4: antes se inventaba un análisis "local" (con veredicto y Net 30) cuando
        // el servidor fallaba. Ahora se muestra un mensaje claro y se puede reintentar.
        console.error('[DocumentAnalyzer] analyzeDocument sin análisis:', res?.data);
        setError(isEsLocal
          ? 'No pudimos analizar el documento. Revisa que sea un Rate Confirmation legible e intenta de nuevo.'
          : 'We could not analyze the document. Make sure it is a readable Rate Confirmation and try again.');
      }
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      // H4: nunca mostrar "Request failed with status code 400" al usuario.
      console.error('[DocumentAnalyzer] Error analyzeDocument:', err?.response?.status, err?.response?.data || err);
      const status = err?.response?.status;
      // Si el servidor explica el motivo, se muestra tal cual (no se tapa con el genérico).
      const motivo = err?.response?.data?.error;
      setError(status === 400 && motivo
        ? motivo
        : status === 400
        ? (isEsLocal
            ? 'No pudimos leer el documento o no es un Rate Confirmation. Prueba con otro archivo o pega el texto.'
            : 'We could not read the document or it is not a Rate Confirmation. Try another file or paste the text.')
        : (isEsLocal
            ? 'Hubo un problema al verificar el documento. Intenta de nuevo en unos segundos.'
            : 'There was a problem verifying the document. Try again in a few seconds.'));
    } finally {
      setLoading(false);
    }
  };

  // Detectar si venimos desde el botón amarillo "Automatización" en Emails y ejecutar la verificación automáticamente
  useEffect(() => {
    if (autoVerifyTriggeredRef.current) return;
    try {
      const rawAuto = sessionStorage.getItem(AUTOMATION_EMAIL_TO_CHECKER_KEY);
      if (!rawAuto) return;
      autoVerifyTriggeredRef.current = true;
      sessionStorage.removeItem(AUTOMATION_EMAIL_TO_CHECKER_KEY);

      const parsed = JSON.parse(rawAuto);
      if (parsed?.documentText) {
        setEmailAutomationCtx(parsed);
        setDocumentText(parsed.documentText);
        if (parsed.fileName) setFileName(parsed.fileName);
        analyze(parsed.documentText, parsed);
      }
    } catch (e) {
      console.warn('[DocumentAnalyzer] Error iniciando automatización desde correo:', e);
    }
  }, []);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    setFileName(file.name);
    setError(null);
    setAnalysis(null);
    setDocumentText('');
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

  // Enviar los datos ya verificados + el hilo resumido (direcciones, fechas, citas) a Mis Cargas (/cargas)
  const handleProceedToCreateLoad = () => {
    const extracted = analysis?.datos_extraidos || {};
    const prefilledLoad = buildThreadSummaryForLoad({
      threadMessages: emailAutomationCtx?.threadMessages || [],
      extracted,
      // Los datos salen del DOCUMENTO analizado (antes no se pasaba el texto)
      rawDocumentText: documentText || '',
      emailSubject: emailAutomationCtx?.emailSubject || fileName || '',
      brokerEmail: emailAutomationCtx?.brokerEmail || '',
    });

    const payloadToLoads = {
      ...prefilledLoad,
      broker_email: emailAutomationCtx?.brokerEmail || '',
      thread_id: emailAutomationCtx?.threadId || null,
      rfc_message_id: emailAutomationCtx?.rfcMessageId || null,
      threadMessages: emailAutomationCtx?.threadMessages || [],
      emailSubject: emailAutomationCtx?.emailSubject || '',
      fromAutomation: true,
    };

    sessionStorage.setItem(AUTOMATION_CHECKER_TO_LOAD_KEY, JSON.stringify(payloadToLoads));
    navigate('/cargas?auto_create=1');
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

      <DemoLimitModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        entityName="verificaciones este mes"
        currentCount={monthlyDocCount}
        maxLimit={limits?.DOCUMENTS_PER_MONTH || 50}
      />

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
          onChange={e => {
            setDocumentText(e.target.value);
            // H4: si el usuario escribe/pega, ya no se trabaja con el archivo anterior
            if (fileName) setFileName('');
            if (error) setError(null);
          }}
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
          onClick={() => analyze()}
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
          <ResultHeader analysis={analysis} onLinkToLoad={handleProceedToCreateLoad} cached={analysis.cached} />

          {/* Crear carga SOLO desde una confirmación; una solicitud de tarifa no crea carga */}
          {(() => {
            const isEsLocal = locale !== 'en';
            const textForType = emailAutomationCtx?.hasPdf
              ? String(documentText || '').split('=== HILO DE CORREO ASOCIADO ===')[0]
              : String(documentText || '');
            const kind = classifyLoadDocument(textForType, analysis?.datos_extraidos?.tipo_documento);
            if (kind === 'rate_request') {
              return (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 flex gap-2.5">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">{isEsLocal ? 'Es una solicitud de tarifa, no una rate confirmation' : 'This is a rate request, not a rate confirmation'}</p>
                    <p className="text-xs text-amber-200/80 mt-1">
                      {isEsLocal
                        ? 'Todavía no hay carga que crear. Responde al broker con tu cotización; cuando llegue la rate confirmation, pásala por el verificador.'
                        : 'There is no load to create yet. Reply to the broker with your quote; when the rate confirmation arrives, run it through the checker.'}
                    </p>
                  </div>
                </div>
              );
            }
            return (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {kind === 'confirmation'
                    ? (isEsLocal ? 'Rate confirmation detectada. Revisa los datos antes de guardar la carga.' : 'Rate confirmation detected. Review the data before saving the load.')
                    : (isEsLocal ? 'No se pudo confirmar el tipo de documento. Revisa bien los datos antes de guardar.' : 'Could not confirm the document type. Review the data carefully before saving.')}
                </p>
                <button
                  type="button"
                  onClick={handleProceedToCreateLoad}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground whitespace-nowrap"
                >
                  <Package className="w-3.5 h-3.5" />
                  {isEsLocal ? 'Crear carga con estos datos' : 'Create load from this data'}
                </button>
              </div>
            );
          })()}
          <KeyFindings categorias={analysis.categorias} />

          {/* Si es usuario demo, mostramos el resto difuminado y la ventana/tarjeta de desbloqueo superpuesta */}
          {isDemoUser ? (
            <div className="relative mt-4">
              <div className="filter blur-[6px] opacity-30 pointer-events-none select-none space-y-3">
                <CategoryGrid categorias={analysis.categorias} />
                <ActionBlock veredicto={analysis.veredicto} puntos_negociar={analysis.puntos_negociar} />
                <LoadMatch datos_extraidos={analysis.datos_extraidos} />
              </div>

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
                      href="https://www.trucky-ai.com"
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
