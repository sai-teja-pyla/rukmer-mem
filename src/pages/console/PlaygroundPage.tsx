import React, { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  MessageSquare,
  Search,
  Plus,
  ChevronDown,
  Split,
  Plug,
  ArrowUp,
  RotateCcw,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';

import { engine } from '../../services/engineClient';
import { keyHeaders, loadProviderKeys, saveProviderKeys, type ProviderKeys } from '../../services/providerKeys';
import type { UserProfile } from '../../types';
import { homeTag as makeHomeTag } from '../../services/tenancy';

type MemoryMode = 'agentic' | 'auto';
type RequestTab = 'prompt' | 'curl' | 'ts' | 'py';

const MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'gemini' },
  { id: 'gpt-4o-mini', label: 'ChatGPT 4o mini', provider: 'openai' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet', provider: 'anthropic' },
  { id: 'grok-3-mini', label: 'Grok 3 mini', provider: 'grok' },
] as const;
type Mode = 'chat' | 'search';
const SOURCES = ['All sources', 'Documents', 'Conversations', 'Apps'];
const SUGGESTIONS = [
  'What do you know about me?',
  'What have I been working on?',
  'What coffee do I prefer?',
];

const DEFAULT_INCLUDE = {
  related: true,
  documents: true,
  chunks: false,
  summaries: false,
  forgotten: false,
};

function SparkIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.2l1.55 6.4 6.45.15-5.15 4.05 1.85 6.3L12 15.9 7.3 19.1l1.85-6.3L4 8.75l6.45-.15L12 2.2z"
        fill="#3b82f6"
      />
    </svg>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`h-[22px] w-10 rounded-full relative shrink-0 transition-colors ${on ? 'bg-[#2563eb]' : 'bg-zinc-700'}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-[3px]'}`} />
    </button>
  );
}

function Stepper({
  value,
  onChange,
  step,
  min,
  max,
  format,
}: {
  value: number;
  onChange: (n: number) => void;
  step: number;
  min: number;
  max: number;
  format?: (n: number) => string;
}) {
  return (
    <div className="flex items-center gap-1 text-[12.5px] text-zinc-300">
      <button
        className="h-6 w-6 rounded-md border border-white/[0.08] hover:bg-white/[0.05]"
        onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}
      >
        –
      </button>
      <span className="w-8 text-center tabular-nums">{format ? format(value) : value}</span>
      <button
        className="h-6 w-6 rounded-md border border-white/[0.08] hover:bg-white/[0.05]"
        onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}
      >
        +
      </button>
    </div>
  );
}

function CircleCheck({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 text-[13px] text-zinc-300">
      <span className={`h-[15px] w-[15px] rounded-full border ${on ? 'border-[#3b82f6] bg-[#2563eb]' : 'border-zinc-600 bg-transparent'}`} />
      {label}
    </button>
  );
}

