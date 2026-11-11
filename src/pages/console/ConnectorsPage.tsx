import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Search, ChevronRight, Copy, Check, ExternalLink } from 'lucide-react';
import { PageHeader, DocLink, Panel, GhostButton, PrimaryButton } from '../../components/console/ui';
import {
  clearStoredConnectorFlags,
  mcpUrlWithKey,
  openApiUrl,
  type AiAppId,
} from '../../services/aiConnectors';
import { engine } from '../../services/engineClient';
import { auth } from '../../firebase';

function rukmerApi(path: string) {
  const host = window.location.hostname;
  const origin = host === 'localhost' || host === '127.0.0.1' ? 'https://app.rukmer.com' : '';
  return `${origin}${path}`;
}

async function signedToken() {
  if (auth.currentUser) return auth.currentUser.getIdToken();
  const user = await new Promise<typeof auth.currentUser>((resolve) => {
    const unsub = onAuthStateChanged(auth, (next) => {
      unsub();
      resolve(next);
    });
    window.setTimeout(() => {
      unsub();
      resolve(auth.currentUser);
    }, 1500);
  });
  if (!user) throw new Error('Sign in to Rukmer first');
  return user.getIdToken();
}

async function rukmerFetch(path: string, init?: RequestInit) {
  const token = await signedToken();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(rukmerApi(path), { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

type Kind = 'ai' | 'oauth' | 'service';

const FILE_CONNECTORS: {
  id: string;
  name: string;
  kind: Exclude<Kind, 'ai'>;
  icon: string;
  href?: (uid: string) => string;
}[] = [
  {
    id: 'gdrive',
    name: 'Google Drive',
    kind: 'oauth',
    icon: 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png',
    href: (uid) => `/api/auth/google?userId=${encodeURIComponent(uid)}&type=gdrive`,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    kind: 'oauth',
    icon: 'https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png',
    href: (uid) => `/api/auth/google?userId=${encodeURIComponent(uid)}&type=gmail`,
  },
  { id: 'slack', name: 'Slack', kind: 'oauth', icon: 'https://cdn.worldvectorlogo.com/logos/slack-new-logo.svg', href: (uid) => `/api/auth/slack?userId=${encodeURIComponent(uid)}` },
  { id: 'outlook', name: 'Microsoft Outlook', kind: 'oauth', icon: '/icons/outlook.svg', href: (uid) => `/api/auth/microsoft?userId=${encodeURIComponent(uid)}&type=outlook` },
  { id: 'teams', name: 'Microsoft Teams', kind: 'oauth', icon: '/icons/teams.svg', href: (uid) => `/api/auth/microsoft?userId=${encodeURIComponent(uid)}&type=teams` },
  { id: 'onedrive', name: 'OneDrive', kind: 'oauth', icon: '/icons/onedrive.svg', href: (uid) => `/api/auth/microsoft?userId=${encodeURIComponent(uid)}&type=onedrive` },
  { id: 'notion', name: 'Notion', kind: 'oauth', icon: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png' },
  { id: 'github', name: 'GitHub', kind: 'oauth', icon: 'https://cdn.simpleicons.org/github/ffffff' },
  { id: 's3', name: 'Amazon S3', kind: 'service', icon: 'https://cdn.simpleicons.org/amazons3/FF9900' },
  { id: 'crawler', name: 'Web Crawler', kind: 'service', icon: '' },
];

const AI_APPS: {
  id: AiAppId;
  name: string;
  where: string;
  open: string;
  steps: string[];
  connectHint: string;
  comingSoon?: boolean;
}[] = [
  {
    id: 'claude',
    name: 'Claude',
    where: 'claude.ai → Settings → Connectors',
    open: 'https://claude.ai/settings/connectors',
    connectHint: 'Copy the MCP URL, then open Claude and add a custom connector. Sign in to Rukmer when asked.',
    steps: [
      'Open Claude → Settings → Connectors → Add custom connector.',
      'Paste the Rukmer MCP URL. Claude starts Rukmer OAuth in the browser — Allow.',
      'If OAuth is blocked, paste a Rukmer API key as ?api_key= on the same URL.',
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    where: 'chatgpt.com → Settings → Connectors',
    open: 'https://chatgpt.com/#settings/Connectors',
    connectHint: 'Copy the MCP URL and the OpenAPI file, then add a connector in ChatGPT. Sign in to Rukmer once.',
    steps: [
      'In ChatGPT, open Settings → Connectors (Developer mode if you do not see it).',
      'Create a connector and paste the Rukmer MCP URL. ChatGPT starts Rukmer login — Allow.',
      'If that screen is missing, create a Custom GPT Action with the OpenAPI file and a Rukmer API key.',
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    where: 'Gemini connectors',
    open: 'https://gemini.google.com/app',
    comingSoon: true,
    connectHint: 'Gemini connectors are coming soon. Until then, chat with Gemini in Playground.',
    steps: [
      'A Gemini connector is not available yet.',
      'Playground can still use Gemini while this connector is in progress.',
    ],
  },
  {
    id: 'grok',
    name: 'Grok',
    where: 'grok.com → Connectors',
    open: 'https://grok.com/connectors',
    connectHint: 'Copy the MCP URL, then add a custom MCP server in Grok and sign in to Rukmer.',
    steps: [
      'Open grok.com → Connectors and add a custom MCP server.',
      'Paste the Rukmer MCP URL and complete Rukmer OAuth, or append ?api_key=.',
      'Grok then calls Rukmer tools in new chats. Past grok.com threads stay on X.',
    ],
  },
];

type BrowserRow = { name: string; lastSync: string | null; items: number; connected: boolean };
type BrowserInfo = {
  connected: boolean;
  items: number;
  lastSync: string | null;
  browsers: BrowserRow[];
  sites: { gmail: number; canvas: number; x: number; browser: number };
};

function BrowserExtensionCard() {
  const [info, setInfo] = useState<BrowserInfo | null>(null);
  const [note, setNote] = useState('');
  const [installed, setInstalled] = useState(false);
  const [pairing, setPairing] = useState(false);
  const load = () => {
    rukmerFetch('/v4/connectors/browser')
      .then((data) => setInfo(data))
      .catch(() => setInfo(null));
  };
  useEffect(() => {
    load();
    const look = () => setInstalled(document.documentElement.dataset.rukmerExtension === '1');
    look();
    const timer = window.setInterval(look, 500);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; ok?: boolean; error?: string };
      if (!data || data.source !== 'rukmer-extension' || data.type !== 'paired') return;
      setPairing(false);
      setNote(data.ok ? 'This browser is connected.' : data.error || 'Could not connect this browser');
      if (data.ok) load();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('message', onMessage);
    };
  }, []);
  const addChrome = () => {
    const link = document.createElement('a');
    link.href = '/rukmer-browser.zip';
    link.download = 'rukmer-browser.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setNote('Download started. Open chrome://extensions, turn on Developer mode, unzip the file, and choose Load unpacked. Reload this page, then click Connect Chrome.');
  };
  const connectBrowser = async () => {
    setNote('');
    setPairing(true);
    try {
      const pair = await rukmerFetch('/v4/connectors/browser/pair', { method: 'POST', body: '{}' });
      if (!pair.code) throw new Error('Could not start the browser connection');
      window.postMessage({ source: 'rukmer-page', type: 'pair', code: pair.code }, window.location.origin);
      window.setTimeout(() => setPairing(false), 8000);
    } catch (err: any) {
      setPairing(false);
      setNote(err.message || 'Could not start the browser connection');
    }
  };
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!installed || autoStarted.current) return;
    if (new URLSearchParams(window.location.search).get('connect') !== 'browser') return;
    autoStarted.current = true;
    void connectBrowser();
  }, [installed]);
  const disconnect = async () => {
    setNote('');
    try {
      await rukmerFetch('/v4/connectors/disconnect', { method: 'POST', body: JSON.stringify({ app: 'browser' }) });
      setNote('Disconnected. Pages already saved stay in memory until you delete them.');
      load();
    } catch (err: any) {
      setNote(err.message || 'Could not disconnect');
    }
  };
  const when = info?.lastSync ? new Date(info.lastSync).toLocaleString() : 'No sync yet';
  return (
    <Panel className="mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] text-white font-medium">Chrome</p>
          <p className="text-[12.5px] text-zinc-400 mt-1 max-w-xl">
            {installed
              ? 'Chrome has the Rukmer extension. Connect it to the account you are already using.'
              : 'Add the Rukmer extension to Chrome, then connect it from this page.'}
          </p>
        </div>
        <div className="flex gap-2">
          {installed ? (
            <button
              type="button"
              onClick={() => void connectBrowser()}
              disabled={pairing}
              className="h-8 px-3 rounded-lg bg-[#2563eb] text-[12px] text-white disabled:opacity-40"
            >
              {pairing ? 'Connecting…' : 'Connect Chrome'}
            </button>
          ) : (
            <button
              type="button"
              onClick={addChrome}
              className="h-8 px-3 rounded-lg bg-[#2563eb] text-[12px] text-white"
            >
              Add to Chrome
            </button>
          )}
          <button
            type="button"
            onClick={disconnect}
            disabled={!info?.connected}
            className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-300 disabled:opacity-40"
          >
            Disconnect
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
        <span className="px-2 py-1 rounded-md bg-white/[0.04] text-zinc-300">{info?.items || 0} items</span>
        <span className="px-2 py-1 rounded-md bg-white/[0.04] text-zinc-400">Last sync {when}</span>
        <span className="px-2 py-1 rounded-md bg-white/[0.04] text-zinc-400">Gmail {info?.sites?.gmail || 0}</span>
        <span className="px-2 py-1 rounded-md bg-white/[0.04] text-zinc-400">Canvas {info?.sites?.canvas || 0}</span>
        <span className="px-2 py-1 rounded-md bg-white/[0.04] text-zinc-400">X {info?.sites?.x || 0}</span>
      </div>
      <div className="mt-3 space-y-1.5">
        {(info?.browsers || []).length === 0 ? (
          <p className="text-[12.5px] text-zinc-500">No browser connected yet.</p>
        ) : (
          info?.browsers.map((row) => (
            <div key={row.name} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-zinc-100 inline-flex items-center gap-2">
                <BrowserMark name={row.name} />
                {row.name}
                <span className="text-[11px] text-zinc-500">{row.connected ? 'Connected' : 'Saved earlier'}</span>
              </span>
              <span className="text-zinc-500 text-[12px]">
                {row.items} items{row.lastSync ? ` · ${new Date(row.lastSync).toLocaleString()}` : ''}
              </span>
            </div>
          ))
        )}
      </div>
      {note && <p className={`text-[12px] mt-2 ${note.includes('connected') ? 'text-emerald-400' : 'text-red-300'}`}>{note}</p>}
    </Panel>
  );
}

function BrowserMark({ name }: { name: string }) {
  const letter = name === 'Edge' ? 'E' : name === 'Brave' ? 'B' : 'C';
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#2563eb] text-[10px] text-white" aria-hidden>
      {letter}
    </span>
  );
}

