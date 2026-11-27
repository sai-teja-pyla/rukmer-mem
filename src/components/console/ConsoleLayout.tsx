import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Tag,
  Share2,
  Unplug,
  Download,
  Library,
  KeyRound,
  Bot,
  ScrollText,
  UserRound,
  Settings,
  Search,
  MoreHorizontal,
  ChevronLeft,
  Building2,
  Users,
  CreditCard,
  BarChart3,
  FolderCog,
  User,
  Menu,
  X,
  Moon,
  Sun,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import type { LucideIcon } from 'lucide-react';
import type { UserProfile } from '../../types';
import { useUserSettings } from '../../hooks/useUserSettings';
import { WHATS_NEW } from '../../content/whatsNew';
import { engine } from '../../services/engineClient';
import { withTimeout } from '../../hooks/useMemoryResource';
import { homeTag as makeHomeTag } from '../../services/tenancy';
import { Skeleton } from './ui';
import { ScopeFilter, type MemoryScope } from './ScopeFilter';

interface ConsoleLayoutProps {
  user: UserProfile;
  restoring?: boolean;
}

type NavItem =
  | { section: string }
  | { to: string; label: string; icon: LucideIcon; chevron?: boolean };

type MemoryHit = { id: string; title: string; text: string; source: string; space?: string; authorName?: string; authoredAt?: string };
type ChatHit = { id: string; title: string };

function loadChatTitles(uid: string): ChatHit[] {
  try {
    const raw = localStorage.getItem(`rukmer.playground.${uid}`);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      const id = String(row?.id || '');
      const title = String(row?.title || '').trim();
      if (!id || !title || title === 'New chat') return [];
      return [{ id, title }];
    });
  } catch {
    return [];
  }
}

const nav: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/playground', label: 'Playground', icon: MessageSquare },
  { section: 'DATA' },
  { to: '/memories', label: 'Memories', icon: Library },
  { to: '/container-tags', label: 'Container Tags', icon: Tag },
  { to: '/memory-graph', label: 'Memory Graph', icon: Share2 },
  { to: '/connectors', label: 'Connectors', icon: Unplug },
  { to: '/import', label: 'Import', icon: Download },
  { section: 'DEVELOPER' },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound },
  { to: '/agents-mcp', label: 'Agents & MCP', icon: Bot },
  { to: '/requests', label: 'Requests', icon: ScrollText },
  { to: '/insights', label: 'User Insights', icon: UserRound },
  { to: '/settings/general', label: 'Settings', icon: Settings, chevron: true },
];

const settingsNav: NavItem[] = [
  { section: 'ORGANIZATION' },
  { to: '/settings/general', label: 'General', icon: Building2 },
  { to: '/settings/team', label: 'Team', icon: Users },
  { to: '/settings/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings/usage', label: 'Usage', icon: BarChart3 },
  { to: '/settings/advanced', label: 'Advanced', icon: FolderCog },
  { section: 'PERSONAL' },
  { to: '/settings/account', label: 'Account', icon: User },
];