export default function PlaygroundPage() {
  const { user, homeTag } = useOutletContext<{ user: UserProfile; homeTag: string }>();
  const mine = homeTag || makeHomeTag(user.uid);
  const [mode, setMode] = useState<Mode>('chat');
  const [memoryMode, setMemoryMode] = useState<MemoryMode>('agentic');
  const [input, setInput] = useState('');
  const [model, setModel] = useState<(typeof MODELS)[number]>(MODELS[0]);
  const [tag, setTag] = useState(mine);
  const [tagOptions, setTagOptions] = useState<string[]>(mine ? [mine] : []);
  const [keys, setKeys] = useState<ProviderKeys>(() => loadProviderKeys());
  const [keysOpen, setKeysOpen] = useState(false);
  const [serverProviders, setServerProviders] = useState<Record<string, boolean>>({});
  const [source, setSource] = useState(SOURCES[0]);
  const [useProfile, setUseProfile] = useState(true);
  const [retrieved, setRetrieved] = useState(10);
  const [strictness, setStrictness] = useState(0.4);
  const [rerank, setRerank] = useState(false);
  const [rewrite, setRewrite] = useState(false);
  const [aggregate, setAggregate] = useState(false);
  const [include, setInclude] = useState(DEFAULT_INCLUDE);
  const [compare, setCompare] = useState(false);
  const [requestTab, setRequestTab] = useState<RequestTab>('prompt');
  const [copied, setCopied] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [hits, setHits] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mine) {
      setTag(mine);
      setTagOptions((prev) => [...new Set([mine, ...prev])]);
    }
    engine
      .tags()
      .then((d) => {
        const tags = [...new Set([mine, ...(d.tags || []).map((t: any) => t.tag)].filter(Boolean))];
        setTagOptions(tags);
        setTag((cur) => (tags.includes(cur) ? cur : mine));
      })
      .catch(() => {});
    engine
      .health()
      .then((d) => setServerProviders(d.providers || {}))
      .catch(() => {});
  }, []);

  const payload = useMemo(
    () => ({
      mode,
      memoryMode,
      model: model.id,
      provider: model.provider,
      containerTag: tag || mine,
      sources: source,
      useProfile,
      memoriesRetrieved: retrieved,
      matchStrictness: strictness,
      rerank,
      rewriteQuery: rewrite,
      aggregate,
      include,
      compareWithoutMemory: compare,
      prompt: input || null,
    }),
    [mode, memoryMode, model, tag, source, useProfile, retrieved, strictness, rerank, rewrite, aggregate, include, compare, input]
  );

  const requestPreview = useMemo(() => {
    const chatBody = {
      model: model.id,
      messages: [{ role: 'user', content: input || 'What do you know about me?' }],
    };
    const body = JSON.stringify(mode === 'chat' ? chatBody : payload, null, 2);
    const url = mode === 'chat' ? '/v1/chat/completions' : '/v4/search';
    if (requestTab === 'prompt') return body;
    if (requestTab === 'curl') {
      return `curl -X POST https://app.rukmer.com${url} \\\n  -H "x-container-tag: ${tag}" \\\n  -H "x-rukmer-memory: on" \\\n  -H "Content-Type: application/json" \\\n  -H "x-${model.provider}-key: $PROVIDER_API_KEY" \\\n  -d '${JSON.stringify(mode === 'chat' ? chatBody : payload)}'`;
    }
    if (requestTab === 'ts') {
      return `const res = await fetch("${url}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "x-container-tag": "${tag}",\n    "x-${model.provider}-key": process.env.PROVIDER_API_KEY,\n  },\n  body: JSON.stringify(${body}),\n});`;
    }
    return `import requests\n\nrequests.post(\n  "https://app.rukmer.com${url}",\n  headers={"x-container-tag": "${tag}", "x-${model.provider}-key": key},\n  json=${body},\n)`;
  }, [payload, requestTab, mode, model, tag, input]);

  const reset = () => {
    setMemoryMode('agentic');
    setSource(SOURCES[0]);
    setUseProfile(true);
    setRetrieved(10);
    setStrictness(0.4);
    setRerank(false);
    setRewrite(false);
    setAggregate(false);
    setInclude(DEFAULT_INCLUDE);
    setCompare(false);
  };

  const copyRequest = async () => {
    try {
      await navigator.clipboard.writeText(requestPreview);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const send = async (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || busy) return;
    setBusy(true);
    setMessages((prev) => [...prev, { role: 'user', text: value }]);
    setInput('');
    const body = {
      query: value,
      prompt: value,
      containerTag: tag || mine,
      memoriesRetrieved: retrieved,
      matchStrictness: strictness,
      rerank,
      rewriteQuery: rewrite,
      include,
      remember: true,
      source: 'playground',
      history: messages.map((m) => ({ role: m.role, content: m.text })),
    };
    try {
      if (mode === 'search') {
        const out = await engine.search(body);
        setHits(out.matches || []);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: `Found ${out.matches?.length || 0} memories in ${out.tookMs}ms · ${out.mode || 'hybrid'}`,
          },
        ]);
      } else {
        const history = [...messages, { role: 'user' as const, text: value }].map((m) => ({
          role: m.role,
          content: m.text,
        }));
        const out = await engine.complete(
          {
            model: model.id,
            messages: history,
            containerTag: tag || mine,
            memoriesRetrieved: retrieved,
            rerank,
            rewriteQuery: rewrite,
            memoryMode,
            compareWithoutMemory: compare,
          },
          {
            ...keyHeaders(keys),
            'x-container-tag': tag || mine,
            'x-rukmer-memory': compare ? 'off' : 'on',
            'x-rukmer-mode': memoryMode,
          }
        );
        const answer = out.answer || out.choices?.[0]?.message?.content || out.error || 'No answer.';
        setHits(out.rukmer ? [{ id: 'inj', title: `${out.rukmer.provider} · ${out.rukmer.matches} memories`, text: compare ? 'Compared without memory.' : 'Memory injected into the model system prompt.', score: out.rukmer.matches }] : []);
        setMessages((prev) => [...prev, { role: 'assistant', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: err.message || 'Memory engine is unreachable.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col px-5 pt-4 pb-3">
      <div className="shrink-0 mb-3">
        <h1 className="text-[22px] font-semibold text-white tracking-tight">Playground</h1>
        <p className="text-[13px] text-zinc-400 mt-0.5">
          Search memories, then chat here. Gemini can use Rukmer’s hosted key — no paste.{' '}
          <Link to="/connectors" className="text-[#60a5fa] hover:underline">
            Connect Claude, ChatGPT, Gemini, or Grok ↗
          </Link>
        </p>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_300px] gap-3">
        <section className="min-h-0 rounded-2xl border border-white/[0.07] bg-[#111113] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#0c0c0e] p-0.5">
              <button
                onClick={() => setMode('chat')}
                className={`h-8 px-3 rounded-md text-[13px] inline-flex items-center gap-1.5 ${
                  mode === 'chat' ? 'bg-[#252528] text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <MessageSquare size={14} /> Chat
              </button>
              <button
                onClick={() => setMode('search')}
                className={`h-8 px-3 rounded-md text-[13px] inline-flex items-center gap-1.5 ${
                  mode === 'search' ? 'bg-[#252528] text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Search size={14} /> Search
              </button>
            </div>
            <Link to="/connectors" className="text-[12.5px] text-zinc-500 hover:text-zinc-300">
              Connect apps instead of keys
            </Link>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 flex flex-col">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                <div className="h-11 w-11 rounded-xl bg-[#1d4ed8]/20 border border-[#3b82f6]/30 flex items-center justify-center mb-4">
                  <SparkIcon />
                </div>
                <p className="text-[16px] font-medium text-zinc-100">
                  {mode === 'chat' ? 'See what Rukmer can do' : 'Search across your memory'}
                </p>
              </div>
            ) : (
              <div className="py-4 space-y-4">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-xl px-3.5 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-[#1e3a5f] text-zinc-100'
                          : 'bg-white/[0.04] border border-white/[0.06] text-zinc-300'
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                {hits.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {hits.map((h) => (
                      <div key={h.id} className="rounded-lg border border-white/[0.07] bg-black/20 p-3">
                        <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
                          <span>{h.title}</span>
                          <span>{h.score}</span>
                        </div>
                        <p className="text-[13px] text-zinc-300 leading-relaxed">{h.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="px-4 pb-3 pt-1">
            <div className="rounded-xl border border-white/[0.09] bg-[#0c0c0e] overflow-hidden">
              <div className="px-3 pt-2.5 pb-1 text-[12.5px] text-zinc-500">
                {mode === 'chat' ? 'Pick a container tag below to start' : 'Enter a query, then pick a container tag'}
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder={mode === 'chat' ? '' : 'Search memories…'}
                className="w-full bg-transparent px-3 text-[13.5px] text-zinc-200 outline-none resize-none min-h-[44px]"
              />
              <div className="flex items-center gap-2 px-2.5 pb-2">
                <button className="h-7 w-7 rounded-md border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center">
                  <Plus size={14} />
                </button>
                <div className="relative">
                  <button
                    onClick={() => setModelOpen((v) => !v)}
                    className="h-7 px-2 rounded-md text-[12.5px] text-zinc-200 hover:bg-white/[0.04] inline-flex items-center gap-1"
                  >
                    {model.label}
                    <span className="text-zinc-500 text-[11px] inline-flex items-center gap-0.5">
                      {memoryMode === 'agentic' ? 'Agentic' : 'Auto'} <ChevronDown size={12} />
                    </span>
                  </button>
                  {modelOpen && (
                    <div className="absolute bottom-8 left-0 z-20 w-56 rounded-lg border border-white/[0.08] bg-[#161618] p-1 shadow-xl">
                      {MODELS.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setModel(m);
                            setModelOpen(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-[12.5px] rounded-md hover:bg-white/[0.06] text-zinc-200"
                        >
                          {m.label}
                          <span className="block text-[10px] text-zinc-500">{m.provider}{serverProviders[m.provider] || keys[m.provider] ? ' · ready' : ' · use Connectors or a key'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1" />
                <button
                  onClick={() => setCompare((v) => !v)}
                  className={`h-7 px-2 rounded-md text-[12px] inline-flex items-center gap-1 ${
                    compare ? 'text-blue-300 bg-blue-500/10' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Split size={13} /> Compare without memory
                </button>
                <button
                  onClick={() => setKeysOpen(true)}
                  className="h-7 w-7 rounded-md text-zinc-500 hover:text-zinc-300 flex items-center justify-center"
                  title="Provider API keys"
                >
                  <Plug size={14} />
                </button>
                <button
                  onClick={() => send()}
                  disabled={busy}
                  className="h-7 w-7 rounded-md bg-[#2563eb] hover:bg-[#1d4ed8] text-white flex items-center justify-center disabled:opacity-50"
                >
                  <ArrowUp size={14} />
                </button>
              </div>
            </div>

            <div className="mt-2">
              <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300">
                <Sparkles size={12} className="text-zinc-500" />
                <select
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className="bg-transparent outline-none pr-1"
                >
                  {tagOptions.map((t) => (
                    <option key={t} value={t} className="bg-[#161618]">
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {messages.length === 0 && mode === 'chat' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="h-8 px-3 rounded-full border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300 hover:bg-white/[0.04] inline-flex items-center gap-2"
                  >
                    <Search size={12} className="text-zinc-500" />
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="min-h-0 rounded-2xl border border-white/[0.07] bg-[#111113] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-[14.5px] font-medium text-white">Memory settings</h2>
            <button onClick={reset} className="text-[12.5px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1">
              Reset <RotateCcw size={12} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
            <p className="text-[10px] tracking-[0.14em] text-zinc-500 mb-2">MEMORY</p>
            <div className="grid grid-cols-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] p-0.5 mb-3">
              <button
                onClick={() => setMemoryMode('agentic')}
                className={`h-8 rounded-md text-[13px] ${memoryMode === 'agentic' ? 'bg-[#1e3a5f] text-white' : 'text-zinc-400'}`}
              >
                Agentic
              </button>
              <button
                onClick={() => setMemoryMode('auto')}
                className={`h-8 rounded-md text-[13px] ${memoryMode === 'auto' ? 'bg-[#1e3a5f] text-white' : 'text-zinc-400'}`}
              >
                Auto-search
              </button>
            </div>

            <Row label="Sources">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="bg-transparent text-[12.5px] text-zinc-300 outline-none border border-white/[0.08] rounded-md h-7 px-2"
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s} className="bg-[#161618]">
                    {s}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Use your profile">
              <Toggle on={useProfile} onClick={() => setUseProfile((v) => !v)} />
            </Row>
            <Row label="Memories retrieved">
              <Stepper value={retrieved} onChange={setRetrieved} step={1} min={1} max={50} />
            </Row>
            <Row label="Match strictness">
              <Stepper value={strictness} onChange={setStrictness} step={0.05} min={0} max={1} format={(n) => n.toFixed(2)} />
            </Row>
            <Row label="Rerank results">
              <Toggle on={rerank} onClick={() => setRerank((v) => !v)} />
            </Row>
            <Row label="Rewrite query">
              <Toggle on={rewrite} onClick={() => setRewrite((v) => !v)} />
            </Row>
            <Row label="Aggregate results">
              <Toggle on={aggregate} onClick={() => setAggregate((v) => !v)} />
            </Row>

            <p className="text-[10px] tracking-[0.14em] text-zinc-500 mt-4 mb-2">INCLUDE IN RESULTS</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <CircleCheck on={include.related} label="Related memories" onClick={() => setInclude((p) => ({ ...p, related: !p.related }))} />
              <CircleCheck on={include.documents} label="Documents" onClick={() => setInclude((p) => ({ ...p, documents: !p.documents }))} />
              <CircleCheck on={include.chunks} label="Chunks" onClick={() => setInclude((p) => ({ ...p, chunks: !p.chunks }))} />
              <CircleCheck on={include.summaries} label="Summaries" onClick={() => setInclude((p) => ({ ...p, summaries: !p.summaries }))} />
              <CircleCheck on={include.forgotten} label="Forgotten" onClick={() => setInclude((p) => ({ ...p, forgotten: !p.forgotten }))} />
            </div>

            <div className="flex items-center justify-between mt-5 mb-2">
              <p className="text-[10px] tracking-[0.14em] text-zinc-500">REQUEST</p>
              <button onClick={copyRequest} className="text-[12px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1">
                {copied ? <Check size={12} /> : <Copy size={12} />} Copy
              </button>
            </div>
            <div className="flex gap-1 mb-2 overflow-x-auto">
              {(
                [
                  ['prompt', 'Prompt'],
                  ['curl', 'cURL'],
                  ['ts', 'TypeScript'],
                  ['py', 'Python'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setRequestTab(id)}
                  className={`h-7 px-2.5 rounded-md text-[12px] shrink-0 ${
                    requestTab === id ? 'bg-[#1e3a5f] text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <pre className="text-[11px] leading-relaxed text-zinc-400 bg-[#0c0c0e] border border-white/[0.06] rounded-lg p-2.5 overflow-auto max-h-[180px] font-mono whitespace-pre-wrap">
              {requestPreview}
            </pre>
          </div>
        </aside>
      </div>

      {keysOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#161618] p-4">
            <p className="text-[15px] font-medium text-white mb-1">Optional builder keys</p>
            <p className="text-[12px] text-zinc-500 mb-3">
              Normal use: Connectors (MCP) or chat here with the hosted Gemini key. Paste keys only if you are calling the provider API yourself.
            </p>
            {(
              [
                ['gemini', 'Gemini'],
                ['openai', 'ChatGPT / OpenAI'],
                ['anthropic', 'Claude'],
                ['grok', 'Grok / xAI'],
              ] as const
            ).map(([id, label]) => (
              <label key={id} className="block mb-2">
                <span className="text-[12px] text-zinc-400">{label}{serverProviders[id] ? ' · server key ready' : ''}</span>
                <input
                  type="password"
                  value={keys[id]}
                  onChange={(e) => setKeys((p) => ({ ...p, [id]: e.target.value }))}
                  placeholder={id === 'gemini' ? 'optional if server has GEMINI_API_KEY' : `paste ${label} API key`}
                  className="mt-1 w-full h-9 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px] outline-none"
                />
              </label>
            ))}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setKeysOpen(false)} className="h-8 px-3 text-[13px] text-zinc-400">
                Close
              </button>
              <button
                onClick={() => {
                  saveProviderKeys(keys);
                  setKeysOpen(false);
                }}
                className="h-8 px-3 rounded-lg bg-[#2563eb] text-[13px] text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-[7px]">
      <span className="text-[13px] text-zinc-300">{label}</span>
      {children}
    </div>
  );
}
