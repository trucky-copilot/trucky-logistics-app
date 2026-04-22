import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSearch, Upload, CheckCircle2, AlertTriangle, XCircle, Loader2, FileText, ChevronDown, ChevronUp, Package, Image } from 'lucide-react';
import { analyzeDocument } from '@/functions/analyzeDocument';
import { base44 } from '@/api/base44Client';

const SEMAFORO = {
  verde: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/20', label: 'Sin problemas' },
  amarillo: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/20', label: 'Revisar' },
  rojo: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/20', label: 'Problema serio' },
};

const VEREDICTO_CONFIG = {
  FIRMAR: { color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/20', label: '✓ PUEDE FIRMAR' },
  NEGOCIAR: { color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/20', label: '⚠ NEGOCIAR ANTES' },
  RECHAZAR: { color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/20', label: '✕ RECHAZAR' },
};

// Accepted file types
const ACCEPTED_TYPES = '.txt,.pdf,.jpg,.jpeg,.png,.csv';

function CategoryCard({ cat }) {
  const [expanded, setExpanded] = useState(false);
  const config = SEMAFORO[cat.semaforo] || SEMAFORO.amarillo;
  const Icon = config.icon;

  return (
    <div className={`rounded-xl border p-4 ${config.bg}`}>
      <button className="w-full flex items-center justify-between" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2.5">
          <Icon className={`w-4 h-4 ${config.color} flex-shrink-0`} />
          <span className="text-sm font-medium text-foreground">{cat.categoria}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2.5 border-t border-white/10 pt-3">
          {cat.hallazgos?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Hallazgos:</p>
              <ul className="space-y-1">
                {cat.hallazgos.map((h, i) => (
                  <li key={i} className="text-xs text-foreground flex gap-1.5">
                    <span className="mt-0.5 flex-shrink-0">•</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cat.clausula_texto && cat.clausula_texto !== 'No aplica' && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Cláusula encontrada:</p>
              <p className="text-xs text-foreground font-mono bg-black/20 rounded p-2 italic">"{cat.clausula_texto}"</p>
            </div>
          )}
          {cat.recomendacion && (
            <div className="bg-black/20 rounded-lg p-2.5">
              <p className="text-xs font-medium text-muted-foreground mb-0.5">Recomendación:</p>
              <p className="text-xs text-foreground">{cat.recomendacion}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DocumentAnalyzer() {
  const [documentText, setDocumentText] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [linkingLoad, setLinkingLoad] = useState(false);
  const [loadLinked, setLoadLinked] = useState(false);
  const navigate = useNavigate();

  const analyze = async () => {
    if (!documentText.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setLoadLinked(false);

    const res = await analyzeDocument({ documentText });
    if (res.data?.analysis) {
      setAnalysis(res.data.analysis);
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

    // Image or PDF — upload and use LLM vision
    if (['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) {
      setLoading(true);
      setAnalysis(null);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        // Use LLM to extract text from image/PDF first
        const extracted = await base44.integrations.Core.InvokeLLM({
          prompt: 'Extract all text content from this document exactly as it appears. Return only the raw text, no commentary.',
          file_urls: [file_url],
        });
        setDocumentText(typeof extracted === 'string' ? extracted : JSON.stringify(extracted));
      } catch (err) {
        setError('No se pudo procesar el archivo. Intenta pegar el texto directamente.');
      }
      setLoading(false);
    } else if (['txt', 'csv'].includes(ext)) {
      const text = await file.text();
      setDocumentText(text);
    } else {
      setError('Formato no soportado. Sube un archivo PDF, JPG, PNG o TXT.');
    }

    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleLinkToLoad = async () => {
    setLinkingLoad(true);
    // Navigate to loads page with document text as query param hint
    // The loads page will show the form pre-filled from the analysis
    const summary = analysis?.resumen_ejecutivo || '';
    const params = new URLSearchParams({ from_doc: '1', doc_summary: summary.slice(0, 200) });
    navigate(`/cargas?${params.toString()}`);
  };

  const veredicto = analysis ? VEREDICTO_CONFIG[analysis.veredicto] : null;
  const generalConfig = analysis ? SEMAFORO[analysis.semaforo_general] : null;
  const GeneralIcon = generalConfig?.icon;
  const hasAbusiveClauses = analysis?.categorias?.some(c => c.semaforo === 'rojo');

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <FileSearch className="w-5 h-5 text-primary" />
          Verificador de Documentos
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Rate Confirmations y Delivery Orders — detecta cláusulas abusivas</p>
      </div>

      {/* Input area */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <label className="text-sm font-medium text-foreground">Pega el texto o sube el documento</label>
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            {fileName ? (
              <span className="text-primary max-w-32 truncate">{fileName}</span>
            ) : (
              <span>Subir PDF / JPG / PNG / TXT</span>
            )}
            <input type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFile} />
          </label>
        </div>

        {/* Accepted formats note */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Image className="w-3 h-3" />
          <span>Acepta PDF, JPG, PNG, TXT — Solo Rate Confirmations y Delivery Orders</span>
        </div>

        <textarea
          value={documentText}
          onChange={e => setDocumentText(e.target.value)}
          placeholder={`Pega aquí el texto del rate confirmation o delivery order...

Ejemplo:
RATE CONFIRMATION
Broker: XYZ Logistics LLC
Carrier: Larcofer USA
Route: Miami, FL → Tampa, FL
Rate: $1,500 flat (redondo)
Payment terms: Net 30 after delivery + POD
Detention: $75/hr after 2 free hours
Late delivery penalty: $250/hour...`}
          rows={8}
          className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none font-mono"
        />
        <button
          onClick={analyze}
          disabled={!documentText.trim() || loading}
          className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {fileName && ['jpg','jpeg','png','pdf'].some(e => fileName.endsWith(e)) && !analysis
                ? 'Extrayendo texto del archivo...'
                : 'Analizando con IA...'}
            </>
          ) : (
            <>
              <FileSearch className="w-4 h-4" />
              Analizar Documento
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-4 rounded-xl bg-red-400/10 border border-red-400/20 text-sm text-red-400">
          <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">{error}</p>
            {error.includes('Solo verifico') && (
              <p className="text-xs mt-1 text-muted-foreground">Por seguridad, no proceso información bancaria ni documentos sensibles.</p>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {analysis && (
        <div className="space-y-4">
          {/* Veredicto general */}
          <div className={`rounded-xl border p-4 ${veredicto?.bg}`}>
            <div className="flex items-center gap-3 mb-2">
              {GeneralIcon && <GeneralIcon className={`w-6 h-6 ${generalConfig?.color}`} />}
              <div className="flex-1">
                <div className={`text-lg font-bold ${veredicto?.color}`}>{veredicto?.label}</div>
                <div className="text-xs text-muted-foreground">Semáforo: {analysis.semaforo_general?.toUpperCase()}</div>
              </div>
              {/* Link to loads button — show when abusive clauses found */}
              {hasAbusiveClauses && !loadLinked && (
                <button
                  onClick={handleLinkToLoad}
                  disabled={linkingLoad}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                >
                  <Package className="w-3.5 h-3.5" />
                  Registrar carga
                </button>
              )}
              {loadLinked && (
                <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Vinculado
                </span>
              )}
            </div>
            <p className="text-sm text-foreground">{analysis.resumen_ejecutivo}</p>
          </div>

          {/* Critical alerts */}
          {analysis.alertas_criticas?.length > 0 && (
            <div className="bg-red-400/5 border border-red-400/20 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-1.5">
                <XCircle className="w-4 h-4" />
                Alertas Críticas
              </p>
              <ul className="space-y-1">
                {analysis.alertas_criticas.map((a, i) => (
                  <li key={i} className="text-xs text-foreground flex gap-1.5">
                    <span className="text-red-400 flex-shrink-0">!</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Categories */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Análisis por Categoría</h3>
            {analysis.categorias?.map((cat, i) => (
              <CategoryCard key={i} cat={cat} />
            ))}
          </div>

          {/* Negotiation points */}
          {analysis.puntos_negociar?.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-primary" />
                Puntos a Negociar
              </p>
              <ul className="space-y-1">
                {analysis.puntos_negociar.map((p, i) => (
                  <li key={i} className="text-xs text-foreground flex gap-1.5">
                    <span className="text-primary flex-shrink-0">→</span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}