import { fetchDrivingMiles } from './base44/functions/marketChat/entry.ts';
import 'dotenv/config';

async function test() { 
  const res = await fetchDrivingMiles('Garden City Terminal, Savannah', 'Elberton'); 
  console.log('Millas calculadas por Google Maps:', res); 
} 

test();
