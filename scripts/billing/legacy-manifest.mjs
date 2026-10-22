import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// OFFLINE ONLY. Reads a complete operator-reviewed snapshot; never calls Base44.
export function buildLegacyManifest(snapshot, cutoff) {
  const cutoffMs = Date.parse(cutoff);
  if (!Number.isFinite(cutoffMs)) throw Error('INVALID_CUTOFF');
  if (snapshot.complete !== true || !Array.isArray(snapshot.organizations) || !Array.isArray(snapshot.users)) throw Error('COMPLETE_SNAPSHOT_REQUIRED');
  const ids = new Set();
  const select = (rows, kind) => rows.map(row => {
    if (typeof row.id !== 'string' || !row.id || ids.has(`${kind}:${row.id}`)) throw Error('INVALID_OR_DUPLICATE_ID');
    ids.add(`${kind}:${row.id}`);
    const created = Date.parse(row.created_date);
    if (!Number.isFinite(created)) throw Error('MISSING_CREATION_TIMESTAMP');
    return { id: row.id, created, disabled: row.active === false };
  }).filter(row => row.created < cutoffMs).map(({ id, disabled }) => ({ id, wasDisabled: disabled })).sort((a,b)=>a.id.localeCompare(b.id));
  const data = {
    version: 1, cutoff: new Date(cutoffMs).toISOString(),
    legacyOrganizations: select(snapshot.organizations, 'organization'),
    legacyUsers: select(snapshot.users, 'user'),
  };
  return { ...data, sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, cutoff, output] = process.argv;
  if (!input || !cutoff || !output) throw Error('Usage: node legacy-manifest.mjs snapshot.json ISO_CUTOFF manifest.json');
  const snapshot = JSON.parse(readFileSync(input, 'utf8'));
  writeFileSync(output, JSON.stringify(buildLegacyManifest(snapshot, cutoff), null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Offline manifest created. No accounts changed. Review counts and checksum before any migration.');
}
