import React, { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Plus, Shield, Mail, Monitor, Lock, RotateCcw, Trash2, Download, LogOut } from 'lucide-react';
import { PageHeader, DocLink, Panel, Row, Toggle, PrimaryButton, GhostButton, CopyField } from '../../components/console/ui';
import type { UserProfile } from '../../types';
import { loadProviderKeys, saveProviderKeys, type ProviderKeys } from '../../services/providerKeys';
import { auth } from '../../firebase';
import { signOut } from 'firebase/auth';

type Ctx = { user: UserProfile; displayName: string; homeTag?: string };

const BUCKETS = [
  'Preferences', 'Interests', 'Goals', 'Work', 'Relationships', 'Health',
  'Skills', 'Finances', 'Education', 'Travel', 'Values', 'Projects',
];

export function GeneralSettingsPage() {
  const [orgName, setOrgName] = useState('Rukmer');
  const [orgContext, setOrgContext] = useState(false);
  const [buckets, setBuckets] = useState<string[]>([]);
  const { homeTag } = useOutletContext<Ctx>();
  const orgId = homeTag || 'your-private-memory';

  return (
    <div className="max-w-[920px]">
      <PageHeader
        title="General"
        subtitle={
          <>
            Your organization's context and preferences. <DocLink>How profiles work ↗</DocLink>
          </>
        }
      />
      <Panel>
        <div className="px-4 py-3 text-[13.5px] text-zinc-200">Organization</div>
        <Row label="Organization name" hint="The public name of your organization.">
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="h-8 w-56 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[13px] text-right outline-none"
          />
        </Row>
        <Row label="Organization ID" hint="Used in CLI and API calls.">
          <CopyField value={orgId} />
        </Row>
        <Row label="Require two-factor for all members" hint="Available on Scale and Enterprise.">
          <Link to="/settings/billing" className="text-[13px] text-[#60a5fa]">
            Upgrade to Scale ↗
          </Link>
        </Row>
        <Row label="Organization context" hint="Filters what gets stored during ingestion, guided by a description of your organization.">
          <Toggle on={orgContext} onClick={() => setOrgContext((v) => !v)} />
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
                      onClick={() => setBuckets((p) => (on ? p.filter((x) => x !== b) : [...p, b]))}
                      className={`h-7 px-2.5 rounded-md border text-[12px] ${
                        on ? 'border-blue-400/40 bg-blue-500/10 text-zinc-100' : 'border-white/[0.08] text-zinc-400'
                      }`}
                    >
                      + {b}
                    </button>
                  );
                })}
                <button className="h-7 px-2.5 rounded-md border border-white/[0.08] text-[12px] text-zinc-400">
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
  return (
    <div className="max-w-[1100px]">
      <PageHeader
        title="Team"
        subtitle="The people in your organization and their roles."
        action={
          <PrimaryButton>
            <Plus size={14} /> Invite member
          </PrimaryButton>
        }
      />
      <Panel>
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] px-4 py-2.5 text-[11px] tracking-[0.08em] text-zinc-500 border-b border-white/[0.06]">
          <span>MEMBER</span>
          <span>ROLE</span>
          <span>ACCESS</span>
          <span>2FA</span>
          <span>JOINED</span>
        </div>
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] px-4 py-3.5 text-[13px] items-center">
          <div>
            <p className="text-zinc-100">{displayName}</p>
            <p className="text-[12px] text-zinc-500">{user.email || '—'}</p>
          </div>
          <span className="text-zinc-300">Owner</span>
          <span className="text-zinc-300">Full</span>
          <span className="inline-flex"><span className="h-6 px-2 rounded-md border border-white/[0.08] text-[11px] text-zinc-400">Off</span></span>
          <span className="text-zinc-400">—</span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 text-[12px] text-zinc-500 border-t border-white/[0.06]">
          <span>1 member</span>
          <span>1/1 seats used</span>
        </div>
      </Panel>
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
            Your balance, your plan, and your invoices. <DocLink>How billing works ↗</DocLink>
          </>
        }
      />
      <Panel className="mb-3 p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[13.5px] text-zinc-200">Current plan</p>
          <div className="flex gap-2">
            <GhostButton>Compare plans</GhostButton>
            <PrimaryButton>Upgrade to Pro · $19</PrimaryButton>
          </div>
        </div>
        <div className="grid grid-cols-4 text-[12px] text-zinc-500 mb-1">
          <span>PLAN</span>
          <span>PRICE</span>
          <span>INCLUDED CREDITS</span>
          <span>STATUS</span>
        </div>
        <div className="grid grid-cols-4 text-[13.5px] text-zinc-200">
          <span>Free</span>
          <span>$0</span>
          <span>$5/mo</span>
          <span><span className="text-[12px] text-emerald-400">Active</span></span>
        </div>
        <p className="text-[12px] text-zinc-500 mt-2">You used $0 of $5 this month. Pro includes $20.</p>
      </Panel>

      <Panel className="mb-3 p-4">
        <p className="text-[13.5px] text-zinc-200 mb-2">Credits</p>
        <p className="text-[28px] text-white">
          $5.00 <span className="text-[13px] text-zinc-500">available</span>
        </p>
        <div className="h-2 rounded-full bg-white/[0.06] mt-3 mb-3 overflow-hidden">
          <div className="h-full w-full bg-zinc-600/40" />
        </div>
        <div className="grid grid-cols-3 text-[12px] text-zinc-500">
          <div>
            PLAN CREDITS
            <p className="text-zinc-200 text-[13px] mt-0.5">$5.00</p>
          </div>
          <div>
            USED THIS PERIOD
            <p className="text-zinc-200 text-[13px] mt-0.5">$0.00</p>
          </div>
          <div>
            MONTHLY ALLOWANCE
            <p className="text-zinc-200 text-[13px] mt-0.5">$5.00</p>
          </div>
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13.5px] text-zinc-200">Billing & payment</p>
          <GhostButton>Manage billing</GhostButton>
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
          <button className="text-[13px] text-zinc-300">Add payment method ›</button>
        </div>
        <p className="text-[13.5px] text-zinc-200 mt-4 mb-2">Invoices</p>
        <p className="text-[13px] text-zinc-500">No invoices yet.</p>
      </Panel>
    </div>
  );
}

