import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldAlert, Save, FileText, Upload, Loader2, CheckCircle2 } from 'lucide-react';

export default function AdminDashboard() {

  const [ticker, setTicker] = useState({
    dry_van: '', reefer: '', flatbed: '', step_deck: '', power_only: '', container: '', diesel: ''
  });
  const [savingTicker, setSavingTicker] = useState(false);
  const [textData, setTextData] = useState('');
  const [pendingContainerRoutes, setPendingContainerRoutes] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loadingOCR, setLoadingOCR] = useState(false);
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '', type: 'success' });
  
  useEffect(() => {
    // Load existing ticker
    try {
      base44.entities.GlobalMarketTicker.filter()
        .then(records => {
          const res = records.find(r => r.id === 'global') || records[0];
          if (res) {
            setTicker({
              dry_van: res.dry_van || '',
              reefer: res.reefer || '',
              flatbed: res.flatbed || '',
              step_deck: res.step_deck || '',
              power_only: res.power_only || '',
              container: res.container || '',
              diesel: res.diesel || ''
            });
          }
        }).catch(err => {
          console.error("Error loading ticker", err);
        });
    } catch (e) {
      console.error("Query GlobalMarketTicker failed", e);
    }
  }, []);

  const handleTickerSave = async () => {
    setSavingTicker(true);
    try {
      const formatted = {
        dry_van: parseFloat(ticker.dry_van) || null,
        reefer: parseFloat(ticker.reefer) || null,
        flatbed: parseFloat(ticker.flatbed) || null,
        step_deck: parseFloat(ticker.step_deck) || null,
        power_only: parseFloat(ticker.power_only) || null,
        container: parseFloat(ticker.container) || null,
        diesel: parseFloat(ticker.diesel) || null
      };
      await base44.functions.invoke('adminUpdateTicker', formatted);
      // Notifica al MarketTicker para actualizar la cinta al instante sin recargar
      window.dispatchEvent(new CustomEvent('tickerUpdated', { detail: formatted }));
      setModal({
        isOpen: true,
        title: 'Se guardaron los datos',
        message: 'La cinta superior nacional fue actualizada exitosamente.',
        type: 'success'
      });
      // Borra los campos después de guardar
      setTicker({ dry_van: '', reefer: '', flatbed: '', step_deck: '', power_only: '', container: '', diesel: '' });
    } catch (e) {
      console.error(e);
      setModal({
        isOpen: true,
        title: 'Error al guardar',
        message: 'No se pudo guardar la cinta. Inténtalo nuevamente.',
        type: 'error'
      });
    }
    setSavingTicker(false);
  };

  const handleStateDataUpload = async () => {
    if (!textData.trim() && pendingContainerRoutes.length === 0) return;
    setUploading(true);
    try {
      const res = await base44.functions.invoke('adminUploadStateData', { 
        textData,
        containerRoutes: pendingContainerRoutes
      });
      if (res && res.data && res.data.success) {
        let msg = 'Datos procesados y guardados exitosamente.';
        if (res.data.containerRoutesParsed > 0) {
          msg += ` Se actualizaron ${res.data.containerRoutesParsed} tarifas de contenedor en el sistema.`;
        }
        if (res.data.statesParsed > 0) {
          msg += ` Se actualizaron ${res.data.statesParsed} estados.`;
        }
        setModal({
          isOpen: true,
          title: 'Se cargaron los datos',
          message: msg,
          type: 'success'
        });
        setTextData('');
        setPendingContainerRoutes([]);
      } else {
        setModal({
          isOpen: true,
          title: 'Error al procesar',
          message: 'No se pudo procesar el documento. Verifica el formato e inténtalo de nuevo.',
          type: 'error'
        });
      }
    } catch (e) {
      console.error(e);
      setModal({
        isOpen: true,
        title: 'Error al procesar',
        message: 'Ocurrió un error al enviar el documento a procesar.',
        type: 'error'
      });
    }
    setUploading(false);
  };

  const loadXLSX = async () => {
    if (window.XLSX) return window.XLSX;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => reject(new Error('No se pudo cargar el visor de Excel'));
      document.head.appendChild(script);
    });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (['xlsx', 'xls'].includes(ext)) {
      setLoadingOCR(true);
      try {
        const XLSX = await loadXLSX();
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        
        let fullTablesMarkdown = '';
        const allExtractedRoutes = [];

        // Detectar estado por nombre de archivo
        let fileState = '';
        const lowerName = file.name.toLowerCase();
        if (lowerName.includes('fl') || lowerName.includes('florida')) fileState = 'FL';
        else if (lowerName.includes('tx') || lowerName.includes('texas')) fileState = 'TX';

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (!rawRows || rawRows.length === 0) continue;

          // Filtrar filas completamente vacías
          const rows = rawRows.filter(r => Array.isArray(r) && r.some(cell => String(cell).trim() !== ''));
          if (rows.length === 0) continue;

          let sheetState = fileState;
          const lowerSheet = sheetName.toLowerCase();
          if (lowerSheet.includes('fl') || lowerSheet.includes('florida')) sheetState = 'FL';
          else if (lowerSheet.includes('tx') || lowerSheet.includes('texas')) sheetState = 'TX';

          fullTablesMarkdown += `### Hoja: ${sheetName}\n\n`;

          // Detectar la fila de encabezados
          let headerIndex = 0;
          for (let i = 0; i < Math.min(6, rows.length); i++) {
            const strCells = rows[i].filter(c => typeof c === 'string' && c.trim().length > 0);
            if (strCells.length >= 2) {
              headerIndex = i;
              break;
            }
          }

          const rawHeaders = rows[headerIndex].map(h => String(h || '').trim());
          const maxCols = Math.max(...rows.slice(headerIndex).map(r => r.length));
          const headers = Array.from({ length: maxCols }, (_, i) => rawHeaders[i] || `Col ${i + 1}`);

          // Construir tabla Markdown organizada
          fullTablesMarkdown += `| ${headers.join(' | ')} |\n`;
          fullTablesMarkdown += `| ${headers.map(() => '---').join(' | ')} |\n`;

          // Detectar columnas clave para rutas y tarifas de contenedor
          let colCiudad = -1;
          let colZona = -1;
          let colPuerto = -1;
          let colMillas = -1;
          let colGrupo = -1;
          let colP20 = -1, colPiso20 = -1;
          let colP40 = -1, colPiso40 = -1;
          let colP45 = -1;
          let colP20H = -1;
          let colEstado = -1;

          headers.forEach((h, idx) => {
            const hl = h.toLowerCase().trim();
            if (hl.includes('ciudad') || hl.includes('city') || hl.includes('destino') || hl.includes('destination')) colCiudad = idx;
            else if (hl.includes('zona') || hl.includes('zone')) colZona = idx;
            else if (hl.includes('puerto') || hl.includes('port') || hl.includes('mercado') || hl.includes('market')) colPuerto = idx;
            else if (hl.includes('milla') || hl.includes('mile')) colMillas = idx;
            else if (hl.includes('grupo') || hl.includes('group')) colGrupo = idx;
            else if (hl.includes('estado') || hl.includes('state')) colEstado = idx;
            else if (hl.includes('heavy') || hl.includes('20h') || hl.includes('20 h') || hl.includes('pesado')) colP20H = idx;
            else if (hl.includes('45')) colP45 = idx;
            else if (hl.includes('20')) {
              if (hl.includes('piso') || hl.includes('floor')) colPiso20 = idx;
              else colP20 = idx;
            }
            else if (hl.includes('40')) {
              if (hl.includes('piso') || hl.includes('floor')) colPiso40 = idx;
              else colP40 = idx;
            }
          });

          for (let r = headerIndex + 1; r < rows.length; r++) {
            const row = rows[r];
            const rowValues = Array.from({ length: maxCols }, (_, i) => {
              const val = row[i];
              if (val === null || val === undefined) return '';
              if (typeof val === 'number') {
                return Number.isInteger(val) ? String(val) : val.toFixed(2);
              }
              return String(val).replace(/\|/g, '-').trim();
            });

            fullTablesMarkdown += `| ${rowValues.join(' | ')} |\n`;

            // Extraer tarifas estructuradas de contenedor
            if (colCiudad >= 0 && (colP20 >= 0 || colP40 >= 0 || colP45 >= 0)) {
              const ciudadVal = String(row[colCiudad] || '').trim();
              const millasVal = colMillas >= 0 ? parseFloat(String(row[colMillas]).replace(/[^0-9.]/g, '')) : null;
              const rowState = colEstado >= 0 ? String(row[colEstado] || '').trim().toUpperCase() : sheetState;

              if (ciudadVal && !ciudadVal.toLowerCase().includes('total') && (rowState === 'FL' || rowState === 'TX' || rowState.length === 2)) {
                const parseNum = (idx) => {
                  if (idx < 0 || row[idx] === undefined || row[idx] === null) return null;
                  const n = parseFloat(String(row[idx]).replace(/[^0-9.]/g, ''));
                  return isFinite(n) && n > 0 ? n : null;
                };

                const p20 = parseNum(colP20);
                const piso20 = parseNum(colPiso20);
                const p40 = parseNum(colP40);
                const piso40 = parseNum(colPiso40);
                const p45 = parseNum(colP45);
                const p20h = parseNum(colP20H);

                if (p20 || p40 || p45 || p20h) {
                  allExtractedRoutes.push({
                    estado: rowState || 'FL',
                    ciudad: ciudadVal,
                    mercado: colPuerto >= 0 ? String(row[colPuerto] || '').trim() : null,
                    zona: colZona >= 0 ? String(row[colZona] || '').trim() : null,
                    grupo: colGrupo >= 0 ? String(row[colGrupo] || '').trim() : null,
                    millas_ida: millasVal && isFinite(millasVal) ? millasVal : 0,
                    precio_20: p20,
                    piso_20: piso20,
                    precio_40: p40,
                    piso_40: piso40,
                    precio_45: p45,
                    piso_45: null,
                    precio_20_heavy: p20h,
                    piso_20_heavy: null,
                    fuente: file.name
                  });
                }
              }
            }
          }
          fullTablesMarkdown += '\n';
        }

        setTextData(fullTablesMarkdown.trim());
        setPendingContainerRoutes(allExtractedRoutes);
      } catch (err) {
        console.error(err);
        setModal({
          isOpen: true,
          title: 'Error al leer Excel',
          message: `Error al procesar el archivo Excel: ${err.message}`,
          type: 'error'
        });
      }
      setLoadingOCR(false);
    } else if (ext === 'pdf') {
      setLoadingOCR(true);
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
        setTextData(text);
        setPendingContainerRoutes([]);
      } catch (err) {
        console.error(err);
        setModal({
          isOpen: true,
          title: 'Error al leer PDF',
          message: `Error al leer PDF localmente: ${err.message}`,
          type: 'error'
        });
      }
      setLoadingOCR(false);
    } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
      setLoadingOCR(true);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        const extracted = await base44.integrations.Core.InvokeLLM({
          prompt: 'Extract all text content from this document exactly as it appears. Return only the raw text, no commentary.',
          file_urls: [file_url],
        });
        setTextData(typeof extracted === 'string' ? extracted : JSON.stringify(extracted));
        setPendingContainerRoutes([]);
      } catch (err) {
        console.error(err);
        setModal({
          isOpen: true,
          title: 'Error al extraer imagen',
          message: `Error al extraer texto de imagen: ${err.message}`,
          type: 'error'
        });
      }
      setLoadingOCR(false);
    } else if (['txt', 'csv'].includes(ext)) {
      const text = await file.text();
      setTextData(text);
      setPendingContainerRoutes([]);
    } else {
      setModal({
        isOpen: true,
        title: 'Formato no soportado',
        message: 'Por favor utiliza un archivo Excel (.xlsx, .xls), PDF, JPG, PNG, CSV o TXT.',
        type: 'error'
      });
    }
    e.target.value = '';
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in">
      <div className="flex items-center gap-3 border-b border-white/10 pb-4">
        <ShieldAlert className="w-8 h-8 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold text-white">Panel de Administración</h1>
          <p className="text-white/60 text-sm">Control global del mercado y la IA</p>
        </div>
      </div>

      {/* Ticker Form */}
      <div className="bg-[#1C1C1E] border border-white/5 p-6 rounded-2xl space-y-4">
        <h2 className="text-lg font-semibold text-white">Cinta Superior (Nacional)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.keys(ticker).map(key => (
            <div key={key}>
              <label className="block text-xs font-medium text-white/60 mb-1 capitalize">
                {key.replace('_', ' ')}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">$</span>
                <input 
                  type="number" step="0.01"
                  value={ticker[key]}
                  onChange={e => setTicker({...ticker, [key]: e.target.value})}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-7 pr-3 text-white focus:outline-none focus:border-amber-500/50"
                  placeholder="0.00"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end pt-2">
          <button 
            onClick={handleTickerSave}
            disabled={savingTicker}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-black px-4 py-2 rounded-xl font-medium transition-colors"
          >
            <Save className="w-4 h-4" /> Guardar Cinta
          </button>
        </div>
      </div>

      {/* AI Market Data Parser */}
      <div className="bg-[#1C1C1E] border border-white/5 p-6 rounded-2xl space-y-4">
        <h2 className="text-lg font-semibold text-white">Actualizar Tarifas por Estado y Contenedores</h2>
        <p className="text-sm text-white/50">Pega aquí el reporte del mercado o sube directamente tu archivo Excel (.xlsx), PDF o imagen. El sistema organizará los datos en tablas y actualizará las tarifas para que el chat las utilice.</p>
        
        <textarea
          value={textData}
          onChange={e => setTextData(e.target.value)}
          placeholder="Pega el texto aquí o sube un archivo Excel (.xlsx), PDF o imagen..."
          disabled={loadingOCR}
          className="w-full h-48 bg-white/5 border border-white/10 rounded-xl p-4 text-white font-mono text-xs focus:outline-none focus:border-amber-500/50 resize-none disabled:opacity-50"
        ></textarea>

        {textData && !loadingOCR && (
          <p className="text-xs text-emerald-400/80 font-medium">✓ Documento listo para procesar{pendingContainerRoutes.length > 0 ? ` (${pendingContainerRoutes.length} tarifas de contenedor detectadas)` : ''}. Haz clic en "Analizar con IA".</p>
        )}
        
        <div className="flex justify-between pt-2">
          <div className="relative">
            <input 
              type="file" 
              accept=".xlsx,.xls,.pdf,.jpg,.jpeg,.png,.txt,.csv" 
              onChange={handleFileUpload}
              disabled={loadingOCR || uploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <button 
              disabled={loadingOCR || uploading}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              {loadingOCR ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {loadingOCR ? 'Procesando...' : 'Cargar Archivo (Excel, PDF, IMG)'}
            </button>
          </div>

          <button 
            onClick={handleStateDataUpload}
            disabled={uploading || loadingOCR || (!textData.trim() && pendingContainerRoutes.length === 0)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl font-medium transition-colors disabled:opacity-50 min-w-[150px] justify-center"
          >
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Upload className="w-4 h-4" /> Analizar con IA
              </>
            )}
          </button>
        </div>
      </div>

      {/* Modal estilizado con diseño de la aplicación */}
      {modal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#1C1C1E] border border-white/10 rounded-2xl w-full max-w-sm p-6 text-center space-y-4 shadow-2xl">
            <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center ${
              modal.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
            }`}>
              {modal.type === 'error' ? (
                <ShieldAlert className="w-6 h-6" />
              ) : (
                <CheckCircle2 className="w-6 h-6" />
              )}
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                {modal.title}
              </h3>
              {modal.message && (
                <p className="text-xs text-white/60 mt-1 leading-relaxed">
                  {modal.message}
                </p>
              )}
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setModal({ ...modal, isOpen: false })}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all shadow-lg shadow-blue-600/20"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
