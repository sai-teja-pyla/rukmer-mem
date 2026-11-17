import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Shield, Monitor, Lock, RotateCcw, Download, LogOut } from 'lucide-react';
import { PageHeader, DocLink, Panel, Row, Toggle, PrimaryButton, GhostButton, CopyField } from '../../components/console/ui';
import type { UserProfile } from '../../types';
import { loadProviderKeys, saveProviderKeys, type ProviderKeys } from '../../services/providerKeys';
import { engine } from '../../services/engineClient';
import { auth } from '../../firebase';
import { signOut } from 'firebase/auth';
import { useUserSettings } from '../../hooks/useUserSettings';

type Ctx = { user: UserProfile; displayName: string; homeTag?: string };

const BUCKETS = [
  'Preferences', 'Interests', 'Goals', 'Work', 'Relationships', 'Health',
  'Skills', 'Finances', 'Education', 'Travel', 'Values', 'Projects',
];

const ORG_KEY = 'rukmer.orgSettings';

function loadOrgSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORG_KEY) || '{}');
    return {
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Rukmer',
      context: !!parsed.context,
      buckets: Array.isArray(parsed.buckets) ? parsed.buckets.filter((b: unknown) => typeof b === 'string') : [],
    };
  } catch {
    return { name: 'Rukmer', context: false, buckets: [] as string[] };
  }
}

