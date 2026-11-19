const STATUS_CONFIG = {
  // Trucks
  disponible: { label: 'Disponible', class: 'text-t-success bg-t-success-soft border-transparent' },
  en_ruta: { label: 'En Ruta', class: 'text-t-text-accent bg-t-bg-surface-raised border-transparent' },
  en_yarda: { label: 'En Yarda', class: 'text-t-warning bg-t-warning-soft border-transparent' },
  mantenimiento: { label: 'Mantenimiento', class: 'text-t-danger bg-t-danger-soft border-transparent' },
  // Loads
  pendiente: { label: 'Pendiente', class: 'text-t-warning bg-t-warning-soft border-transparent' },
  en_transito: { label: 'En Tránsito', class: 'text-t-text-accent bg-t-bg-surface-raised border-transparent' },
  entregado: { label: 'Entregado', class: 'text-t-success bg-t-success-soft border-transparent' },
  cancelado: { label: 'Cancelado', class: 'text-t-danger bg-t-danger-soft border-transparent' },
  // Results
  ganancia: { label: 'Ganancia', class: 'text-t-success bg-t-success-soft border-transparent' },
  break_even: { label: 'Break-Even', class: 'text-t-warning bg-t-warning-soft border-transparent' },
  perdida: { label: 'Pérdida', class: 'text-t-danger bg-t-danger-soft border-transparent' },
  // Drivers
  activo: { label: 'Activo', class: 'text-t-success bg-t-success-soft border-transparent' },
  inactivo: { label: 'Inactivo', class: 'text-t-text-secondary bg-t-action-secondary border-transparent' },
  vacaciones: { label: 'Vacaciones', class: 'text-t-warning bg-t-warning-soft border-transparent' },
  suspension: { label: 'Suspendido', class: 'text-t-danger bg-t-danger-soft border-transparent' },
  // Brokers
  precaucion: { label: 'Precaución', class: 'text-t-warning bg-t-warning-soft border-transparent' },
  bloqueado: { label: 'Bloqueado', class: 'text-t-danger bg-t-danger-soft border-transparent' },
  // Tipo cliente
  quickload: { label: '$2.20/mi', class: 'text-t-text-secondary bg-t-action-secondary border-transparent' },
  broker_directo: { label: 'Broker Directo', class: 'text-t-text-accent bg-t-bg-surface-raised border-transparent' },
  cliente_directo: { label: 'Cliente Directo', class: 'text-t-success bg-t-success-soft border-transparent' },
};

const STATUS_LABELS = {
  es: { disponible: 'Disponible', en_ruta: 'En Ruta', en_yarda: 'En Yarda', mantenimiento: 'Mantenimiento', pendiente: 'Pendiente', en_transito: 'En Tránsito', entregado: 'Entregado', cancelado: 'Cancelado', ganancia: 'Ganancia', break_even: 'Break-Even', perdida: 'Pérdida', activo: 'Activo', inactivo: 'Inactivo', vacaciones: 'Vacaciones', suspension: 'Suspendido', precaucion: 'Precaución', bloqueado: 'Bloqueado', quickload: '$2.20/mi', broker_directo: 'Broker Directo', cliente_directo: 'Cliente Directo' },
  en: { disponible: 'Available', en_ruta: 'En Route', en_yarda: 'In Yard', mantenimiento: 'Maintenance', pendiente: 'Pending', en_transito: 'In Transit', entregado: 'Delivered', cancelado: 'Cancelled', ganancia: 'Profit', break_even: 'Break-Even', perdida: 'Loss', activo: 'Active', inactivo: 'Inactive', vacaciones: 'Vacation', suspension: 'Suspended', precaucion: 'Caution', bloqueado: 'Blocked', quickload: '$2.20/mi', broker_directo: 'Direct Broker', cliente_directo: 'Direct Client' },
};

import { useLanguage } from '@/lib/LanguageContext';

export default function StatusBadge({ status, className = '' }) {
  const { locale } = useLanguage();
  const config = STATUS_CONFIG[status] || { label: status, class: 'text-t-text-secondary bg-t-action-secondary border-transparent' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.class} ${className}`}>
      {STATUS_LABELS[locale]?.[status] || config.label}
    </span>
  );
}