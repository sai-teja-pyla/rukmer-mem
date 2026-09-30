import React, { useEffect, useState } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState, FilterChip } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

export default function RequestsPage() {
  const [data, setData] = useState<any>({ requests: [], byType: {}, ok: 0, avgMs: 0 });

  useEffect(() => {
    engine.requests().then(setData).catch(() => {});
  }, []);

  const rows = data.requests || [];
  const total = rows.length;

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="Requests"
        subtitle={
          <>
            Every API call, with timing and status. <DocLink>How usage is measured ↗</DocLink>
          </>
        }
      />
      <div className="flex flex-wrap gap-2 mb-3">
        <FilterChip>All types <ChevronDown size={12} /></FilterChip>
        <FilterChip>All statuses <ChevronDown size={12} /></FilterChip>
        <FilterChip>Last 30 days <ChevronDown size={12} /></FilterChip>
      </div>
      <div className="grid md:grid-cols-3 gap-3 mb-3">
        <Panel className="p-4 min-h-[120px]">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500 mb-6">BY TYPE</p>
          <p className="text-[22px] text-zinc-200">{total} <span className="text-[13px] text-zinc-500">requests</span></p>
          <p className="text-[12px] text-zinc-500 mt-2">{JSON.stringify(data.byType || {})}</p>
        </Panel>
        <Panel className="p-4 min-h-[120px]">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500 mb-6">2XX RESPONSES</p>
          <p className="text-[22px] text-zinc-200">{data.ok || 0}</p>
        </Panel>
        <Panel className="p-4 min-h-[120px]">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500 mb-6">AVG SEARCH LATENCY</p>
          <p className="text-[13px] text-zinc-300 mt-8">{data.avgMs ? `${data.avgMs} ms` : '— no search traffic in this period'}</p>
        </Panel>
      </div>
      <Panel>
        {rows.length === 0 ? (
          <EmptyState icon={<Activity size={18} />} title="No requests yet" body="API requests will appear here once you start making calls." />
        ) : (
          <div>
            {rows.slice(0, 40).map((r: any) => (
              <div key={r.id} className="grid grid-cols-5 px-4 py-2.5 text-[12.5px] text-zinc-400 border-t border-white/[0.06]">
                <span>{r.method}</span>
                <span className="text-zinc-200">{r.path}</span>
                <span>{r.status}</span>
                <span>{r.ms}ms</span>
                <span>{new Date(r.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
