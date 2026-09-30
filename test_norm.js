const normalizeForMap = (loc) => {
  let norm = loc;
  const lower = loc.toLowerCase();
  if (lower.includes('o083')) return 'Austell, GA';
  return norm;
};
const origin = 'Atlanta O083, GA';
console.log('normOrigin:', normalizeForMap(origin));
console.log('cacheKey:', `${normalizeForMap(origin).toLowerCase().trim()}|braselton, ga`);
