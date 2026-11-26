import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Library, Plus, Trash2 } from 'lucide-react';
import { engine } from '../../services/engineClient';
import { PageHeader, Panel, EmptyState, PrimaryButton } from '../../components/console/ui';
import { ScopeFilter, type MemoryScope } from '../../components/console/ScopeFilter';
import { RetentionCard, MEMORY_KINDS } from '../../components/console/RetentionCard';
import { MemoriesStatus, memoriesListView } from './memoryStates';
import type { UserProfile } from '../../types';

type MemoryRow = {
  id: string;
  recordType: 'document' | 'fact';
  title: string;
  text: string;
  preview: string;
  source: string;
  kind: string;
  containerTag: string;
  visibility: string;
  teamId: string;
  ownerId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  archived: boolean;
  forgotten: boolean;
  deletedAt: string | null;
  canErase: boolean;
  canEdit: boolean;
};

type ListResponse = { memories?: MemoryRow[]; nextCursor?: string | null; total?: number };
type Team = { id: string; name: string };
type FormState = { id: string; text: string; title: string; kind: string; containerTag: string; visibility: 'private' | 'team'; teamId: string };
type ConfirmState = { title: string; body: string; confirm: string; danger?: boolean; run: () => Promise<void> };
type Cluster = { reason: string; score: number; keep: MemoryRow; drop: MemoryRow[] };

const field = 'h-8 w-full px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-zinc-100 outline-none';

