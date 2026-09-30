import React, { useMemo, useState } from 'react';
import { Search, ChevronRight, MoreHorizontal } from 'lucide-react';
import { PageHeader, DocLink, Panel, GhostButton } from '../../components/console/ui';

type Kind = 'oauth' | 'service';

const CONNECTORS: { name: string; kind: Kind; plan: string; icon: string }[] = [
  { name: 'Google Drive', kind: 'oauth', plan: 'Pro', icon: 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png' },
  { name: 'Gmail', kind: 'oauth', plan: 'Max', icon: 'https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png' },
  { name: 'Slack', kind: 'oauth', plan: 'Pro', icon: 'https://cdn.worldvectorlogo.com/logos/slack-new-logo.svg' },
  { name: 'Microsoft Outlook', kind: 'oauth', plan: 'Pro', icon: '/icons/outlook.svg' },
  { name: 'Microsoft Teams', kind: 'oauth', plan: 'Pro', icon: '/icons/teams.svg' },
  { name: 'OneDrive', kind: 'oauth', plan: 'Pro', icon: '/icons/onedrive.svg' },
  { name: 'Notion', kind: 'oauth', plan: 'Pro', icon: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png' },
  { name: 'GitHub', kind: 'oauth', plan: 'Scale', icon: 'https://cdn.simpleicons.org/github/ffffff' },
  { name: 'Amazon S3', kind: 'service', plan: 'Scale', icon: 'https://cdn.simpleicons.org/amazons3/FF9900' },
  { name: 'Web Crawler', kind: 'service', plan: 'Scale', icon: '' },
];

export default function ConnectorsPage() {
  const [tab, setTab] = useState<'all' | Kind>('all');
  const [q, setQ] = useState('');

  const list = useMemo(
    () =>
      CONNECTORS.filter((c) => (tab === 'all' ? true : c.kind === tab)).filter((c) =>
        c.name.toLowerCase().includes(q.toLowerCase())
      ),
    [tab, q]
  );

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader
        title="Connectors"
        subtitle={
          <>
            Bring in content from the tools you already use. <DocLink>How connectors sync ↗</DocLink>
          </>
        }
      />
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#0c0c0e] p-0.5">
          {(['all', 'oauth', 'service'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`h-8 px-3 rounded-md text-[13px] capitalize ${
                tab === id ? 'bg-[#252528] text-white' : 'text-zinc-400'
              }`}
            >
              {id === 'oauth' ? 'OAuth' : id === 'service' ? 'Services' : 'All'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] w-[220px]">
          <Search size={13} className="text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search connectors..."
            className="bg-transparent text-[13px] outline-none w-full placeholder:text-zinc-600"
          />
        </div>
      </div>
      <Panel>
        {list.map((c) => (
          <div
            key={c.name}
            className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06] last:border-b-0"
          >
            <div className="h-8 w-8 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center overflow-hidden">
              {c.icon ? <img src={c.icon} alt="" className="h-5 w-5 object-contain" /> : <span className="text-[11px] text-zinc-400">W</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] text-zinc-100">{c.name}</p>
              <p className="text-[12px] text-zinc-500">Requires the {c.plan} plan</p>
            </div>
            <ChevronRight size={16} className="text-zinc-600" />
            <GhostButton>Upgrade</GhostButton>
            <button className="h-8 w-8 rounded-md text-zinc-500 hover:text-zinc-300 flex items-center justify-center">
              <MoreHorizontal size={16} />
            </button>
          </div>
        ))}
      </Panel>
    </div>
  );
}
