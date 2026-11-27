#!/usr/bin/env node
import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import readline from 'readline';
import { RukmerClient } from './client.js';

type Flags = { apiKey: string; url: string; yes: boolean; help: boolean; command: string };

function parse(argv: string[]): Flags {
  const flags: Flags = { apiKey: '', url: 'https://app.rukmer.com', yes: false, help: false, command: '' };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--api-key') flags.apiKey = argv[++i] || '';
    else if (arg === '--url') flags.url = argv[++i] || flags.url;
    else rest.push(arg);
  }
  flags.command = rest[0] || '';
  return flags;
}

function ask(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function detectEnvFile(cwd: string) {
  if (fs.existsSync(path.join(cwd, '.env.local'))) return '.env.local';
  return '.env';
}

function upsertEnv(file: string, values: Record<string, string>) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = current.split(/\n/);
  const keys = new Set(Object.keys(values));
  const next = lines.filter((line) => !keys.has(line.split('=')[0] || ''));
  for (const [key, value] of Object.entries(values)) next.push(`${key}=${value}`);
  const body = next.filter((line, index, all) => line !== '' || index < all.length - 1).join('\n');
  fs.writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
}

function ensureGitignore(cwd: string, name: string) {
  const file = path.join(cwd, '.gitignore');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  if (text.split('\n').some((line) => line.trim() === name)) return;
  fs.writeFileSync(file, text.endsWith('\n') ? `${text}${name}\n` : `${text}\n${name}\n`);
}

function writeMcp(cwd: string, url: string) {
  const cursorDir = path.join(cwd, '.cursor');
  const cursorFile = path.join(cursorDir, 'mcp.json');
  const claude = path.join(cwd, '.mcp.json');
  const target = fs.existsSync(cursorDir) || fs.existsSync(path.join(cwd, '.cursor')) ? cursorFile : fs.existsSync(path.dirname(claude)) ? claude : cursorFile;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let json: { mcpServers?: Record<string, { url: string }> } = {};
  if (fs.existsSync(target)) {
    try {
      json = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      json = {};
    }
  }
  json.mcpServers = { ...(json.mcpServers || {}), rukmer: { url } };
  fs.writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
  return target;
}

function help(setup = false) {
  if (setup) {
    console.log(`rukmer setup

Options:
  --api-key <key>   Rukmer API key
  --url <url>       API base URL (default https://app.rukmer.com)
  --yes             Skip prompts and use the flags
  --help            Show this help
`);
    return;
  }
  console.log(`rukmer <command>

Commands:
  login     Sign in through the browser and save a key
  logout    Remove the saved API key
  setup     Write RUKMER_API_KEY and wire MCP
  search    Search memory
  add       Save a note
  profile   Read the profile

Run rukmer setup --help for setup flags.
`);
}

async function login(flags: Flags) {
  const url = (flags.url || 'https://app.rukmer.com').replace(/\/$/, '');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(12).toString('hex');
  const server = http.createServer();
  const secret = await new Promise<string>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const redirect = `http://127.0.0.1:${port}/callback`;
      const authorize = new URL(`${url}/oauth/authorize`);
      authorize.searchParams.set('redirect_uri', redirect);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('code_challenge', challenge);
      authorize.searchParams.set('code_challenge_method', 'S256');
      authorize.searchParams.set('connector', 'cli');
      console.log(`Open ${authorize.toString()}`);
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      try {
        const child = spawn(opener, [authorize.toString()], { stdio: 'ignore', detached: true });
        child.unref();
      } catch {
        /* the printed URL is enough when a browser cannot be opened */
      }
      server.on('request', async (req, res) => {
        const incoming = new URL(req.url || '/', redirect);
        if (incoming.searchParams.get('state') !== state) {
          res.end('State mismatch');
          return;
        }
        const code = incoming.searchParams.get('code') || '';
        const token = await fetch(`${url}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier }),
        });
        const data = (await token.json()) as { access_token?: string };
        res.end('Rukmer is connected. You can close this tab.');
        server.close();
        if (!data.access_token) reject(new Error('Login did not return a key'));
        else resolve(data.access_token);
      });
    });
  });
  const envName = detectEnvFile(process.cwd());
  upsertEnv(path.join(process.cwd(), envName), { RUKMER_API_KEY: secret, RUKMER_URL: url });
  console.log(`Saved ${envName}`);
}

async function logout() {
  const cwd = process.cwd();
  const envName = detectEnvFile(cwd);
  const file = path.join(cwd, envName);
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\n/).filter((line) => !line.startsWith('RUKMER_API_KEY='));
    fs.writeFileSync(file, `${lines.filter((line, index, all) => line || index < all.length - 1).join('\n')}\n`);
  }
  console.log('Signed out. RUKMER_API_KEY was removed from the local env file.');
}

async function setup(flags: Flags) {
  if (flags.help) return help(true);
  const cwd = process.cwd();
  const kind = fs.existsSync(path.join(cwd, 'package.json')) ? 'node' : fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt')) ? 'python' : 'unknown';
  let apiKey = flags.apiKey || process.env.RUKMER_API_KEY || '';
  let url = flags.url || process.env.RUKMER_URL || 'https://app.rukmer.com';
  if (!apiKey) {
    await login(flags);
    const saved = fs.readFileSync(path.join(cwd, detectEnvFile(cwd)), 'utf8');
    apiKey = saved.split(/\n/).find((line) => line.startsWith('RUKMER_API_KEY='))?.slice('RUKMER_API_KEY='.length) || '';
  }
  const envName = detectEnvFile(cwd);
  upsertEnv(path.join(cwd, envName), { RUKMER_API_KEY: apiKey, RUKMER_URL: url });
  ensureGitignore(cwd, envName);
  const mcpFile = writeMcp(cwd, `${url.replace(/\/$/, '')}/mcp`);
  const client = new RukmerClient({ baseUrl: url, apiKey });
  await client.search('rukmer setup');
  console.log(`You're set up (${kind}). Saved ${envName} and ${path.relative(cwd, mcpFile)}.`);
}

async function main() {
  const flags = parse(process.argv.slice(2));
  if (!flags.command) {
    help(false);
    return;
  }
  if (flags.command === 'login') return login(flags);
  if (flags.command === 'logout') return logout();
  if (flags.command === 'setup') return setup(flags);
  const client = new RukmerClient({
    baseUrl: flags.url || process.env.RUKMER_URL || 'https://app.rukmer.com',
    apiKey: flags.apiKey || process.env.RUKMER_API_KEY || '',
  });
  if (flags.command === 'search') {
    const query = process.argv.slice(3).filter((arg) => !arg.startsWith('--')).join(' ');
    console.log(JSON.stringify(await client.search(query || 'rukmer'), null, 2));
    return;
  }
  if (flags.command === 'add') {
    const text = process.argv.slice(3).filter((arg) => !arg.startsWith('--')).join(' ');
    console.log(JSON.stringify(await client.add(text || 'note'), null, 2));
    return;
  }
  if (flags.command === 'profile') {
    console.log(JSON.stringify(await client.profile(), null, 2));
    return;
  }
  help(false);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'rukmer failed');
  process.exitCode = 1;
});
