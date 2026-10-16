import React, { useEffect, useMemo, useState } from 'react';
import { Search, ChevronRight, Copy, Check, ExternalLink } from 'lucide-react';
import { PageHeader, DocLink, Panel, GhostButton, PrimaryButton } from '../../components/console/ui';
import {
  loadConnectedApps,
  mcpUrlWithKey,
  openApiUrl,
  setAppConnected,
  type AiAppId,
} from '../../services/aiConnectors';
import { engine } from '../../services/engineClient';

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

export default function ConnectorsPage() {
  const [tab, setTab] = useState<'ai' | 'all' | Kind>('ai');
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [connected, setConnected] = useState<AiAppId[]>(() => loadConnectedApps());
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

  useEffect(() => {
    const saved = sessionStorage.getItem('rukmer.mcpKey') || '';
    if (saved.startsWith('rk_live_')) {
      setReadyKey(saved);
      setKey(saved);
    }
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
        setConnectNote('Copied the MCP URL and opened ChatGPT. Add a connector, then Allow Rukmer.');
      } else {
        await copy(`${app.id}-mcp`, withKey);
        window.open(app.open, '_blank', 'noreferrer');
        setConnectNote(`Copied the MCP URL and opened ${app.name}. Add the connector, then Allow Rukmer.`);
      }
      const next = setAppConnected(app.id, true);
      setConnected(next);
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
                        setConnected(setAppConnected(app.id, false));
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
                  <p className="text-[12px] text-zinc-500">Imports files you own, not AI chat history</p>
                </div>
                <ChevronRight size={16} className="text-zinc-600" />
                {c.id === 'notion' || c.id === 'github' || c.id === 's3' || c.id === 'crawler' ? (
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