function GmailConnectCard() {
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    rukmerFetch('/api/connectors/gmail')
      .then((data) => {
        setConnected(!!data.connected);
        setItems(Number(data.items || 0));
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get('connection') === 'success' && params.get('gmail') === 'ok') {
      setNote('Gmail is connected. Recent inbox mail is in memory.');
    } else if (params.get('gmail') === 'error') {
      setNote('Gmail is connected. Recent mail did not finish importing. Sync again.');
    } else if (params.get('error') === 'google_failed' || params.get('error') === 'google_state') {
      setNote('Google did not finish connecting. Click Connect Gmail again.');
    }
  }, []);
  const connect = async () => {
    setBusy(true);
    setNote('');
    try {
      const data = await rukmerFetch('/api/auth/gmail');
      if (!data.url) throw new Error('Could not start Gmail');
      window.location.href = data.url;
    } catch (err: any) {
      setBusy(false);
      setNote(err.message || 'Could not start Gmail');
    }
  };
  const sync = async () => {
    setBusy(true);
    setNote('');
    try {
      const data = await rukmerFetch('/api/connectors/gmail/sync', { method: 'POST' });
      setConnected(true);
      setItems(Number(data.items || 0));
      setNote(`Saved ${data.imported || 0} new message${data.imported === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setNote(err.message || 'Could not sync Gmail');
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setNote('');
    try {
      await rukmerFetch('/api/connectors/gmail/disconnect', { method: 'POST' });
      setConnected(false);
      setNote('Disconnected. Mail already saved stays in memory.');
      load();
    } catch (err: any) {
      setNote(err.message || 'Could not disconnect Gmail');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] text-white font-medium">Gmail</p>
          <p className="text-[12.5px] text-zinc-400 mt-1 max-w-xl">
            One click opens Google. You approve read-only access, and recent inbox mail is saved into this account. Sign-in codes and password resets are skipped.
          </p>
          <p className="text-[12px] text-zinc-500 mt-2">{connected ? `${items} message${items === 1 ? '' : 's'} in memory` : 'Not connected'}</p>
        </div>
        <div className="flex gap-2">
          {connected ? (
            <button type="button" onClick={() => void sync()} disabled={busy} className="h-8 px-3 rounded-lg bg-[#2563eb] text-[12px] text-white disabled:opacity-40">
              {busy ? 'Working…' : 'Sync mail'}
            </button>
          ) : (
            <button type="button" onClick={() => void connect()} disabled={busy} className="h-8 px-3 rounded-lg bg-[#2563eb] text-[12px] text-white disabled:opacity-40">
              {busy ? 'Opening Google…' : 'Connect Gmail'}
            </button>
          )}
          <button type="button" onClick={() => void disconnect()} disabled={!connected || busy} className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-300 disabled:opacity-40">
            Disconnect
          </button>
        </div>
      </div>
      {note && <p className={`text-[12px] mt-2 ${note.includes('could not') || note.includes('did not') || note.includes('Could not') ? 'text-red-300' : 'text-emerald-400'}`}>{note}</p>}
    </Panel>
  );
}

export default function ConnectorsPage() {
  const [tab, setTab] = useState<'ai' | 'all' | Kind>('ai');
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [connected, setConnected] = useState<AiAppId[]>([]);
  const [key, setKey] = useState('');
  const [readyKey, setReadyKey] = useState('');
  const [busyApp, setBusyApp] = useState<AiAppId | null>(null);
  const [connectNote, setConnectNote] = useState('');
  const [importProvider, setImportProvider] = useState<'github' | 'notion' | 's3' | 'web'>('web');
  const [importValue, setImportValue] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const liveKey = readyKey || key;
  const keyed = mcpUrlWithKey(liveKey);
  const spec = openApiUrl();

  const refreshConnected = async () => {
    clearStoredConnectorFlags();
    try {
      const data = await engine.connectorApps();
      const allowed = new Set<AiAppId>(['claude', 'chatgpt', 'grok', 'gemini']);
      const apps = (Array.isArray(data?.apps) ? data.apps : []).filter((id: string): id is AiAppId => allowed.has(id as AiAppId));
      setConnected(apps);
    } catch {
      setConnected([]);
    }
  };

  useEffect(() => {
    const saved = sessionStorage.getItem('rukmer.mcpKey') || '';
    if (saved.startsWith('rk_live_')) {
      setReadyKey(saved);
      setKey(saved);
    }
    void refreshConnected();
    const onFocus = () => void refreshConnected();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
    setCopied(id);
    setTimeout(() => setCopied(null), 1400);
  };

  const ensureKey = async () => {
    if (liveKey.startsWith('rk_live_')) return liveKey;
    const rec = await engine.createKey('Chat app connector');
    const secret = String(rec.secret || '');
    if (!secret.startsWith('rk_live_')) throw new Error('Could not create a Rukmer key');
    setReadyKey(secret);
    setKey(secret);
    sessionStorage.setItem('rukmer.mcpKey', secret);
    return secret;
  };

  const connectApp = async (app: (typeof AI_APPS)[number]) => {
    if (app.comingSoon) return;
    setBusyApp(app.id);
    setConnectNote('');
    try {
      const secret = await ensureKey();
      const withKey = mcpUrlWithKey(secret);
      if (app.id === 'gemini') {
        const cmd = `gemini mcp add rukmer ${withKey}`;
        await copy('gemini-cmd', cmd);
        setConnectNote('Copied the Gemini command. Paste it in a terminal, then mark this connected.');
      } else if (app.id === 'chatgpt') {
        await copy('chatgpt-mcp', withKey);
        window.open(app.open, '_blank', 'noreferrer');
        setConnectNote('Copied the MCP URL and opened ChatGPT. This stays Off until you Allow Rukmer.');
      } else {
        await copy(`${app.id}-mcp`, withKey);
        window.open(app.open, '_blank', 'noreferrer');
        setConnectNote(`Copied the MCP URL and opened ${app.name}. This stays Off until you Allow Rukmer.`);
      }
      await refreshConnected();
    } catch (err: any) {
      setConnectNote(err.message || 'Could not start the connection');
    } finally {
      setBusyApp(null);
    }
  };

  const list = useMemo(
    () =>
      FILE_CONNECTORS.filter((c) => (tab === 'all' ? true : c.kind === tab)).filter((c) =>
        c.name.toLowerCase().includes(q.toLowerCase())
      ),
    [tab, q]
  );

  const apps = useMemo(
    () => AI_APPS.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())),
    [q]
  );

  const showAi = tab === 'ai' || tab === 'all';
  const showFiles = tab !== 'ai';

  return (
    <div className="max-w-[1100px] mx-auto pb-8">
      <PageHeader
        title="Connectors"
        subtitle={
          <>
            Each chat app has its own section. Sign in to Rukmer once, then plug in Claude, ChatGPT, or Grok. Gemini is coming soon.{' '}
            <DocLink>How connectors work ↗</DocLink>
          </>
        }
      />

      <Panel className="mb-4 p-4 text-[13px] text-zinc-400 leading-relaxed space-y-2">
        <p className="text-zinc-200">You do not paste ChatGPT, Gemini, Claude, or Grok API keys.</p>
        <p>
          Those apps connect with <span className="text-zinc-300">Rukmer OAuth</span> or a{' '}
          <span className="text-zinc-300">Rukmer API key</span>. They still cannot export old chat history.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Optional rk_live_ key, or click Connect on an app to mint one"
            className="flex-1 h-9 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px] font-mono outline-none"
          />
          <button
            onClick={() => copy('mcpk', keyed)}
            className="h-9 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-300 inline-flex items-center gap-1"
          >
            {copied === 'mcpk' ? <Check size={12} /> : <Copy size={12} />} Copy MCP URL
          </button>
        </div>
        <p className="text-[11px] font-mono text-zinc-500 break-all">{keyed}</p>
        {connectNote && (
          <p className="text-[12px] text-emerald-400" role="status">
            {connectNote}
          </p>
        )}
      </Panel>

      <BrowserExtensionCard />
      <GmailConnectCard />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3">
        <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#0c0c0e] p-0.5 overflow-x-auto max-w-full">
          {(['ai', 'all', 'oauth', 'service'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`h-8 px-3 rounded-md text-[13px] ${tab === id ? 'bg-[#252528] text-white' : 'text-zinc-400'}`}
            >
              {id === 'ai' ? 'AI apps' : id === 'oauth' ? 'Files (OAuth)' : id === 'service' ? 'Services' : 'All'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] w-full sm:w-[220px]">
          <Search size={13} className="text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search connectors..."
            className="bg-transparent text-[13px] outline-none w-full placeholder:text-zinc-600"
          />
        </div>
      </div>

      {showAi && (
        <div className="grid md:grid-cols-2 gap-3 mb-4">
          {apps.map((app) => {
            const on = !app.comingSoon && connected.includes(app.id);
            return (
              <Panel key={app.id} className="p-4 flex flex-col min-h-[240px]">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-[15px] font-medium text-white">{app.name}</p>
                    <p className="text-[12px] text-zinc-500">{app.where}</p>
                  </div>
                  {app.comingSoon ? (
                    <span className="text-[11px] text-amber-200/90 border border-amber-400/30 bg-amber-400/10 rounded px-1.5 py-0.5">Coming soon</span>
                  ) : on ? (
                    <span className="text-[11px] text-emerald-400 border border-emerald-500/20 rounded px-1.5 py-0.5">On</span>
                  ) : (
                    <span className="text-[11px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5">Off</span>
                  )}
                </div>
                <p className="text-[13px] text-zinc-400 leading-relaxed mb-3">{app.connectHint}</p>
                <ol className="list-decimal pl-4 text-[12.5px] text-zinc-500 space-y-1 mb-4">
                  {app.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <div className="mt-auto flex flex-wrap gap-2">
                  {app.comingSoon ? (
                    <button type="button" disabled className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-500 cursor-not-allowed">
                      Coming soon
                    </button>
                  ) : (
                  <PrimaryButton onClick={() => void connectApp(app)}>
                    {busyApp === app.id ? 'Connecting…' : on ? 'Reconnect' : `Connect ${app.name}`}
                  </PrimaryButton>
                  )}
                  {!app.comingSoon && (
                  <button
                    onClick={() => copy(`${app.id}-url`, keyed)}
                    className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-300 inline-flex items-center gap-1"
                  >
                    {copied === `${app.id}-url` || copied === `${app.id}-mcp` || copied === 'gemini-cmd' ? <Check size={12} /> : <Copy size={12} />}
                    Copy MCP URL
                  </button>
                  )}
                  {app.id === 'chatgpt' && (
                    <button
                      onClick={() => copy('oa', spec)}
                      className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-400"
                    >
                      {copied === 'oa' ? 'Copied OpenAPI' : 'Copy OpenAPI'}
                    </button>
                  )}
                  {!app.comingSoon && (
                  <a
                    href={app.open}
                    target="_blank"
                    rel="noreferrer"
                    className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-300 inline-flex items-center gap-1"
                  >
                    Open {app.name} <ExternalLink size={12} />
                  </a>
                  )}
                  {on && (
                    <GhostButton
                      onClick={() => {
                        void engine.disconnectConnector(app.id).then((data) => {
                          const allowed = new Set<AiAppId>(['claude', 'chatgpt', 'grok', 'gemini']);
                          const apps = (Array.isArray(data?.apps) ? data.apps : []).filter((id: string): id is AiAppId =>
                            allowed.has(id as AiAppId)
                          );
                          setConnected(apps);
                        }).catch((err: any) => {
                          setConnectNote(err.message || 'Could not disconnect');
                        });
                      }}
                    >
                      Disconnect
                    </GhostButton>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {showFiles && (
        <>
          <Panel>
            {list.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-3 px-3 sm:px-4 py-3.5 border-b border-white/[0.06] last:border-b-0"
              >
                <div className="h-8 w-8 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center overflow-hidden">
                  {c.icon ? <img src={c.icon} alt="" className="h-5 w-5 object-contain" /> : <span className="text-[11px] text-zinc-400">W</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] text-zinc-100">{c.name}</p>
                  <p className="text-[12px] text-zinc-500">
                    {c.id === 'gmail' ? 'Connect Gmail at the top of this page' : 'Imports files you own, not AI chat history'}
                  </p>
                </div>
                <ChevronRight size={16} className="text-zinc-600" />
                {c.id === 'gmail' ? (
                  <span className="text-[12px] text-zinc-400">Use Connect Gmail above</span>
                ) : c.id === 'notion' || c.id === 'github' || c.id === 's3' || c.id === 'crawler' ? (
                  <GhostButton
                    onClick={() => {
                      setImportProvider(c.id === 'crawler' ? 'web' : c.id);
                      document.getElementById('connector-value')?.focus();
                    }}
                  >
                    Use the import form
                  </GhostButton>
                ) : (
                  <span className="text-[12px] text-zinc-500">OAuth file sync is not on this server</span>
                )}
              </div>
            ))}
          </Panel>
          <Panel className="p-4 mt-3">
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setImportStatus('Importing…');
                try {
                  const body =
                    importProvider === 'github' || importProvider === 'notion'
                      ? { provider: importProvider, token: importValue }
                      : { provider: importProvider === 's3' ? 's3' : 'web', url: importValue };
                  const out = await engine.importConnector(body);
                  setImportStatus(`Imported ${out.imported} item${out.imported === 1 ? '' : 's'}`);
                  setImportValue('');
                } catch (err: any) {
                  setImportStatus(err.message || 'Import failed');
                }
              }}
            >
              <label className="block text-[13px] text-zinc-200" htmlFor="connector-provider">
                Import from GitHub, Notion, S3, or a web page
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  id="connector-provider"
                  aria-label="Connector to import from"
                  value={importProvider}
                  onChange={(e) => setImportProvider(e.target.value as typeof importProvider)}
                  className="h-9 rounded-lg border border-white/[0.08] bg-[#111113] px-2 text-[13px] text-zinc-200"
                >
                  <option value="web">Web page URL</option>
                  <option value="github">GitHub token</option>
                  <option value="notion">Notion token</option>
                  <option value="s3">S3 presigned URL</option>
                </select>
                <input
                  aria-label={importProvider === 'github' || importProvider === 'notion' ? 'Access token, used once and not stored' : 'https URL to import'}
                  id="connector-value"
                  value={importValue}
                  onChange={(e) => setImportValue(e.target.value)}
                  placeholder={importProvider === 'github' || importProvider === 'notion' ? 'Token (used once, not stored)' : 'https://'}
                  className="h-9 flex-1 rounded-lg border border-white/[0.08] bg-[#111113] px-3 text-[13px] text-zinc-200"
                />
                <button type="submit" className="h-9 px-3 rounded-lg bg-[#2563eb] text-[12px] text-white">
                  Import into memory
                </button>
              </div>
              <p className="text-[12px] text-zinc-500" role="status">
                {importStatus || 'Tokens are sent once to read your files and are not saved.'}
              </p>
            </form>
          </Panel>
        </>
      )}
    </div>
  );
}