async function downloadExport() {
  const data = await engine.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rukmer-export.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function GeneralSettingsPage() {
  const savedOrg = loadOrgSettings();
  const [orgName, setOrgName] = useState(savedOrg.name);
  const [orgContext, setOrgContext] = useState(savedOrg.context);
  const [buckets, setBuckets] = useState<string[]>(savedOrg.buckets);
  const { homeTag } = useOutletContext<Ctx>();
  const [orgId, setOrgId] = useState(homeTag || 'your-private-memory');
  useEffect(() => {
    engine
      .teams()
      .then((out) => setOrgId(out.teams?.[0]?.orgId || homeTag || 'your-private-memory'))
      .catch(() => setOrgId(homeTag || 'your-private-memory'));
  }, [homeTag]);
  const { settings, updateSettings } = useUserSettings();
  const light = (settings?.consoleTheme || localStorage.getItem('consoleTheme')) === 'light';
  const persistOrg = (next: { name?: string; context?: boolean; buckets?: string[] }) => {
    const value = { name: next.name ?? orgName, context: next.context ?? orgContext, buckets: next.buckets ?? buckets };
    localStorage.setItem(ORG_KEY, JSON.stringify(value));
  };

  return (
    <div className="max-w-[920px]">
      <PageHeader
        title="General"
        subtitle={
          <>
            Your organization's context and preferences. <DocLink section="profiles">How profiles work ↗</DocLink>
          </>
        }
      />
      <Panel>
        <div className="px-4 py-3 text-[13.5px] text-zinc-200">Organization</div>
        <Row label="Appearance" hint="Dark is the default. Switch the console to a white theme.">
          <button
            type="button"
            onClick={() => {
              const next = light ? 'dark' : 'light';
              localStorage.setItem('consoleTheme', next);
              void updateSettings({ consoleTheme: next });
            }}
            className="h-8 px-3 rounded-lg border border-white/[0.1] text-[13px] text-zinc-200"
          >
            {light ? 'Light' : 'Dark'}
          </button>
        </Row>
        <Row label="Organization name" hint="The public name of your organization.">
          <input
            value={orgName}
            onChange={(e) => {
              setOrgName(e.target.value);
              persistOrg({ name: e.target.value });
            }}
            className="h-8 w-56 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-right outline-none"
          />
        </Row>
        <Row label="Organization ID" hint="Used in CLI and API calls.">
          <CopyField value={orgId} />
        </Row>
        <Row label="Require two-factor for all members" hint="Authenticator app codes are coming after private beta.">
          <span className="text-[11px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5">Coming soon</span>
        </Row>
        <Row label="Organization context" hint="Filters what gets stored during ingestion, guided by a description of your organization.">
          <Toggle
            on={orgContext}
            onClick={() => {
              const next = !orgContext;
              setOrgContext(next);
              persistOrg({ context: next });
            }}
          />
        </Row>
        <div className="px-4 py-4 border-t border-white/[0.06]">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-[13.5px] text-zinc-200">Profile buckets</p>
              <p className="text-[12px] text-zinc-500 mt-0.5 max-w-sm">
                Extra topical groups memories get sorted into. Hover a bucket to see what it collects.
              </p>
            </div>
            <div className="flex-1 max-w-md">
              <div className="flex gap-2 mb-2 text-[11px] text-zinc-500">
                <span className="inline-flex items-center gap-1"><Lock size={11} /> Static</span>
                <span className="inline-flex items-center gap-1"><Lock size={11} /> Dynamic</span>
                <span className="ml-auto tracking-[0.12em]">PRESETS</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {BUCKETS.map((b) => {
                  const on = buckets.includes(b);
                  return (
                    <button
                      key={b}
                      onClick={() => {
                        const next = on ? buckets.filter((x) => x !== b) : [...buckets, b];
                        setBuckets(next);
                        persistOrg({ buckets: next });
                      }}
                      className={`h-7 px-2.5 rounded-md border text-[12px] ${
                        on ? 'border-blue-400/40 bg-blue-500/10 text-zinc-100' : 'border-white/[0.08] text-zinc-400'
                      }`}
                    >
                      + {b}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-md border border-white/[0.08] text-[12px] text-zinc-400"
                  onClick={() => {
                    const name = window.prompt('Bucket name')?.trim();
                    if (!name || buckets.includes(name)) return;
                    const next = [...buckets, name];
                    setBuckets(next);
                    persistOrg({ buckets: next });
                  }}
                >
                  + Custom bucket
                </button>
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function TeamSettingsPage() {
  const { user, displayName } = useOutletContext<Ctx>();
  const [data, setData] = useState<any>({ teams: [] });
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState('');
  const [teamId, setTeamId] = useState('');
  const load = () => {
    engine
      .teams()
      .then((out) => {
        setData(out);
        setTeamId((cur) => cur || out.teams?.[0]?.id || '');
        setError('');
      })
      .catch((err) => setError(err.message || 'Could not load the team'));
  };
  useEffect(() => {
    load();
  }, []);
  const team = (data.teams || []).find((row: { id: string }) => row.id === teamId) || data.teams?.[0];
  const mine = team?.members?.find((row: { uid: string }) => row.uid === user.uid);
  const canAdmin = mine?.role === 'owner' || mine?.role === 'admin';
  const start = async () => {
    setError('');
    try {
      await engine.bootstrapTeam('Rukmer', displayName);
      load();
    } catch (err: any) {
      setError(err.message || 'Could not create the team brain');
    }
  };
  const inviteTeammate = async () => {
    if (!team) return;
    setError('');
    try {
      const created = await engine.createInvite(team.id, 'member');
      setInvite(created);
      load();
    } catch (err: any) {
      setError(err.message || 'Could not create an invite');
    }
  };
  return (
    <div className="max-w-[1100px]">
      <PageHeader
        title="Team"
        subtitle="The people in your organization and their roles."
        action={
          team && canAdmin ? (
            <button type="button" onClick={() => void inviteTeammate()} className="h-8 px-3 rounded-lg bg-[#2563eb] text-[12.5px] text-white">
              Invite teammate
            </button>
          ) : null
        }
      />
      {error ? <p className="text-[13px] text-red-300 mb-3">{error}</p> : null}
      {!team ? (
        <Panel className="p-4">
          <p className="text-[13px] text-zinc-300 mb-3">Start a shared team brain. Personal memories stay private until you choose team.</p>
          <button type="button" onClick={() => void start()} className="h-8 px-3 rounded-lg bg-[#2563eb] text-[12.5px] text-white">
            Create team brain
          </button>
        </Panel>
      ) : (
        <Panel>
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-[13.5px] text-zinc-200">{team.name}</p>
            <button type="button" onClick={() => void engine.leaveTeam(team.id).then(load).catch((err) => setError(err.message))} className="text-[12px] text-zinc-400">
              Leave team
            </button>
          </div>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] px-4 py-2.5 text-[11px] tracking-[0.08em] text-zinc-500 border-b border-white/[0.06]">
            <span>MEMBER</span>
            <span>ROLE</span>
            <span>ACCESS</span>
            <span>JOINED</span>
          </div>
          {(team.members || []).map((member: { uid: string; displayName?: string; email?: string; role: string; joinedAt?: string; lastActiveAt?: string }) => (
            <div key={member.uid} className="grid grid-cols-[2fr_1fr_1fr_1fr] px-4 py-3.5 text-[13px] items-center border-t border-white/[0.06]">
              <div>
                <p className="text-zinc-100">{member.displayName || member.uid}</p>
                <p className="text-[12px] text-zinc-500">{member.email || member.lastActiveAt || '—'}</p>
              </div>
              {canAdmin && member.uid !== user.uid ? (
                <select
                  aria-label={`Role for ${member.displayName || member.uid}`}
                  value={member.role}
                  onChange={(e) => void engine.setTeammateRole(team.id, member.uid, e.target.value).then(load)}
                  className="bg-transparent text-zinc-300"
                >
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                </select>
              ) : (
                <span className="text-zinc-300">{member.role}</span>
              )}
              <span className="text-zinc-300">{team.slug || 'general'}</span>
              <span className="text-zinc-400">{member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : '—'}</span>
            </div>
          ))}
          {(team.invites || []).map((row: { id: string; status: string; sas?: string }) => (
            <div key={row.id} className="px-4 py-2 text-[12px] text-zinc-400 border-t border-white/[0.06] flex justify-between">
              <span>Pending invite · {row.status} {row.sas || ''}</span>
              <button type="button" onClick={() => void engine.revokeInvite(row.id).then(load)} className="text-zinc-300">
                Revoke
              </button>
            </div>
          ))}
        </Panel>
      )}
      {invite ? (
        <Panel className="p-4 mt-3">
          <p className="text-[13px] text-zinc-200 mb-2">Share this invite</p>
          <p className="text-[12px] text-zinc-400 break-all">{invite.inviteUrl}</p>
          <p className="text-[13px] text-zinc-200 mt-2">Code {invite.code}</p>
          <div className="mt-2" dangerouslySetInnerHTML={{ __html: invite.qrSvg || '' }} />
          {invite.sas ? <p className="mt-2 text-[18px]">{invite.sas}</p> : null}
        </Panel>
      ) : null}
    </div>
  );
}

export function BillingSettingsPage() {
  const { user, displayName } = useOutletContext<Ctx>();
  return (
    <div className="max-w-[920px]">
      <PageHeader
        title="Billing"
        subtitle={
          <>
            Your balance, your plan, and your invoices. <DocLink section="billing">How billing works ↗</DocLink>
          </>
        }
      />
      <Panel className="mb-3 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <p className="text-[13.5px] text-zinc-200">Current plan</p>
          <div className="flex gap-2">
            <span className="h-8 px-3 rounded-lg border border-emerald-500/20 text-[12px] text-emerald-400 inline-flex items-center">Private beta · Pro</span>
          </div>
        </div>
        <div className="overflow-x-auto">
        <div className="grid grid-cols-4 text-[12px] text-zinc-500 mb-1 min-w-[480px]">
          <span>PLAN</span>
          <span>PRICE</span>
          <span>INCLUDED CREDITS</span>
          <span>STATUS</span>
        </div>
        <div className="grid grid-cols-4 text-[13.5px] text-zinc-200 min-w-[480px]">
          <span>Pro (beta)</span>
          <span>$0</span>
          <span>Full access</span>
          <span><span className="text-[12px] text-emerald-400">Active</span></span>
        </div>
        </div>
        <p className="text-[12px] text-zinc-500 mt-2">Private beta: every signed-in account has the same Pro connectors, OAuth, and memory access. No upgrade required.</p>
      </Panel>

      <Panel className="mb-3 p-4">
        <p className="text-[13.5px] text-zinc-200 mb-2">Credits</p>
        <p className="text-[15px] text-zinc-300">Not billed during private beta.</p>
        <p className="text-[12px] text-zinc-500 mt-1">Usage on the next page counts documents, facts, and API calls. It does not draw down a balance.</p>
      </Panel>

      <Panel className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13.5px] text-zinc-200">Billing & payment</p>
          <span className="text-[12px] text-zinc-500">No invoices in private beta</span>
        </div>
        <div className="grid grid-cols-2 text-[12px] text-zinc-500 mb-3">
          <div>
            ACCOUNT
            <p className="text-zinc-200 text-[13px] mt-0.5">{displayName}</p>
          </div>
          <div>
            BILLING EMAIL
            <p className="text-zinc-200 text-[13px] mt-0.5">{user.email || '—'}</p>
          </div>
        </div>
        <div className="flex items-center justify-between py-2 border-t border-white/[0.06]">
          <span className="text-[13px] text-zinc-400">No payment method</span>
          <span className="text-[13px] text-zinc-500">Not billed in private beta</span>
        </div>
        <p className="text-[13.5px] text-zinc-200 mt-4 mb-2">Invoices</p>
        <p className="text-[13px] text-zinc-500">No invoices yet.</p>
      </Panel>
    </div>
  );
}

export function UsageSettingsPage() {
  const [stats, setStats] = useState<any>(null);
  const [requests, setRequests] = useState<any>(null);
  useEffect(() => {
    engine.stats().then(setStats).catch(() => {});
    engine.requests().then(setRequests).catch(() => {});
  }, []);
  const calls = requests?.requests?.length || stats?.requests || 0;
  return (
    <div className="max-w-[920px]">
      <PageHeader title="Usage" subtitle="Memory and API activity for this account. Private beta is not metered in dollars." />
      <Panel className="p-4 mb-3">
        <p className="text-[13px] text-zinc-400 mb-2">This account</p>
        <p className="text-[28px] text-white">
          {calls} <span className="text-[13px] text-zinc-500">logged API calls</span>
        </p>
        <div className="flex gap-[3px] mt-3 mb-2">
          {Array.from({ length: 48 }).map((_, i) => (
            <span key={i} className="h-4 flex-1 rounded-[1px] bg-white/[0.06]" />
          ))}
        </div>
        <p className="text-[12px] text-zinc-500">Private beta does not charge credits</p>
      </Panel>
      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <Panel className="p-4">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500">DOCUMENTS</p>
          <p className="text-[22px] text-zinc-200 mt-4">
            {stats?.documents ?? '—'} <span className="text-[13px] text-zinc-500">stored</span>
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500">FACTS</p>
          <p className="text-[22px] text-zinc-200 mt-4">
            {stats?.latestFacts ?? '—'} <span className="text-[13px] text-zinc-500">latest</span>
          </p>
          <p className="text-[12px] text-zinc-500 mt-2">{stats?.chunks ?? 0} chunks</p>
        </Panel>
      </div>
      <Panel className="p-8 text-center min-h-[180px] flex flex-col items-center justify-center">
        <p className="text-[13.5px] text-zinc-200 self-start mb-10">Recent calls</p>
        <p className="text-[15px] text-zinc-200">{requests?.byType ? Object.entries(requests.byType).map(([k, v]) => `${k} ${v}`).join(' · ') || 'No calls logged yet' : 'No calls logged yet'}</p>
        <p className="text-[13px] text-zinc-500 mt-1">New API calls show up on Requests after you use Playground or Import.</p>
      </Panel>
    </div>
  );
}

export function AdvancedSettingsPage() {
  const [keys, setKeys] = useState<ProviderKeys>(() => loadProviderKeys());
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  return (
    <div className="max-w-[920px]">
      <PageHeader title="Advanced" subtitle="LLM provider keys, export, or reset the org." />
      <Panel className="mb-3">
        <div className="px-4 py-3 text-[13.5px] text-zinc-200">Give Rukmer a brain for your models</div>
        <p className="px-4 pb-2 text-[12px] text-zinc-500">
          Optional, for builders. Everyday users connect Claude / ChatGPT / Gemini / Grok under Connectors (MCP). Playground can use the hosted Gemini key.
        </p>
        {(
          [
            ['gemini', 'Gemini'],
            ['openai', 'OpenAI / ChatGPT'],
            ['anthropic', 'Claude'],
            ['grok', 'Grok / xAI'],
          ] as const
        ).map(([id, label]) => (
          <Row key={id} label={label} hint={id === 'gemini' ? 'Optional if GEMINI_API_KEY is on the server.' : `Required to chat as ${label}.`}>
            <input
              type="password"
              value={keys[id]}
              onChange={(e) => setKeys((p) => ({ ...p, [id]: e.target.value }))}
              className="h-8 w-64 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12px] outline-none"
              placeholder="API key"
            />
          </Row>
        ))}
        <div className="px-4 py-3 flex justify-end">
          <PrimaryButton
            onClick={() => {
              saveProviderKeys(keys);
              setSaved(true);
              setTimeout(() => setSaved(false), 1200);
            }}
          >
            {saved ? 'Saved' : 'Save keys'}
          </PrimaryButton>
        </div>
      </Panel>
      <Panel className="mb-3">
        <Row label="Export organization data" hint="Downloads your documents and current facts as JSON.">
          <GhostButton
            onClick={() => {
              setNote('');
              void downloadExport().catch((e) => setNote(e.message || 'Export failed'));
            }}
          >
            <Download size={13} /> Export
          </GhostButton>
        </Row>
        {note ? <p className="px-4 pb-3 text-[12px] text-zinc-400">{note}</p> : null}
      </Panel>
      <Panel>
        <div className="px-4 py-3 text-[13.5px] text-red-400">Danger zone</div>
        <div className="flex items-center justify-between px-4 py-3.5 border-t border-white/[0.06]">
          <div>
            <p className="text-[13.5px] text-zinc-200">Reset organization data</p>
            <p className="text-[12px] text-zinc-500 max-w-md">
              Remove all documents, memories, connections, and org settings. Billing and members are kept.
            </p>
          </div>
          <button
            type="button"
            className="h-8 px-3 rounded-lg border border-red-500/30 text-[13px] text-red-400 inline-flex items-center gap-1.5"
            onClick={() => {
              if (!window.confirm('Remove all documents and memories in this account? API keys stay.')) return;
              void engine
                .resetAccount()
                .then((out) => setNote(`Removed ${out.documents || 0} documents and ${out.facts || 0} facts.`))
                .catch((e) => setNote(e.message || 'Reset failed'));
            }}
          >
            <RotateCcw size={13} /> Reset data
          </button>
        </div>
        <div className="flex items-center justify-between px-4 py-3.5 border-t border-white/[0.06]">
          <div>
            <p className="text-[13.5px] text-zinc-200">Delete organization</p>
            <p className="text-[12px] text-zinc-500 max-w-md">
              Private beta accounts are not deleted from this screen. Reset data above if you want a clean memory.
            </p>
          </div>
          <span className="text-[12px] text-zinc-500">Unavailable</span>
        </div>
      </Panel>
    </div>
  );
}

function AccountMemberships() {
  const [teams, setTeams] = useState<any[]>([]);
  useEffect(() => {
    engine.teams().then((out) => setTeams(out.teams || [])).catch(() => setTeams([]));
  }, []);
  return (
    <Panel className="mb-3">
      <div className="px-4 py-3 text-[13.5px] text-zinc-200">Organizations</div>
      {teams.length === 0 ? (
        <p className="px-4 py-3.5 text-[13px] text-zinc-500 border-t border-white/[0.06]">No organization memberships yet.</p>
      ) : (
        teams.map((team) => (
          <div key={team.id} className="flex items-center justify-between px-4 py-3.5 border-t border-white/[0.06]">
            <div>
              <p className="text-[13.5px] text-zinc-200">{team.name}</p>
              <p className="text-[12px] text-zinc-500">{team.orgId || team.tag}</p>
            </div>
            <span className="text-[11px] tracking-[0.1em] text-zinc-500">{(team.members || []).length} members</span>
          </div>
        ))
      )}
    </Panel>
  );
}

export function AccountSettingsPage() {
  const { user, displayName } = useOutletContext<Ctx>();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="max-w-[920px]">
      <PageHeader title="Account" subtitle="Your profile, sessions, and organization memberships." />
      <Panel className="mb-3">
        <div className="px-4 py-3 text-[13.5px] text-zinc-200">Profile</div>
        <Row label="Name">
          <span className="text-[13px] text-zinc-300">{displayName}</span>
        </Row>
        <Row label="Email">
          <span className="text-[13px] text-zinc-300">
            {user.email || '—'}
          </span>
        </Row>
      </Panel>
      <Panel className="mb-3">
        <div className="px-4 py-3 text-[13.5px] text-zinc-200">Two-factor authentication</div>
        <div className="flex items-start justify-between px-4 py-3.5 border-t border-white/[0.06] gap-4">
          <div className="flex gap-3">
            <div className="h-9 w-9 rounded-lg border border-white/[0.08] flex items-center justify-center text-zinc-400">
              <Shield size={16} />
            </div>
            <div>
              <p className="text-[13.5px] text-zinc-200">
                Authenticator app <span className="ml-2 text-[11px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5">Coming soon</span>
              </p>
              <p className="text-[12px] text-zinc-500 mt-1 max-w-md">
                Authenticator app codes are coming after private beta.
              </p>
            </div>
          </div>
        </div>
      </Panel>
      <Panel className="mb-3">
        <div className="px-4 py-3 text-[13.5px] text-zinc-200">Active sessions</div>
        <div className="flex items-start gap-3 px-4 py-3.5 border-t border-white/[0.06]">
          <div className="h-9 w-9 rounded-lg border border-white/[0.08] flex items-center justify-center text-zinc-400">
            <Monitor size={16} />
          </div>
          <div>
            <p className="text-[13.5px] text-zinc-200">
              This browser <span className="ml-2 text-[11px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5">This device</span>
            </p>
            <p className="text-[12px] text-zinc-500 mt-0.5">Signed in · Active now</p>
          </div>
        </div>
      </Panel>
      <AccountMemberships />
      <Panel className="mb-3">
        <div className="flex items-center justify-between px-4 py-4 gap-4">
          <div>
            <p className="text-[13.5px] text-zinc-200">Export your data</p>
            <p className="text-[12px] text-zinc-500 max-w-md">
              Downloads your documents and current facts as JSON.
            </p>
          </div>
          <GhostButton
            onClick={() => {
              void downloadExport().catch(() => {});
            }}
          >
            <Download size={14} /> Download my data
          </GhostButton>
        </div>
      </Panel>
      <Panel>
        <div className="flex items-center justify-between px-4 py-4 gap-4">
          <div>
            <p className="text-[13.5px] text-zinc-200">Sign out</p>
            <p className="text-[12px] text-zinc-500 max-w-md">End this browser session and return to login.</p>
          </div>
          <button
            type="button"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut(auth);
              window.location.assign('/login');
            }}
            className="h-8 px-3 rounded-lg border border-white/[0.1] text-[13px] text-zinc-300 inline-flex items-center gap-1.5"
          >
            <LogOut size={13} /> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </Panel>
    </div>
  );
}
