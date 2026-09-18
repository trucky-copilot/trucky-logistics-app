const STATUS_CONFIG = {
  // Trucks
  disponible: { label: 'Disponible', class: 'text-green-400 bg-green-400/10 border-green-400/20' },
  en_ruta: { label: 'En Ruta', class: 'text-violet-400 bg-violet-400/10 border-violet-400/20' },
  en_yarda: { label: 'En Yarda', class: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  mantenimiento: { label: 'Mantenimiento', class: 'text-red-400 bg-red-400/10 border-red-400/20' },
  // Loads
  pendiente: { label: 'Pendiente', class: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  en_transito: { label: 'En Tránsito', class: 'text-violet-400 bg-violet-400/10 border-violet-400/20' },
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
  quickload: { label: '$2.20/mi', class: 'text-muted-foreground bg-muted/50 border-border' },
  broker_directo: { label: 'Broker Directo', class: 'text-violet-400 bg-violet-400/10 border-violet-400/20' },
  cliente_directo: { label: 'Cliente Directo', class: 'text-green-400 bg-green-400/10 border-green-400/20' },
};

const STATUS_LABELS = {
  es: { disponible: 'Disponible', en_ruta: 'En Ruta', en_yarda: 'En Yarda', mantenimiento: 'Mantenimiento', pendiente: 'Pendiente', en_transito: 'En Tránsito', entregado: 'Entregado', cancelado: 'Cancelado', ganancia: 'Ganancia', break_even: 'Break-Even', perdida: 'Pérdida', activo: 'Activo', inactivo: 'Inactivo', vacaciones: 'Vacaciones', suspension: 'Suspendido', precaucion: 'Precaución', bloqueado: 'Bloqueado', quickload: '$2.20/mi', broker_directo: 'Broker Directo', cliente_directo: 'Cliente Directo' },
  en: { disponible: 'Available', en_ruta: 'En Route', en_yarda: 'In Yard', mantenimiento: 'Maintenance', pendiente: 'Pending', en_transito: 'In Transit', entregado: 'Delivered', cancelado: 'Cancelled', ganancia: 'Profit', break_even: 'Break-Even', perdida: 'Loss', activo: 'Active', inactivo: 'Inactive', vacaciones: 'Vacation', suspension: 'Suspended', precaucion: 'Caution', bloqueado: 'Blocked', quickload: '$2.20/mi', broker_directo: 'Direct Broker', cliente_directo: 'Direct Client' },
};

import { useLanguage } from '@/lib/LanguageContext';

export default function StatusBadge({ status, className = '' }) {
  const { locale } = useLanguage();
  const config = STATUS_CONFIG[status] || { label: status, class: 'text-muted-foreground bg-muted/50 border-border' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${config.class} ${className}`}>
      {STATUS_LABELS[locale]?.[status] || config.label}
    </span>
  );
}