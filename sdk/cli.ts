import { RukmerClient } from './typescript/client.js';

const [cmd, ...rest] = process.argv.slice(2);
const baseUrl = process.env.RUKMER_URL || 'http://127.0.0.1:5001';
const apiKey = process.env.RUKMER_API_KEY;
const user = process.env.RUKMER_USER;
const client = new RukmerClient({ baseUrl, apiKey, user });

async function main() {
  if (cmd === 'search') {
    console.log(JSON.stringify(await client.search(rest.join(' ') || ''), null, 2));
    return;
  }
  if (cmd === 'add') {
    console.log(JSON.stringify(await client.add(rest.join(' ')), null, 2));
    return;
  }
  if (cmd === 'profile') {
    console.log(JSON.stringify(await client.profile(), null, 2));
    return;
  }
  console.error('Usage: tsx sdk/cli.ts search|add|profile <text>');
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
