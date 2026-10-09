import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Copy, Check } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState, TableHead, PrimaryButton, Toggle } from '../../components/console/ui';
import { mcpUrl as liveMcpUrl } from '../../services/aiConnectors';

const EDITORS = ['Claude Code', 'Cursor', 'Codex', 'OpenCode', 'Muse Code', 'AmpCode', 'OpenClaw', 'Hermes'];

export default function AgentsMcpPage() {
  const [includeKey, setIncludeKey] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [editor, setEditor] = useState('Claude Code');

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

  return (
    <div className="max-w-[1100px] mx-auto pb-8">
      <PageHeader
        title="Agents"
        subtitle={
          <>
            Coding agents (Cursor, Claude Code) live here. For Claude, ChatGPT, Gemini, and Grok as chat apps, use Connectors — MCP, no API keys.{' '}
            <DocLink>How agents connect ↗</DocLink>
          </>
        }
      />

      <Panel className="mb-6 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <p className="text-[13.5px] text-zinc-200">Using Claude, ChatGPT, Gemini, or Grok as a person?</p>
          <p className="text-[12.5px] text-zinc-500">Connect those apps with MCP. No provider API keys, and they still cannot export old chats.</p>
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

      <Panel className="mb-3 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div>
            <p className="text-[13.5px] text-zinc-200">Connect an agent</p>
            <p className="text-[12.5px] text-zinc-500">All editor plugins at once. Claude Code, Cursor, Codex and OpenCode.</p>
          </div>
          <button
            onClick={() => copy('npx', pluginCmd)}
            className="h-8 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] font-mono text-zinc-300"
          >
            {copied === 'npx' ? 'Copied' : pluginCmd}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {EDITORS.map((e) => (
            <button
              key={e}
              onClick={() => setEditor(e)}
              className={`h-8 px-3 rounded-full border text-[12.5px] ${
                editor === e ? 'border-blue-400/40 bg-blue-500/10 text-white' : 'border-white/[0.08] text-zinc-400'
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-2 text-[13px]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4">
            <span className="text-zinc-400">1. Add the marketplace</span>
            <code className="text-[12px] text-zinc-300 font-mono break-all">/plugin marketplace add rukmer/rukmer-memory</code>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4">
            <span className="text-zinc-400">2. Install</span>
            <code className="text-[12px] text-zinc-300 font-mono">/plugin install rukmer</code>
          </div>
        </div>
      </Panel>

      <Panel className="mb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3.5 border-b border-white/[0.06]">
          <div>
            <p className="text-[13.5px] text-zinc-200">Connect over MCP</p>
            <p className="text-[12px] text-zinc-500">Add this URL to your MCP client. Signs in through your browser.</p>
          </div>
          <button
            onClick={() => copy('mcp', mcpUrl)}
            className="h-8 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px] font-mono text-zinc-300 max-w-full truncate"
          >
            {copied === 'mcp' ? 'Copied' : mcpUrl}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3.5">
          <div>
            <p className="text-[13.5px] text-zinc-200">Rukmer CLI</p>
            <p className="text-[12px] text-zinc-500">Manage this workspace from a shell.</p>
          </div>
          <button
            onClick={() => copy('cli', cli)}
            className="h-8 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px] font-mono text-zinc-300 max-w-full truncate"
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
