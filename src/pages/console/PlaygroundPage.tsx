import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { ScopeFilter, type MemoryScope } from '../../components/console/ScopeFilter';
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
import { friendlyModelError, isRawKeyError } from '../../services/modelError';
import { threadTitle, titleAfterSend } from '../../services/threadTitle';
import { keyHeaders, loadProviderKeys, pickReadyModel, saveProviderKeys, type ProviderKeys } from '../../services/providerKeys';
import type { UserProfile } from '../../types';
import { homeTag as makeHomeTag } from '../../services/tenancy';
import { spaceLabel, type SpaceRef } from '../../services/spaceLabel';
import { openPlaygroundSession } from './playgroundSession';
import { currentModel, MODEL_CATALOG, type ModelChoice } from '../../../engine/models';

type MemoryMode = 'agentic' | 'auto';
type Retrieval = 'hybrid' | 'semantic' | 'keyword';
type RequestTab = 'prompt' | 'curl' | 'ts' | 'py';
type Citation = { id: string; text: string; title?: string; source?: string; score?: number };
type ChatMsg = { role: 'user' | 'assistant'; text: string; citations?: Citation[]; error?: boolean };
type Thread = { id: string; title: string; updatedAt: string; messages: ChatMsg[] };

function threadStore(uid: string) {
  return `rukmer.playground.${uid}`;
}

function loadThreads(uid: string): Thread[] {
  try {
    const raw = localStorage.getItem(threadStore(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      const id = String(row?.id || '');
      if (!id) return [];
      const messages = Array.isArray(row.messages)
        ? row.messages.flatMap((message: { role?: string; text?: string; content?: string; citations?: Citation[]; error?: boolean }) => {
            const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : '';
            if (!role) return [];
            const text = String(message.text || message.content || '');
            const rawKey = role === 'assistant' && isRawKeyError(text);
            const error = rawKey || message.error === true;
            const citations = !error && Array.isArray(message.citations) ? message.citations : undefined;
            return [{ role, text: rawKey ? friendlyModelError(text) : text, ...(error ? { error: true } : {}), ...(citations ? { citations } : {}) }];
          })
        : [];
      return [{ id, title: String(row.title || 'New chat'), updatedAt: String(row.updatedAt || new Date().toISOString()), messages }];
    });
  } catch {
    return [];
  }
}

function saveThreads(uid: string, threads: Thread[]) {
  localStorage.setItem(threadStore(uid), JSON.stringify(threads.slice(0, 40)));
}

function newThread(): Thread {
  return { id: `chat_${Date.now()}`, title: 'New chat', updatedAt: new Date().toISOString(), messages: [] };
}

const MODELS: ModelChoice[] = MODEL_CATALOG;
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

function MessageBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 480;
  const shown = long && !open ? `${text.slice(0, 480)}…` : text;
  return (
    <>
      <div className="[overflow-wrap:anywhere] break-words">{shown}</div>
      {long ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-[12px] text-[#93c5fd] hover:underline">
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </>
  );
}

function MemoriesUsed({ citations }: { citations?: Citation[] }) {
  const [open, setOpen] = useState(false);
  const rows = citations || [];
  return (
    <div className="mt-2 border-t border-white/[0.06] pt-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-[12px] text-zinc-400 hover:text-zinc-200">
        Memories used ({rows.length})
      </button>
      {open ? (
        rows.length ? (
          <div className="mt-2 space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="text-[12px] text-zinc-400">
                <p className="[overflow-wrap:anywhere] break-words text-zinc-300">{row.text}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {row.source || 'memory'}
                  {typeof row.score === 'number' ? ` · ${row.score}` : ''}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[12px] text-zinc-500">No memories were injected.</p>
        )
      ) : null}
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
  const { user, homeTag, memoryScope = 'private', setMemoryScope } = useOutletContext<{
    user: UserProfile;
    homeTag: string;
    memoryScope?: MemoryScope;
    setMemoryScope?: (scope: MemoryScope) => void;
  }>();
  const [searchParams] = useSearchParams();
  const mine = homeTag || makeHomeTag(user.uid);
  const [mode, setMode] = useState<Mode>('chat');
  const [memoryMode, setMemoryMode] = useState<MemoryMode>('agentic');
  const [input, setInput] = useState('');
  const [model, setModel] = useState<ModelChoice>(() => {
    const stored = loadProviderKeys();
    const ready: Record<string, boolean> = {};
    for (const candidate of MODELS) ready[candidate.provider] = !!stored[candidate.provider];
    const remembered = MODELS.find((item) => item.id === currentModel(localStorage.getItem('rukmer.playground.model') || ''));
    return remembered || pickReadyModel(MODELS, ready) || MODELS[0];
  });
  const [tag, setTag] = useState(mine);
  const [tagOptions, setTagOptions] = useState<string[]>(mine ? [mine] : []);
  const [keys, setKeys] = useState<ProviderKeys>(() => loadProviderKeys());
  const [keysOpen, setKeysOpen] = useState(false);
  const [serverProviders, setServerProviders] = useState<Record<string, boolean>>({});
  const [providerPhase, setProviderPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [providerTry, setProviderTry] = useState(0);
  const [providerError, setProviderError] = useState('');
  const [teams, setTeams] = useState<SpaceRef[]>([]);
  const [submitted, setSubmitted] = useState('');
  const [sendHint, setSendHint] = useState('');
  const [searchNote, setSearchNote] = useState('');
  const [searchSession, setSearchSession] = useState<{ query: string; summary: string; citations: Citation[] } | null>(null);
  const [source, setSource] = useState(SOURCES[0]);
  const [useProfile, setUseProfile] = useState(true);
  const [retrieved, setRetrieved] = useState(4);
  const [strictness, setStrictness] = useState(0.4);
  const [rerank, setRerank] = useState(false);
  const [retrieval, setRetrieval] = useState<Retrieval>('hybrid');
  const [rewrite, setRewrite] = useState(false);
  const [aggregate, setAggregate] = useState(false);
  const [include, setInclude] = useState(DEFAULT_INCLUDE);
  const [compare, setCompare] = useState(false);
  const [requestTab, setRequestTab] = useState<RequestTab>('prompt');
  const [copied, setCopied] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelBox, setModelBox] = useState<{ left: number; width: number; maxHeight: number; top?: number; bottom?: number } | null>(null);
  const [threads, setThreads] = useState<Thread[]>(() => {
    const opened = openPlaygroundSession(loadThreads(user.uid), new URLSearchParams(window.location.search).get('thread') || '');
    return [opened.active as Thread, ...opened.history.filter((item) => item.id !== opened.active.id) as Thread[]];
  });
  const [threadId, setThreadId] = useState(() => openPlaygroundSession(loadThreads(user.uid), new URLSearchParams(window.location.search).get('thread') || '').active.id);
  const [saveNote, setSaveNote] = useState('');
  const [spaceHint, setSpaceHint] = useState<{ spaceLabel?: string; spaceKind?: string; requiresConfirmation?: boolean } | null>(null);
  const [hits, setHits] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameHint, setRenameHint] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const thread = threads.find((t) => t.id === threadId) || threads[0];
  const messages = thread?.messages || [];

  const persistThreads = (next: Thread[], id = threadId) => {
    setThreads(next);
    saveThreads(user.uid, next);
    setThreadId(id);
  };

  const startChat = () => {
    const empty = threads.find((item) => item.messages.length === 0 && (item.title === 'New chat' || /^New chat \d+$/.test(item.title)));
    if (empty) {
      persistThreads(threads, empty.id);
    } else {
      const created = newThread();
      persistThreads([created, ...threads], created.id);
    }
    setHits([]);
    setInput('');
    setRenaming(false);
    setConfirmDelete(false);
  };

  const saveRename = () => {
    const next = threadTitle(renameValue, 80);
    if (!renameValue.trim() || next === 'New chat') {
      setRenameHint('Enter a title');
      return;
    }
    persistThreads(
      threads.map((item) => (item.id === threadId ? { ...item, title: next, updatedAt: new Date().toISOString() } : item))
    );
    setRenaming(false);
    setRenameHint('');
  };

  const removeThread = () => {
    const rest = threads.filter((item) => item.id !== threadId);
    if (!rest.length) {
      const created = newThread();
      persistThreads([created], created.id);
    } else {
      persistThreads(rest, rest[0].id);
    }
    setHits([]);
    setRenaming(false);
    setConfirmDelete(false);
  };

  useEffect(() => {
    if (!modelOpen) {
      setModelBox(null);
      return;
    }
    const place = () => {
      const el = modelBtnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const composer = el.closest('[data-composer]');
      const bounds = composer ? composer.getBoundingClientRect() : rect;
      const gap = 6;
      const width = Math.min(300, window.innerWidth - 32);
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
      const spaceAbove = Math.max(0, bounds.top - 8);
      const spaceBelow = Math.max(0, window.innerHeight - bounds.bottom - 8);
      const openUp = spaceAbove >= 140 || spaceAbove >= spaceBelow;
      const room = Math.max(0, (openUp ? spaceAbove : spaceBelow) - gap);
      const maxHeight = Math.min(320, Math.round(window.innerHeight * 0.45), room);
      setModelBox(
        openUp
          ? { left, width, maxHeight, bottom: window.innerHeight - bounds.top + gap }
          : { left, width, maxHeight, top: bounds.bottom + gap }
      );
    };
    place();
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (modelBtnRef.current?.contains(target) || modelMenuRef.current?.contains(target)) return;
      setModelOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('pointerdown', close);
    };
  }, [modelOpen]);

  useEffect(() => {
    if (!stickRef.current) return;
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, busy, saveNote]);

  const search = searchParams.toString();
  useEffect(() => {
    const params = new URLSearchParams(search);
    const nextMode = params.get('mode');
    const q = params.get('q');
    const thread = params.get('thread');
    if (nextMode === 'search' || nextMode === 'chat') setMode(nextMode);
    if (q) setInput(q);
    if (thread && loadThreads(user.uid).some((item) => item.id === thread)) setThreadId(thread);
  }, [search, user.uid]);

  const providerReady = (provider: string) => !!(serverProviders[provider] || keys[provider as keyof ProviderKeys]);
  const noneReady = providerPhase === 'ready' && !providerReady(model.provider);

  useEffect(() => {
    const ready: Record<string, boolean> = {};
    for (const candidate of MODELS) ready[candidate.provider] = providerReady(candidate.provider);
    const first = pickReadyModel(MODELS, ready);
    setModel((cur) => {
      const mapped = MODELS.find((item) => item.id === currentModel(cur.id)) || cur;
      localStorage.setItem('rukmer.playground.model', mapped.id);
      return ready[mapped.provider] ? mapped : first || mapped;
    });
  }, [serverProviders, keys]);

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
    let cancelled = false;
    const loadProviders = async () => {
      let last = 'Could not check model keys';
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const [health, me] = await Promise.all([engine.health(), engine.me().catch(() => ({} as { providers?: Record<string, boolean> }))]);
          if (cancelled) return;
          setServerProviders(me.providers || health.providers || {});
          setProviderError('');
          setProviderPhase('ready');
          return;
        } catch (err) {
          last = err instanceof Error ? err.message : last;
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
      if (!cancelled) {
        setProviderError(last);
        setProviderPhase('error');
      }
    };
    void loadProviders();
    engine.teams().then((out) => setTeams(out.teams || [])).catch(() => setTeams([]));
    return () => {
      cancelled = true;
    };
  }, [providerTry]);

  const payload = useMemo(
    () => ({
      mode,
      memoryMode,
      model: model.id,
      provider: model.provider,
      containerTag: tag || mine,
      scope: memoryScope,
      sources: source,
      useProfile,
      memoriesRetrieved: retrieved,
      matchStrictness: strictness,
      rerank,
      retrieval,
      rewriteQuery: rewrite,
      aggregate,
      include,
      compareWithoutMemory: compare,
      prompt: input.trim() || submitted || null,
    }),
    [mode, memoryMode, model, tag, memoryScope, source, useProfile, retrieved, strictness, rerank, retrieval, rewrite, aggregate, include, compare, input, submitted]
  );

  const requestPreview = useMemo(() => {
    const chatBody = {
      model: model.id,
      messages: [{ role: 'user', content: (input.trim() ? input : submitted) || 'What do you know about me?' }],
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
  }, [payload, requestTab, mode, model, tag, input, submitted]);

  const reset = () => {
    setMemoryMode('agentic');
    setSource(SOURCES[0]);
    setUseProfile(true);
    setRetrieved(4);
    setStrictness(0.4);
    setRerank(false);
    setRetrieval('hybrid');
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
    if (!value) {
      setSendHint(mode === 'search' ? 'Enter a query' : 'Enter a message');
      return;
    }
    if (busy) {
      setSendHint(mode === 'search' ? 'A search is already running.' : 'Already sending.');
      return;
    }
    if (mode === 'chat' && providerPhase === 'loading') {
      setSendHint('Still checking model keys.');
      return;
    }
    if (mode === 'chat' && noneReady) {
      setSendHint('Add a model key for this model, or switch to Search.');
      return;
    }
    setSendHint('');
    const withUser = threads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            title: titleAfterSend(t, value),
            updatedAt: new Date().toISOString(),
            messages: [...t.messages, { role: 'user' as const, text: value }],
          }
        : t
    );
    const failThread = (message: string) => {
      persistThreads(
        withUser.map((t) =>
          t.id === threadId
            ? { ...t, messages: [...t.messages, { role: 'assistant' as const, text: friendlyModelError(message), error: true }] }
            : t
        )
      );
    };
    setBusy(true);
    setSubmitted(value);
    if (mode === 'chat') persistThreads(withUser);
    setInput('');
    const body = {
      query: value,
      prompt: value,
      containerTag: tag || mine,
      scope: memoryScope,
      sources: source,
      memoriesRetrieved: retrieved,
      matchStrictness: strictness,
      rerank,
      retrieval,
      rewriteQuery: rewrite,
      include,
      remember: true,
      source: 'playground',
      history: [...messages, { role: 'user' as const, text: value }].filter((m) => !m.error).map((m) => ({ role: m.role, content: m.text })),
    };
    try {
      if (mode === 'search') {
        const started = Date.now();
        const out = await engine.search(body);
        const waited = Date.now() - started;
        const citations = (out.matches || []).map((hit: Citation) => ({
          id: String(hit.id),
          text: String(hit.text || ''),
          title: hit.title,
          source: hit.source,
          score: hit.score,
        }));
        const serverMs = Number(out.tookMs) || 0;
        const lag = waited > serverMs + 1500 ? ` · ${waited}ms in the browser` : '';
        setHits([]);
        setSearchSession({
          query: value,
          summary: `Found ${citations.length} memories in ${serverMs}ms · ${out.mode || 'hybrid'}${lag}`,
          citations,
        });
        setSearchNote('');
      } else {
        const history = [...messages, { role: 'user' as const, text: value }]
          .filter((m) => !m.error)
          .map((m) => ({
            role: m.role,
            content: m.text,
          }));
        const out = await engine.complete(
          {
            model: model.id,
            messages: history,
            containerTag: tag || mine,
            scope: memoryScope,
            source: 'playground',
            memoriesRetrieved: retrieved,
            matchStrictness: strictness,
            retrieval,
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
            'x-rukmer-scope': memoryScope,
          }
        );
        const content = String(out.choices?.[0]?.message?.content || '').trim();
        const rawError = [out.error, out.message]
          .map((item) => (typeof item === 'string' ? item : item?.message || item?.error || ''))
          .map((item: string) => String(item || '').trim())
          .find(Boolean);
        const answerText = String(out.answer || content || '').trim();
        if (rawError && (!answerText || answerText === rawError || isRawKeyError(answerText))) {
          failThread(rawError);
          return;
        }
        if (isRawKeyError(answerText)) {
          failThread(answerText);
          return;
        }
        if (!answerText) throw new Error('The model did not reply.');
        const answer = answerText;
        const citations = (out.rukmer?.citations || []) as Citation[];
        const saved = out.rukmer?.memorySave;
        setSaveNote(saved?.saved ? `Saved to ${saved.spaceLabel || 'Personal'} memory` : saved?.skipped ? `Not saved: ${saved.reason || 'not a durable fact'}` : '');
        setSpaceHint(out.rukmer?.otherSpaceHint || null);
        setHits([]);
        persistThreads(
          withUser.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  updatedAt: new Date().toISOString(),
                  messages: [...t.messages, { role: 'assistant', text: typeof answer === 'string' ? answer : JSON.stringify(answer), citations }],
                }
              : t
          )
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'The model did not reply.';
      if (mode === 'search') {
        setInput(value);
        setSearchNote(message);
      } else {
        failThread(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const chatBlocked = mode === 'chat' && noneReady;
  const checkingKeys = mode === 'chat' && providerPhase === 'loading';
  const canSend = !!input.trim() && !busy && !chatBlocked && !checkingKeys;
  const sendTitle = checkingKeys
    ? 'Still checking model keys'
    : chatBlocked
      ? 'Add an API key'
      : busy
        ? mode === 'search'
          ? 'Searching'
          : 'Waiting for a reply'
        : input.trim()
          ? 'Send'
          : 'Enter a query';

  return (
    <div className="h-full min-h-0 flex flex-col px-3 sm:px-5 pt-3 sm:pt-4 pb-3">
      <div className="shrink-0 mb-3">
        <h1 className="hidden lg:block text-[22px] font-semibold text-white tracking-tight">Playground</h1>
        <p className="text-[13px] text-zinc-400 mt-0.5">
          Chat with memory, or search what is already stored.{' '}
          <Link to="/connectors" className="text-[#60a5fa] hover:underline">
            Connect Claude, ChatGPT, or Grok
          </Link>
          . Gemini connectors are coming soon.
        </p>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] max-xl:auto-rows-max gap-3 overflow-y-auto xl:overflow-hidden">
        <section className="xl:min-h-0 xl:h-full rounded-2xl border border-white/[0.07] bg-[#111113] flex flex-col overflow-hidden">
          <div className="flex flex-col gap-2 px-3 sm:px-4 pt-3 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
            <div className="flex flex-wrap items-center gap-2">
              <details className="text-[13px] text-zinc-300">
                <summary className="cursor-pointer">Chat history</summary>
                <div className="mt-1 max-h-40 overflow-auto">
                  {threads.filter((item) => item.messages.some((message) => message.text.trim())).map((item) => (
                    <button key={item.id} type="button" className="block w-full text-left px-2 py-1 rounded hover:bg-white/[0.05] break-words" onClick={() => setThreadId(item.id)}>
                      {item.title}
                    </button>
                  ))}
                </div>
              </details>
              <select
                aria-label="Chat thread"
                value={threadId}
                onChange={(e) => {
                  setThreadId(e.target.value);
                  setHits([]);
                  setRenaming(false);
                  setConfirmDelete(false);
                }}
                className="h-8 max-w-[220px] px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px] text-zinc-300"
              >
                {threads.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={startChat}
                className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-200 hover:bg-white/[0.04] inline-flex items-center gap-1"
              >
                <Plus size={13} /> New chat
              </button>
              <button
                type="button"
                disabled={busy}
                title={busy ? 'Waiting for a reply' : 'Rename chat'}
                onClick={() => {
                  setRenaming(true);
                  setRenameValue(thread?.title || '');
                  setRenameHint('');
                  setConfirmDelete(false);
                }}
                className="h-8 px-2.5 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-300 hover:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Rename
              </button>
              <button
                type="button"
                disabled={busy}
                title={busy ? 'Waiting for a reply' : 'Delete chat'}
                onClick={() => {
                  setConfirmDelete(true);
                  setRenaming(false);
                }}
                className="h-8 px-2.5 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-300 hover:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete
              </button>
              <Link to="/connectors" className="text-[12.5px] text-zinc-500 hover:text-zinc-300 hidden sm:inline">
                Connect apps
              </Link>
            </div>
          </div>
          {renaming ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Thread title"
                value={renameValue}
                onChange={(e) => {
                  setRenameValue(e.target.value);
                  setRenameHint('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveRename();
                  }
                }}
                className="h-8 min-w-[180px] flex-1 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-200 outline-none"
              />
              <button type="button" onClick={saveRename} className="h-8 px-2.5 rounded-lg bg-[#2563eb] text-[12.5px] text-white">
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenaming(false);
                  setRenameHint('');
                }}
                className="h-8 px-2.5 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-300"
              >
                Cancel
              </button>
              {renameHint ? <span className="text-[12px] text-red-300">{renameHint}</span> : null}
            </div>
          ) : null}
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-zinc-300">
              <span>Delete this chat?</span>
              <button type="button" onClick={removeThread} className="h-8 px-2.5 rounded-lg bg-red-500/20 text-red-100">
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-8 px-2.5 rounded-lg border border-white/[0.08] text-zinc-300"
              >
                Cancel
              </button>
            </div>
          ) : null}
          </div>

          <div
            ref={messagesRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            }}
            className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 flex flex-col"
          >
            {mode === 'search' ? (
              <div className="py-4 space-y-3">
                {searchSession ? (
                  <>
                    <p className="text-[13px] text-zinc-300">{searchSession.summary}</p>
                    <p className="text-[12px] text-zinc-500">Query: {searchSession.query}</p>
                    {searchSession.citations.map((h) => (
                      <div key={h.id} className="rounded-lg border border-white/[0.07] bg-black/20 p-3">
                        <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
                          <span>{h.title}</span>
                          <span>{h.score}</span>
                        </div>
                        <p className="text-[13px] text-zinc-200 leading-relaxed">{h.text}</p>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                    <p className="text-[16px] font-medium text-zinc-100">Search across your memory</p>
                  </div>
                )}
                {busy ? <p className="text-[13.5px] text-zinc-300">Searching…</p> : null}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                <div className="h-11 w-11 rounded-xl bg-[#1d4ed8]/20 border border-[#3b82f6]/30 flex items-center justify-center mb-4">
                  <SparkIcon />
                </div>
                <p className="text-[16px] font-medium text-zinc-100">See what Rukmer can do</p>
              </div>
            ) : (
              <div className="py-4 space-y-4">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      role={m.error ? 'alert' : undefined}
                      className={`max-w-[92%] sm:max-w-[80%] min-w-0 rounded-xl px-3.5 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] break-words ${
                        m.error
                          ? 'bg-red-500/10 border border-red-400/30 text-red-100'
                          : m.role === 'user'
                            ? 'bg-[#1d4ed8] text-white'
                            : 'bg-white/[0.04] border border-white/[0.06] text-zinc-100'
                      }`}
                    >
                      {m.error ? <p className="text-[11px] tracking-wide text-red-300/80 mb-1">Error</p> : null}
                      <MessageBody text={m.text} />
                      {m.role === 'assistant' && !m.error ? <MemoriesUsed citations={m.citations} /> : null}
                    </div>
                  </div>
                ))}
                {busy ? (
                  <div className="flex justify-start">
                    <div className="rounded-xl px-3.5 py-2 text-[13.5px] text-zinc-400 bg-white/[0.04] border border-white/[0.06]">
                      Waiting for a reply…
                    </div>
                  </div>
                ) : null}
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

          <div className="shrink-0 px-4 pb-3 pt-1">
            {mode === 'chat' && providerPhase === 'error' && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[12.5px] text-zinc-200">
                <span>Couldn't check model keys. {providerError} Retry.</span>
                <button type="button" onClick={() => setProviderTry((n) => n + 1)} className="h-7 px-2.5 rounded-md border border-white/10 text-[12px]">
                  Retry
                </button>
              </div>
            )}
            {sendHint ? <p className="mb-2 text-[12.5px] text-zinc-300">{sendHint}</p> : null}
            {mode === 'search' && searchNote ? <p className="mb-2 text-[12.5px] text-zinc-300">{searchNote}</p> : null}
            {chatBlocked && (
              <div className="key-banner mb-2 flex flex-nowrap items-center justify-between gap-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-[12.5px] text-amber-100">
                <span className="min-w-0">No model key yet. Add one in Settings → Advanced or use Search mode</span>
                <Link
                  to="/settings/advanced"
                  className="shrink-0 h-7 px-2.5 rounded-md bg-amber-200 text-[#1c1917] text-[12px] font-medium inline-flex items-center"
                >
                  Add key
                </Link>
              </div>
            )}
            {saveNote ? <p className="mb-2 text-[13px] text-emerald-300">{saveNote}</p> : null}
            {spaceHint ? (
              <p className="mb-2 text-[13px] text-amber-100">
                I found a related memory in your {spaceHint.spaceKind === 'personal' ? 'Personal' : spaceHint.spaceLabel} space, which isn&apos;t active here. Switch to that space to use it{spaceHint.requiresConfirmation ? ', or ask me to copy it into this Organization space' : ''}.
              </p>
            ) : null}
            <div data-composer className="shrink-0 sticky bottom-0 z-20 rounded-xl border border-white/[0.09] bg-[#0c0c0e] pb-[env(safe-area-inset-bottom)]">
              <div className="px-3 pt-2.5 pb-1 text-[12.5px] text-zinc-500">
                {!tag
                  ? mode === 'chat'
                    ? 'Pick a container tag below to start'
                    : 'Enter a query, then pick a container tag'
                  : mode === 'chat'
                    ? `Ask anything — memory from ${spaceLabel(tag, { homeTag: mine, teams }).label} is used`
                    : 'Search your memories'}
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!canSend) {
                      setSendHint(sendTitle);
                      return;
                    }
                    void send();
                  }
                }}
                rows={2}
                placeholder={mode === 'chat' ? '' : 'Enter a query'}
                className="w-full bg-transparent px-3 text-base md:text-[13.5px] text-zinc-200 outline-none resize-none min-h-[44px]"
              />
              <div className="flex flex-nowrap items-center gap-2 px-2.5 pb-2 min-w-0">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <button
                    ref={modelBtnRef}
                    type="button"
                    onClick={() => {
                      if (mode === 'search') return;
                      setModelOpen((v) => !v);
                    }}
                    disabled={mode === 'search'}
                    className="max-w-full min-w-0 h-7 px-2 rounded-md text-[12.5px] text-zinc-200 hover:bg-white/[0.04] inline-flex items-center gap-1 disabled:opacity-60"
                    aria-expanded={modelOpen}
                    aria-haspopup="listbox"
                    title={mode === 'search' ? 'Search does not use a model' : model.label}
                  >
                    <span className="truncate">{mode === 'search' ? 'Model unused' : model.label}</span>
                    <ChevronDown size={12} className="shrink-0 text-zinc-500" />
                  </button>
                  {modelOpen && modelBox && (
                    <div
                      ref={modelMenuRef}
                      role="listbox"
                      style={{ top: modelBox.top, bottom: modelBox.bottom, left: modelBox.left, width: modelBox.width, maxHeight: modelBox.maxHeight }}
                      className="fixed z-[60] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-white/[0.08] bg-[#161618] p-1 shadow-xl"
                    >
                      {MODELS.map((m) => {
                        const ready = providerReady(m.provider);
                        const rowClass = `w-full text-left px-2.5 py-1.5 text-[12.5px] rounded-md text-zinc-200 ${
                          ready ? 'hover:bg-white/[0.06]' : ''
                        } ${m.id === model.id ? 'bg-white/[0.06]' : ''}`;
                        if (!ready) {
                          return (
                            <div key={m.id} role="option" aria-selected={false} className={rowClass}>
                              {m.label}
                              <Link
                                to="/settings/advanced"
                                className="needs-key mt-0.5 block font-medium underline whitespace-nowrap"
                                onClick={() => setModelOpen(false)}
                              >
                                Needs API key · Settings → Advanced
                              </Link>
                            </div>
                          );
                        }
                        return (
                          <button
                            key={m.id}
                            type="button"
                            role="option"
                            aria-selected={m.id === model.id}
                            onClick={() => {
                              setModel(m);
                              setModelOpen(false);
                            }}
                            className={rowClass}
                          >
                            {m.label}
                            <span className="block text-[11px] text-zinc-500">Ready</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={memoryMode === 'agentic' ? 'Memory mode, Agentic' : 'Memory mode, Auto'}
                  title={memoryMode === 'agentic' ? 'Agentic' : 'Auto'}
                  onClick={() => setMemoryMode((mode) => (mode === 'agentic' ? 'auto' : 'agentic'))}
                  className="shrink-0 h-7 w-7 sm:w-auto sm:px-2 rounded-md text-[12px] text-zinc-400 border border-white/[0.08] inline-flex items-center justify-center"
                >
                  <span className="hidden sm:inline">{memoryMode === 'agentic' ? 'Agentic' : 'Auto'}</span>
                  <Sparkles size={13} className="sm:hidden" />
                </button>
                <div className="ml-auto shrink-0 flex items-center gap-1">
                <button
                  onClick={() => setCompare((v) => !v)}
                  title="Compare without memory"
                  aria-label="Compare without memory"
                  className={`h-7 w-7 shrink-0 rounded-md text-[12px] inline-flex items-center justify-center ${
                    compare ? 'text-blue-300 bg-blue-500/10' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Split size={13} />
                </button>
                <button
                  onClick={() => setKeysOpen(true)}
                  className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:text-zinc-300 flex items-center justify-center"
                  title="Provider API keys"
                >
                  <Plug size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!canSend) return;
                    send();
                  }}
                  disabled={!canSend}
                  aria-disabled={!canSend}
                  title={sendTitle}
                  aria-label={sendTitle}
                  className={`h-7 w-7 shrink-0 rounded-md flex items-center justify-center ${
                    canSend
                      ? 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white'
                      : 'bg-[#2563eb]/40 text-white/80 cursor-not-allowed'
                  }`}
                >
                  <ArrowUp size={14} />
                </button>
                </div>
              </div>
            </div>

            <div className="mt-2">
              <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300">
                <Sparkles size={12} className="text-zinc-500" />
                <select
                  value={tag}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTag(next);
                    setMemoryScope?.(next.startsWith('tm_') ? 'team' : 'private');
                  }}
                  className="bg-transparent outline-none pr-1"
                >
                  {tagOptions.map((t) => (
                    <option key={t} value={t} className="bg-[#161618]">
                      {spaceLabel(t, { homeTag: mine, teams }).label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {messages.length === 0 && mode === 'chat' && (
              <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={chatBlocked}
                    className="shrink-0 h-8 px-3 rounded-full border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300 hover:bg-white/[0.04] inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    <Search size={12} className="text-zinc-500" />
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="xl:min-h-0 rounded-2xl border border-white/[0.07] bg-[#111113] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-[14.5px] font-medium text-white">Memory settings</h2>
            <button onClick={reset} className="text-[12.5px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1">
              Reset <RotateCcw size={12} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
            <p className="text-[10px] tracking-[0.14em] text-zinc-500 mb-2">MEMORY</p>
            <div className="mb-3">
              <p className="text-[12px] text-zinc-400 mb-1">Scope</p>
              <ScopeFilter value={memoryScope} onChange={(scope) => setMemoryScope?.(scope)} />
            </div>
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
            <Row label="Retrieval">
              <select
                value={retrieval}
                onChange={(e) => setRetrieval(e.target.value as Retrieval)}
                className="bg-transparent text-[12.5px] text-zinc-300 outline-none border border-white/[0.08] rounded-md h-7 px-2"
              >
                <option value="hybrid" className="bg-[#161618]">Hybrid</option>
                <option value="semantic" className="bg-[#161618]">Semantic</option>
                <option value="keyword" className="bg-[#161618]">Keyword</option>
              </select>
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
