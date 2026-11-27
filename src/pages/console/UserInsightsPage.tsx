import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FileText, Users } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState, Skeleton, LoadError, StatusBadge } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

export default function UserInsightsPage() {
  const [data, setData] = useState<any>(null);
  const [folder, setFolder] = useState('All');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const seen = useRef(false);

  const load = (manual = false) => {
    if (manual) {
      setLoading(true);
      setError('');
    }
    engine
      .insights()
      .then((next) => {
        seen.current = true;
        setData(next);
        setLoaded(true);
        setError('');
      })
      .catch((e) => {
        if (!seen.current) setError(e?.message || 'Could not load insights');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const memories = data?.memories ?? 0;
  const documents: any[] = data?.documents || [];
  const folders: { name: string; count: number }[] = data?.folders || [];
  const shown = useMemo(
    () => (folder === 'All' ? documents : documents.filter((d) => d.folder === folder)),
    [documents, folder]
  );

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="User Insights"
        subtitle={
          <>
            Documents and folders in this workspace, plus memory coverage.{' '}
            <DocLink section="insights">How insights are computed ↗</DocLink>
          </>
        }
      />
      <div className="grid md:grid-cols-3 gap-3 mb-3">
        {[
          ['ACTIVE USERS', data ? String(data.activeUsers ?? 0) : ''],
          ['MEMORIES STORED', data ? String(memories) : ''],
          ['DOCUMENTS', data ? String(documents.length) : ''],
        ].map(([label, value]) => (
          <Panel key={label} className="p-4 min-h-[110px]">
            <p className="text-[11px] tracking-[0.12em] text-zinc-500 mb-6">{label}</p>
            {loading && !data ? <Skeleton className="h-7 w-16" /> : <p className="text-[22px] text-zinc-200">{data ? value : '—'}</p>}
          </Panel>
        ))}
      </div>

      <div className="grid lg:grid-cols-[240px_minmax(0,1fr)] gap-3">
        <Panel className="p-3">
          <p className="text-[12px] tracking-[0.12em] text-zinc-500 mb-2">FOLDERS</p>
          <button
            type="button"
            onClick={() => setFolder('All')}
            className={`w-full text-left h-8 px-2 rounded-md text-[13px] ${folder === 'All' ? 'bg-[#1e3a5f] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            All · {loaded ? documents.length : '—'}
          </button>
          {folders.map((f) => (
            <button
              key={f.name}
              type="button"
              onClick={() => setFolder(f.name)}
              className={`w-full text-left h-8 px-2 rounded-md text-[13px] inline-flex items-center gap-2 ${
                folder === f.name ? 'bg-[#1e3a5f] text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Folder size={13} /> {f.name} · {f.count}
            </button>
          ))}
          {!loading && data && folders.length === 0 && <p className="text-[12px] text-zinc-500 px-2 pt-2">Folders appear after you import files.</p>}
          {loading && !data ? <Skeleton className="h-8 w-full mt-2" /> : null}
        </Panel>

        <Panel>
          {loading && !data ? (
            <div className="p-4 space-y-3" aria-busy="true">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-4/5" />
            </div>
          ) : error && !loaded ? (
            <LoadError message={error} onRetry={() => load(true)} />
          ) : loaded && shown.length === 0 ? (
            <EmptyState
              icon={<Users size={18} />}
              title="No documents yet"
              body="Import files or chat in Playground. They show up here as documents and folders."
            />
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {shown.map((d) => (
                <div key={d.id} className="px-4 py-3 flex items-start gap-3">
                  <FileText size={16} className="text-zinc-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[13.5px] text-zinc-100 truncate">{d.title}</p>
                    <p className="text-[12px] text-zinc-500">
                      {d.folder} · {d.source} · {d.chars || 0} chars · {d.createdAt ? new Date(d.createdAt).toLocaleString() : ''} · <StatusBadge status={d.processingStatus} reason={d.memoryStatusReason} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
