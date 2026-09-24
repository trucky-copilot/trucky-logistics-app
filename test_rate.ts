import { resolveDrayageQuote } from './base44/functions/marketChat/rateEngine.ts';
console.log(JSON.stringify(resolveDrayageQuote({
  origenRaw: 'Garden City Terminal',
  destinoRaw: 'Elberton',
  tamano: '20',
  millasIdaDeclaradas: 243,
  pagoCamionRpm: null,
  tarifaOfrecida: null
}), null, 2));
