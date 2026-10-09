import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Search, ChevronRight, MoreHorizontal, Copy, Check, ExternalLink } from 'lucide-react';
import { PageHeader, DocLink, Panel, GhostButton, PrimaryButton } from '../../components/console/ui';
import {
  loadConnectedApps,
  mcpUrl,
  mcpUrlWithKey,
  openApiUrl,
  setAppConnected,
  type AiAppId,
} from '../../services/aiConnectors';
import type { UserProfile } from '../../types';

type Kind = 'ai' | 'oauth' | 'service';

const FILE_CONNECTORS: {
  id: string;
  name: string;
  kind: Exclude<Kind, 'ai'>;
  plan: string;
  icon: string;
  href?: (uid: string) => string;
}[] = [
  {
    id: 'gdrive',
    name: 'Google Drive',
    kind: 'oauth',
    plan: 'Pro',
    icon: 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png',
    href: (uid) => `/api/auth/google?userId=${encodeURIComponent(uid)}&type=gdrive`,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    kind: 'oauth',
    plan: 'Max',
    icon: 'https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png',
    href: (uid) => `/api/auth/google?userId=${encodeURIComponent(uid)}&type=gmail`,
  },
  { id: 'slack', name: 'Slack', kind: 'oauth', plan: 'Pro', icon: 'https://cdn.worldvectorlogo.com/logos/slack-new-logo.svg' },
  { id: 'outlook', name: 'Microsoft Outlook', kind: 'oauth', plan: 'Pro', icon: '/icons/outlook.svg', href: (uid) => `/api/auth/microsoft?userId=${encodeURIComponent(uid)}&type=outlook` },
  { id: 'teams', name: 'Microsoft Teams', kind: 'oauth', plan: 'Pro', icon: '/icons/teams.svg', href: (uid) => `/api/auth/microsoft?userId=${encodeURIComponent(uid)}&type=teams` },
  { id: 'onedrive', name: 'OneDrive', kind: 'oauth', plan: 'Pro', icon: '/icons/onedrive.svg', href: (uid) => `/api/auth/microsoft?userId=${encodeURIComponent(uid)}&type=onedrive` },
  { id: 'notion', name: 'Notion', kind: 'oauth', plan: 'Pro', icon: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png' },
  { id: 'github', name: 'GitHub', kind: 'oauth', plan: 'Scale', icon: 'https://cdn.simpleicons.org/github/ffffff' },
  { id: 's3', name: 'Amazon S3', kind: 'service', plan: 'Scale', icon: 'https://cdn.simpleicons.org/amazons3/FF9900' },
  { id: 'crawler', name: 'Web Crawler', kind: 'service', plan: 'Scale', icon: '' },
];

const AI_APPS: {
  id: AiAppId;
  name: string;
  where: string;
  open: string;
  steps: string[];
}[] = [
  {
    id: 'claude',
    name: 'Claude',
    where: 'claude.ai → Customize → Connectors',
    open: 'https://claude.ai/settings/connectors',
    steps: [
      'Open Claude → Settings → Connectors → Add custom connector.',
      'Paste the Rukmer MCP URL. Claude starts Rukmer OAuth in the browser — Allow.',
      'If OAuth is blocked, paste a Rukmer API key as ?api_key= on the same URL.',
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    where: 'chatgpt.com → Settings → Connectors (Developer mode)',
    open: 'https://chatgpt.com/',
    steps: [
      'Turn on ChatGPT Developer mode, then Settings → Connectors → Create.',
      'Paste the Rukmer MCP URL. ChatGPT uses OAuth — sign in to Rukmer and Allow.',
      'Fallback: Custom GPT Actions with the OpenAPI file plus a Rukmer API key.',
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    where: 'Gemini CLI, or chat in Rukmer Playground',
    open: 'https://gemini.google.com/',
    steps: [
      'Gemini’s website cannot import old chats. For CLI: gemini mcp add rukmer <MCP URL with api_key>.',
      'Or chat in Playground with Gemini selected — memory stays in this workspace.',
      'Going forward, searchMemories / addMemory write facts into your graph.',
    ],
  },
  {
    id: 'grok',
    name: 'Grok',
    where: 'grok.com → Connectors',
    open: 'https://grok.com/connectors',
    steps: [
      'Open grok.com → Connectors and add a custom MCP server.',
      'Paste the Rukmer MCP URL and complete Rukmer OAuth, or append ?api_key=.',
      'Grok then calls Rukmer tools in new chats. Past grok.com threads stay on X.',
    ],
  },
];

export default function ConnectorsPage() {
  const { user } = useOutletContext<{ user: UserProfile; homeTag: string }>();
  const [tab, setTab] = useState<'ai' | 'all' | Kind>('ai');
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState<AiAppId | null>(null);
  const [connected, setConnected] = useState<AiAppId[]>(() => loadConnectedApps());
  const [key, setKey] = useState('');
  const url = mcpUrl();
  const keyed = mcpUrlWithKey(key);
  const spec = openApiUrl();

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
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
            Plug Claude, ChatGPT, Gemini, and Grok into Rukmer memory — or sync files you own.{' '}
            <DocLink>How connectors work ↗</DocLink>
          </>
        }
      />

      <Panel className="mb-4 p-4 text-[13px] text-zinc-400 leading-relaxed space-y-2">
        <p className="text-zinc-200">You do not paste ChatGPT, Gemini, Claude, or Grok API keys.</p>
        <p>
          Those apps connect with <span className="text-zinc-300">Rukmer OAuth</span> or a{' '}
          <span className="text-zinc-300">Rukmer API key</span> from API Keys. They still cannot export old chat history.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Optional rk_live_ key to embed in the MCP URL"
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
      </Panel>

      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#0c0c0e] p-0.5">
          {(['ai', 'all', 'oauth', 'service'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`h-8 px-3 rounded-md text-[13px] ${
                tab === id ? 'bg-[#252528] text-white' : 'text-zinc-400'
              }`}
            >
              {id === 'ai' ? 'AI apps' : id === 'oauth' ? 'Files (OAuth)' : id === 'service' ? 'Services' : 'All'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] w-[220px]">
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
        <Panel className="mb-4">
          {apps.map((app) => {
            const on = connected.includes(app.id);
            const expanded = open === app.id;
            return (
              <div key={app.id} className="border-b border-white/[0.06] last:border-b-0">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="h-8 w-8 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[11px] text-zinc-300">
                    {app.name.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] text-zinc-100">{app.name}</p>
                    <p className="text-[12px] text-zinc-500 truncate">{on ? 'Connected — tools enabled in that app' : app.where}</p>
                  </div>
                  {on && (
                    <span className="text-[11px] text-emerald-400 border border-emerald-500/20 rounded px-1.5 py-0.5">On</span>
                  )}
                  <GhostButton onClick={() => setOpen(expanded ? null : app.id)}>{expanded ? 'Hide' : 'Connect'}</GhostButton>
                </div>
                {expanded && (
                  <div className="px-4 pb-4 space-y-2">
                    <ol className="list-decimal pl-4 text-[13px] text-zinc-400 space-y-1">
                      {app.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <button
                        onClick={() => copy(app.id, keyed)}
                        className="h-8 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px] font-mono text-zinc-300"
                      >
                        {copied === app.id ? 'Copied MCP URL' : url}
                      </button>
                      {app.id === 'chatgpt' && (
                        <button
                          onClick={() => copy('oa', spec)}
                          className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-400"
                        >
                          {copied === 'oa' ? 'Copied' : 'Copy OpenAPI'}
                        </button>
                      )}
                      <a
                        href={app.open}
                        target="_blank"
                        rel="noreferrer"
                        className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-300 inline-flex items-center gap-1"
                      >
                        Open {app.name} <ExternalLink size={12} />
                      </a>
                      <PrimaryButton
                        onClick={() => {
                          const next = setAppConnected(app.id, !on);
                          setConnected(next);
                        }}
                      >
                        {on ? 'Disconnect' : "I've connected this"}
                      </PrimaryButton>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="px-4 py-3 flex items-center justify-between gap-3 border-t border-white/[0.06]">
            <p className="text-[12px] text-zinc-500">Same MCP URL for every app. OAuth signs the connector into your private tag.</p>
            <button
              onClick={() => copy('mcp', keyed)}
              className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12px] text-zinc-300 inline-flex items-center gap-1"
            >
              {copied === 'mcp' ? <Check size={12} /> : <Copy size={12} />} {copied === 'mcp' ? 'Copied' : 'Copy MCP URL'}
            </button>
          </div>
        </Panel>
      )}

      {showFiles && (
        <Panel>
          {list.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06] last:border-b-0"
            >
              <div className="h-8 w-8 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center overflow-hidden">
                {c.icon ? <img src={c.icon} alt="" className="h-5 w-5 object-contain" /> : <span className="text-[11px] text-zinc-400">W</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] text-zinc-100">{c.name}</p>
                <p className="text-[12px] text-zinc-500">Requires the {c.plan} plan · imports files you own, not AI chat history</p>
              </div>
              <ChevronRight size={16} className="text-zinc-600" />
              {c.href && user?.uid ? (
                <a href={c.href(user.uid)} className="h-8 px-3 rounded-lg bg-[#2563eb] text-[12px] text-white inline-flex items-center">
                  Connect
                </a>
              ) : (
                <GhostButton>Upgrade</GhostButton>
              )}
              <button className="h-8 w-8 rounded-md text-zinc-500 hover:text-zinc-300 flex items-center justify-center">
                <MoreHorizontal size={16} />
              </button>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
