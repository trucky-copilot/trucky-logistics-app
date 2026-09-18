import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSearch, Upload, XCircle, Loader2, Image,
  Truck, Users
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

const ACCEPTED_TYPES = '.txt,.pdf,.jpg,.jpeg,.png,.csv';

export default function DocumentAnalyzer() {
  const orgId = useOrganizationId();
  const { t, locale } = useLanguage();
  const [documentText, setDocumentText] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [analysis, setAnalysis] = useState(null);
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

  const analyze = async () => {
    if (!documentText.trim() || loading) return;
    setLoading(true);
    setLoadingMsg(t.documents.extract);
    setError(null);
    setAnalysis(null);

    const t1 = setTimeout(() => setLoadingMsg(t.documents.validate), 3000);
    const t2 = setTimeout(() => setLoadingMsg(t.documents.verifyBroker), 6000);

    const res = await base44.functions.invoke('analyzeDocument', {
      documentText,
      selectedCarrierId,
      locale,
   });

    clearTimeout(t1);
    clearTimeout(t2);

    if (res.data?.analysis) {
      setAnalysis({ ...res.data.analysis, cached: res.data.cached || false });
    } else if (res.data?.error) {
      setError(res.data.error);
    }
    setLoading(false);
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    setFileName(file.name);
    setError(null);
    setAnalysis(null);

    if (['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) {
      setLoading(true);
      setLoadingMsg(t.documents.process);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        const extracted = await base44.integrations.Core.InvokeLLM({
          prompt: 'Extract all text content from this document exactly as it appears. Return only the raw text, no commentary.',
          file_urls: [file_url],
        });
        setDocumentText(typeof extracted === 'string' ? extracted : JSON.stringify(extracted));
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
        <div className="space-y-3">
          <ResultHeader analysis={analysis} onLinkToLoad={handleLinkToLoad} cached={analysis.cached} />
          <KeyFindings categorias={analysis.categorias} />
          <CategoryGrid categorias={analysis.categorias} />
          <ActionBlock veredicto={analysis.veredicto} puntos_negociar={analysis.puntos_negociar} />
          <LoadMatch datos_extraidos={analysis.datos_extraidos} />
        </div>
      )}
    </div>
  );
}