const res = await fetch('https://trucky-17a283d5.base44.app');
const html = await res.text();
const scripts = [];
const regex = /src="([^"]+\.js)"/g;
let match;
while ((match = regex.exec(html)) !== null) {
  scripts.push(match[1]);
}
console.log('Scripts:', scripts);

for (const scriptUrl of scripts) {
  const fullUrl = scriptUrl.startsWith('http') ? scriptUrl : 'https://trucky-17a283d5.base44.app' + scriptUrl;
  const scriptRes = await fetch(fullUrl);
  const text = await scriptRes.text();
  console.log(`Script ${scriptUrl}: length=${text.length}`);
  console.log('Contains gmail.send:', text.includes('gmail.send'));
}
