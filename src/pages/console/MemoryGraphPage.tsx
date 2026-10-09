import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Share2, ChevronRight, Download, X } from 'lucide-react';
import { DocLink, PrimaryButton } from '../../components/console/ui';
import { engine } from '../../services/engineClient';
import { homeTag as makeHomeTag } from '../../services/tenancy';
import type { UserProfile } from '../../types';

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

type Fact = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  evidence?: string;
  isLatest?: boolean;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  isLatest?: boolean;
  subject?: string;
  object?: string;
  evidence?: string;
  containerTag?: string;
};

export default function MemoryGraphPage() {
  const ctx = useOutletContext<{ user: UserProfile; homeTag: string }>();
  const homeTag = ctx?.homeTag || (ctx?.user?.uid ? makeHomeTag(ctx.user.uid) : '');
  const [legendOpen, setLegendOpen] = useState(false);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<GraphNode | GraphEdge | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!homeTag) return;
    engine
      .graph(homeTag)
      .then((data) => {
        const nodes = data.nodes || [];
        const edges = data.edges || [];
        setGraph({ nodes, edges });
        setSelected((cur) => {
          if (!cur) return null;
          return nodes.find((n: GraphNode) => n.id === cur.id) || edges.find((e: GraphEdge) => e.id === cur.id) || cur;
        });
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

  const layout = useMemo(() => {
    const nodes = graph.nodes || [];
    const w = 960;
    const h = 560;
    const cx = w / 2;
    const cy = h / 2;
    const n = Math.max(nodes.length, 1);
    return nodes.map((node, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const ring = node.kind === 'document' ? 150 : 230;
      return {
        ...node,
        x: cx + Math.cos(angle) * ring,
        y: cy + Math.sin(angle) * ring * 0.72,
      };
    });
  }, [graph]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    layout.forEach((n) => m.set(n.id, n));
    return m;
  }, [layout]);

  const hasData = (graph.nodes || []).length > 0;
  const selectedNode = selected && 'kind' in selected ? selected : null;
  const selectedEdge = selected && 'source' in selected && !('kind' in selected) ? selected : null;
  const related = selectedNode
    ? (graph.edges || []).filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
    : [];

  const pick = (item: GraphNode | GraphEdge, ev?: React.MouseEvent | React.PointerEvent) => {
    ev?.stopPropagation();
    setSelected(item);
    setLegendOpen(false);
  };

  return (
    <div className="h-full min-h-0 relative overflow-hidden">
      <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
      {hasData && (
        <svg
          className="absolute inset-0 w-full h-full z-[1]"
          viewBox="0 0 960 560"
          preserveAspectRatio="xMidYMid meet"
          onClick={() => setSelected(null)}
        >
          {(graph.edges || []).map((e) => {
            const a = pos.get(e.source);
            const b = pos.get(e.target);
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const active = selectedEdge?.id === e.id;
            return (
              <g key={e.id} onClick={(ev) => pick(e, ev)} className="cursor-pointer">
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="14" />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={active ? '#93c5fd' : '#3b82f6'}
                  strokeWidth={active ? '2.4' : e.isLatest === false ? '1' : '1.2'}
                  opacity={e.isLatest === false ? '0.3' : '0.55'}
                  strokeDasharray={e.isLatest === false ? '4 4' : undefined}
                />
                {e.label ? (
                  <text x={mx} y={my - 4} textAnchor="middle" fill="#a1a1aa" fontSize="9">
                    {String(e.label).slice(0, 18)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {layout.map((n) => {
            const active = selectedNode?.id === n.id;
            return n.kind === 'document' ? (
              <g key={n.id} onClick={(ev) => pick(n, ev)} className="cursor-pointer">
                <rect x={n.x - 22} y={n.y - 22} width="44" height="44" rx="8" fill="transparent" />
                <rect x={n.x - 14} y={n.y - 14} width="28" height="28" rx="6" fill="#1e293b" stroke={active ? '#bfdbfe' : '#60a5fa'} strokeWidth={active ? 2 : 1} />
                <text x={n.x} y={n.y + 28} textAnchor="middle" fill="#d4d4d8" fontSize="11">
                  {(n.label || 'document').slice(0, 28)}
                </text>
              </g>
            ) : (
              <g key={n.id} onClick={(ev) => pick(n, ev)} className="cursor-pointer">
                <circle cx={n.x} cy={n.y} r="22" fill="transparent" />
                <circle cx={n.x} cy={n.y} r="8" fill={active ? '#60a5fa' : '#1d4ed8'} />
                <text x={n.x} y={n.y + 22} textAnchor="middle" fill="#e4e4e7" fontSize="11">
                  {(n.label || 'memory').slice(0, 22)}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {!hasData && (
        <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 text-center">
          <Share2 size={22} className="text-zinc-500 mb-3" />
          <p className="text-[16px] font-medium text-white">{error ? 'Memory graph is offline' : loading ? 'Loading memory…' : 'Nothing to plot yet'}</p>
          <p className="text-[13px] text-zinc-500 mt-1">
            {error || 'Chat in Playground or import documents. Facts land here as connected memories.'}
          </p>
          <DocLink>How the memory graph works ↗</DocLink>
          <Link to="/import" className="mt-5">
            <PrimaryButton><Download size={14} /> Import documents</PrimaryButton>
          </Link>
        </div>
      )}

      {hasData && (
        <div className="absolute top-3 left-3 z-10 rounded-lg border border-white/[0.08] bg-[#161618]/90 px-3 py-2 text-[12px] text-zinc-400 max-w-[calc(100%-1.5rem)]">
          {graph.nodes.length} memories · {graph.edges.length} links — click a node or line
        </div>
      )}

      {selected && (
        <div className="absolute z-20 inset-x-0 bottom-0 sm:inset-auto sm:top-3 sm:right-3 sm:bottom-3 sm:w-[340px] max-h-[55vh] sm:max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-t-2xl sm:rounded-xl border border-white/[0.08] bg-[#161618] p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                {selectedNode ? `${selectedNode.kind}${selectedNode.type ? ` · ${selectedNode.type}` : ''}` : 'link'}
              </p>
              <p className="text-[16px] font-medium text-white break-words">
                {selectedNode ? selectedNode.label : `${selectedEdge?.subject || ''} ${selectedEdge?.label || ''} ${selectedEdge?.object || ''}`}
              </p>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="h-8 w-8 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center shrink-0" aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {selectedNode?.containerTag && <p className="text-[12px] font-mono text-zinc-500 mb-2 break-all">{selectedNode.containerTag}</p>}
          {selectedNode?.source && <p className="text-[12px] text-zinc-500 mb-2">Source: {selectedNode.source}{selectedNode.createdAt ? ` · ${new Date(selectedNode.createdAt).toLocaleString()}` : ''}</p>}

          {selectedNode?.text ? (
            <div className="mb-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 mb-1">Contents</p>
              <p className="text-[13px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{selectedNode.text}</p>
            </div>
          ) : null}

          {selectedEdge && (
            <div className="mb-3 space-y-1">
              <p className="text-[13px] text-zinc-200">
                <span className="text-white">{selectedEdge.subject}</span>
                <span className="text-blue-300"> {selectedEdge.label} </span>
                <span className="text-white">{selectedEdge.object}</span>
              </p>
              {selectedEdge.evidence ? <p className="text-[13px] text-zinc-400 leading-relaxed">{selectedEdge.evidence}</p> : null}
              {selectedEdge.isLatest === false && <p className="text-[12px] text-zinc-500">Historical (superseded)</p>}
            </div>
          )}

          {selectedNode && (selectedNode.facts || []).length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 mb-1">Facts</p>
              <ul className="space-y-2">
                {selectedNode.facts!.map((f) => (
                  <li key={f.id} className="rounded-lg border border-white/[0.06] bg-black/20 p-2">
                    <p className="text-[13px] text-zinc-200">
                      {f.subject} <span className="text-blue-300">{f.predicate}</span> {f.object}
                    </p>
                    {f.evidence ? <p className="text-[12px] text-zinc-500 mt-1 leading-relaxed">{f.evidence}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selectedNode && related.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 mb-1">Connected</p>
              <ul className="space-y-1">
                {related.map((e) => {
                  const otherId = e.source === selectedNode.id ? e.target : e.source;
                  const other = graph.nodes.find((n) => n.id === otherId);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = graph.nodes.find((n) => n.id === otherId);
                          if (next) setSelected(next);
                          else pick(e);
                        }}
                        className="text-left text-[13px] text-zinc-300 hover:text-white"
                      >
                        {e.label} → {other?.label || otherId}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {selectedNode && !selectedNode.text && !(selectedNode.facts || []).length && (
            <p className="text-[13px] text-zinc-500">No stored excerpt for this node yet. Linked facts appear here after Playground or import extracts them.</p>
          )}
        </div>
      )}

      <button onClick={() => setLegendOpen((v) => !v)} className="absolute bottom-4 left-4 z-10 h-8 px-3 rounded-lg border border-white/[0.1] bg-[#111113] text-[13px] text-zinc-300 inline-flex items-center gap-1">
        <ChevronRight size={14} className={legendOpen ? 'rotate-90' : ''} /> Legend
      </button>
      {legendOpen && (
        <div className="absolute bottom-14 left-4 z-10 w-64 rounded-lg border border-white/[0.08] bg-[#161618] p-3 text-[12px] text-zinc-400">
          Squares are documents and conversations. Dots are facts. Click a node or a line to open its contents. Solid lines are current. Dashed lines are historical.
        </div>
      )}
    </div>
  );
}
