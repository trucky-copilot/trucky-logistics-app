async function run() {
  const envText = await Deno.readTextFile('./base44/functions/marketChat/.env');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
    if (m) Deno.env.set(m[1], m[2].trim());
  }

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', 'Atlanta BNSF, GA');
  url.searchParams.set('destinations', 'Braselton, GA');
  url.searchParams.set('units', 'imperial');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run();
