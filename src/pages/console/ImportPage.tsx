import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Upload, Zap, Plus } from 'lucide-react';
import { PageHeader, DocLink, Panel, PrimaryButton, GhostButton } from '../../components/console/ui';
import { engine } from '../../services/engineClient';
import type { UserProfile } from '../../types';
import { homeTag as makeHomeTag } from '../../services/tenancy';

const TYPES = ['TXT', 'MD', 'JSON', 'CSV', 'HTML', 'PDF'];

export default function ImportPage() {
  const { user, homeTag } = useOutletContext<{ user: UserProfile; homeTag: string }>();
  const mine = homeTag || makeHomeTag(user.uid);
  const [url, setUrl] = useState('');
  const [staged, setStaged] = useState<{ title: string; text?: string; pdfBase64?: string; mime?: string; source: string }[]>([]);
  const [tag, setTag] = useState(mine);
  const [tags, setTags] = useState<string[]>(mine ? [mine] : []);
  const [task, setTask] = useState<'memory' | 'rag'>('memory');
  const [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const refresh = () => {
    engine.tags().then((d) => setTags([...new Set([mine, ...(d.tags || []).map((t: any) => t.tag)].filter(Boolean))])).catch(() => {});
    engine.jobs().then((d) => setJobs(d.jobs || [])).catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next: { title: string; text?: string; pdfBase64?: string; mime?: string; source: string }[] = [];
    for (const file of Array.from(list)) {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        bytes.forEach((b) => {
          binary += String.fromCharCode(b);
        });
        next.push({
          title: file.name,
          pdfBase64: btoa(binary),
          mime: 'application/pdf',
          source: 'pdf',
        });
      } else {
        const text = await file.text();
        next.push({ title: file.name, text, mime: file.type || 'text/plain', source: 'upload' });
      }
    }
    setStaged((p) => [...p, ...next]);
  };

  const runImport = async () => {
    if (!staged.length) return;
    setBusy(true);
    setStatus('Embedding and indexing…');
    try {
      await engine.ingestBatch({ containerTag: tag, task, documents: staged });
      setStaged([]);
      setStatus('Import complete');
      refresh();
    } catch (e: any) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="Import"
        subtitle={
          <>
            Add content to your memory layer. <DocLink>What you can add ↗</DocLink>
          </>
        }
      />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-3">
        <div className="space-y-3">
          <label
            className="block rounded-xl border border-dashed border-white/[0.12] bg-[#111113] px-6 py-12 text-center cursor-pointer hover:border-white/[0.2]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            <input type="file" multiple className="hidden" accept=".txt,.md,.json,.csv,.html,.htm,.pdf,application/pdf" onChange={(e) => addFiles(e.target.files)} />
            <div className="mx-auto h-10 w-10 rounded-lg border border-white/[0.08] flex items-center justify-center text-zinc-500 mb-3">
              <Upload size={18} />
            </div>
            <p className="text-[14px] text-zinc-200">Drop files here or click to browse</p>
            <div className="flex flex-wrap justify-center gap-1.5 mt-3">
              {TYPES.map((t) => (
                <span key={t} className="h-6 px-2 rounded-md border border-white/[0.08] text-[11px] text-zinc-500">
                  {t}
                </span>
              ))}
            </div>
          </label>

          <Panel className="p-4">
            <p className="text-[13px] text-zinc-300 mb-2">Add from the web</p>
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="flex-1 h-9 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] outline-none"
              />
              <GhostButton
                onClick={async () => {
                  if (!url.trim()) return;
                  setBusy(true);
                  try {
                    await engine.ingest({ url: url.trim(), containerTag: tag, task });
                    setUrl('');
                    setStatus('URL ingested');
                    refresh();
                  } catch (e: any) {
                    setStatus(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Plus size={14} /> Add
              </GhostButton>
            </div>
          </Panel>

          <Panel>
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.06]">
              <div>
                <p className="text-[13.5px] text-zinc-200">Container tag</p>
                <p className="text-[12px] text-zinc-500">Group this import under one tag.</p>
              </div>
              <select
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="h-8 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300"
              >
                {tags.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between px-4 py-3.5">
              <div>
                <p className="text-[13.5px] text-zinc-200">Task type</p>
                <p className="text-[12px] text-zinc-500 max-w-md">Memory extracts a fact graph. SuperRAG skips graph extraction for speed.</p>
              </div>
              <div className="inline-flex rounded-lg border border-white/[0.08] p-0.5 bg-[#0c0c0e]">
                <button onClick={() => setTask('memory')} className={`h-8 px-3 rounded-md text-[13px] ${task === 'memory' ? 'bg-[#1e3a5f] text-white' : 'text-zinc-400'}`}>Memory</button>
                <button onClick={() => setTask('rag')} className={`h-8 px-3 rounded-md text-[13px] ${task === 'rag' ? 'bg-[#1e3a5f] text-white' : 'text-zinc-400'}`}>SuperRAG</button>
              </div>
            </div>
            <div className="px-4 py-2 text-[12px] text-zinc-500 space-y-1">
              {staged.map((s) => (
                <p key={s.title}>
                  • {s.title} {s.pdfBase64 ? '(PDF)' : `(${(s.text || '').length} chars)`}
                </p>
              ))}
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-[11px] tracking-[0.12em] text-zinc-500">{staged.length ? `${staged.length} staged` : 'NOTHING STAGED YET'}</p>
              <PrimaryButton onClick={runImport} className={!staged.length || busy ? 'opacity-50 pointer-events-none' : ''}>
                {busy ? 'Working…' : 'Import'}
              </PrimaryButton>
            </div>
            {status && <p className="px-4 pb-3 text-[12px] text-zinc-400">{status}</p>}
          </Panel>
        </div>

        <Panel className="min-h-[220px] p-4">
          <p className="text-[13.5px] text-zinc-200 mb-4">Processing</p>
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-10">
              <Zap size={18} className="text-zinc-600 mb-2" />
              <p className="text-[14px] text-zinc-200">Nothing in flight</p>
              <p className="text-[12.5px] text-zinc-500 mt-1">Imports appear here while they process.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id} className="rounded-lg border border-white/[0.06] p-2.5 text-[12px] text-zinc-400">
                  <span className="text-emerald-400">{j.status}</span> · {j.message}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
