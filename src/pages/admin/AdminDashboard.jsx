import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldAlert, Save, FileText, Upload } from 'lucide-react';

export default function AdminDashboard() {

  const [ticker, setTicker] = useState({
    dry_van: '', reefer: '', flatbed: '', step_deck: '', power_only: '', container: '', diesel: ''
  });
  const [savingTicker, setSavingTicker] = useState(false);
  const [textData, setTextData] = useState('');
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  
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
    setStatusMsg('');
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
      setStatusMsg('Cinta actualizada exitosamente.');
    } catch (e) {
      console.error(e);
      setStatusMsg('Error guardando la cinta.');
    }
    setSavingTicker(false);
  };

  const handleStateDataUpload = async () => {
    if (!textData.trim()) return;
    setUploading(true);
    setStatusMsg('Procesando documento con IA... esto puede tardar un poco.');
    try {
      const res = await base44.functions.invoke('adminUploadStateData', { textData });
      if (res && res.data && res.data.success) {
        setStatusMsg(`Datos guardados exitosamente. Se actualizaron ${res.data.statesParsed} estados.`);
        setTextData('');
      } else {
        setStatusMsg('La IA no pudo procesar el documento.');
      }
    } catch (e) {
      console.error(e);
      setStatusMsg('Error enviando el documento a la IA.');
    }
    setUploading(false);
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

      {statusMsg && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-200">
          {statusMsg}
        </div>
      )}

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
            <Save className="w-4 h-4" /> {savingTicker ? 'Guardando...' : 'Guardar Cinta'}
          </button>
        </div>
      </div>

      {/* AI Market Data Parser */}
      <div className="bg-[#1C1C1E] border border-white/5 p-6 rounded-2xl space-y-4">
        <h2 className="text-lg font-semibold text-white">Actualizar Tarifas por Estado (IA)</h2>
        <p className="text-sm text-white/50">Pega aquí el contenido de texto de tu PDF o reporte del mercado. La IA extraerá los precios y los actualizará para que el chat los utilice.</p>
        
        <textarea
          value={textData}
          onChange={e => setTextData(e.target.value)}
          placeholder="Pega el texto de DAT o Truckstop aquí..."
          className="w-full h-40 bg-white/5 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-amber-500/50 resize-none"
        ></textarea>
        
        <div className="flex justify-end pt-2">
          <button 
            onClick={handleStateDataUpload}
            disabled={uploading || !textData.trim()}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
          >
            <Upload className="w-4 h-4" /> {uploading ? 'Procesando...' : 'Analizar con IA'}
          </button>
        </div>
      </div>

    </div>
  );
}
