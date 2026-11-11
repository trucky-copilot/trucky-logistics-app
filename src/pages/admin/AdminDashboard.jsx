import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldAlert, Save, Upload, Loader2, CheckCircle2 } from 'lucide-react';
import RatesSection from './rates/RatesSection';
import PlansSection from './PlansSection';


export default function AdminDashboard() {
  const [section, setSection] = useState('tarifas');

  const [ticker, setTicker] = useState({
    dry_van: '', reefer: '', flatbed: '', step_deck: '', power_only: '', container: '', diesel: ''
  });
  const [savingTicker, setSavingTicker] = useState(false);
  const [textData, setTextData] = useState('');
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
    if (!textData.trim()) return;
    setUploading(true);
    try {
      const res = await base44.functions.invoke('adminUploadStateData', { textData });
      if (res && res.data && res.data.success) {
        let msg = 'Datos procesados y guardados exitosamente.';
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

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (['xlsx', 'xls'].includes(ext)) {
      // F6-01: los Excel se cargan en la pestaña Tarifas (validación estricta).
      setModal({
        isOpen: true,
        title: 'Los Excel se cargan en Tarifas',
        message: 'Sube el Excel en la pestaña "Tarifas" → "Cargar Excel". Aquí solo se usan PDF, imágenes o texto con las tarifas por milla de cada estado.',
        type: 'error'
      });
      e.target.value = '';
      return;
    }
    if (ext === 'pdf') {
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
        const extractRes = await base44.functions.invoke('extractDocumentText', { file_url });
        const extracted = extractRes.data?.text;
        if (!extracted) throw new Error(extractRes.data?.error || 'No se pudo extraer el texto');
        setTextData(extracted);
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
    } else {
      setModal({
        isOpen: true,
        title: 'Formato no soportado',
        message: 'Por favor utiliza un archivo PDF, JPG, PNG, CSV o TXT.',
        type: 'error'
      });
    }
    e.target.value = '';
  };

  return (
    <div className={`${section === 'tarifas' ? 'max-w-6xl' : 'max-w-4xl'} mx-auto p-4 md:p-6 space-y-6 animate-in fade-in`}>
      <div className="flex items-center gap-3 border-b border-white/10 pb-4">
        <ShieldAlert className="w-8 h-8 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold text-white">Panel de Administración</h1>
          <p className="text-white/60 text-sm">Control global del mercado y la IA</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {[['tarifas', 'Tarifas'], ['planes', 'Planes'], ['mercado', 'Mercado por estado y cinta']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setSection(id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${section === id ? 'bg-amber-500 text-black' : 'bg-white/5 text-white/70 hover:bg-white/10'}`}>
            {label}
          </button>
        ))}
      </div>

      {section === 'tarifas' && <RatesSection />}
      {section === 'planes' && <PlansSection />}

      {section === 'mercado' && (<>

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
        <h2 className="text-lg font-semibold text-white">Actualizar Tarifas por Estado (RPM)</h2>
        <p className="text-sm text-white/50">Pega aquí el reporte del mercado o sube un PDF o imagen con las tarifas por milla de cada estado (Dry Van, Reefer, Flatbed, Contenedor). El Excel de tarifas drayage se carga en la pestaña <button type="button" onClick={() => setSection('tarifas')} className="text-amber-400 underline">Tarifas</button>.</p>
        
        <textarea
          value={textData}
          onChange={e => setTextData(e.target.value)}
          placeholder="Pega el texto aquí o sube un PDF o imagen..."
          disabled={loadingOCR}
          className="w-full h-48 bg-white/5 border border-white/10 rounded-xl p-4 text-white font-mono text-xs focus:outline-none focus:border-amber-500/50 resize-none disabled:opacity-50"
        ></textarea>

        {textData && !loadingOCR && (
          <p className="text-xs text-emerald-400/80 font-medium">✓ Documento listo para procesar. Haz clic en "Analizar con IA".</p>
        )}
        
        <div className="flex justify-between pt-2">
          <div className="relative">
            <input 
              type="file" 
              accept=".pdf,.jpg,.jpeg,.png,.txt,.csv" 
              onChange={handleFileUpload}
              disabled={loadingOCR || uploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <button 
              disabled={loadingOCR || uploading}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              {loadingOCR ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {loadingOCR ? 'Procesando...' : 'Cargar Archivo (PDF, IMG)'}
            </button>
          </div>

          <button 
            onClick={handleStateDataUpload}
            disabled={uploading || loadingOCR || !textData.trim()}
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

      </>)}

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