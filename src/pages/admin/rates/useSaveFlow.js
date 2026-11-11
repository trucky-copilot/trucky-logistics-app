// Flujo común de guardado: 1) pedir vista previa al servidor, 2) mostrarla,
// 3) al confirmar, aplicar EXACTAMENTE los mismos cambios y recargar.
import { useState } from 'react';
import { previewChanges, applyChanges } from '@/lib/ratesApi';

export default function useSaveFlow(onSaved) {
  const [pending, setPending] = useState(null); // { entity, changes, preview }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const review = async (entity, changes) => {
    setBusy(true); setError(null);
    try {
      const preview = await previewChanges(entity, changes);
      setPending({ entity, changes, preview });
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const res = await applyChanges(pending.entity, pending.changes, pending.preview?.firma);
    if (res?.errores?.length) throw new Error(res.errores.map((e) => e.mensaje).join('; '));
    setPending(null);
    await onSaved?.(res);
  };

  return { pending, review, confirm, cancel: () => setPending(null), error, setError, busy };
}
