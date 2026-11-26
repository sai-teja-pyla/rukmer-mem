import React, { useEffect, useState } from 'react';
import { engine } from '../../services/engineClient';
import { Panel } from './ui';

export const MEMORY_KINDS = ['session', 'working', 'context', 'summary', 'preference', 'fact', 'decision'] as const;

type Policy = { tenantId: string; memoryKind: string; ttlDays: number; action: 'archive' | 'purge' };
type Access = { tenantId: string; admin: boolean };
type Gov = {
  tenants?: string[];
  tenantAccess?: Access[];
  retention?: Policy[];
  defaults?: { ttlDays?: Record<string, number>; action?: Record<string, 'archive' | 'purge'> };
};

type Draft = { ttlDays: string; action: 'archive' | 'purge' };

function keyOf(tenantId: string, kind: string) {
  return `${tenantId}:${kind}`;
}

export function RetentionCard({ compact = false }: { compact?: boolean }) {
  const [gov, setGov] = useState<Gov | null>(null);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => {
    engine
      .governance()
      .then((out: Gov) => {
        setGov(out);
        const next: Record<string, Draft> = {};
        for (const tenantId of out.tenantAccess?.map((row) => row.tenantId) || out.tenants || []) {
          for (const kind of MEMORY_KINDS) {
            const policy = (out.retention || []).find((row) => row.tenantId === tenantId && row.memoryKind === kind);
            next[keyOf(tenantId, kind)] = {
              ttlDays: String(policy ? policy.ttlDays : out.defaults?.ttlDays?.[kind] ?? ''),
              action: policy?.action || out.defaults?.action?.[kind] || 'archive',
            };
          }
        }
        setDraft(next);
        setError('');
      })
      .catch((err: Error) => setError(err.message || 'Could not load retention'));
  };

  useEffect(() => {
    load();
  }, []);

  const tenants = gov?.tenantAccess || (gov?.tenants || []).map((tenantId) => ({ tenantId, admin: false }));

  const save = async (tenantId: string, kind: string) => {
    const row = draft[keyOf(tenantId, kind)];
    if (!row) return;
    const ttlDays = Number(row.ttlDays);
    if (!Number.isFinite(ttlDays) || ttlDays < 0 || ttlDays > 3650) {
      setError('Days must be from 0 to 3650. 0 means keep.');
      return;
    }
    setBusy(keyOf(tenantId, kind));
    setError('');
    setSaved('');
    try {
      await engine.setRetention({ tenantId, memoryKind: kind, ttlDays, action: row.action });
      setSaved(`${kind} saved for ${tenantId}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save retention');
    } finally {
      setBusy('');
    }
  };

  return (
    <Panel className="p-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div>
          <p className="text-[13.5px] text-zinc-200">Retention</p>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            {compact
              ? 'How long each kind of memory is kept. 0 means keep. Org tenants are editable by owners and admins.'
              : 'Each kind uses your tenant policy, or the default when you have not set one. 0 means keep. A personal tenant is always yours to edit.'}
          </p>
        </div>
      </div>
      {error ? <p className="text-[13px] text-red-300 mb-2">{error}</p> : null}
      {saved ? <p className="text-[13px] text-emerald-300 mb-2">{saved}</p> : null}
      {!gov ? (
        <p className="text-[13px] text-zinc-500">Loading retention…</p>
      ) : (
        tenants.map((tenant) => (
          <div key={tenant.tenantId} className="mt-3 border-t border-white/[0.06] pt-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[12px] text-zinc-400 break-all">{tenant.tenantId}</p>
              {tenant.admin ? (
                <button
                  type="button"
                  onClick={() => void engine.runExpiry(tenant.tenantId).then(() => setSaved('Expiry sweep finished')).catch((err: Error) => setError(err.message))}
                  className="h-7 px-2 rounded-md border border-white/[0.08] text-[12px] text-zinc-300"
                >
                  Run expiry now
                </button>
              ) : (
                <span className="text-[12px] text-zinc-500">Read only</span>
              )}
            </div>
            <div className="space-y-2">
              {MEMORY_KINDS.map((kind) => {
                const row = draft[keyOf(tenant.tenantId, kind)] || { ttlDays: '', action: 'archive' as const };
                return (
                  <div key={kind} className="grid grid-cols-1 sm:grid-cols-[8rem_6rem_8rem_auto] gap-2 items-center">
                    <span className="text-[13px] text-zinc-200 capitalize">{kind}</span>
                    <input
                      aria-label={`${kind} days`}
                      inputMode="numeric"
                      disabled={!tenant.admin}
                      value={row.ttlDays}
                      onChange={(e) => setDraft((cur) => ({ ...cur, [keyOf(tenant.tenantId, kind)]: { ...row, ttlDays: e.target.value } }))}
                      className="h-8 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-zinc-100 disabled:text-zinc-500"
                    />
                    <select
                      aria-label={`${kind} action`}
                      disabled={!tenant.admin}
                      value={row.action}
                      onChange={(e) =>
                        setDraft((cur) => ({
                          ...cur,
                          [keyOf(tenant.tenantId, kind)]: { ...row, action: e.target.value === 'purge' ? 'purge' : 'archive' },
                        }))
                      }
                      className="h-8 px-2 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-zinc-100 disabled:text-zinc-500"
                    >
                      <option value="archive">archive</option>
                      <option value="purge">purge</option>
                    </select>
                    {tenant.admin ? (
                      <button
                        type="button"
                        disabled={busy === keyOf(tenant.tenantId, kind)}
                        onClick={() => void save(tenant.tenantId, kind)}
                        className="h-8 px-3 rounded-lg bg-[#2563eb] text-[12.5px] text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </Panel>
  );
}
