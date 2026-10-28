import { createClient } from '@base44/sdk';

const base44 = createClient({
  appId: 'cbef744a8545c389ef439ea6'
});

try {
  console.log('Invoking sendGmail test with invalid token...');
  const res = await base44.functions.invoke('sendGmail', {
    to: 'test@example.com',
    subject: 'test',
    content: 'hello test',
    accessToken: 'test_token_invalid'
  });
  console.log('Response:', res.data);
} catch (err) {
  console.error('Error status:', err.status || err.response?.status);
  console.error('Error data:', err.response?.data || err.data || err.message);
}
