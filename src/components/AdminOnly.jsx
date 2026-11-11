import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { isAppAdmin } from '@/lib/adminAccess';

// Protege rutas de administración: si no es administrador, vuelve al inicio.
export default function AdminOnly({ children }) {
  const { user } = useAuth();
  if (!isAppAdmin(user)) return <Navigate to="/" replace />;
  return children;
}
