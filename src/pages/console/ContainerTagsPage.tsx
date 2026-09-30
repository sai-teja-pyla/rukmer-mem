import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronDown, Tag, Download } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState, FilterChip, TableHead, PrimaryButton } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

export default function ContainerTagsPage() {
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<any[]>([]);

  useEffect(() => {
    engine.tags().then((d) => setTags(d.tags || [])).catch(() => {});
  }, []);

  const filtered = tags.filter((t) => t.tag.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="Container Tags"
        subtitle={
          <>
            One memory space for each project, user, or workspace. <DocLink>How container tags work ↗</DocLink>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] min-w-[220px]">
          <Search size={13} className="text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags..." className="bg-transparent text-[13px] outline-none w-full placeholder:text-zinc-600" />
        </div>
        <FilterChip>All documents <ChevronDown size={12} /></FilterChip>
        <FilterChip>All memories <ChevronDown size={12} /></FilterChip>
        <FilterChip>All activity <ChevronDown size={12} /></FilterChip>
      </div>
      <Panel>
        <TableHead cols={['CONTAINER TAG', 'DOCUMENTS', 'MEMORIES', 'ACTIVITY']} />
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Tag size={18} />}
            title="No container tags yet"
            body="Tags are created the first time you ingest with a containerTag."
            action={
              <Link to="/import">
                <PrimaryButton><Download size={14} /> Import data</PrimaryButton>
              </Link>
            }
          />
        ) : (
          <div>
            {filtered.map((t) => (
              <div key={t.tag} className="grid grid-cols-4 px-4 py-3 text-[13px] text-zinc-300 border-t border-white/[0.06]">
                <span className="text-zinc-100">{t.tag}</span>
                <span>{t.documents}</span>
                <span>{t.memories}</span>
                <span className="text-zinc-500">{t.activity ? new Date(t.activity).toLocaleString() : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
