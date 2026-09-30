import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

export default function UserInsightsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    engine.insights().then(setData).catch(() => {});
  }, []);

  const memories = data?.memories ?? 0;

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="User Insights"
        subtitle={
          <>
            Coverage and activity for people in this workspace. <DocLink>How insights are computed ↗</DocLink>
          </>
        }
      />
      <div className="grid md:grid-cols-3 gap-3 mb-3">
        {[
          ['ACTIVE USERS', String(data?.activeUsers ?? 0)],
          ['MEMORIES STORED', String(memories)],
          ['QUERIES THIS PERIOD', String(data?.queries ?? 0)],
        ].map(([label, value]) => (
          <Panel key={label} className="p-4 min-h-[110px]">
            <p className="text-[11px] tracking-[0.12em] text-zinc-500 mb-6">{label}</p>
            <p className="text-[22px] text-zinc-200">{value}</p>
          </Panel>
        ))}
      </div>
      <Panel>
        {memories === 0 ? (
          <EmptyState icon={<Users size={18} />} title="No insights yet" body="User-level memory coverage appears after the first ingest and search." />
        ) : (
          <div className="p-4 text-[13px] text-zinc-400 space-y-2">
            {(data.tags || []).map((t: any) => (
              <p key={t.tag}>{t.tag}: {t.memories} memories · {t.documents} docs</p>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
