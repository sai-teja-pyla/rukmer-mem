import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState, TableHead } from '../../components/console/ui';
import { engine } from '../../services/engineClient';
import { useMemoryResource } from '../../hooks/useMemoryResource';
import { ContainerTagsStatus, TagRows, resourceView, type TagRow } from './memoryStates';

export default function ContainerTagsPage() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'documents' | 'memories'>('all');
  const resource = useMemoryResource(() => engine.tags() as Promise<{ tags?: TagRow[] }>);
  const tags = resource.data?.tags || [];
  const view = resourceView(resource.phase, tags.length);

  const filtered = tags.filter((row) => {
    if (!row.tag.toLowerCase().includes(q.toLowerCase())) return false;
    if (kind === 'documents') return Number(row.documents) > 0;
    if (kind === 'memories') return Number(row.memories) > 0;
    return true;
  });

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="Container Tags"
        subtitle={
          <>
            One memory space for each project, user, or workspace. <DocLink section="container-tags">How container tags work ↗</DocLink>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] min-w-[220px]">
          <Search size={13} className="text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags..." className="bg-transparent text-[13px] outline-none w-full placeholder:text-zinc-600" />
        </div>
        {(['all', 'documents', 'memories'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setKind(id)}
            className={`h-8 px-3 rounded-lg border text-[12.5px] ${kind === id ? 'border-blue-400/40 bg-blue-500/10 text-white' : 'border-white/[0.08] bg-[#0c0c0e] text-zinc-300'}`}
          >
            {id === 'all' ? 'All tags' : id === 'documents' ? 'Has documents' : 'Has memories'}
          </button>
        ))}
      </div>
      <Panel>
        <TableHead cols={['CONTAINER TAG', 'DOCUMENTS', 'MEMORIES', 'ACTIVITY']} />
        {view === 'ready' && filtered.length > 0 ? (
          <TagRows tags={filtered} />
        ) : view === 'ready' ? (
          <EmptyState icon={<Search size={18} />} title="No tags match" body="Try a different search or filter." />
        ) : (
          <ContainerTagsStatus phase={view} onRetry={resource.retry} />
        )}
      </Panel>
    </div>
  );
}
