import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Play, Globe, FileText } from 'lucide-react';
import { engine } from '../../services/engineClient';
import { mcpUrl } from '../../services/aiConnectors';

const USE_CASES = ['Build with Rukmer', 'Connect my AI tools', 'Team memory'] as const;
const USE_KEY = 'rukmer.setup.useCase';

function ago(iso?: string | null) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function shortPrompt(origin: string, key: string) {
  const secret = key || 'rk_live_…';
  return `Wire this app to Rukmer Memory at ${origin}.

Use API key ${secret}. Send it as Authorization: Bearer <key>.

1. Ingest: POST ${origin}/v3/documents
   { "title": "Note", "text": "...", "source": "app" }
2. Retrieve: POST ${origin}/v4/search
   { "query": "what should I remember?" }
3. Remember a chat turn: POST ${origin}/v4/remember
   { "messages": [{ "role": "user", "content": "..." }] }

Keep the key in .env as RUKMER_API_KEY. Do not commit it.`;
}

export default function OverviewPage() {
  const client = useQueryClient();
  const [useCase, setUseCase] = useState(() => {
    try {
      return localStorage.getItem(USE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [editingUse, setEditingUse] = useState(!useCase);
  const [copied, setCopied] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [loiNote, setLoiNote] = useState(false);
  const keyOnce = useRef(false);
  const origin = typeof window === 'undefined' ? 'https://app.rukmer.com' : window.location.origin;

  useEffect(() => {
    if (sessionStorage.getItem('rukmer.loiAccepted') === '1') {
      sessionStorage.removeItem('rukmer.loiAccepted');
      setLoiNote(true);
    }
  }, []);

  const counts = useQuery({
    queryKey: ['stats'],
    queryFn: () => engine.stats(),
  });
  const status = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => engine.setupStatus(),
    refetchInterval: (query) => (query.state.data?.firstRequestAt ? false : 3000),
  });

  useEffect(() => {
    const row = status.data;
    if (!row || row.hasKey || secret || keyOnce.current) return;
    keyOnce.current = true;
    void engine
      .createKey('Setup')
      .then((out) => {
        setSecret(String(out.secret || ''));
        void client.invalidateQueries({ queryKey: ['setup-status'] });
      })
      .catch(() => {
        keyOnce.current = false;
      });
  }, [status.data, secret, client]);

  const choose = (value: string) => {
    setUseCase(value);
    setEditingUse(false);
    try {
      localStorage.setItem(USE_KEY, value);
    } catch {
      /* ignore */
    }
  };

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard may be blocked */
    }
    setCopied(id);
    window.setTimeout(() => setCopied(''), 1400);
  };

  const ready = status.data;
  const memories = counts.data ? Number(counts.data.chunks ?? 0) : null;
  const documents = counts.data ? Number(counts.data.documents ?? 0) : null;
  const searches = counts.data ? Number(counts.data.searchesToday ?? 0) : null;

  return (
    <div className="max-w-[920px] mx-auto">
      <div className="rounded-2xl border border-white/[0.07] bg-[#141416] p-5 md:p-6">
        <h1 className="text-[22px] font-semibold text-white tracking-tight">Set up Rukmer</h1>
        {loiNote ? <p className="text-[13px] text-zinc-300 mt-2">Letter of Intent accepted for this account.</p> : null}

        <section className="mt-5">
          <p className="text-[13px] text-zinc-400 mb-2">1. What brings you here?</p>
          {useCase && !editingUse ? (
            <p className="text-[14px] text-zinc-100">
              {useCase}{' '}
              <button type="button" className="text-[#60a5fa] text-[13px]" onClick={() => setEditingUse(true)}>
                Change
              </button>
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {USE_CASES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => choose(item)}
                  className="h-9 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-zinc-200 hover:border-[#2563eb]"
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="mt-6">
          <p className="text-[13px] text-zinc-400 mb-2">2. Run this in your project</p>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] px-3 py-2.5 min-w-0">
            <code className="text-[13px] text-zinc-100 min-w-0 break-all">$ npx rukmer setup</code>
            <button type="button" className="text-[12.5px] text-[#93c5fd]" onClick={() => void copy('cmd', 'npx rukmer setup')}>
              {copied === 'cmd' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[12.5px] text-zinc-500 mt-2">Launches your coding agent to wire Rukmer into your app.</p>
          <div className="flex flex-wrap gap-3 mt-3 text-[13px]">
            <button type="button" className="text-zinc-300 hover:text-white" onClick={() => void copy('prompt', shortPrompt(origin, secret))}>
              {copied === 'prompt' ? 'Copied' : 'Copy a prompt instead'}
            </button>
            <button type="button" className="text-zinc-400 hover:text-zinc-200" onClick={() => setManualOpen((v) => !v)}>
              Set up manually {manualOpen ? '▴' : '▾'}
            </button>
          </div>
          {manualOpen ? (
            <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/25 p-3 text-[12.5px] text-zinc-400 space-y-2">
              <p>MCP URL: <span className="text-zinc-200">{mcpUrl()}</span></p>
              <p>Search: <code className="text-zinc-200">POST {origin}/v4/search</code></p>
              <p>
                <Link to="/api-keys" className="text-[#93c5fd]">API keys</Link>
                {' · '}
                <Link to="/agents-mcp" className="text-[#93c5fd]">Agents</Link>
                {' · '}
                <Link to="/docs" className="text-[#93c5fd]">Docs</Link>
              </p>
            </div>
          ) : null}
        </section>

        <section className="mt-6 rounded-xl border border-white/[0.08] bg-[#0c0c0e] p-4">
          <p className="text-[14px] text-zinc-100">3. Listening for your first request</p>
          <p className="text-[12.5px] text-zinc-500 mt-1">Run the command in your project. This page picks it up on its own.</p>
          <StatusRow
            label="API key ready"
            done={!!ready?.hasKey || !!secret}
            waiting={!ready}
            detail={ready?.hasKey || secret ? `Created ${ago(ready?.keyCreatedAt)}` : 'Creating a Setup key…'}
          />
          {secret ? (
            <p className="mt-2 text-[12px] text-amber-200">
              Shown only once. <span className="font-mono text-emerald-300 break-all">{secret}</span>{' '}
              <button type="button" className="text-[#93c5fd]" onClick={() => void copy('secret', secret)}>
                {copied === 'secret' ? 'Copied' : 'Copy'}
              </button>
            </p>
          ) : null}
          <StatusRow
            label="First request"
            done={!!ready?.firstRequestAt}
            waiting={!ready?.firstRequestAt}
            detail={ready?.firstRequestAt ? ago(ready.firstRequestAt) : 'Waiting'}
          />
        </section>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-6">
        <CountCard label="Memories" value={counts.isPending ? null : memories} />
        <CountCard label="Documents" value={counts.isPending ? null : documents} />
        <CountCard label="Searches today" value={counts.isPending ? null : searches} />
      </div>

      <h2 className="text-[16px] font-medium text-zinc-200 mt-8 mb-3">Explore</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <ExploreCard to="/playground" icon={<Play size={16} />} title="Playground" subtitle="Ask what this account already remembers" />
        <ExploreCard to="/import" icon={<Globe size={16} />} title="Import" subtitle="Add a file or note, then search it" />
        <ExploreCard to="/memory-graph" icon={<FileText size={16} />} title="Memory graph" subtitle="See documents and facts after import" />
      </div>
    </div>
  );
}

function StatusRow({ label, done, waiting, detail }: { label: string; done: boolean; waiting: boolean; detail: string }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-[13px] min-w-0">
      <span className="text-zinc-200 inline-flex items-center gap-2 min-w-0">
        {done ? <Check size={14} className="text-emerald-400" /> : waiting ? <Loader2 size={14} className="animate-spin text-zinc-500" /> : null}
        {label}
      </span>
      <span className="text-zinc-500 min-w-0 break-words text-right">{detail}</span>
    </div>
  );
}

function CountCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#141416] px-4 py-3.5">
      <p className="text-[11px] tracking-[0.12em] text-zinc-500">{label}</p>
      <p className="text-[22px] text-zinc-100 mt-2">{value === null ? '—' : value}</p>
    </div>
  );
}

function ExploreCard({ to, icon, title, subtitle }: { to: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link to={to} className="group flex items-start gap-3 rounded-xl border border-white/[0.07] bg-[#141416] hover:bg-[#19191c] px-4 py-[18px]">
      <span className="mt-0.5 text-zinc-500">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-medium text-zinc-100">{title}</span>
        <span className="block text-[12.5px] text-zinc-500 mt-0.5">{subtitle}</span>
      </span>
      <span className="text-zinc-600 group-hover:text-zinc-400 text-sm mt-0.5">↗</span>
    </Link>
  );
}
