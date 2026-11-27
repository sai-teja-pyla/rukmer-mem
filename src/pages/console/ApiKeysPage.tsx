import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Plus, X } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState, TableHead, PrimaryButton } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

export default function ApiKeysPage() {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.get('create') === '1');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<any[] | null>(null);
  const [secret, setSecret] = useState('');
  const [check, setCheck] = useState('');
  const [checkMsg, setCheckMsg] = useState('');
  const [error, setError] = useState('');
  const [nameQ, setNameQ] = useState('');
  const [sourceQ, setSourceQ] = useState('');
  const [creatorQ, setCreatorQ] = useState('');

  const load = () => {
    engine.keys({ name: nameQ, source: sourceQ, creator: creatorQ }).then((d) => setCreated(d.keys || [])).catch(() => setCreated([]));
  };

  useEffect(() => {
    load();
  }, [nameQ, sourceQ, creatorQ]);

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="API Keys"
        subtitle={
          <>
            Create keys that let your apps use the API. <DocLink section="api-keys">How API keys work ↗</DocLink>
          </>
        }
      />
      <Panel className="mb-4 p-4">
        <p className="text-[13px] text-zinc-300 mb-2">Validate a key</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={check}
            onChange={(e) => setCheck(e.target.value)}
            placeholder="rk_live_…"
            className="flex-1 h-9 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px] font-mono outline-none"
          />
          <PrimaryButton
            onClick={async () => {
              setCheckMsg('');
              try {
                const out = await engine.verifyKey(check.trim());
                setCheckMsg(out.ok ? `Valid · ${out.homeTag} · ${out.via}` : out.error || 'Invalid');
              } catch (e: any) {
                setCheckMsg(e.message || 'Invalid API key');
              }
            }}
          >
            Verify
          </PrimaryButton>
        </div>
        {checkMsg && <p className="text-[12px] text-zinc-400 mt-2">{checkMsg}</p>}
        {error && <p className="text-[12px] text-red-300 mt-2">{error}</p>}
      </Panel>

      <div className="flex flex-wrap gap-2 mb-3">
        <input value={nameQ} onChange={(e) => setNameQ(e.target.value)} placeholder="Name" className="h-8 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px]" />
        <select value={sourceQ} onChange={(e) => setSourceQ(e.target.value)} className="h-8 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px] text-zinc-300">
          <option value="">All sources</option>
          <option value="console">console</option>
          <option value="oauth">oauth</option>
          <option value="cli">cli</option>
          <option value="mcp">mcp</option>
        </select>
        <input value={creatorQ} onChange={(e) => setCreatorQ(e.target.value)} placeholder="Creator" className="h-8 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px]" />
      </div>
      <Panel>
        <TableHead cols={['API KEY', 'SOURCE', 'CREATOR', 'SCOPE', 'CREATED', 'LAST USED', 'REVOKE']} />
        <div className="relative min-h-[320px]">
          {created === null ? (
            <p className="px-4 py-8 text-[13px] text-zinc-400">Loading keys…</p>
          ) : created.length === 0 ? (
            <EmptyState
              icon={<KeyRound size={18} />}
              title="No API keys yet"
              body="Create your first key to authenticate requests to the Rukmer API."
              action={
                <div className="flex flex-col items-center gap-3">
                  <a href="/docs#api-keys" className="text-[13px] text-[#60a5fa]">
                    Learn how ↗
                  </a>
                  <PrimaryButton onClick={() => setOpen(true)}>
                    <Plus size={14} /> Create key
                  </PrimaryButton>
                </div>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              {(created || []).map((k) => (
                <div key={k.id || k.prefix} className="grid grid-cols-7 min-w-[760px] px-4 py-3 text-[13px] text-zinc-300 border-t border-white/[0.06] items-center">
                  <span className="font-mono truncate">{k.name ? `${k.name} · ${k.prefix}` : k.prefix}</span>
                  <span>{k.source || 'console'}</span>
                  <span className="truncate">{k.createdBy?.email || k.createdBy?.name || k.createdBy?.uid || '—'}</span>
                  <span>{k.scope || (k.readOnly ? 'Read-only' : 'Full')}</span>
                  <span>{k.createdAt ? new Date(k.createdAt).toLocaleDateString() : 'Just now'}</span>
                  <span>{k.lastUsed || '—'}</span>
                  <button
                    type="button"
                    className="text-left text-[12px] text-red-300 hover:text-red-200"
                    onClick={async () => {
                      if (!k.id || k.canRevoke === false) return;
                      if (!window.confirm(`Revoke ${k.name || k.prefix}?`)) return;
                      try {
                        await engine.revokeKey(k.id);
                        setCreated((p) => p.filter((row) => row.id !== k.id));
                        setError('');
                      } catch (e: any) {
                        setError(e.message || 'Could not revoke the key');
                      }
                    }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
              <div className="p-3">
                <PrimaryButton onClick={() => setOpen(true)}>
                  <Plus size={14} /> Create key
                </PrimaryButton>
              </div>
            </div>
          )}
        </div>
      </Panel>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-[#161618] p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[15px] font-medium text-white">Create API key</p>
              <button onClick={() => setOpen(false)}>
                <X size={16} className="text-zinc-500" />
              </button>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name"
              className="w-full h-9 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] outline-none mb-3"
            />
            <p className="text-[12px] text-zinc-500 mb-4">The secret is shown once. Store it in your agent config.</p>
            {secret && <p className="text-[12px] font-mono text-emerald-400 mb-3 break-all">{secret}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="h-8 px-3 text-[13px] text-zinc-400">
                Cancel
              </button>
              <PrimaryButton
                onClick={async () => {
                  try {
                    const rec = await engine.createKey(name || 'Untitled');
                    setCreated((p) => [rec, ...(p || [])]);
                    setSecret(rec.secret || '');
                    setName('');
                    setError('');
                  } catch (e: any) {
                    setError(e.message || 'Could not create a key');
                  }
                }}
              >
                Create
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
