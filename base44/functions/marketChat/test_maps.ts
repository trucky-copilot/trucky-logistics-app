import envText from './.env' with { type: 'text' };
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
  if (m) Deno.env.set(m[1], m[2].trim());
}

const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
const normalizeForMap = (loc: string) => {
  let norm = loc;
  const lower = loc.toLowerCase();
  if (lower.includes('mega rail') || lower.includes('garden city') || lower.includes('savannah port')) return `Georgia Ports Authority - Garden City Terminal, Savannah, GA`;
  if (lower.includes('ns rossville')) return `Norfolk Southern - Rossville Intermodal Facility, 2515 Highway 72, Rossville, TN`;
  if (lower.includes('m669') || lower.includes('port tampa bay')) return `Port Tampa Bay, 2999 Guy N Verger Blvd, Tampa, FL 33605`;
  if (lower.includes('pomtoc') || lower.includes('sfct')) return `${norm}, Miami`;
  if (lower.includes('o083') || (lower.includes('bnsf') && lower.includes('atlanta'))) return `Austell, GA`;
  if (lower === 'up' || lower === 'up rail' || lower === 'up, tx' || lower.includes('union pacific') || (lower.includes('up') && lower.includes('dallas'))) return `Wilmer, TX`;
  if (lower.includes('h572')) return `Elwood, IL`;
  if (lower.includes('wando') || lower.includes('wwt')) return `Mount Pleasant, SC`;
  return norm;
};
const origin = normalizeForMap('Garden City, GA');
const dest = normalizeForMap('Lakeland 33815, FL');
const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
url.searchParams.set('origins', origin);
url.searchParams.set('destinations', dest);
url.searchParams.set('units', 'imperial');
url.searchParams.set('key', apiKey || '');

const res = await fetch(url.toString());
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
