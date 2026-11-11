// Lector de Excel en el navegador (misma librería que ya usaba el Panel Admin).
// Se carga bajo demanda desde cdnjs solo cuando alguien sube un archivo.
export async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('No se pudo cargar el visor de Excel'));
    document.head.appendChild(script);
  });
}

// F6-01: lee todas las hojas como filas, con las MISMAS opciones que el
// conversor del servidor (header: 1, defval: null), y calcula la huella del
// archivo (sha256) para saber de qué versión vino cada tarifa.
export async function readExcelSheets(file) {
  const XLSX = await loadXLSX();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheets = {};
  for (const name of workbook.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null });
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { sheets, sha };
}
