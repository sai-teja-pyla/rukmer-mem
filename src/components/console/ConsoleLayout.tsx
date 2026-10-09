import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Tag,
  Share2,
  Unplug,
  Download,
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
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import type { LucideIcon } from 'lucide-react';
import type { UserProfile } from '../../types';
import { useUserSettings } from '../../hooks/useUserSettings';

interface ConsoleLayoutProps {
  user: UserProfile;
}

type NavItem =
  | { section: string }
  | { to: string; label: string; icon: LucideIcon; chevron?: boolean };

const nav: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/playground', label: 'Playground', icon: MessageSquare },
  { section: 'DATA' },
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

export default function ConsoleLayout({ user }: ConsoleLayoutProps) {
  const { settings } = useUserSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useLayoutEffect(() => {
    document.body.classList.add('dark-mode');
    document.body.classList.remove('light-mode');
    document.body.style.backgroundColor = '#0a0a0b';
  }, [location.pathname]);

  useEffect(() => {
    setNavOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const displayName = settings?.displayName || user.name || 'User';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || 'U';

  const isSettings = location.pathname.startsWith('/settings');
  const activeNav = isSettings ? settingsNav : nav;
  const current = [...nav, ...settingsNav].find(
    (item): item is Extract<NavItem, { to: string }> => !('section' in item) && location.pathname.startsWith(item.to)
  );
  const pageTitle = current?.label || 'Rukmer';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeNav;
    return activeNav.filter((item) => !('section' in item) && item.label.toLowerCase().includes(q));
  }, [query, activeNav]);

  const isImmersive =
    location.pathname.startsWith('/playground') || location.pathname.startsWith('/memory-graph');

  const sidebar = (
    <>
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 rounded-lg bg-[#141416] border border-white/[0.06] px-2.5 h-[34px]">
          <Search size={14} className="text-zinc-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
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
      </nav>

      <div className="px-3 pb-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="rounded-xl border border-white/[0.06] bg-[#121214] p-3 mb-3 hidden sm:block">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] font-medium text-zinc-400">What's new</p>
            <p className="text-[10px] text-zinc-600">Sep 14</p>
          </div>
          <p className="text-[12.5px] font-medium text-zinc-100 leading-snug">A new console sidebar</p>
          <p className="text-[11.5px] text-zinc-500 mt-1 leading-snug">
            Grouped navigation, a settings panel of its own, and documents browsed.
          </p>
        </div>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-full flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-white/[0.04]"
          >
            <div className="h-7 w-7 rounded-full bg-[#1a1a1e] border border-white/10 flex items-center justify-center text-[10px] font-semibold text-zinc-200">
              {initials}
            </div>
            <span className="flex-1 text-left text-[13px] text-zinc-300 truncate">{displayName}</span>
            <MoreHorizontal size={16} className="text-zinc-500" />
          </button>
          {menuOpen && (
            <div className="absolute bottom-10 left-0 right-0 rounded-lg border border-white/[0.08] bg-[#161618] shadow-xl p-1 z-20">
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
    <div className="h-[100dvh] w-full max-w-[100vw] overflow-hidden bg-[#0a0a0b] text-zinc-200 flex">
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
          <p className="text-[14px] font-medium text-white truncate">{pageTitle}</p>
        </header>
        <main
          className={`flex-1 min-h-0 min-w-0 bg-[#0f0f11] ${
            isImmersive ? 'overflow-hidden p-0' : 'overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-5'
          }`}
        >
          <Outlet context={{ user, displayName, homeTag: user.uid ? `u_${user.uid}` : '' }} />
        </main>
      </div>
    </div>
  );
}