export function UsageSettingsPage() {
  return (
    <div className="max-w-[920px]">
      <PageHeader title="Usage" subtitle="Where this period's credits went, day by day and meter by meter." />
      <Panel className="p-4 mb-3">
        <p className="text-[13px] text-zinc-400 mb-2">This period</p>
        <p className="text-[28px] text-white">
          $0.00 <span className="text-[13px] text-zinc-500">used</span>
        </p>
        <div className="flex gap-[3px] mt-3 mb-2">
          {Array.from({ length: 48 }).map((_, i) => (
            <span key={i} className="h-4 flex-1 rounded-[1px] bg-white/[0.06]" />
          ))}
        </div>
        <p className="text-[12px] text-zinc-500">of $5.00 in credits</p>
      </Panel>
      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <Panel className="p-4">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500">TOKENS PROCESSED</p>
          <p className="text-[22px] text-zinc-200 mt-4">
            0 <span className="text-[13px] text-zinc-500">this period</span>
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-[11px] tracking-[0.12em] text-zinc-500">PROJECTED MONTH-END</p>
          <p className="text-[22px] text-zinc-200 mt-4">
            $0.00 <span className="text-[13px] text-zinc-500">at current pace</span>
          </p>
          <p className="text-[12px] text-zinc-500 mt-2">0% of credits</p>
        </Panel>
      </div>
      <Panel className="p-8 text-center min-h-[180px] flex flex-col items-center justify-center">
        <p className="text-[13.5px] text-zinc-200 self-start mb-10">Daily spend</p>
        <p className="text-[15px] text-zinc-200">No spend yet</p>
        <p className="text-[13px] text-zinc-500 mt-1">Daily usage appears here as it's metered.</p>
      </Panel>
    </div>
  );
}

export function AdvancedSettingsPage() {
  const [keys, setKeys] = useState<ProviderKeys>(() => loadProviderKeys());
  const [saved, setSaved] = useState(false);
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
        <Row label="Export organization data" hint="Documents and memories with their container tags, as JSON. Emailed as a link, valid for 6 hours.">
          <GhostButton>
            <Download size={13} /> Export
          </GhostButton>
        </Row>
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
          <button className="h-8 px-3 rounded-lg border border-red-500/30 text-[13px] text-red-400 inline-flex items-center gap-1.5">
            <RotateCcw size={13} /> Reset data
          </button>
        </div>
        <div className="flex items-center justify-between px-4 py-3.5 border-t border-white/[0.06]">
          <div>
            <p className="text-[13.5px] text-zinc-200">Delete organization</p>
            <p className="text-[12px] text-zinc-500 max-w-md">
              Permanently delete this organization and all its data. This cancels your subscription.
            </p>
          </div>
          <button className="h-8 px-3 rounded-lg border border-red-500/30 text-[13px] text-red-400 inline-flex items-center gap-1.5">
            <Trash2 size={13} /> Delete organization
          </button>
        </div>
      </Panel>
    </div>
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
            {user.email || '—'}{' '}
            <button className="text-[#60a5fa] ml-2">Change</button>
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
                Authenticator app <span className="ml-2 text-[11px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5">Off</span>
              </p>
              <p className="text-[12px] text-zinc-500 mt-1 max-w-md">
                Ask for a code from your phone after the email code. Protects you if someone gets into your inbox.
              </p>
            </div>
          </div>
          <Link to="/settings/billing" className="text-[13px] text-[#60a5fa] shrink-0">
            Available on Scale, upgrade ↗
          </Link>
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
      <Panel className="mb-3">
        <div className="px-4 py-3 text-[13.5px] text-zinc-200">Organizations</div>
        <div className="flex items-center justify-between px-4 py-3.5 border-t border-white/[0.06]">
          <div>
            <p className="text-[13.5px] text-zinc-200">Rukmer</p>
            <p className="text-[12px] text-zinc-500">{user.uid ? `u_${user.uid}` : 'private memory'}</p>
          </div>
          <span className="text-[11px] tracking-[0.1em] text-zinc-500">OWNER · 1 member</span>
        </div>
      </Panel>
      <Panel className="mb-3">
        <div className="flex items-center justify-between px-4 py-4 gap-4">
          <div>
            <p className="text-[13.5px] text-zinc-200">Export your data</p>
            <p className="text-[12px] text-zinc-500 max-w-md">
              Your documents and memories with their container tags, as JSON. Emailed as a link, valid for 6 hours.
            </p>
          </div>
          <GhostButton>
            <Mail size={14} /> Email me my data
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
