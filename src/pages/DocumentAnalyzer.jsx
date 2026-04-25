import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSearch, Upload, XCircle, Loader2, Image,
  FileText, AlertTriangle, ChevronDown, ChevronUp
} from 'lucide-react';
import { analyzeDocument } from '@/functions/analyzeDocument';
import { base44 } from '@/api/base44Client';
import CategoryCard from '@/components/doc-analyzer/CategoryCard';
import VeredictoCard from '@/components/doc-analyzer/VeredictoCard';

const ACCEPTED_TYPES = '.txt,.pdf,.jpg,.jpeg,.png,.csv';

export default function DocumentAnalyzer() {
  const [documentText, setDocumentText] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [showPuntos, setShowPuntos] = useState(false);
  const navigate = useNavigate();

  const analyze = async () => {
    if (!documentText.trim() || loading) return;
    setLoading(true);
    setLoadingMsg('Extrayendo datos del documento...');
    setError(null);
    setAnalysis(null);

    setTimeout(() => setLoadingMsg('Validando contra reglas de negocio...'), 3000);
    setTimeout(() => setLoadingMsg('Verificando broker y carrier...'), 6000);

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
    setAnalysis(null);

    if (['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) {
      setLoading(true);
      setLoadingMsg('Procesando archivo...');
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        const extracted = await base44.integrations.Core.InvokeLLM({
          prompt: 'Extract all text content from this document exactly as it appears. Return only the raw text, no commentary.',
          file_urls: [file_url],
        });
        setDocumentText(typeof extracted === 'string' ? extracted : JSON.stringify(extracted));
      } catch {
        setError('No se pudo procesar el archivo. Intenta pegar el texto directamente.');
      }
      setLoading(false);
    } else if (['txt', 'csv'].includes(ext)) {
      const text = await file.text();
      setDocumentText(text);
    } else {
      setError('Formato no soportado. Usa PDF, JPG, PNG o TXT.');
    }
    e.target.value = '';
  };

  const handleLinkToLoad = () => {
    const summary = analysis?.resumen_ejecutivo || '';
    const params = new URLSearchParams({ from_doc: '1', doc_summary: summary.slice(0, 200) });
    navigate(`/cargas?${params.toString()}`);
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <FileSearch className="w-5 h-5 text-primary" />
          Verificador de Documentos
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Rate Confirmations · Delivery Orders — análisis operativo, comercial e identidad
        </p>
      </div>

      {/* Input */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <label className="text-sm font-medium text-foreground">Pega el texto o sube el documento</label>
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            {fileName
              ? <span className="text-primary max-w-32 truncate">{fileName}</span>
              : <span>Subir PDF / JPG / PNG / TXT</span>
            }
            <input type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleFile} />
          </label>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Image className="w-3 h-3 flex-shrink-0" />
          <span>Acepta PDF, JPG, PNG, TXT — Solo Rate Confirmations y Delivery Orders</span>
        </div>

        <textarea
          value={documentText}
          onChange={e => setDocumentText(e.target.value)}
          placeholder={`Pega aquí el texto del Rate Confirmation o Delivery Order...

RATE CONFIRMATION
Broker: XYZ Logistics LLC  MC: 123456
Carrier: Larcofer USA
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
              Verificar Documento
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
              <p className="text-xs mt-1 text-muted-foreground">Por seguridad, no procesamos información bancaria ni documentos sensibles.</p>
            )}
          </div>
        </div>
      )}

      {/* Resultados */}
      {analysis && (
        <div className="space-y-3">
          {/* Veredicto */}
          <VeredictoCard analysis={analysis} onLinkToLoad={handleLinkToLoad} />

          {/* Alertas críticas */}
          {analysis.alertas_criticas?.length > 0 && (
            <div className="bg-red-400/5 border border-red-400/20 rounded-xl p-4">
              <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Alertas Críticas
              </p>
              <ul className="space-y-1">
                {analysis.alertas_criticas.map((a, i) => (
                  <li key={i} className="text-xs text-foreground flex gap-2">
                    <span className="text-red-400 flex-shrink-0 font-bold">!</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Categorías — 7 cards */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide px-1">Análisis por Categoría</p>
            {analysis.categorias?.map((cat, i) => (
              <CategoryCard
                key={i}
                cat={cat}
                defaultExpanded={cat.semaforo === 'rojo'}
              />
            ))}
          </div>

          {/* Puntos a negociar */}
          {analysis.puntos_negociar?.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-3"
                onClick={() => setShowPuntos(!showPuntos)}
              >
                <p className="text-xs font-bold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                  Puntos a Negociar ({analysis.puntos_negociar.length})
                </p>
                {showPuntos
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                }
              </button>
              {showPuntos && (
                <div className="px-4 pb-4 space-y-1.5 border-t border-border pt-3">
                  {analysis.puntos_negociar.map((p, i) => (
                    <div key={i} className="text-xs text-foreground flex gap-2">
                      <span className="text-primary flex-shrink-0 font-bold">{i + 1}.</span>
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}