function PageSkeleton() {
  return (
    <div className="max-w-[1220px] mx-auto space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const source = String(text || '');
  const needle = query.trim();
  if (!needle) return <>{source}</>;
  const lower = source.toLowerCase();
  const q = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let guard = 0;
  while (from < source.length && guard < 20) {
    const at = lower.indexOf(q, from);
    if (at < 0) {
      parts.push(source.slice(from));
      break;
    }
    if (at > from) parts.push(source.slice(from, at));
    parts.push(
      <mark key={`${at}-${guard}`} className="bg-amber-300/35 text-inherit rounded-sm">
        {source.slice(at, at + needle.length)}
      </mark>
    );
    from = at + Math.max(needle.length, 1);
    guard += 1;
  }
  if (from < source.length && guard >= 20) parts.push(source.slice(from));
  return <>{parts}</>;
}

export default function ConsoleLayout({ user, restoring = false }: ConsoleLayoutProps) {
  const { settings, updateSettings } = useUserSettings();
  const appearance = (settings?.consoleTheme || localStorage.getItem('consoleTheme') || 'dark') === 'light' ? 'light' : 'dark';
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [memoryScope, setMemoryScope] = useState<MemoryScope>('all');
  const [toast, setToast] = useState('');
  const [inbox, setInbox] = useState<{ id: string; teamName: string }[]>([]);
  const [memories, setMemories] = useState<MemoryHit[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const searchRequest = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [palette, setPalette] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const homeTag = makeHomeTag(user.uid);

  useLayoutEffect(() => {
    document.body.style.backgroundColor = appearance === 'light' ? '#f4f5f7' : '#0a0a0b';
  }, [appearance]);

  useEffect(() => {
    setNavOpen(false);
    setMenuOpen(false);
    const joined = sessionStorage.getItem('rukmer.joinedTeam');
    if (joined) {
      setToast(`You joined ${joined}`);
      sessionStorage.removeItem('rukmer.joinedTeam');
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!user.uid) return;
    let stop = false;
    engine
      .inboxInvites()
      .then((out) => {
        if (!stop) setInbox(out.invites || []);
      })
      .catch(() => {
        if (!stop) setInbox([]);
      });
    return () => {
      stop = true;
    };
  }, [user.uid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((cur) => (cur === 'open' ? '' : 'open'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const displayName = settings?.displayName || user.name || '';
  const chipReady = !restoring && !!displayName;
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  const isSettings = location.pathname.startsWith('/settings');
  const activeNav = isSettings ? settingsNav : nav;
  const current = [...nav, ...settingsNav].find(
    (item): item is Extract<NavItem, { to: string }> => !('section' in item) && location.pathname.startsWith(item.to)
  );
  const pageTitle = current?.label || 'Rukmer';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeNav;
    const seen = new Set<string>();
    return [...nav, ...settingsNav].filter((item): item is Extract<NavItem, { to: string }> => {
      if ('section' in item || !item.label.toLowerCase().includes(q) || seen.has(item.to)) return false;
      seen.add(item.to);
      return true;
    });
  }, [query, activeNav]);

  const chats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !user.uid) return [];
    return loadChatTitles(user.uid)
      .filter((chat) => chat.title.toLowerCase().includes(q))
      .slice(0, 5);
  }, [query, user.uid]);

  useEffect(() => {
    const requestId = ++searchRequest.current;
    const q = query.trim();
    if (q.length < 2 || !homeTag) {
      setMemories([]);
      setMemoryLoading(false);
      return;
    }
    setMemories([]);
    setMemoryLoading(true);
    const timer = window.setTimeout(() => {
      withTimeout(engine.search({ query: q, containerTag: homeTag, memoriesRetrieved: 5, scope: memoryScope }))
        .then((out) => {
          if (requestId !== searchRequest.current) return;
          const rows = (out.matches || []).slice(0, 5).flatMap((hit: MemoryHit & { id?: string }) => {
            const id = String(hit.id || '');
            if (!id) return [];
            const text = String(hit.text || '').replace(/\s+/g, ' ').trim();
            return [{
              id,
              title: String(hit.title || ''),
              text: text.slice(0, 80),
              source: String(hit.source || 'memory'),
              space: hit.space,
              authorName: hit.authorName,
              authoredAt: hit.authoredAt,
            }];
          });
          setMemories(rows);
        })
        .catch(() => {
          if (requestId !== searchRequest.current) return;
          setMemories([]);
        })
        .finally(() => {
          if (requestId === searchRequest.current) setMemoryLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, homeTag, memoryScope]);

  const isImmersive =
    location.pathname.startsWith('/playground') || location.pathname.startsWith('/memory-graph');

  const sidebar = (
    <>
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <div
          className="flex-1 flex items-center gap-2 rounded-lg bg-[#141416] border border-white/[0.06] px-2.5 h-[34px] cursor-text"
          onClick={() => searchRef.current?.focus()}
        >
          <Search size={14} className="text-zinc-500 shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              if (query) setQuery('');
              else setNavOpen(false);
            }}
            className="bg-transparent text-[13px] w-full outline-none placeholder:text-zinc-600"
          />
          <kbd className="hidden sm:inline text-[10px] text-zinc-500 border border-white/[0.08] rounded px-1 py-[1px] font-medium leading-none">
            ⌘K
          </kbd>
        </div>
        <button
          type="button"
          className="lg:hidden h-[34px] w-[34px] rounded-lg border border-white/[0.08] text-zinc-300 flex items-center justify-center"
          onClick={() => setNavOpen(false)}
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>
      <div className="px-3 pb-1">
        <ScopeFilter value={memoryScope} onChange={setMemoryScope} />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-1">
        {isSettings && (
          <button
            onClick={() => navigate('/overview')}
            className="flex items-center gap-2 px-2.5 h-8 rounded-lg text-[13px] text-zinc-300 hover:bg-white/[0.04] mb-1 w-full"
          >
            <ChevronLeft size={16} />
            Settings
          </button>
        )}
        {query.trim() && filtered.length > 0 ? (
          <p className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-[0.16em] text-zinc-500">Pages</p>
        ) : null}
        {filtered.map((item, i) => {
          if ('section' in item) {
            return (
              <p key={`${item.section}-${i}`} className="px-2.5 pt-3 pb-1 text-[10px] font-medium tracking-[0.16em] text-zinc-500">
                {item.section}
              </p>
            );
          }
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 h-8 rounded-lg text-[13px] mb-[1px] transition-colors ${
                  isActive
                    ? 'bg-[#1e4b8c]/55 text-[#dbeafe]'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`
              }
            >
              <Icon size={16} strokeWidth={1.7} />
              <span className="flex-1 truncate">{item.label}</span>
              {item.chevron && <span className="text-zinc-500 text-[15px] leading-none">›</span>}
            </NavLink>
          );
        })}
        {query.trim() && chats.length > 0 ? (
          <div className="mt-2">
            <p className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-[0.16em] text-zinc-500">Chats</p>
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => {
                  setNavOpen(false);
                  navigate(`/playground?mode=chat&thread=${encodeURIComponent(chat.id)}`);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg mb-[1px] hover:bg-white/[0.04]"
              >
                <span className="block truncate text-[13px] text-zinc-200">{chat.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        {query.trim().length >= 2 ? (
          <div className="mt-2">
            <p className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-[0.16em] text-zinc-500">Memories</p>
            {memoryLoading ? <p className="px-2.5 py-1 text-[12px] text-zinc-500">Searching…</p> : <p className="px-2.5 py-1 text-[12px] text-zinc-500">{memories.length} {memories.length === 1 ? 'memory' : 'memories'}</p>}
            {memories.map((memory) => (
              <button
                key={memory.id}
                type="button"
                onClick={() => {
                  setNavOpen(false);
                  navigate(`/playground?mode=search&q=${encodeURIComponent(query.trim())}`);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg mb-[1px] hover:bg-white/[0.04]"
              >
                <span className="block truncate text-[13px] text-zinc-200"><Highlight text={memory.title || memory.text || 'Memory'} query={query} /></span>
                <span className="block truncate text-[11px] text-zinc-500">
                  {memory.space === 'team' ? `Team${memory.authorName ? ` · ${memory.authorName}` : ''}` : memory.source}
                  {memory.text ? <> · <Highlight text={memory.text} query={query} /></> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {query.trim() && filtered.length === 0 && chats.length === 0 && memories.length === 0 && !memoryLoading ? (
          <p className="px-2.5 py-2 text-[13px] text-zinc-500">No pages or memories match</p>
        ) : null}
      </nav>

      <div className="px-3 pb-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {WHATS_NEW[0] ? (
          <div className="rounded-xl border border-white/[0.06] bg-[#121214] p-3 mb-3 hidden sm:block">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-medium text-zinc-400">What's new</p>
              <p className="text-[10px] text-zinc-600">{new Date(`${WHATS_NEW[0].date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
            </div>
            <p className="text-[12.5px] font-medium text-zinc-100 leading-snug">{WHATS_NEW[0].title}</p>
            <p className="text-[11.5px] text-zinc-500 mt-1 leading-snug">{WHATS_NEW[0].body}</p>
          </div>
        ) : null}

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-full flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-white/[0.04]"
          >
            {chipReady ? (
              <div className="h-7 w-7 rounded-full bg-[#1a1a1e] border border-white/10 flex items-center justify-center text-[10px] font-semibold text-zinc-200">
                {initials}
              </div>
            ) : (
              <div className="h-7 w-7 rounded-full bg-white/10 animate-pulse" />
            )}
            <span className="flex-1 text-left text-[13px] text-zinc-300 truncate">{chipReady ? displayName : <span className="inline-block h-3 w-24 rounded bg-white/10 animate-pulse" />}</span>
            <MoreHorizontal size={16} className="text-zinc-500" />
          </button>
          {menuOpen && (
            <div className="absolute bottom-10 left-0 right-0 rounded-lg border border-white/[0.08] bg-[#161618] shadow-xl p-1 z-20">
                <button
                  type="button"
                  onClick={() => {
                    const next = appearance === 'light' ? 'dark' : 'light';
                    localStorage.setItem('consoleTheme', next);
                    void updateSettings({ consoleTheme: next });
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-[12px] text-zinc-300 rounded-md hover:bg-white/[0.06]"
                >
                  {appearance === 'light' ? 'Dark theme' : 'Light theme'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setNavOpen(false);
                    navigate('/settings/account');
                  }}
                className="w-full text-left px-2.5 py-1.5 text-[12px] text-zinc-300 rounded-md hover:bg-white/[0.06]"
              >
                Account
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  void signOut(auth);
                  window.location.assign('/login');
                }}
                className="w-full text-left px-2.5 py-1.5 text-[12px] text-zinc-300 rounded-md hover:bg-white/[0.06]"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className={`h-[100dvh] w-full max-w-[100vw] overflow-hidden bg-[#0a0a0b] text-zinc-200 flex ${appearance === 'light' ? 'theme-light' : ''}`}>
      {navOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-[min(280px,86vw)] h-full flex flex-col border-r border-white/[0.05] bg-[#0c0c0e] transition-transform duration-200 ${
          navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {sidebar}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col h-full">
        <header className="lg:hidden shrink-0 h-12 px-3 flex items-center gap-2 border-b border-white/[0.06] bg-[#0c0c0e] pt-[env(safe-area-inset-top)]">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="h-9 w-9 rounded-lg border border-white/[0.08] text-zinc-200 flex items-center justify-center"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <p className="text-[14px] font-medium text-white truncate flex-1">{pageTitle}</p>
          <button
            type="button"
            aria-label={appearance === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            onClick={() => {
              const next = appearance === 'light' ? 'dark' : 'light';
              localStorage.setItem('consoleTheme', next);
              void updateSettings({ consoleTheme: next });
            }}
            className="h-9 w-9 rounded-lg border border-white/[0.08] text-zinc-200 flex items-center justify-center"
          >
            {appearance === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </header>
        {toast ? (
          <p role="status" className="shrink-0 px-4 py-2 text-[13px] bg-[#12301f] text-[#b7f7d1] border-b border-white/[0.06]">
            {toast}
          </p>
        ) : null}
        {inbox.map((invite) => (
          <div key={invite.id} className="shrink-0 px-4 py-2 text-[13px] bg-[#1a2433] text-zinc-100 border-b border-white/[0.06] flex flex-wrap items-center gap-2">
            <span>You&apos;re invited to {invite.teamName}</span>
            <button
              type="button"
              className="h-7 px-2 rounded-md bg-[#2563eb] text-white"
              onClick={() =>
                void engine
                  .acceptInvite({ id: invite.id, displayName })
                  .then(() => {
                    setToast(`You joined ${invite.teamName}`);
                    setInbox((rows) => rows.filter((row) => row.id !== invite.id));
                  })
                  .catch(() => undefined)
              }
            >
              Accept
            </button>
            <button
              type="button"
              className="h-7 px-2 rounded-md border border-white/[0.12]"
              onClick={() => void engine.declineInvite(invite.id).then(() => setInbox((rows) => rows.filter((row) => row.id !== invite.id)))}
            >
              Decline
            </button>
          </div>
        ))}
        <main
          className={`flex-1 min-h-0 min-w-0 bg-[#0f0f11] ${
            isImmersive ? 'overflow-hidden p-0' : 'overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-5'
          }`}
        >
          {restoring ? (
            <PageSkeleton />
          ) : (
            <Suspense fallback={<PageSkeleton />}>
              <Outlet context={{ user, displayName, homeTag: user.uid ? `u_${user.uid}` : '', memoryScope, setMemoryScope }} />
            </Suspense>
          )}
        </main>
      </div>
      {palette ? (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-start justify-center pt-[12vh]" onClick={() => setPalette('')}>
          <div className="w-[min(560px,92vw)] rounded-xl bg-[#161618] border border-white/[0.08] p-2" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Jump to a page or memory"
              className="w-full h-10 bg-transparent px-3 text-[14px] outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setPalette('');
              }}
            />
            {[
              ['Overview', '/overview'],
              ['Requests', '/requests'],
              ['API keys', '/api-keys?create=1'],
              ['Agents', '/agents'],
              ['Connectors', '/connectors'],
              ['Graph', '/memory-graph'],
            ]
              .filter((row) => row[0].toLowerCase().includes(query.toLowerCase()))
              .map((row) => (
                <button
                  key={row[1]}
                  className="w-full text-left px-3 py-2 text-[13px] text-zinc-200 hover:bg-white/[0.05] rounded-md"
                  onClick={() => {
                    setPalette('');
                    navigate(row[1]);
                  }}
                >
                  {row[0]}
                </button>
              ))}
            {memories.slice(0, 6).map((hit) => (
              <button
                key={hit.id}
                className="w-full text-left px-3 py-2 text-[13px] text-zinc-400 hover:bg-white/[0.05] rounded-md"
                onClick={() => {
                  setPalette('');
                  navigate(`/requests?id=${encodeURIComponent(hit.id)}`);
                }}
              >
                {hit.title || hit.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
