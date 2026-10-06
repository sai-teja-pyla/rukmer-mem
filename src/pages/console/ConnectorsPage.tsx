import React, { useMemo, useState } from 'react';
import { Search, ChevronRight, MoreHorizontal, Copy, Check, ExternalLink } from 'lucide-react';
import { PageHeader, DocLink, Panel, GhostButton, PrimaryButton } from '../../components/console/ui';
import {
  loadConnectedApps,
  mcpUrl,
  openApiUrl,
  setAppConnected,
  type AiAppId,
} from '../../services/aiConnectors';

type Kind = 'ai' | 'oauth' | 'service';

const FILE_CONNECTORS: { name: string; kind: Exclude<Kind, 'ai'>; plan: string; icon: string }[] = [
  { name: 'Google Drive', kind: 'oauth', plan: 'Pro', icon: 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png' },
  { name: 'Gmail', kind: 'oauth', plan: 'Max', icon: 'https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png' },
  { name: 'Slack', kind: 'oauth', plan: 'Pro', icon: 'https://cdn.worldvectorlogo.com/logos/slack-new-logo.svg' },
  { name: 'Microsoft Outlook', kind: 'oauth', plan: 'Pro', icon: '/icons/outlook.svg' },
  { name: 'Microsoft Teams', kind: 'oauth', plan: 'Pro', icon: '/icons/teams.svg' },
  { name: 'OneDrive', kind: 'oauth', plan: 'Pro', icon: '/icons/onedrive.svg' },
  { name: 'Notion', kind: 'oauth', plan: 'Pro', icon: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png' },
  { name: 'GitHub', kind: 'oauth', plan: 'Scale', icon: 'https://cdn.simpleicons.org/github/ffffff' },
  { name: 'Amazon S3', kind: 'service', plan: 'Scale', icon: 'https://cdn.simpleicons.org/amazons3/FF9900' },
  { name: 'Web Crawler', kind: 'service', plan: 'Scale', icon: '' },
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
      'Open Claude → Customize → Connectors (or Settings → Connectors).',
      'Add a custom connector and paste the Rukmer MCP URL. No Anthropic API key.',
      'Enable searchMemories and addMemory. New chats can read and write Rukmer memory.',
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    where: 'chatgpt.com → Settings → Connectors (Developer mode)',
    open: 'https://chatgpt.com/',
    steps: [
      'In ChatGPT, turn on Developer mode, then Settings → Connectors → create.',
      'Paste the Rukmer MCP URL, or attach the OpenAPI file as Custom GPT Actions.',
      'Sign in is your ChatGPT account plus this workspace. No OpenAI API key.',
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    where: 'Gemini CLI, or chat in Rukmer Playground',
    open: 'https://gemini.google.com/',
    steps: [
      'Gemini’s website does not import past chats. Connect Gemini CLI: gemini mcp add rukmer <MCP URL>.',
      'Or stay in Playground and pick Gemini — Rukmer can use the hosted Gemini key.',
      'Going forward, tools searchMemories / addMemory keep the graph in Rukmer.',
    ],
  },
  {
    id: 'grok',
    name: 'Grok',
    where: 'grok.com → Connectors',
    open: 'https://grok.com/connectors',
    steps: [
      'Open grok.com → Connectors and add a custom MCP server.',
      'Paste the Rukmer MCP URL. No xAI API key.',
      'Grok then calls Rukmer tools in new chats. Past grok.com threads stay on X.',
    ],
  },
];

export default function ConnectorsPage() {
  const [tab, setTab] = useState<'ai' | 'all' | Kind>('ai');
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState<AiAppId | null>(null);
  const [connected, setConnected] = useState<AiAppId[]>(() => loadConnectedApps());
  const url = mcpUrl();
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

      <Panel className="mb-4 p-4 text-[13px] text-zinc-400 leading-relaxed">
        <p className="text-zinc-200 mb-1">You do not paste those products’ API keys.</p>
        <p>
          They do not give Rukmer their chat-session or history APIs. Connecting means:{' '}
          <span className="text-zinc-300">while you talk in that app going forward</span>, it can search and save
          memory here. Old threads stay where they are unless you import a file.
        </p>
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
                        onClick={() => copy(app.id, url)}
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
            <p className="text-[12px] text-zinc-500">Same MCP URL for every app. Copy once, paste in each connector.</p>
            <button
              onClick={() => copy('mcp', url)}
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
              key={c.name}
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
              <GhostButton>Upgrade</GhostButton>
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
