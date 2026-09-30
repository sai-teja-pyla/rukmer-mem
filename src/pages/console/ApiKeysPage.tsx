import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, X } from 'lucide-react';
import { PageHeader, DocLink, Panel, EmptyState, TableHead, PrimaryButton } from '../../components/console/ui';
import { engine } from '../../services/engineClient';

export default function ApiKeysPage() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<any[]>([]);
  const [secret, setSecret] = useState('');

  useEffect(() => {
    engine.keys().then((d) => setCreated(d.keys || [])).catch(() => {});
  }, []);

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="API Keys"
        subtitle={
          <>
            Create keys that let your apps use the API. <DocLink>How API keys work ↗</DocLink>
          </>
        }
      />
      <Panel>
        <TableHead cols={['API KEY', 'SCOPE', 'CREATED', 'LAST USED', 'EXPIRES']} />
        <div className="relative min-h-[320px]">
          {created.length === 0 ? (
            <EmptyState
              icon={<KeyRound size={18} />}
              title="No API keys yet"
              body="Create your first key to authenticate requests to the Rukmer API."
              action={
                <div className="flex flex-col items-center gap-3">
                  <a href="/docs" className="text-[13px] text-[#60a5fa]">
                    Learn how ↗
                  </a>
                  <PrimaryButton onClick={() => setOpen(true)}>
                    <Plus size={14} /> Create key
                  </PrimaryButton>
                </div>
              }
            />
          ) : (
            <div>
              {created.map((k) => (
                <div key={k.id || k.prefix} className="grid grid-cols-5 px-4 py-3 text-[13px] text-zinc-300 border-t border-white/[0.06]">
                  <span className="font-mono">{k.prefix}</span>
                  <span>Full</span>
                  <span>{k.createdAt ? new Date(k.createdAt).toLocaleDateString() : 'Just now'}</span>
                  <span>{k.lastUsed || '—'}</span>
                  <span>{k.expires || 'Never'}</span>
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
                  const rec = await engine.createKey(name || 'Untitled');
                  setCreated((p) => [rec, ...p]);
                  setSecret(rec.secret || '');
                  setName('');
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
