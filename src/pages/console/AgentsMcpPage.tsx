import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Copy, Check } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState, TableHead, PrimaryButton, Toggle } from '../../components/console/ui';
import { mcpUrl as liveMcpUrl } from '../../services/aiConnectors';

type AgentId = 'claude' | 'cursor' | 'codex';

const AGENTS: {
  id: AgentId;
  name: string;
  docs: string;
  docsHref: string;
  steps: { title: string; hint?: string; cmd: string }[];
}[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    docs: 'Claude Code docs',
    docsHref: 'https://code.claude.com/docs/en/plugins',
    steps: [
      { title: '1. Add the marketplace', cmd: '/plugin marketplace add rukmer/rukmer-memory' },
      {
        title: '2. Install',
        hint: 'Restart Claude Code and it opens your browser to sign in.',
        cmd: '/plugin install rukmer',
      },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    docs: 'Cursor docs',
    docsHref: 'https://cursor.com/docs/context/mcp',
    steps: [
      { title: '1. Open MCP settings', hint: 'Cursor Settings → MCP → New MCP server.', cmd: 'Cursor Settings → MCP' },
      { title: '2. Paste the Rukmer URL', hint: 'Cursor opens your browser. Allow Rukmer.', cmd: '' },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    docs: 'Codex docs',
    docsHref: 'https://developers.openai.com/codex/mcp',
    steps: [
      { title: '1. Add the MCP server', cmd: '' },
      { title: '2. Sign in', hint: 'Restart Codex and approve Rukmer in the browser.', cmd: 'codex' },
    ],
  },
];

function AgentMark({ id }: { id: AgentId }) {
  if (id === 'claude') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
        <g stroke="currentColor" strokeWidth="1.35" strokeLinecap="round">
          <path d="M8 1.6v12.8M1.6 8h12.8M3.4 3.4l9.2 9.2M12.6 3.4 3.4 12.6" />
        </g>
      </svg>
    );
  }
  if (id === 'cursor') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
        <path d="M8 2.1 13.2 5v6L8 13.9 2.8 11V5L8 2.1Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        <path d="M8 2.2V8.1L13.1 11M8 8.1 2.9 11" fill="none" stroke="currentColor" strokeWidth="1.15" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path d="M6.1 4.2 2.8 8l3.3 3.8M9.9 4.2 13.2 8 9.9 11.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AgentsMcpPage() {
  const [includeKey, setIncludeKey] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [editor, setEditor] = useState<AgentId>('claude');

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
  };

  const pluginCmd = 'npx rukmer plugin';
  const mcpUrl = liveMcpUrl();
  const cli = 'npm i -g rukmer && rukmer login';
  const agent = AGENTS.find((item) => item.id === editor) || AGENTS[0];
  const steps = agent.steps.map((step) => ({
    ...step,
    cmd: step.cmd || (agent.id === 'cursor' ? mcpUrl : `codex mcp add rukmer --url ${mcpUrl}`),
  }));

  return (
    <div className="max-w-[1100px] mx-auto pb-8">
      <PageHeader
        title="Agents"
        subtitle={
          <>
            Coding agents (Cursor, Claude Code, Codex) live here. For Claude, ChatGPT, and Grok as chat apps, use Connectors. Gemini is coming soon.{' '}
            <DocLink>How agents connect ↗</DocLink>
          </>
        }
      />

      <Panel className="mb-6 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <p className="text-[13.5px] text-zinc-200">Using Claude, ChatGPT, or Grok as a person?</p>
          <p className="text-[12.5px] text-zinc-500">Connect those apps with MCP. Gemini is coming soon. No provider API keys, and they still cannot export old chats.</p>
        </div>
        <Link to="/connectors" className="h-8 px-3 rounded-lg bg-[#2563eb] text-[13px] text-white inline-flex items-center">
          Open Connectors
        </Link>
      </Panel>

      <p className="text-[14px] font-medium text-zinc-200 mb-2">Connected</p>
      <Panel className="mb-8">
        <TableHead cols={['AGENT', 'ACCESS', 'DEVICE', 'CREATED', 'LAST ACTIVE']} />
        <EmptyState
          icon={<Bot size={18} />}
          title="No agents connected yet"
          body="Agents appear here with their key, device, and access."
          action={
            <button
              onClick={() => copy('plugin', pluginCmd)}
              className="h-8 px-3 rounded-lg border border-white/[0.1] text-[12.5px] text-zinc-300 font-mono inline-flex items-center gap-2"
            >
              $ {pluginCmd} {copied === 'plugin' ? <Check size={12} /> : <Copy size={12} />}
            </button>
          }
        />
      </Panel>

      <p className="text-[14px] font-medium text-zinc-200">In your agents</p>
      <p className="text-[13px] text-zinc-500 mb-3">Rukmer as a plugin: your agents and the CLI share this workspace’s memory.</p>

      <Panel className="mb-3 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/[0.06]">
          <p className="text-[13.5px] text-zinc-100">Connect an agent</p>
          <a href={agent.docsHref} target="_blank" rel="noreferrer" className="text-[12.5px] text-zinc-500 hover:text-zinc-300 shrink-0">
            {agent.docs}
          </a>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3.5 border-b border-white/[0.06]">
          <div>
            <p className="text-[13.5px] text-zinc-100">All editor plugins at once</p>
            <p className="text-[12.5px] text-zinc-500">Claude Code, Cursor, and Codex.</p>
          </div>
          <button
            type="button"
            onClick={() => copy('npx', pluginCmd)}
            className="h-8 max-w-full px-3 rounded-lg border border-white/[0.08] bg-[#111113] text-[12.5px] font-mono text-zinc-200 truncate"
          >
            {copied === 'npx' ? 'Copied' : pluginCmd}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-white/[0.06]">
          {AGENTS.map((item) => {
            const on = editor === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setEditor(item.id)}
                className={`h-9 pl-2.5 pr-3.5 rounded-full border inline-flex items-center gap-2 text-[13.5px] ${
                  on
                    ? 'border-[#2563eb] bg-[#1e4b8c]/55 text-[#dbeafe]'
                    : 'border-white/[0.1] bg-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <AgentMark id={item.id} />
                {item.name}
              </button>
            );
          })}
        </div>
        {steps.map((step) => (
          <div key={step.title} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3.5 border-b border-white/[0.06] last:border-b-0">
            <div className="min-w-0">
              <p className="text-[13.5px] text-zinc-100">{step.title}</p>
              {step.hint ? <p className="text-[12.5px] text-zinc-500">{step.hint}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => copy(step.title, step.cmd)}
              className="h-8 max-w-full sm:max-w-[420px] px-3 rounded-lg border border-white/[0.08] bg-[#111113] text-[12.5px] font-mono text-zinc-200 truncate text-left"
            >
              {copied === step.title ? 'Copied' : step.cmd}
            </button>
          </div>
        ))}
      </Panel>

      <Panel className="mb-3 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/[0.06]">
          <p className="text-[13.5px] text-zinc-100">Connect over MCP</p>
          <span className="text-[12.5px] text-zinc-500">MCP setup</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3.5">
          <div>
            <p className="text-[13.5px] text-zinc-100">Add this URL to your MCP client</p>
            <p className="text-[12.5px] text-zinc-500">Signs in through your browser. No API key needed.</p>
          </div>
          <button
            type="button"
            onClick={() => copy('mcp', mcpUrl)}
            className="h-8 max-w-full sm:max-w-[420px] px-3 rounded-lg border border-white/[0.08] bg-[#111113] text-[12px] font-mono text-zinc-200 truncate"
          >
            {copied === 'mcp' ? 'Copied' : mcpUrl}
          </button>
        </div>
      </Panel>

      <Panel className="mb-3 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/[0.06]">
          <p className="text-[13.5px] text-zinc-100">Rukmer CLI</p>
          <span className="text-[12.5px] text-zinc-500">CLI</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3.5">
          <div>
            <p className="text-[13.5px] text-zinc-100">Manage this workspace from a shell</p>
            <p className="text-[12.5px] text-zinc-500">Install the CLI, then sign in once in the browser.</p>
          </div>
          <button
            type="button"
            onClick={() => copy('cli', cli)}
            className="h-8 max-w-full sm:max-w-[420px] px-3 rounded-lg border border-white/[0.08] bg-[#111113] text-[12px] font-mono text-zinc-200 truncate"
          >
            {copied === 'cli' ? 'Copied' : cli}
          </button>
        </div>
      </Panel>

      <p className="text-[14px] font-medium text-zinc-200 mt-6">How data is processed</p>
      <p className="text-[13px] text-zinc-500 mb-3">
        Rukmer stores memory. Gemini, GPT, Claude, and Grok only see a retrieved prompt. They do not keep your graph.
      </p>
      <Panel className="mb-3 p-4 space-y-2 text-[13px] text-zinc-400">
        <p>
          <span className="text-zinc-200">Stored:</span> chunks with embeddings, BM25 index, and durable facts
          (prefers, works_at, lives_in) scoped by containerTag.
        </p>
        <p>
          <span className="text-zinc-200">Not stored as memory:</span> provider account history, model weights, or
          throwaway chat questions.
        </p>
        <p>
          <span className="text-zinc-200">Flow:</span> ingest → extract facts → hybrid retrieve → inject into the
          system prompt → generate with the chosen model → commit new durable facts.
        </p>
        <p className="font-mono text-[12px] text-zinc-500">GET /v4/protocol</p>
      </Panel>

      <p className="text-[14px] font-medium text-zinc-200 mt-6">Memory router</p>
      <p className="text-[13px] text-zinc-500 mb-3">
        For products you build: one OpenAI-style URL. Everyday chat in Claude / ChatGPT / Gemini / Grok should use the MCP connector, not these keys.
      </p>
      <Panel className="mb-3 p-4">
        <pre className="text-[11px] leading-relaxed text-zinc-400 font-mono whitespace-pre-wrap break-all overflow-x-auto">{`# One URL — change model + key
curl https://app.rukmer.com/v1/chat/completions \\
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \\
  -H "x-container-tag: u_<your-uid>" \\
  -H "x-rukmer-memory: on" \\
  -H "Content-Type: application/json" \\
  -H "x-gemini-key: $GEMINI_API_KEY" \\
  -d '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"What do you know about me?"}]}'

# GPT:    x-openai-key + model gpt-4o-mini
# Claude: x-anthropic-key + model claude-sonnet-4-5
# Grok:   x-grok-key + model grok-3-mini
# Cursor / OpenAI SDK: baseURL https://app.rukmer.com/v1

GET  /v1/models
GET  /v4/tools
POST /v4/tools/execute  {"name":"searchMemories","arguments":{"query":"...","containerTag":"u_<your-uid>"}}
POST /v4/inject         {"query":"...","containerTag":"u_<your-uid>"}`}</pre>
      </Panel>

      <p className="text-[14px] font-medium text-zinc-200 mt-6">In your product</p>
      <p className="text-[13px] text-zinc-500 mb-3">Rukmer as infrastructure: give your own app memory with the SDK.</p>
      <Panel>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 py-3.5">
          <div>
            <p className="text-[13.5px] text-zinc-200">Build with Rukmer</p>
            <p className="text-[12px] text-zinc-500">Paste the setup prompt into your coding agent.</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-[12px] text-zinc-500 inline-flex items-center gap-2">
              Include an API key <Toggle on={includeKey} onClick={() => setIncludeKey((v) => !v)} />
            </span>
            <PrimaryButton
              onClick={() =>
                copy(
                  'setup',
                  `# Onboard this project to Rukmer Memory\nUse ${mcpUrl}${includeKey ? '\nInclude an API key from /api-keys' : ''}`
                )
              }
            >
              {copied === 'setup' ? 'Copied' : 'Copy setup prompt'}
            </PrimaryButton>
          </div>
        </div>
      </Panel>
    </div>
  );
}
