// Archivo mensual de Cargas en PDF (tabla del mes + totales).
import { effectiveRate, effectiveRpm, effectiveProfit } from './loadRate.js';
import { loadDate, periodTotals } from './loadPeriods.js';

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function downloadMonthlyLoadsPdf(loads = [], { year, month, isEs = true, carrierName = '' } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const monthName = new Date(year, month, 1).toLocaleDateString(isEs ? 'es-CO' : 'en-US', { month: 'long', year: 'numeric' });
  const rows = [...loads].sort((a, b) => (loadDate(a) || 0) - (loadDate(b) || 0));
  const tot = periodTotals(rows);

  const cols = isEs
    ? ['Fecha', 'Origen', 'Destino', 'Broker', 'Millas', '$/mi', 'Total', 'Ganancia', 'Estado']
    : ['Date', 'Origin', 'Destination', 'Broker', 'Miles', '$/mi', 'Total', 'Profit', 'Status'];
  const widths = [60, 136, 136, 110, 44, 46, 68, 68, 62];
  const right = new Set([4, 5, 6, 7]);
  const x0 = 36;
  const fit = (txt, w) => {
    let t = String(txt ?? '');
    while (t && doc.getTextWidth(t) > w - 6) t = t.slice(0, -1);
    return t.length < String(txt ?? '').length ? t.slice(0, -2) + '...' : t;
  };
  const drawRow = (cells, y, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    let x = x0;
    cells.forEach((c, i) => {
      const t = fit(c, widths[i]);
      if (right.has(i)) doc.text(t, x + widths[i] - 4, y, { align: 'right' });
      else doc.text(t, x + 2, y);
      x += widths[i];
    });
  };
  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(`Trucky · ${isEs ? 'Cargas de' : 'Loads for'} ${monthName}`, x0, 46);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (carrierName) doc.text(carrierName, x0, 62);
    doc.setFontSize(9);
    drawRow(cols, 84, true);
    doc.line(x0, 89, W - x0, 89);
    return 104;
  };

  let y = header();
  doc.setFontSize(9);
  for (const l of rows) {
    if (y > H - 70) { doc.addPage(); y = header(); doc.setFontSize(9); }
    const d = loadDate(l);
    drawRow([
      d ? d.toLocaleDateString(isEs ? 'es-CO' : 'en-US') : '--',
      l.origen || '--', l.destino || '--', l.broker_nombre || '--',
      l.millas || '--',
      effectiveRpm(l) > 0 ? `$${effectiveRpm(l).toFixed(2)}` : '--',
      money(effectiveRate(l)), money(effectiveProfit(l)), l.estado || 'pendiente',
    ], y);
    y += 16;
  }
  if (rows.length === 0) { doc.text(isEs ? 'Sin cargas en este mes.' : 'No loads this month.', x0, y); y += 16; }

  y += 8; doc.line(x0, y - 10, W - x0, y - 10);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(
    `${isEs ? 'Cargas' : 'Loads'}: ${tot.count}   ·   ${isEs ? 'Ingresos' : 'Revenue'}: ${money(tot.revenue)}   ·   ${isEs ? 'Millas' : 'Miles'}: ${tot.miles.toLocaleString('en-US')}   ·   $/mi: ${tot.rpm > 0 ? '$' + tot.rpm.toFixed(2) : '--'}   ·   ${isEs ? 'Ganancia' : 'Profit'}: ${money(tot.profit)}`,
    x0, y + 4,
  );
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(`${isEs ? 'Generado' : 'Generated'}: ${new Date().toLocaleString(isEs ? 'es-CO' : 'en-US')}`, x0, H - 28);

  const mm = String(month + 1).padStart(2, '0');
  doc.save(`Trucky_Cargas_${year}-${mm}.pdf`);
}
