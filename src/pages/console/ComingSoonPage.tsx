import React from 'react';
import { useLocation } from 'react-router-dom';

const titles: Record<string, { title: string; body: string }> = {
  '/container-tags': {
    title: 'Container Tags',
    body: 'Isolate memory by workspace or project. This view is next after Overview.',
  },
  '/memory-graph': {
    title: 'Memory Graph',
    body: 'Visualize extracted facts and relationships across ingested sources.',
  },
  '/connectors': {
    title: 'Connectors',
    body: 'Connect Slack, Gmail, Drive, Teams, Outlook, and OneDrive from this panel next.',
  },
  '/import': {
    title: 'Import',
    body: 'Upload files and URLs into Rukmer memory from one place.',
  },
  '/api-keys': {
    title: 'API Keys',
    body: 'Create and revoke keys for agents and MCP clients.',
  },
  '/agents-mcp': {
    title: 'Agents & MCP',
    body: 'Wire Cursor, Claude Code, and other agents into this workspace.',
  },
  '/requests': {
    title: 'Requests',
    body: 'Inspect API traffic for ingest, search, and chat.',
  },
  '/insights': {
    title: 'User Insights',
    body: 'Usage and memory coverage for each signed-in user.',
  },
};

export default function ComingSoonPage() {
  const { pathname } = useLocation();
  const copy = titles[pathname] || { title: 'Coming next', body: 'This panel is part of the new console. We will build it after Overview.' };

  return (
    <div className="h-full min-h-[70vh] rounded-2xl border border-white/[0.07] bg-[#111113] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-[11px] tracking-[0.16em] uppercase text-zinc-600 mb-3">Next up</p>
        <h1 className="text-2xl font-semibold text-white mb-2">{copy.title}</h1>
        <p className="text-[13.5px] text-zinc-400 leading-relaxed">{copy.body}</p>
      </div>
    </div>
  );
}
