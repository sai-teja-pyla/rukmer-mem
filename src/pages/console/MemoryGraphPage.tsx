import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Brain, Calendar, ChevronDown, Eye, X } from 'lucide-react';
import { engine } from '../../services/engineClient';
import { homeTag as makeHomeTag } from '../../services/tenancy';
import type { UserProfile } from '../../types';

type Fact = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  evidence?: string;
  isLatest?: boolean;
  derived?: boolean;
  containerTag?: string;
  horizon?: 'long' | 'short';
  validFrom?: string;
  validTo?: string | null;
};

type GraphNode = {
  id: string;
  label: string;
  kind: string;
  type?: string;
  source?: string;
  mime?: string;
  containerTag?: string;
  createdAt?: string;
  text?: string;
  facts?: Fact[];
  x?: number;
  y?: number;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  isLatest?: boolean;
  derived?: boolean;
  subject?: string;
  object?: string;
  evidence?: string;
  containerTag?: string;
};

type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; tags: string[] };

const VIEW_W = 1000;
const VIEW_H = 640;
const HUB = { x: 390, y: 318 };

function hexPoints(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');
}

function inSpace(node: GraphNode, space: string) {
  if (space === 'all') return true;
  if (node.containerTag === space) return true;
  return (node.facts || []).some((f) => f.containerTag === space);
}

function isLatestMemory(node: GraphNode) {
  const facts = node.facts || [];
  if (!facts.length) return true;
  return facts.some((f) => f.isLatest !== false);
}

