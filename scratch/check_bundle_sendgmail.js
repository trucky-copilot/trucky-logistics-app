const res = await fetch('https://trucky-17a283d5.base44.app/assets/index-BlPd5cnZ.js');
const text = await res.text();

let pos = 0;
while (true) {
  const idx = text.indexOf('sendGmail', pos);
  if (idx === -1) break;
  console.log('--- FOUND at', idx, '---');
  console.log(text.slice(Math.max(0, idx - 150), idx + 250));
  pos = idx + 1;
}
