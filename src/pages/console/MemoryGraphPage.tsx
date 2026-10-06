import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Share2, ChevronRight, Download } from 'lucide-react';
import { DocLink, PrimaryButton } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

export default function MemoryGraphPage() {
  const [legendOpen, setLegendOpen] = useState(false);
  const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    engine
      .graph()
      .then((data) => {
        setGraph({ nodes: data.nodes || [], edges: data.edges || [] });
        setError('');
      })
      .catch((e) => setError(e.message || 'Could not load graph'));
  }, []);

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
    return nodes.map((n, i) => {
      const gold = Math.PI * (3 - Math.sqrt(5));
      const angle = i * gold;
      const ring = n.kind === 'document' ? 110 : 210;
      const jitter = 18 + (i % 7) * 6;
      return {
        ...n,
        x: cx + Math.cos(angle) * (ring + jitter),
        y: cy + Math.sin(angle) * (ring * 0.62 + jitter * 0.4),
      };
    });
  }, [graph]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    layout.forEach((n) => m.set(n.id, n));
    return m;
  }, [layout]);

  const hasData = (graph.nodes || []).length > 0;

  return (
    <div className="h-full min-h-0 relative overflow-hidden">
      <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
      {hasData && (
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 960 560">
          {(graph.edges || []).map((e) => {
            const a = pos.get(e.source);
            const b = pos.get(e.target);
            if (!a || !b) return null;
            return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3b82f6" strokeWidth={e.isLatest === false ? '1' : '1.2'} opacity={e.isLatest === false ? '0.3' : '0.55'} strokeDasharray={e.isLatest === false ? '4 4' : undefined} />;
          })}
          {layout.map((n) =>
            n.kind === 'document' ? (
              <g key={n.id} onClick={() => setSelected(n)} className="cursor-pointer">
                <rect x={n.x - 12} y={n.y - 12} width="24" height="24" rx="6" fill="#1e293b" stroke="#60a5fa" />
                <text x={n.x} y={n.y + 22} textAnchor="middle" fill="#a1a1aa" fontSize="10">
                  {(n.label || '').slice(0, 22)}
                </text>
              </g>
            ) : (
              <g key={n.id} onClick={() => setSelected(n)} className="cursor-pointer">
                <circle cx={n.x} cy={n.y} r="7" fill="#1d4ed8" />
                <text x={n.x} y={n.y + 18} textAnchor="middle" fill="#d4d4d8" fontSize="10">
                  {(n.label || '').slice(0, 18)}
                </text>
              </g>
            )
          )}
        </svg>
      )}

      {!hasData && (
        <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 text-center">
          <Share2 size={22} className="text-zinc-500 mb-3" />
          <p className="text-[16px] font-medium text-white">{error ? 'Memory graph is offline' : 'Nothing to plot yet'}</p>
          <p className="text-[13px] text-zinc-500 mt-1">
            {error || 'Chat in Playground or import documents. Facts land here as connected memories.'}
          </p>
          <DocLink>How the memory graph works ↗</DocLink>
          <Link to="/import" className="mt-5">
            <PrimaryButton><Download size={14} /> Import documents</PrimaryButton>
          </Link>
        </div>
      )}

      {selected && (
        <div className="absolute top-4 right-4 z-10 w-64 rounded-xl border border-white/[0.08] bg-[#161618] p-3">
          <p className="text-[12px] text-zinc-500">{selected.kind}{selected.type ? ` · ${selected.type}` : ''}</p>
          <p className="text-[14px] text-white">{selected.label}</p>
        </div>
      )}

      <button onClick={() => setLegendOpen((v) => !v)} className="absolute bottom-4 left-4 z-10 h-8 px-3 rounded-lg border border-white/[0.1] bg-[#111113] text-[13px] text-zinc-300 inline-flex items-center gap-1">
        <ChevronRight size={14} className={legendOpen ? 'rotate-90' : ''} /> Legend
      </button>
      {legendOpen && (
        <div className="absolute bottom-14 left-4 z-10 w-64 rounded-lg border border-white/[0.08] bg-[#161618] p-3 text-[12px] text-zinc-400">
          Squares are documents and conversations. Dots are facts. Solid lines are current (isLatest). Dashed lines are historical.
        </div>
      )}
    </div>
  );
}
