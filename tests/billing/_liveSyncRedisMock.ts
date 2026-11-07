// Redis en memoria para las pruebas de sincronización live: GET/SET(NX)/RPUSH/
// DEL y los scripts Lua de lock.ts emulados con la misma semántica (atómica).
// La semántica real de los scripts se verificó además contra un Redis real.
import {
  RELEASE_LOCK_SCRIPT, RELEASE_LOCK_AND_PENDING_SCRIPT, SET_PENDING_IF_OWNER_SCRIPT, RECOVERY_RELEASE_SCRIPT,
} from '../../base44/functions/syncBillingSubscription/lock.ts';

const ownedBy = (raw: unknown, owner: string) => {
  try { return JSON.parse(String(raw)).owner === owner; } catch { return false; }
};

export function createRedisMock(initial: Array<[string, unknown]> = [], opts: { failRpush?: boolean } = {}) {
  const store = new Map<string, any>(initial);
  const writes: unknown[][] = [];
  const cmd = async (c: unknown[]): Promise<unknown> => {
    const [op, key, value] = c as string[];
    if (op === 'GET') return store.get(key) ?? null;
    writes.push(c);
    if (op === 'SET') { if (c.includes('NX') && store.has(key)) return null; store.set(key, value); return 'OK'; }
    if (op === 'RPUSH') { if (opts.failRpush) throw new Error('RPUSH failed'); const l = store.get(key) ?? []; l.push(value); store.set(key, l); return l.length; }
    if (op === 'EVAL') {
      const script = c[1];
      if (script === RELEASE_LOCK_SCRIPT) {
        const [lock, owner] = [c[3], c[4]] as string[];
        if (store.get(lock) === owner) { store.delete(lock); return 1; }
        return 0;
      }
      if (script === SET_PENDING_IF_OWNER_SCRIPT) {
        const [lock, pend, owner, json] = [c[3], c[4], c[5], c[6]] as string[];
        if (store.get(lock) !== owner) return 0;
        if (store.has(pend)) return -1;
        store.set(pend, json); return 1;
      }
      if (script === RELEASE_LOCK_AND_PENDING_SCRIPT) {
        const [lock, pend, owner] = [c[3], c[4], c[5]] as string[];
        if (store.get(lock) !== owner) return 0;
        const p = store.get(pend);
        if (p && !ownedBy(p, owner)) return -1;
        store.delete(pend); store.delete(lock); return 1;
      }
      if (script === RECOVERY_RELEASE_SCRIPT) {
        const [lock, pend, audit, owner, expectPending, entry] = [c[3], c[4], c[5], c[6], c[7], c[8]] as string[];
        if (store.get(lock) !== owner) return 0;
        const p = store.get(pend);
        if (expectPending === '0') { if (p) return -2; }
        else if (!p || !ownedBy(p, owner)) return -1;
        // Atómico: si la auditoría falla, el script se aborta sin borrar nada.
        if (opts.failRpush) throw new Error('ERR script aborted: RPUSH failed');
        const l = store.get(audit) ?? []; l.push(entry); store.set(audit, l);
        if (p) store.delete(pend);
        store.delete(lock);
        return 1;
      }
      throw new Error('unexpected script');
    }
    throw new Error('unexpected ' + op);
  };
  return { cmd, store, writes };
}
