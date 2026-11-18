import React from 'react';
import { Download, Tag } from 'lucide-react';

export type LoadPhase = 'loading' | 'error' | 'empty' | 'ready';

export function resourceView(phase: 'loading' | 'error' | 'ready', count: number): LoadPhase {
  if (phase !== 'ready') return phase;
  return count > 0 ? 'ready' : 'empty';
}

export function graphView(phase: 'loading' | 'error' | 'ready', memoryCount: number, hasPlot: boolean): LoadPhase {
  if (phase !== 'ready') return phase;
  return memoryCount > 0 || hasPlot ? 'ready' : 'empty';
}

export function graphCountText(phase: LoadPhase, count: number) {
  if (phase === 'loading') return 'Loading memory…';
  if (phase === 'error') return "Couldn't load your memories";
  return `${count} total memories`;
}

export function nodeLabel(label: string) {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 16) return text;
  const slice = text.slice(0, 15);
  const cut = slice.lastIndexOf(' ');
  return `${(cut > 6 ? slice.slice(0, cut) : slice).trim()}…`;
}

export function graphDataText(nodes: { label?: string }[]) {
  return nodes
    .map((node) => String(node.label || '').trim())
    .filter(Boolean)
    .slice(0, 20)
    .join(', ');
}

export function GraphCountLabel({ phase, count }: { phase: LoadPhase; count: number }) {
  return (
    <span className="block text-[11.5px] graph-muted" data-phase={phase}>
      {graphCountText(phase, count)}
    </span>
  );
}

export function MemoryErrorBanner({ onRetry, variant = 'console' }: { onRetry: () => void; variant?: 'console' | 'graph' }) {
  if (variant === 'graph') {
    return (
      <div role="alert" data-phase="error">
        <p className="text-[15px]">Couldn't load your memories, retry</p>
        <button type="button" onClick={onRetry} className="inline-block mt-3 text-[13px]" style={{ color: 'var(--graph-memory)' }}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div role="alert" data-phase="error" className="flex flex-col items-center justify-center text-center py-16 px-6">
      <p className="text-[15px] font-medium text-zinc-100">Couldn't load your memories, retry</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center h-9 px-3.5 rounded-lg border border-white/[0.08] text-[13px] text-zinc-200"
      >
        Retry
      </button>
    </div>
  );
}

export function GraphStatus({ phase, onRetry }: { phase: 'loading' | 'error' | 'empty'; onRetry: () => void }) {
  return (
    <div className="pointer-events-auto text-center max-w-sm px-6 -translate-y-6 md:-translate-x-10" data-phase={phase}>
      {phase === 'loading' ? (
        <div className="space-y-3 w-56 mx-auto" aria-busy="true">
          <div className="mx-auto h-16 w-16 rounded-full border animate-pulse" style={{ borderColor: 'var(--graph-border)' }} />
          <div className="h-3 rounded-md animate-pulse" style={{ background: 'var(--graph-hover)' }} />
          <div className="h-3 w-2/3 mx-auto rounded-md animate-pulse" style={{ background: 'var(--graph-hover)' }} />
        </div>
      ) : phase === 'error' ? (
        <MemoryErrorBanner variant="graph" onRetry={onRetry} />
      ) : (
        <>
          <p className="text-[15px]">Nothing to plot yet</p>
          <p className="text-[13px] graph-muted mt-1">Chat in Playground or import documents. Memories show up here around the space.</p>
          <a href="/import" className="inline-block mt-3 text-[13px]" style={{ color: 'var(--graph-memory)' }}>
            Import documents
          </a>
        </>
      )}
    </div>
  );
}

export function ContainerTagsStatus({ phase, onRetry }: { phase: 'loading' | 'error' | 'empty'; onRetry: () => void }) {
  if (phase === 'loading') {
    return (
      <div className="px-4 py-4 space-y-3" aria-busy="true" data-phase="loading">
        <div className="animate-pulse rounded-md bg-white/[0.06] h-8 w-full" />
        <div className="animate-pulse rounded-md bg-white/[0.06] h-8 w-full" />
        <div className="animate-pulse rounded-md bg-white/[0.06] h-8 w-4/5" />
      </div>
    );
  }
  if (phase === 'error') return <MemoryErrorBanner onRetry={onRetry} />;
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6" data-phase="empty">
      <div className="h-10 w-10 rounded-lg border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-zinc-500 mb-3">
        <Tag size={18} />
      </div>
      <p className="text-[15px] font-medium text-zinc-100">No container tags yet</p>
      <p className="text-[13px] text-zinc-500 mt-1 max-w-sm">Tags are created the first time you ingest with a containerTag.</p>
      <a href="/import" className="mt-4 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#2563eb] text-white text-[13px] font-medium">
        <Download size={14} /> Import data
      </a>
    </div>
  );
}

export type TagRow = {
  tag: string;
  documents?: number;
  memories?: number;
  activity?: string;
  sites?: string[];
};

const SOURCE_LABEL: Record<string, string> = { browser: 'Browser', gmail: 'Gmail', canvas: 'Canvas', x: 'X' };

function SourceMarks({ sites }: { sites?: string[] }) {
  if (!sites?.length) return null;
  return (
    <>
      {sites.map((site) => (
        <span
          key={site}
          className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-zinc-300"
          title={SOURCE_LABEL[site] || site}
        >
          <i className="h-1.5 w-1.5 rounded-full bg-[#2563eb]" aria-hidden />
          {SOURCE_LABEL[site] || site}
        </span>
      ))}
    </>
  );
}

export function TagRows({ tags }: { tags: TagRow[] }) {
  return (
    <div className="overflow-x-auto" data-phase="ready">
      {tags.map((row) => (
        <div key={row.tag} className="grid grid-cols-4 min-w-[560px] px-4 py-3 text-[13px] text-zinc-300 border-t border-white/[0.06]">
          <span className="text-zinc-100 inline-flex items-center gap-1.5 flex-wrap">
            {row.tag}
            <SourceMarks sites={row.sites} />
          </span>
          <span>{row.documents ?? 0}</span>
          <span>{row.memories ?? 0}</span>
          <span className="text-zinc-500">{row.activity ? new Date(row.activity).toLocaleString() : '—'}</span>
        </div>
      ))}
    </div>
  );
}
