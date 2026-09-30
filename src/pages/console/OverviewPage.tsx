import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, ChevronDown, Sparkles, Box, FileText, Play, Globe } from 'lucide-react';

const BASE_PROMPT = `# You are onboarding this project to Rukmer Memory

Rukmer is a memory API for AI apps and agents: ingest conversations, documents, files, and URLs; get semantic search, extracted facts, and per-user profiles back. Every call is scoped to one containerTag, with strict isolation between tags.

## What you can call

| Operation | Endpoint | Use when |
|---|---|---|
| Add content | POST /v3/documents | Ingest conversations, documents, files, URLs |
| Search documents | POST /v3/search | Find raw chunks for RAG grounding |
| Search memories | POST /v4/search | Find extracted facts with graph context |
| Get profile | GET /v4/profile | Static + dynamic context for a user |
| List documents | POST /v3/documents/list | Paginate and filter ingested content |
| Forget memory | DELETE /v4/memories | Soft-delete one fact; JSON body with containerTag plus id or exact content |
| Forget matching | POST /v4/memories/forget-matching | Soft-delete every fact matching a query or an ids list; dryRun previews first |`;

export default function OverviewPage() {
  const [copied, setCopied] = useState(false);
  const [includeKey, setIncludeKey] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);

  const prompt = useMemo(() => {
    if (!includeKey) return BASE_PROMPT;
    return `${BASE_PROMPT}

## Auth
Send Firebase ID tokens as: Authorization: Bearer <ID_TOKEN>
Keep secrets in .env — never commit keys.`;
  }, [includeKey]);

  const lines = prompt.split('\n');

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      /* clipboard may be blocked in embedded browsers */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="max-w-[1220px] mx-auto">
      <div className="rounded-2xl border border-white/[0.07] bg-[#141416] p-5 md:p-7">
        <div className="grid md:grid-cols-[minmax(240px,0.95fr)_minmax(0,1.25fr)] gap-6 lg:gap-8 items-stretch">
          <div className="flex flex-col justify-center py-8 min-[960px]:py-10">
            <div className="flex items-center gap-2.5 text-zinc-400 mb-6">
              <Sparkles size={18} strokeWidth={1.6} />
              <Box size={18} strokeWidth={1.6} />
              <FileText size={18} strokeWidth={1.6} />
            </div>
            <h1 className="text-[32px] font-semibold tracking-tight text-white mb-3">Get started</h1>
            <p className="text-[14px] text-zinc-400 leading-relaxed max-w-[340px]">
              Paste one prompt into Claude Code, Cursor, Codex or OpenCode. Your agent creates a key, learns the API, and wires memory into this project.
            </p>

            <div className="flex items-center gap-3 mt-7">
              <button
                onClick={copyPrompt}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-[13.5px] font-medium"
              >
                {copied ? <Check size={15} /> : null}
                {copied ? 'Copied' : 'Copy prompt'}
              </button>
              <button
                onClick={() => setManualOpen((v) => !v)}
                className="text-[13.5px] text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1"
              >
                or set up manually
                <ChevronDown size={15} className={`transition-transform ${manualOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {manualOpen && (
              <div className="mt-4 rounded-lg border border-white/[0.07] bg-black/25 p-3 text-[12.5px] text-zinc-400 space-y-1.5 max-w-[360px]">
                <p>1. Add keys to <code className="text-zinc-300">.env</code> and place <code className="text-zinc-300">service-account.json</code> in the project root.</p>
                <p>2. Run <code className="text-zinc-300">npm run dev</code> and <code className="text-zinc-300">PORT=5001 npm start</code>.</p>
                <p>3. Connect apps from Connectors, then try queries in Playground.</p>
              </div>
            )}

            <Link to="/agents-mcp" className="mt-10 text-[13px] text-zinc-500 hover:text-zinc-300 w-fit">
              Looking for plugins?
            </Link>
          </div>

          <div className="relative rounded-xl border border-white/[0.08] bg-[#0c0c0e] overflow-hidden min-h-[360px]">
            <button
              onClick={copyPrompt}
              className="absolute top-2.5 right-2.5 z-10 h-8 w-8 rounded-md border border-white/[0.08] bg-[#141416] text-zinc-400 hover:text-white flex items-center justify-center"
              aria-label="Copy prompt"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <pre className="text-[12.5px] leading-[1.7] p-4 pr-12 pb-14 overflow-auto max-h-[440px] font-mono">
              {lines.map((line, i) => (
                <div key={i} className="flex gap-5">
                  <span className="w-4 shrink-0 text-right text-zinc-600 select-none">{i + 1}</span>
                  <span className={`whitespace-pre-wrap ${line.startsWith('#') ? 'text-zinc-400' : 'text-zinc-200'}`}>
                    {line || ' '}
                  </span>
                </div>
              ))}
            </pre>
            <div className="absolute bottom-3 right-3 flex items-center gap-2 text-[12px] text-zinc-400">
              <span>Include an API key</span>
              <button
                role="switch"
                aria-checked={includeKey}
                onClick={() => setIncludeKey((v) => !v)}
                className={`h-[22px] w-10 rounded-full relative transition-colors ${includeKey ? 'bg-[#2563eb]' : 'bg-zinc-700'}`}
              >
                <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all ${includeKey ? 'left-[22px]' : 'left-[3px]'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <h2 className="text-[16px] font-medium text-zinc-200 mt-8 mb-3">Explore</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <ExploreCard to="/playground" icon={<Play size={16} />} title="Live Demo" subtitle="See Rukmer memory in action" />
        <ExploreCard to="/playground" icon={<Globe size={16} />} title="Playground" subtitle="Test the API interactively" />
        <ExploreCard to="/docs" icon={<FileText size={16} />} title="Documentation" subtitle="Read the full API reference" />
      </div>
    </div>
  );
}

function ExploreCard({ to, icon, title, subtitle }: { to: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-xl border border-white/[0.07] bg-[#141416] hover:bg-[#19191c] px-4 py-[18px]"
    >
      <span className="mt-0.5 text-zinc-500">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-medium text-zinc-100">{title}</span>
        <span className="block text-[12.5px] text-zinc-500 mt-0.5">{subtitle}</span>
      </span>
      <span className="text-zinc-600 group-hover:text-zinc-400 text-sm mt-0.5">↗</span>
    </Link>
  );
}
