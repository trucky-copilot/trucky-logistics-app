const STATUS_CONFIG = {
  // Trucks
  disponible: { label: 'Disponible', class: 'text-green-400 bg-green-400/10 border-green-400/20' },
  en_ruta: { label: 'En Ruta', class: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
  en_yarda: { label: 'En Yarda', class: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  mantenimiento: { label: 'Mantenimiento', class: 'text-red-400 bg-red-400/10 border-red-400/20' },
  // Loads
  pendiente: { label: 'Pendiente', class: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  en_transito: { label: 'En Tránsito', class: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
  entregado: { label: 'Entregado', class: 'text-green-400 bg-green-400/10 border-green-400/20' },
  cancelado: { label: 'Cancelado', class: 'text-red-400 bg-red-400/10 border-red-400/20' },
  // Results
  ganancia: { label: 'Ganancia', class: 'text-green-400 bg-green-400/10 border-green-400/20' },
  break_even: { label: 'Break-Even', class: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  perdida: { label: 'Pérdida', class: 'text-red-400 bg-red-400/10 border-red-400/20' },
  // Drivers
  activo: { label: 'Activo', class: 'text-green-400 bg-green-400/10 border-green-400/20' },
  inactivo: { label: 'Inactivo', class: 'text-muted-foreground bg-muted/50 border-border' },
  vacaciones: { label: 'Vacaciones', class: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  suspension: { label: 'Suspendido', class: 'text-red-400 bg-red-400/10 border-red-400/20' },
  // Brokers
  precaucion: { label: 'Precaución', class: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  bloqueado: { label: 'Bloqueado', class: 'text-red-400 bg-red-400/10 border-red-400/20' },
  // Tipo cliente
  quickload: { label: 'Quickload', class: 'text-muted-foreground bg-muted/50 border-border' },
  broker_directo: { label: 'Broker Directo', class: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
  cliente_directo: { label: 'Cliente Directo', class: 'text-green-400 bg-green-400/10 border-green-400/20' },
};

export default function StatusBadge({ status, className = '' }) {
  const config = STATUS_CONFIG[status] || { label: status, class: 'text-muted-foreground bg-muted/50 border-border' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${config.class} ${className}`}>
      {config.label}
    </span>
  );
}