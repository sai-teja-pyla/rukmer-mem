import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Share2, ChevronRight, Download } from 'lucide-react';
import { DocLink, PrimaryButton } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

export default function MemoryGraphPage() {
  const [legendOpen, setLegendOpen] = useState(false);
  const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    engine.graph().then(setGraph).catch(() => {});
  }, []);

  const layout = useMemo(() => {
    const nodes = graph.nodes || [];
    const w = 800, h = 520, cx = 400, cy = 250;
    return nodes.map((n, i) => {
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      const r = n.kind === 'document' ? 90 : 180;
      return { ...n, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r * 0.72 };
    });
  }, [graph]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    layout.forEach((n) => m.set(n.id, n));
    layout.forEach((n) => m.set(n.label, n));
    return m;
  }, [layout]);

  const hasData = (graph.nodes || []).length > 0;

  return (
    <div className="h-full min-h-0 relative overflow-hidden">
      <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
      {hasData && (
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 520">
          {(graph.edges || []).map((e) => {
            const a = pos.get(e.source);
            const b = pos.get(e.target);
            if (!a || !b) return null;
            return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3b82f6" strokeWidth="1.1" opacity="0.7" />;
          })}
          {layout.map((n) =>
            n.kind === 'document' ? (
              <g key={n.id} onClick={() => setSelected(n)} className="cursor-pointer">
                <rect x={n.x - 14} y={n.y - 14} width="28" height="28" rx="6" fill="#1e293b" stroke="#60a5fa" />
              </g>
            ) : (
              <circle key={n.id} cx={n.x} cy={n.y} r="7" fill="#1d4ed8" className="cursor-pointer" onClick={() => setSelected(n)} />
            )
          )}
        </svg>
      )}

      {!hasData && (
        <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 text-center">
          <Share2 size={22} className="text-zinc-500 mb-3" />
          <p className="text-[16px] font-medium text-white">Nothing to plot yet</p>
          <p className="text-[13px] text-zinc-500 mt-1">Every document you add lands here as connected memories.</p>
          <DocLink>How the memory graph works ↗</DocLink>
          <Link to="/import" className="mt-5">
            <PrimaryButton><Download size={14} /> Import documents</PrimaryButton>
          </Link>
        </div>
      )}

      {selected && (
        <div className="absolute top-4 right-4 z-10 w-64 rounded-xl border border-white/[0.08] bg-[#161618] p-3">
          <p className="text-[12px] text-zinc-500">{selected.kind}</p>
          <p className="text-[14px] text-white">{selected.label}</p>
        </div>
      )}

      <button onClick={() => setLegendOpen((v) => !v)} className="absolute bottom-4 left-4 z-10 h-8 px-3 rounded-lg border border-white/[0.1] bg-[#111113] text-[13px] text-zinc-300 inline-flex items-center gap-1">
        <ChevronRight size={14} className={legendOpen ? 'rotate-90' : ''} /> Legend
      </button>
      {legendOpen && (
        <div className="absolute bottom-14 left-4 z-10 w-56 rounded-lg border border-white/[0.08] bg-[#161618] p-3 text-[12px] text-zinc-400">
          Squares are documents. Dots are extracted memories. Lines are triples.
        </div>
      )}
    </div>
  );
}