function when(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function messageOf(err: unknown) {
  return err instanceof Error && err.message ? err.message : 'Something went wrong';
}

const emptyForm = (): FormState => ({ id: '', text: '', title: '', kind: 'context', containerTag: '', visibility: 'private', teamId: '' });

export default function MemoriesPage() {
  const ctx = useOutletContext<{ user: UserProfile; memoryScope?: MemoryScope; setMemoryScope?: (scope: MemoryScope) => void }>();
  const memoryScope = ctx?.memoryScope || 'all';
  const uid = ctx?.user?.uid || '';
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [kind, setKind] = useState('');
  const [containerTag, setContainerTag] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [trash, setTrash] = useState(false);
  const [cursor, setCursor] = useState('');
  const [prevCursors, setPrevCursors] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [detail, setDetail] = useState<MemoryRow | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [cleanup, setCleanup] = useState(false);
  const [cleanupError, setCleanupError] = useState('');
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [junk, setJunk] = useState<MemoryRow[]>([]);
  const [expired, setExpired] = useState<MemoryRow[]>([]);
  const [toast, setToast] = useState<{ ids: string[]; label: string } | null>(null);

  const filters = useMemo(
    () => ({ q, source, kind, containerTag, from, to, scope: memoryScope, onlyDeleted: trash, cursor, tick }),
    [q, source, kind, containerTag, from, to, memoryScope, trash, cursor, tick]
  );

  useEffect(() => {
    let cancel = false;
    setPhase('loading');
    setError('');
    engine
      .listMemories({
        q: filters.q,
        source: filters.source,
        kind: filters.kind,
        containerTag: filters.containerTag,
        scope: filters.scope,
        from: filters.from,
        to: filters.to,
        onlyDeleted: filters.onlyDeleted,
        limit: 50,
        cursor: filters.cursor,
      })
      .then((out: ListResponse) => {
        if (cancel) return;
        setRows(out.memories || []);
        setTotal(Number(out.total || 0));
        setNextCursor(out.nextCursor || null);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancel) return;
        setRows([]);
        setTotal(0);
        setError(messageOf(err));
        setPhase('error');
      });
    return () => {
      cancel = true;
    };
  }, [filters]);

  useEffect(() => {
    engine.tags(memoryScope).then((out: { tags?: { tag: string }[] }) => setTags((out.tags || []).map((row) => row.tag))).catch(() => setTags([]));
    engine.teams().then((out: { teams?: Team[] }) => setTeams(out.teams || [])).catch(() => setTeams([]));
  }, [memoryScope, tick]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 10000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const view = memoriesListView(phase, rows.length);
  const filtered = q || source || kind || containerTag || from || to || trash || memoryScope !== 'all';
  const reload = () => setTick((n) => n + 1);

  const resetPage = () => {
    setCursor('');
    setPrevCursors([]);
  };

  const softDelete = (ids: string[]) => {
    setConfirm({
      title: ids.length === 1 ? 'Delete this memory?' : `Delete ${ids.length} memories?`,
      body: 'They leave search and the graph. You can undo for a few seconds, or restore them from Recently deleted.',
      confirm: 'Delete',
      run: async () => {
        await engine.forgetMemories({ ids });
        setToast({ ids, label: ids.length === 1 ? 'Memory deleted' : `${ids.length} memories deleted` });
        setPicked([]);
        setDetail(null);
        reload();
      },
    });
  };

  const hardDelete = (ids: string[]) => {
    setConfirm({
      title: ids.length === 1 ? 'Delete permanently?' : `Permanently delete ${ids.length} memories?`,
      body: 'This cannot be undone. The text, chunks, and file are removed.',
      confirm: 'Delete permanently',
      danger: true,
      run: async () => {
        await engine.forgetMemories({ ids, permanent: true });
        setToast(null);
        setPicked([]);
        setDetail(null);
        reload();
      },
    });
  };

  const saveForm = async () => {
    if (!form) return;
    setSaving(true);
    setFormError('');
    try {
      if (form.id) {
        await engine.updateMemory(form.id, { text: form.text, title: form.title, kind: form.kind });
      } else {
        await engine.createMemory({
          text: form.text,
          title: form.title,
          kind: form.kind,
          containerTag: form.containerTag || undefined,
          visibility: form.visibility,
          teamId: form.visibility === 'team' ? form.teamId : undefined,
        });
      }
      setForm(null);
      resetPage();
      reload();
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const openCleanup = async () => {
    setCleanup(true);
    setCleanupError('');
    try {
      const [dup, junkOut, expiredOut] = await Promise.all([
        engine.findDuplicates({ dryRun: true }),
        engine.forgetMatching({ junk: true, dryRun: true }),
        engine.forgetMatching({ expired: true, dryRun: true }),
      ]);
      setClusters(dup.clusters || []);
      setJunk(junkOut.items || []);
      setExpired(expiredOut.items || []);
    } catch (err) {
      setCleanupError(messageOf(err));
    }
  };

  const author = (row: MemoryRow) => row.createdBy === uid || row.ownerId === uid;

  return (
    <div className="max-w-[1100px]">
      <PageHeader
        title="Memories"
        subtitle="Everything this account can read. Add a missing note, or delete one you do not want recalled."
        action={
          <div className="flex gap-2">
            <button type="button" onClick={() => void openCleanup()} className="h-9 px-3 rounded-lg border border-white/[0.08] text-[13px] text-zinc-200">
              Clean up
            </button>
            <PrimaryButton onClick={() => { setForm(emptyForm()); setFormError(''); }}>
              <Plus size={14} /> Add memory
            </PrimaryButton>
          </div>
        }
      />

      <Panel className="mb-3 p-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2">
          <input aria-label="Search memories" value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }} placeholder="Search" className={`${field} lg:max-w-xs`} />
          <ScopeFilter value={memoryScope} onChange={(scope) => { ctx?.setMemoryScope?.(scope); resetPage(); }} />
          <button
            type="button"
            aria-pressed={trash}
            onClick={() => { setTrash((on) => !on); resetPage(); }}
            className={`h-8 px-2.5 rounded-md text-[12px] border ${trash ? 'bg-white/[0.08] border-white/[0.14] text-zinc-100' : 'border-white/[0.08] text-zinc-400'}`}
          >
            Recently deleted
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-2">
          <input aria-label="Source" value={source} onChange={(e) => { setSource(e.target.value); resetPage(); }} placeholder="Source" className={field} />
          <select aria-label="Kind" value={kind} onChange={(e) => { setKind(e.target.value); resetPage(); }} className={field}>
            <option value="">All kinds</option>
            {MEMORY_KINDS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Container tag" value={containerTag} onChange={(e) => { setContainerTag(e.target.value); resetPage(); }} className={field}>
            <option value="">All tags</option>
            {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
          <input aria-label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); resetPage(); }} className={field} />
          <input aria-label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); resetPage(); }} className={field} />
        </div>
      </Panel>

      <Panel className="mb-4">
        {view === 'loading' || view === 'error' ? (
          <MemoriesStatus phase={view} onRetry={reload} />
        ) : view === 'empty' && !filtered ? (
          <MemoriesStatus phase="empty" onRetry={reload} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Library size={18} />} title={trash ? 'Nothing deleted recently' : 'No memories match'} body="Try another search or filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="text-[11px] tracking-wide text-zinc-500">
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2 font-medium">Memory</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Visibility</th>
                  <th className="px-3 py-2 font-medium">Tag</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-white/[0.06] text-[13px] text-zinc-300 hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.title || row.id}`}
                        checked={picked.includes(row.id)}
                        onChange={() => setPicked((cur) => cur.includes(row.id) ? cur.filter((id) => id !== row.id) : [...cur, row.id])}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setDetail(row)} className="text-left">
                        <span className="block text-zinc-100">{row.title || 'Untitled'}</span>
                        <span className="block text-[12px] text-zinc-500 line-clamp-2">{row.preview}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2">{row.source}</td>
                    <td className="px-3 py-2">{row.kind}</td>
                    <td className="px-3 py-2">{row.visibility}</td>
                    <td className="px-3 py-2 max-w-[10rem] truncate">{row.containerTag}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{when(row.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.expiresAt ? when(row.expiresAt) : 'Keep'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {phase === 'ready' && total > rows.length ? (
          <div className="flex items-center justify-between px-3 py-2 border-t border-white/[0.06] text-[12px] text-zinc-500">
            <span>{total} memories</span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={!prevCursors.length}
                onClick={() => {
                  const stack = prevCursors.slice(0, -1);
                  setCursor(prevCursors[prevCursors.length - 1] || '');
                  setPrevCursors(stack);
                }}
                className="h-7 px-2 rounded-md border border-white/[0.08] disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!nextCursor}
                onClick={() => {
                  if (!nextCursor) return;
                  setPrevCursors((cur) => [...cur, cursor]);
                  setCursor(nextCursor);
                }}
                className="h-7 px-2 rounded-md border border-white/[0.08] disabled:opacity-40"
              >
                Next
              </button>
            </span>
          </div>
        ) : null}
      </Panel>

      {picked.length ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl border border-white/[0.1] bg-[#16161a] px-3 py-2 shadow-lg">
          <span className="text-[13px] text-zinc-200">{picked.length} selected</span>
          <button type="button" onClick={() => softDelete(picked)} className="h-8 px-2.5 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-100">Delete</button>
          <button type="button" onClick={() => hardDelete(picked)} className="h-8 px-2.5 rounded-lg border border-red-500/30 text-[12.5px] text-red-300">Delete permanently</button>
        </div>
      ) : null}

      <div className="mb-6">
        <RetentionCard />
      </div>

      {detail ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setDetail(null)}>
          <aside className="h-full w-full max-w-md bg-[#111113] border-l border-white/[0.08] p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[16px] font-medium text-zinc-100">{detail.title || 'Memory'}</h2>
              <button type="button" aria-label="Close" onClick={() => setDetail(null)} className="text-zinc-400 text-[13px]">Close</button>
            </div>
            <p className="text-[12px] text-zinc-500 mt-1">{detail.source} · {detail.kind} · {detail.visibility} · {detail.containerTag}</p>
            <p className="text-[13px] text-zinc-200 whitespace-pre-wrap mt-4">{detail.text}</p>
            <p className="text-[12px] text-zinc-500 mt-3">Created {when(detail.createdAt)} · Expires {detail.expiresAt ? when(detail.expiresAt) : 'never'}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {detail.canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setForm({ id: detail.id, text: detail.text, title: detail.title, kind: detail.kind, containerTag: detail.containerTag, visibility: detail.visibility === 'team' ? 'team' : 'private', teamId: detail.teamId });
                    setFormError('');
                  }}
                  className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-100"
                >
                  Edit
                </button>
              ) : null}
              {detail.canErase ? (
                <button type="button" onClick={() => softDelete([detail.id])} className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-100">Delete</button>
              ) : null}
              {detail.canErase ? (
                <button type="button" onClick={() => hardDelete([detail.id])} className="h-8 px-3 rounded-lg border border-red-500/30 text-[12.5px] text-red-300">Delete permanently</button>
              ) : null}
              {author(detail) ? (
                <button
                  type="button"
                  onClick={() => {
                    const to = detail.visibility === 'team' ? 'private' : 'team';
                    const teamId = to === 'team' ? detail.teamId || teams[0]?.id : undefined;
                    if (to === 'team' && !teamId) {
                      setError('Create a team before moving this memory.');
                      return;
                    }
                    void engine.moveMemory(detail.id, to, teamId).then(() => { setDetail(null); reload(); }).catch((err: unknown) => setError(messageOf(err)));
                  }}
                  className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-100"
                >
                  {detail.visibility === 'team' ? 'Move to private' : 'Move to team'}
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {form ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-white/[0.08] bg-[#111113] p-4">
            <h2 className="text-[16px] font-medium text-zinc-100">{form.id ? 'Edit memory' : 'Add memory'}</h2>
            <label className="block text-[12px] text-zinc-500 mt-3 mb-1" htmlFor="memory-text">Text</label>
            <textarea id="memory-text" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={5} className="w-full px-2.5 py-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-zinc-100 outline-none" />
            <label className="block text-[12px] text-zinc-500 mt-3 mb-1" htmlFor="memory-title">Title</label>
            <input id="memory-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={field} />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <select aria-label="Memory kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={field}>
                {MEMORY_KINDS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              {form.id ? null : (
                <select aria-label="Visibility" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value === 'team' ? 'team' : 'private' })} className={field}>
                  <option value="private">Private</option>
                  <option value="team">Team</option>
                </select>
              )}
            </div>
            {form.id ? null : (
              <div className="grid grid-cols-1 gap-2 mt-2">
                <select aria-label="Container" value={form.containerTag} onChange={(e) => setForm({ ...form, containerTag: e.target.value })} className={field}>
                  <option value="">Home tag</option>
                  {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                </select>
                {form.visibility === 'team' ? (
                  <select aria-label="Team" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} className={field}>
                    <option value="">Choose a team</option>
                    {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                ) : null}
              </div>
            )}
            {formError ? <p className="text-[13px] text-red-300 mt-2">{formError}</p> : null}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setForm(null)} className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-300">Cancel</button>
              <button type="button" disabled={saving || !form.text.trim()} onClick={() => void saveForm()} className="h-8 px-3 rounded-lg bg-[#2563eb] text-[12.5px] text-white disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-[#111113] p-4">
            <h2 className="text-[16px] font-medium text-zinc-100">{confirm.title}</h2>
            <p className="text-[13px] text-zinc-400 mt-2">{confirm.body}</p>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setConfirm(null)} className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-300">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  const job = confirm.run();
                  setConfirm(null);
                  void job.catch((err: unknown) => setError(messageOf(err)));
                }}
                className={`h-8 px-3 rounded-lg text-[12.5px] text-white ${confirm.danger ? 'bg-red-600' : 'bg-[#2563eb]'}`}
              >
                {confirm.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cleanup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-white/[0.08] bg-[#111113] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-medium text-zinc-100">Clean up</h2>
              <button type="button" onClick={() => setCleanup(false)} className="text-[13px] text-zinc-400">Close</button>
            </div>
            <p className="text-[12px] text-zinc-500 mt-1">Nothing is deleted until you confirm a preview.</p>
            {cleanupError ? <p className="text-[13px] text-red-300 mt-2">{cleanupError}</p> : null}
            <CleanupBlock
              title="Duplicates"
              empty="No duplicates to clean."
              count={clusters.reduce((n, cluster) => n + cluster.drop.length, 0)}
              onConfirm={() => {
                setConfirm({
                  title: 'Remove duplicate memories?',
                  body: 'The newest copy is kept. The others are deleted and can be undone for a few seconds.',
                  confirm: 'Remove duplicates',
                  run: async () => {
                    const out = await engine.findDuplicates({ dryRun: false });
                    const ids = (out.clusters || []).flatMap((cluster: Cluster) => cluster.drop.map((row) => row.id));
                    if (ids.length) setToast({ ids, label: 'Duplicates removed' });
                    setCleanup(false);
                    reload();
                  },
                });
              }}
            >
              {clusters.length ? clusters.map((cluster) => (
                <p key={cluster.keep.id} className="text-[13px] text-zinc-300">
                  Keep “{cluster.keep.title || cluster.keep.preview}”. Drop {cluster.drop.length} {cluster.reason} {cluster.reason === 'near' ? `(${cluster.score})` : ''}.
                </p>
              )) : null}
            </CleanupBlock>
            <CleanupBlock
              title="Junk chats"
              empty="No auto-saved model chats."
              count={junk.length}
              onConfirm={() => {
                const ids = junk.map((row) => row.id);
                setConfirm({
                  title: `Delete ${ids.length} junk chats?`,
                  body: 'These are assistant replies saved as gemini-router, openai-router, anthropic-router, or grok-router. Notes you added stay.',
                  confirm: 'Delete junk',
                  run: async () => {
                    await engine.forgetMatching({ junk: true, dryRun: false });
                    setToast({ ids, label: 'Junk chats deleted' });
                    setCleanup(false);
                    reload();
                  },
                });
              }}
            >
              {junk.slice(0, 8).map((row) => <p key={row.id} className="text-[13px] text-zinc-300">{row.source}: {row.preview}</p>)}
            </CleanupBlock>
            <CleanupBlock
              title="Expired"
              empty="Nothing is past its expiry."
              count={expired.length}
              onConfirm={() => {
                const ids = expired.map((row) => row.id);
                setConfirm({
                  title: `Delete ${ids.length} expired memories?`,
                  body: 'These are past their expiry and have not been purged yet.',
                  confirm: 'Delete expired',
                  run: async () => {
                    await engine.forgetMatching({ expired: true, dryRun: false });
                    setToast({ ids, label: 'Expired memories deleted' });
                    setCleanup(false);
                    reload();
                  },
                });
              }}
            >
              {expired.slice(0, 8).map((row) => <p key={row.id} className="text-[13px] text-zinc-300">{row.preview}</p>)}
            </CleanupBlock>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-white/[0.1] bg-[#16161a] px-3 py-2 shadow-lg">
          <Trash2 size={14} className="text-zinc-400" />
          <span className="text-[13px] text-zinc-100">{toast.label}</span>
          <button
            type="button"
            onClick={() => {
              const ids = toast.ids;
              setToast(null);
              void engine.restoreMemories({ ids }).then(reload).catch((err: unknown) => setError(messageOf(err)));
            }}
            className="text-[13px] text-[#60a5fa]"
          >
            Undo
          </button>
        </div>
      ) : null}
      {error && phase === 'ready' ? <p className="text-[13px] text-red-300 mt-2">{error}</p> : null}
    </div>
  );
}

function CleanupBlock({
  title,
  empty,
  count,
  onConfirm,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 border-t border-white/[0.06] pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13.5px] text-zinc-200">{title}</p>
        {count ? (
          <button type="button" onClick={onConfirm} className="h-7 px-2 rounded-md border border-white/[0.08] text-[12px] text-zinc-200">
            Delete {count}
          </button>
        ) : null}
      </div>
      <div className="mt-2 space-y-1">{count ? children : <p className="text-[13px] text-zinc-500">{empty}</p>}</div>
    </div>
  );
}
