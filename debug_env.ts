import { resolve } from "node:path";

async function run() {
  // Simulating the fetchDrivingMiles inside entry.ts
  let apiKey = null;

  try {
    const envText = Deno.readTextFileSync(new URL('./base44/functions/marketChat/.env', import.meta.url));
    envText.split('\n').forEach(line => {
      const [key, ...val] = line.split('=');
      if (key && val.length) {
        Deno.env.set(key.trim(), val.join('=').trim());
      }
    });
  } catch (e) {
    console.error("Error reading .env:", e);
  }

  apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") || process.env?.GOOGLE_MAPS_API_KEY;

  console.log("API Key found:", apiKey ? apiKey.substring(0, 10) + "..." : "undefined");

  if (!apiKey) {
    console.log("FAILED to load API key");
    return;
  }

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', 'Wilmer, TX');
  url.searchParams.set('destinations', 'Temple, TX');
  url.searchParams.set('units', 'imperial');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();
  const element = data?.rows?.[0]?.elements?.[0];
  console.log(`GMaps Status: ${element?.status}`);
  if (element?.status === 'OK') {
    console.log(`Miles: ${element.distance.text}`);
  }
}

run();
