const res = await fetch('https://trucky-17a283d5.base44.app');
const html = await res.text();
console.log('HTML length:', html.length);
const scripts = [];
const regex = /src="([^"]+\.js)"/g;
let match;
while ((match = regex.exec(html)) !== null) {
  scripts.push(match[1]);
}
console.log('Scripts found:', scripts);

for (const scriptUrl of scripts) {
  const fullUrl = scriptUrl.startsWith('http') ? scriptUrl : 'https://trucky-17a283d5.base44.app' + scriptUrl;
  const scriptRes = await fetch(fullUrl);
  const text = await scriptRes.text();
  console.log(`Script ${scriptUrl} length: ${text.length}`);
  console.log('Contains billing_link:', text.includes('billing_link'));
  console.log('Contains BillingLinkConfirmation:', text.includes('BillingLinkConfirmation') || text.includes('Confirmar vinculación'));
  console.log('Contains LiveBillingGate:', text.includes('LiveBillingGate') || text.includes('getBillingLinkState'));
}
