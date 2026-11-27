import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Library, Search } from 'lucide-react';
import { PageHeader, Panel, EmptyState, PrimaryButton, GhostButton, StatusBadge } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

type Doc = {
  id: string;
  title?: string;
  preview?: string;
  text?: string;
  createdAt?: string;
  source?: string;
  containerTag?: string;
  processingStatus?: string;
  memoryStatusReason?: string;
};

type Undo = { title: string; text: string; containerTag?: string };

function when(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MemoriesPage() {
  const { homeTag = '', memoryScope = 'private' } = useOutletContext<{ homeTag?: string; memoryScope?: string }>();
  const writeTag = memoryScope === 'private' ? homeTag : undefined;
  const spaceName = memoryScope === 'team' ? 'Organization' : 'Personal';
  const [docs, setDocs] = useState<Doc[]>([]);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [days, setDays] = useState(30);
  const [retentionNote, setRetentionNote] = useState('');

  const load = async () => {
    const data = await engine.listDocs(writeTag, memoryScope === 'all' ? 'all' : memoryScope);
    setDocs(data.documents || []);
  };

  useEffect(() => {
    void load().catch(() => setStatus('Could not load memories'));
    void engine
      .governance()
      .then((view) => {
        const policy = (view.retention || []).find((row: { memoryKind?: string }) => row.memoryKind === 'context' || row.memoryKind === '*');
        const fallback = Number(view.defaults?.ttlDays?.context);
        setDays(Number(policy?.ttlDays ?? (Number.isFinite(fallback) ? fallback : 30)));
      })
      .catch(() => {});
  }, [writeTag, memoryScope]);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 10000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((doc) => `${doc.title || ''} ${doc.preview || doc.text || ''}`.toLowerCase().includes(q));
  }, [docs, query]);

  const add = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setStatus('');
    try {
      await engine.ingest({ title: title.trim() || 'Memory', text: body, source: 'memory', containerTag: writeTag, scope: memoryScope === 'team' ? 'team' : 'private' });
      setTitle('');
      setText('');
      setStatus(`Saved to ${spaceName} memory`);
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: Doc) => {
    setBusy(true);
    setStatus('');
    try {
      await engine.forget(doc.id);
      setUndo({ title: doc.title || 'Memory', text: doc.preview || doc.text || '', containerTag: doc.containerTag });
      setPending(null);
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!undo) return;
    const saved = undo;
    setUndo(null);
    setBusy(true);
    try {
      await engine.ingest({ title: saved.title, text: saved.text, source: 'memory', containerTag: saved.containerTag });
      setStatus('Memory restored');
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not restore');
    } finally {
      setBusy(false);
    }
  };

  const saveRetention = async () => {
    setRetentionNote('');
    try {
      await engine.setRetention({ ttlDays: days, memoryKind: 'context', action: 'archive' });
      setRetentionNote(`Context memories are kept for ${days} days.`);
    } catch (err) {
      setRetentionNote(err instanceof Error ? err.message : 'Could not save retention');
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto min-w-0">
      <PageHeader
        title="Memories"
        subtitle="Everything Rukmer has saved for you. Search it, add a note, or delete one you do not want kept."
      />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-3">
        <div>
          <div className="flex items-center gap-2 h-9 px-2.5 mb-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e]">
            <Search size={14} className="text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories"
              aria-label="Search memories"
              className="bg-transparent text-[13px] text-zinc-100 outline-none w-full placeholder:text-zinc-500"
            />
          </div>
          <Panel>
            {shown.length === 0 ? (
              <EmptyState
                icon={<Library size={18} />}
                title={docs.length ? 'No memories match' : 'No memories yet'}
                body={docs.length ? 'Try a different search.' : 'Add a note, or import a document. It will show up here.'}
              />
            ) : (
              shown.map((doc) => (
                <div key={doc.id} className="px-4 py-3 border-t border-white/[0.06] first:border-t-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13.5px] text-zinc-100 break-words [overflow-wrap:anywhere]">{doc.title || 'Untitled memory'}</p>
                      <p className="text-[11px] text-zinc-500">{spaceName}</p>
                      <StatusBadge status={doc.processingStatus} reason={doc.memoryStatusReason} />
                      <p className="text-[12.5px] text-zinc-400 mt-1 max-h-14 overflow-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{doc.preview || doc.text || 'No text'}</p>
                      <p className="text-[11px] text-zinc-500 mt-1">{when(doc.createdAt)}{doc.source ? ` · ${doc.source}` : ''}</p>
                    </div>
                    {pending === doc.id ? (
                      <div className="shrink-0 flex items-center gap-1.5">
                        <button type="button" className="h-8 px-2.5 rounded-lg bg-red-500/20 text-[12px] text-red-100" disabled={busy} onClick={() => void remove(doc)}>
                          Delete
                        </button>
                        <GhostButton onClick={() => setPending(null)}>Cancel</GhostButton>
                      </div>
                    ) : (
                      <GhostButton onClick={() => setPending(doc.id)}>Delete</GhostButton>
                    )}
                  </div>
                </div>
              ))
            )}
          </Panel>
          {undo ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] px-3 py-2 text-[13px] text-zinc-300">
              <span>Deleted “{undo.title}”.</span>
              <button type="button" className="text-[#93c5fd] hover:underline" onClick={() => void restore()}>
                Undo
              </button>
            </div>
          ) : null}
          {status ? <p className="mt-3 text-[12.5px] text-zinc-400">{status}</p> : null}
        </div>
        <div className="space-y-3">
          <Panel className="p-4">
            <p className="text-[13px] text-zinc-200 mb-2">Add a memory</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              aria-label="Memory title"
              className="w-full h-9 px-3 mb-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What should Rukmer remember?"
              aria-label="Memory text"
              rows={5}
              className="w-full px-3 py-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-zinc-100 outline-none resize-y placeholder:text-zinc-500"
            />
            <PrimaryButton className="mt-3" disabled={!text.trim() || busy} onClick={() => void add()}>
              {busy ? 'Saving…' : 'Save memory'}
            </PrimaryButton>
          </Panel>
          <Panel className="p-4">
            <p className="text-[13px] text-zinc-200">How long to keep context</p>
            <p className="text-[12px] text-zinc-500 mt-1 mb-3">Notes and pasted context are archived after this many days. Facts and preferences keep their own schedule.</p>
            <label className="block text-[12px] text-zinc-400 mb-2">
              Days
              <input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
                className="mt-1 h-9 w-full px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-zinc-100 outline-none"
              />
            </label>
            <GhostButton onClick={() => void saveRetention()}>Save retention</GhostButton>
            {retentionNote ? <p className="mt-2 text-[12px] text-zinc-400">{retentionNote}</p> : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
