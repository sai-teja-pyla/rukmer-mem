import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

const RANGE_MS = { '24h': 86400000, '7d': 7 * 86400000 };

function inRange(at: string, range: '24h' | '7d') {
  const time = Date.parse(at);
  return Number.isFinite(time) && Date.now() - time <= RANGE_MS[range];
}

export default function RequestsPage() {
  const [data, setData] = useState<any>({ requests: [], byType: {}, ok: 0, avgMs: 0 });
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [range, setRange] = useState<'24h' | '7d'>('7d');

  useEffect(() => {
    engine.requests().then(setData).catch(() => {});
  }, []);

  const windowed = (data.requests || []).filter((r: { at: string }) => inRange(r.at, range));
  const rows = windowed.filter((r: any) => {
    if (type !== 'all' && r.type !== type) return false;
    if (status === '2xx' && (r.status < 200 || r.status >= 300)) return false;
    if (status === 'errors' && r.status < 400) return false;
    return true;
  });
  const total = windowed.length;
  const windowLabel = range === '24h' ? 'Showing last 24h' : 'Showing the last 7 days';
  const byType: Record<string, number> = {};
  let ok = 0;
  let searchMs = 0;
  let searchN = 0;
  for (const row of windowed) {
    byType[row.type] = (byType[row.type] || 0) + 1;
    if (row.status >= 200 && row.status < 300) ok += 1;
    if (row.type === 'search') {
      searchMs += Number(row.ms) || 0;
      searchN += 1;
    }
  }
  const avgMs = searchN ? Math.round(searchMs / searchN) : 0;

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="Requests"
        subtitle={
          <>
            Every API call, with timing and status. <DocLink section="usage">How usage is measured ↗</DocLink>
          </>
        }
      />
      <div className="flex flex-wrap gap-2 mb-3">
        <label className="h-8 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300 inline-flex items-center gap-1">
          Type
          <select aria-label="Request type" value={type} onChange={(e) => setType(e.target.value)} className="bg-transparent outline-none">
            <option value="all">All types</option>
            <option value="search">Search</option>
            <option value="chat">Chat</option>
            <option value="ingest">Ingest</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="h-8 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300 inline-flex items-center gap-1">
          Range
          <select aria-label="Request range" value={range} onChange={(e) => setRange(e.target.value as '24h' | '7d')} className="bg-transparent outline-none">
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
          </select>
        </label>
        <label className="h-8 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300 inline-flex items-center gap-1">
          Status
          <select aria-label="Request status" value={status} onChange={(e) => setStatus(e.target.value)} className="bg-transparent outline-none">
            <option value="all">All statuses</option>
            <option value="2xx">2xx</option>
            <option value="errors">Errors</option>
          </select>
        </label>
        <p className="h-8 inline-flex items-center text-[12.5px] text-zinc-400">{windowLabel}</p>
      </div>
      <div className="grid md:grid-cols-3 gap-3 mb-3">
        <Panel className="p-4 min-h-[120px]">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500 mb-6">BY TYPE</p>
          <p className="text-[22px] text-zinc-200">{total} <span className="text-[13px] text-zinc-500">requests</span></p>
          <p className="text-[12px] text-zinc-500 mt-2">{JSON.stringify(byType)}</p>
        </Panel>
        <Panel className="p-4 min-h-[120px]">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500 mb-6">2XX RESPONSES</p>
          <p className="text-[22px] text-zinc-200">{ok}</p>
        </Panel>
        <Panel className="p-4 min-h-[120px]">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500 mb-6">AVG SEARCH LATENCY</p>
          <p className="text-[13px] text-zinc-300 mt-8">{avgMs ? `${avgMs} ms` : '— no search traffic in this period'}</p>
        </Panel>
      </div>
      <Panel>
        {rows.length === 0 ? (
          <EmptyState icon={<Activity size={18} />} title="No requests yet" body="API requests will appear here once you start making calls." />
        ) : (
          <div>
            {rows.map((r: any) => (
              <div key={r.id} className="grid grid-cols-5 px-4 py-2.5 text-[12.5px] text-zinc-400 border-t border-white/[0.06]">
                <span>{r.method}</span>
                <span className="text-zinc-200">{r.path}</span>
                <span>{r.status}</span>
                <span>{r.ms}ms</span>
                <span>{new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