function memoryCopy(node: GraphNode) {
  const text = node.text?.trim();
  if (text) return text;
  const facts = node.facts || [];
  const evidence = [...new Set(facts.map((f) => f.evidence?.trim()).filter(Boolean))] as string[];
  if (evidence.length) return evidence.join(' ');
  if (facts.length) return facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`).join('. ');
  return node.label || '';
}

function versionOf(node: GraphNode) {
  const older = (node.facts || []).filter((f) => f.isLatest === false).length;
  return `v${older + 1}`;
}

function relevanceOf(node: GraphNode) {
  const facts = node.facts || [];
  if (!facts.length) return 100;
  const latest = facts.filter((f) => f.isLatest !== false).length;
  return Math.round((latest / facts.length) * 100);
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function nodeFlags(node: GraphNode) {
  const now = Date.now();
  const facts = node.facts || [];
  const expiring = facts.some((f) => {
    if (f.isLatest === false) return false;
    if (f.horizon === 'short') return true;
    if (!f.validTo) return false;
    const end = Date.parse(f.validTo);
    return end > now && end - now < 14 * 86400000;
  });
  const created = node.createdAt ? Date.parse(node.createdAt) : NaN;
  const fresh = !Number.isNaN(created) && now - created < 7 * 86400000;
  return { expiring, fresh };
}

function trimLine(x1: number, y1: number, x2: number, y2: number, trimStart: number, trimEnd: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x1: x1 + (dx / len) * trimStart,
    y1: y1 + (dy / len) * trimStart,
    x2: x2 - (dx / len) * trimEnd,
    y2: y2 - (dy / len) * trimEnd,
  };
}

function spokeKind(hubId: string | null, nodeId: string, edges: GraphEdge[]) {
  if (!hubId) return 'doc' as const;
  const links = edges.filter(
    (e) => (e.source === hubId && e.target === nodeId) || (e.target === hubId && e.source === nodeId)
  );
  if (links.some((e) => e.derived)) return 'version' as const;
  if (links.some((e) => e.isLatest === false)) return 'similar' as const;
  return 'doc' as const;
}

function orbitOf(nodes: GraphNode[]) {
  const n = nodes.length;
  if (!n) return [];
  const minGap = 64;
  const placed: { node: GraphNode; ring: number; index: number; count: number; radius: number }[] = [];
  let cursor = 0;
  let ring = 0;
  while (cursor < n) {
    const radius = 188 + ring * 92;
    const cap = Math.max(8, Math.floor((2 * Math.PI * radius) / minGap));
    const count = Math.min(cap, n - cursor);
    for (let index = 0; index < count; index += 1) {
      placed.push({ node: nodes[cursor + index], ring, index, count, radius });
    }
    cursor += count;
    ring += 1;
  }
  return placed.map(({ node, ring, index, count, radius }) => {
    const turn = (index / count) * Math.PI * 2 - Math.PI / 2 + ring * 0.38;
    const wobble = ((index * 53 + ring * 17) % 56) - 22;
    const r = radius + wobble;
    return {
      ...node,
      x: HUB.x + Math.cos(turn) * r,
      y: HUB.y + Math.sin(turn) * r * 0.9,
    };
  });
}

function HexMark({ filled, muted }: { filled?: boolean; muted?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <polygon points={hexPoints(8, 8, 6.2)} fill="none" stroke={muted ? 'var(--graph-doc)' : 'var(--graph-memory)'} strokeWidth="1.2" />
      {filled ? <circle cx="8" cy="8" r="2.1" fill="var(--graph-latest)" /> : null}
    </svg>
  );
}

function Legend() {
  return (
    <div className="px-4 pb-4 pt-1 space-y-3 text-[12px]">
      <div>
        <p className="text-[10px] tracking-[0.14em] graph-faint mb-1.5">NODES</p>
        <div className="space-y-1.5">
          <p className="flex items-center gap-2"><HexMark muted /> Document</p>
          <p className="flex items-center gap-2"><HexMark filled /> Memory (latest)</p>
          <p className="flex items-center gap-2"><HexMark /> Memory (older)</p>
        </div>
      </div>
      <div>
        <p className="text-[10px] tracking-[0.14em] graph-faint mb-1.5">STATUS</p>
        <div className="space-y-1.5">
          <p className="flex items-center gap-2"><span className="w-4 text-center text-[#f07178] text-[13px] leading-none">✕</span> Forgotten</p>
          <p className="flex items-center gap-2"><span className="w-4 flex justify-center"><span className="h-2.5 w-2.5 rounded-full bg-[#f0a202]" /></span> Expiring soon</p>
          <p className="flex items-center gap-2"><span className="w-4 flex justify-center text-[#3dd68c] text-[14px] leading-none">✚</span> New memory</p>
        </div>
      </div>
      <div>
        <p className="text-[10px] tracking-[0.14em] graph-faint mb-1.5">CONNECTIONS</p>
        <div className="space-y-1.5">
          <p className="flex items-center gap-2"><span className="w-7 border-t" style={{ borderColor: 'var(--graph-line)' }} /> Doc → Memory</p>
          <p className="flex items-center gap-2"><span className="w-7 border-t border-dashed" style={{ borderColor: 'var(--graph-line)' }} /> Doc similarity</p>
          <p className="flex items-center gap-2"><span className="w-7 border-t" style={{ borderColor: 'var(--graph-version)' }} /> Version chain</p>
        </div>
      </div>
      <div>
        <p className="text-[10px] tracking-[0.14em] graph-faint mb-1.5">SIMILARITY</p>
        <div className="space-y-1.5">
          <p className="flex items-center gap-2"><span className="w-4 flex justify-center"><span className="h-2.5 w-2.5 rounded-full bg-[#8b98a3]" /></span> Weak</p>
          <p className="flex items-center gap-2"><span className="w-4 flex justify-center"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--graph-memory)' }} /></span> Strong</p>
        </div>
      </div>
    </div>
  );
}

export default function MemoryGraphPage() {
  const ctx = useOutletContext<{ user: UserProfile; homeTag: string }>();
  const homeTag = ctx?.homeTag || (ctx?.user?.uid ? makeHomeTag(ctx.user.uid) : '');
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [], tags: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [space, setSpace] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const dismissed = useRef(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!homeTag) {
      setLoading(false);
      return;
    }
    engine
      .graph()
      .then((data) => {
        setGraph({ nodes: data.nodes || [], edges: data.edges || [], tags: data.tags || [] });
        setError('');
      })
      .catch((e) => setError(e.message || 'Could not load graph'))
      .finally(() => setLoading(false));
  }, [homeTag]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const spaces = useMemo(() => {
    const tags = new Set<string>();
    for (const tag of graph.tags) if (tag) tags.add(tag);
    for (const node of graph.nodes) if (node.containerTag) tags.add(node.containerTag);
    return [...tags];
  }, [graph]);

  const visible = useMemo(() => graph.nodes.filter((n) => inSpace(n, space)), [graph.nodes, space]);
  const memories = useMemo(() => visible.filter((n) => n.kind !== 'document'), [visible]);
  const documents = useMemo(() => visible.filter((n) => n.kind === 'document'), [visible]);
  const hub = useMemo(() => {
    if (!documents.length) return null;
    const score = new Map<string, number>();
    for (const edge of graph.edges) {
      if (edge.label === 'mentions') score.set(edge.source, (score.get(edge.source) || 0) + 1);
    }
    return [...documents].sort((a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0))[0];
  }, [documents, graph.edges]);
  const orbit = useMemo(() => orbitOf(memories.length ? memories : documents.filter((d) => d.id !== hub?.id)), [memories, documents, hub?.id]);

  useEffect(() => {
    if (dismissed.current || selectedId) return;
    if (orbit[0]) setSelectedId(orbit[0].id);
  }, [orbit, selectedId]);

  const selected = visible.find((n) => n.id === selectedId) || graph.nodes.find((n) => n.id === selectedId) || null;
  const memoryCount = memories.length;
  const spaceLabel = space === 'all' ? 'All Spaces' : space;
  const hasPlot = orbit.length > 0 || !!hub;

  const chooseSpace = (id: string) => {
    setSpace(id);
    setMenuOpen(false);
    dismissed.current = false;
    setSelectedId(null);
    setView({ x: 0, y: 0, k: 1 });
  };

  const pick = (id: string) => {
    dismissed.current = false;
    setSelectedId(id);
  };

  return (
    <div className="memory-graph h-full min-h-0 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(var(--graph-grid) 1px, transparent 1px), linear-gradient(90deg, var(--graph-grid) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
        }}
      />

      <svg
        className="absolute inset-0 w-full h-full z-[1] cursor-grab active:cursor-grabbing"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[data-node]')) return;
          drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
        onWheel={(e) => {
          setView((v) => ({ ...v, k: Math.min(2.2, Math.max(0.55, v.k * (e.deltaY > 0 ? 0.92 : 1.08))) }));
        }}
        onDoubleClick={() => setView({ x: 0, y: 0, k: 1 })}
      >
        <g transform={`translate(${HUB.x} ${HUB.y}) translate(${view.x} ${view.y}) scale(${view.k}) translate(${-HUB.x} ${-HUB.y})`}>
          {orbit.map((node) => {
            const kind = spokeKind(hub?.id || null, node.id, graph.edges);
            const active = selected?.id === node.id;
            const end = trimLine(HUB.x, HUB.y, node.x ?? HUB.x, node.y ?? HUB.y, 24, 14);
            return (
              <line
                key={`spoke-${node.id}`}
                x1={end.x1}
                y1={end.y1}
                x2={end.x2}
                y2={end.y2}
                stroke={kind === 'version' ? 'var(--graph-version)' : 'var(--graph-line)'}
                strokeWidth={active ? 1.5 : 1.05}
                strokeDasharray={kind === 'similar' ? '4 4' : undefined}
                opacity={active ? 0.95 : 0.62}
              />
            );
          })}

          <g data-node onClick={() => hub && pick(hub.id)} className={hub ? 'cursor-pointer' : undefined}>
            <rect x={HUB.x - 18} y={HUB.y - 18} width="36" height="36" rx="8" fill="var(--graph-hub)" stroke={selected?.id === hub?.id ? 'var(--graph-text)' : 'var(--graph-hub-stroke)'} strokeWidth={selected?.id === hub?.id ? 1.8 : 1.4} />
          </g>

          {orbit.map((node) => {
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const active = selected?.id === node.id;
            const latest = node.kind !== 'document' && isLatestMemory(node);
            const isDoc = node.kind === 'document';
            const stroke = isDoc ? 'var(--graph-doc)' : latest ? 'var(--graph-memory)' : 'var(--graph-memory-old)';
            const flags = nodeFlags(node);
            return (
              <g key={node.id} data-node onClick={() => pick(node.id)} className="cursor-pointer" style={{ pointerEvents: 'all' }}>
                <circle cx={x} cy={y} r="26" fill="transparent" />
                {active ? (
                  <polygon points={hexPoints(x, y, 28)} fill="none" stroke="var(--graph-ring)" strokeWidth="1.2" strokeDasharray="3 3" style={{ pointerEvents: 'none' }} />
                ) : null}
                <polygon points={hexPoints(x, y, 18)} fill="transparent" stroke={stroke} strokeWidth={active ? 1.8 : 1.35} />
                {latest && !isDoc ? <circle cx={x} cy={y} r="5.2" fill="var(--graph-latest)" /> : null}
                {flags.expiring ? <circle cx={x + 16} cy={y - 16} r="3.4" fill="#f0a202" /> : null}
                {!flags.expiring && flags.fresh ? <circle cx={x + 16} cy={y - 16} r="3.4" fill="#3dd68c" /> : null}
              </g>
            );
          })}
        </g>
      </svg>

      {!hasPlot && (
        <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto text-center max-w-sm px-6 -translate-y-6 md:-translate-x-10">
            <p className="text-[15px]">{error ? 'Memory graph is offline' : loading ? 'Loading memory…' : 'Nothing to plot yet'}</p>
            <p className="text-[13px] graph-muted mt-1">
              {error || 'Chat in Playground or import documents. Memories show up here around the space.'}
            </p>
            {!error && !loading ? (
              <Link to="/import" className="inline-block mt-3 text-[13px]" style={{ color: 'var(--graph-memory)' }}>
                Import documents
              </Link>
            ) : null}
          </div>
        </div>
      )}

      <div ref={menuRef} className="absolute top-3 left-3 z-20">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="graph-chip flex items-center gap-2.5 min-w-[210px] max-w-[280px] rounded-xl px-2.5 py-2 text-left"
        >
          <span className="h-7 w-7 rounded-full border flex items-center justify-center graph-muted shrink-0" style={{ borderColor: 'var(--graph-border)' }}>
            <Eye size={14} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13.5px] font-medium truncate">{spaceLabel}</span>
            <span className="block text-[11.5px] graph-muted">{memoryCount} total memories</span>
          </span>
          <ChevronDown size={16} className={`graph-muted shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
        {menuOpen && (
          <div className="graph-panel mt-1.5 w-full rounded-xl border py-1 max-h-64 overflow-auto">
            <button type="button" onClick={() => chooseSpace('all')} className="graph-hover w-full text-left px-3 py-1.5 text-[13px]">
              All Spaces
            </button>
            {spaces.map((tag) => (
              <button key={tag} type="button" onClick={() => chooseSpace(tag)} className="graph-hover w-full text-left px-3 py-1.5 text-[13px] truncate">
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="graph-panel absolute z-20 bottom-3 left-3 right-3 md:left-auto md:bottom-auto md:top-3 md:right-3 w-auto md:w-[308px] max-h-[48%] md:max-h-[calc(100%-1.5rem)] flex flex-col rounded-2xl border shadow-[0_16px_40px_rgba(0,0,0,0.18)] overflow-hidden">
        {selected ? (
          <>
            <div className="shrink-0 flex items-center justify-between px-4 pt-3.5 pb-2">
              <div className="flex items-center gap-2">
                <Brain size={16} strokeWidth={1.7} />
                <span className="text-[14px] font-medium">{selected.kind === 'document' ? 'Document' : 'Memory'}</span>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  dismissed.current = true;
                  setSelectedId(null);
                }}
                className="h-7 w-7 rounded-md graph-muted hover:opacity-80 flex items-center justify-center"
              >
                <X size={15} />
              </button>
            </div>
            <div className="overflow-y-auto min-h-0 px-4 pb-3">
              <p className="text-[10px] tracking-[0.14em] graph-faint mb-1">MEMORY</p>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{memoryCopy(selected)}</p>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-[10px] tracking-[0.14em] graph-faint">SPACE</p>
                  <p className="text-[13px] break-all mt-0.5">{selected.containerTag || hub?.containerTag || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-[0.14em] graph-faint">VERSION</p>
                  <p className="text-[13px] mt-0.5">{versionOf(selected)}</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-[0.14em] graph-faint">RELEVANCE SCORE</p>
                  <p className="text-[13px] mt-0.5">{relevanceOf(selected)}%</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 text-[11.5px] graph-muted">
                {formatDate(selected.createdAt) ? (
                  <span className="inline-flex items-center gap-1">
                    <Calendar size={12} />
                    {formatDate(selected.createdAt)}
                  </span>
                ) : null}
                <span className="truncate"># {selected.id}</span>
              </div>
            </div>
          </>
        ) : null}
        <div className="shrink-0 border-t overflow-y-auto" style={{ borderColor: 'var(--graph-border)' }}>
          <Legend />
        </div>
      </aside>
    </div>
  );
}
