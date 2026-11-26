import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useUserSettings } from '../hooks/useUserSettings';

const SECTIONS = [
  { id: 'getting-started', label: 'Getting started' },
  { id: 'connect', label: 'Connect ChatGPT, Claude, Grok' },
  { id: 'agents', label: 'Agents' },
  { id: 'container-tags', label: 'Container tags' },
  { id: 'import', label: 'Import' },
  { id: 'api-keys', label: 'API keys' },
  { id: 'playground', label: 'Playground' },
  { id: 'memories', label: 'Memories' },
  { id: 'insights', label: 'User insights' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'usage', label: 'Usage' },
  { id: 'billing', label: 'Billing' },
];

const MCP_URL = 'https://app.rukmer.com/mcp';

export default function DocsPage() {
  const { hash } = useLocation();
  const { settings } = useUserSettings();
  const isDark = settings?.theme === 'dark';
  const active = hash.replace(/^#/, '') || 'getting-started';

  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!id) return;
    const scroll = () => document.getElementById(id)?.scrollIntoView({ block: 'start' });
    scroll();
    const frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  const theme = {
    bg: isDark ? 'bg-[#0f0f0f]' : 'bg-slate-50',
    text: isDark ? 'text-gray-200' : 'text-gray-800',
    sidebar: isDark ? 'bg-[#1a1a1a] border-gray-800' : 'bg-white border-gray-200',
    card: isDark ? 'bg-[#1a1a1a] border-gray-800' : 'bg-white border-gray-200',
    header: isDark ? 'text-white' : 'text-gray-900',
    muted: isDark ? 'text-gray-400' : 'text-gray-600',
    active: isDark ? 'bg-blue-600/10 text-blue-400' : 'bg-blue-50 text-blue-700',
    inactive: isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900',
  };

  return (
    <div className={`min-h-screen flex flex-col md:flex-row ${theme.bg} ${theme.text}`}>
      <aside className={`w-full md:w-72 border-r p-6 flex-shrink-0 md:sticky md:top-0 md:h-screen md:overflow-y-auto ${theme.sidebar}`}>
        <Link to="/help" className="flex items-center gap-2 mb-8 text-sm font-medium hover:text-blue-500">
          <ArrowLeft size={16} /> Back to Help
        </Link>
        <h2 className="text-xs font-bold uppercase tracking-wider opacity-50 mb-4">Documentation</h2>
        <nav className="space-y-1">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={`block px-3 py-2 rounded-lg text-sm ${active === section.id ? theme.active : theme.inactive}`}
            >
              {section.label}
            </a>
          ))}
        </nav>
      </aside>

      <main className="flex-1 p-8 md:p-12">
        <div className="max-w-3xl mx-auto space-y-14 leading-relaxed">
          <section id="getting-started" className="scroll-mt-8">
            <h1 className={`text-3xl font-bold mb-4 ${theme.header}`}>Getting started</h1>
            <p>
              Rukmer is a memory layer for you and your agents. Chat, search, and connected apps read the same private store.
            </p>
            <ol className="list-decimal pl-5 mt-4 space-y-2">
              <li>Sign in. Rukmer creates a home container tag for your account.</li>
              <li>Add memories from Import, or by chatting in Playground.</li>
              <li>Search them in Playground, or from the sidebar search.</li>
              <li>Connect ChatGPT, Claude, Grok, or a coding agent when you want those tools to use the same memory.</li>
            </ol>
          </section>

          <section id="connect" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>Connect ChatGPT, Claude, and Grok</h2>
            <p>
              Chat apps connect with a custom MCP URL. Rukmer OAuth signs you in once. You do not paste a ChatGPT, Claude, or Grok API key.
            </p>
            <p className={`mt-4 p-4 rounded-lg border font-mono text-sm break-all ${theme.card}`}>{MCP_URL}</p>
            <ul className="list-disc pl-5 mt-4 space-y-2">
              <li>ChatGPT: Settings → Connectors. Create a connector and paste the MCP URL, then Allow Rukmer.</li>
              <li>Claude: add the Rukmer connector and approve the sign-in in the browser.</li>
              <li>Grok: paste the same MCP URL and Allow Rukmer.</li>
            </ul>
            <p className={`mt-4 text-sm ${theme.muted}`}>Gemini connectors are coming soon. Open Connectors in the console to copy the URL for this site.</p>
          </section>

          <section id="agents" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>Agents</h2>
            <p>Cursor, Claude Code, and Codex use the same MCP endpoint. They share this workspace’s memory after you sign in.</p>
            <ul className="list-disc pl-5 mt-4 space-y-2">
              <li>Cursor: Settings → MCP → New MCP server, then paste {MCP_URL} and Allow Rukmer.</li>
              <li>Claude Code: install the Rukmer plugin, restart, and approve the browser sign-in.</li>
              <li>Codex: add an MCP server with that URL, restart, and approve Rukmer.</li>
            </ul>
            <p className={`mt-4 text-sm ${theme.muted}`}>There is no npm package named rukmer. The Agents page in the console has the exact commands.</p>
          </section>

          <section id="container-tags" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>Container tags</h2>
            <p>
              A container tag is one memory space. Your home tag holds your own memories. Add another tag for a project, a customer, or a workspace so those memories stay separate.
            </p>
            <p className="mt-4">Playground, Import, and search all use the tag you pick. Memories in one tag are not returned for another.</p>
          </section>

          <section id="import" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>Import</h2>
            <p>Import adds files, URLs, and pasted text to the container tag you select. Drop a file, paste a URL, or paste up to 50,000 characters with an optional title. Finished documents show in that tag’s file list.</p>
            <p className="mt-4">A tag with no stored documents says so only after the list has loaded. Processing jobs stay in their own list until they finish.</p>
          </section>

          <section id="api-keys" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>API keys</h2>
            <p>
              Rukmer API keys (they start with <span className="font-mono">rk_live_</span>) let your own apps call the memory API. Create them on API Keys. They are separate from provider keys for Gemini, OpenAI, Anthropic, and xAI.
            </p>
            <p className="mt-4">
              Provider keys are only needed when Playground chats with a model that has no server key. Add those from the plug icon in Playground or Settings → Advanced. Search does not need a provider key.
            </p>
          </section>

          <section id="playground" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>Playground</h2>
            <p>Chat and Search use the same container tag and the same memories. They do different jobs.</p>
            <ul className="list-disc pl-5 mt-4 space-y-2">
              <li>Chat asks a model and injects memories that meet match strictness. It needs a model key, from the server or from Settings → Advanced.</li>
              <li>Search looks up memories and does not call a model. It works with no model key.</li>
            </ul>
            <p className="mt-4">
              Match strictness is a score from 0 to 1. The default is 0.40. A memory is used only when its relevance is at least that high. Raise it to keep fewer, closer memories.
            </p>
          </section>

          <section id="memories" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>Memories</h2>
            <p>
              Memories lists what this account can read. Search, filters, and pages narrow the list. Add memory saves a note you type, including a short one. Delete hides it and offers Undo for a few seconds. Delete permanently removes it. Clean up previews duplicates, auto-saved model chats, and expired rows before anything is removed. Retention on the same page sets how long each kind is kept. 0 means keep.
            </p>
          </section>

          <section id="insights" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>User insights</h2>
            <p>
              Insights count the documents, folders, and memories already stored in this workspace. The numbers appear after the store responds. An empty workspace shows zeros only once that response says the store is empty.
            </p>
          </section>

          <section id="profiles" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>Profiles</h2>
            <p>
              Settings → General is the organization profile: name, appearance, and the context Rukmer can use when a question is about you. Profile facts are added to chat only when the question is about you, or when the fact itself matches the search.
            </p>
          </section>

          <section id="usage" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>Usage</h2>
            <p>Requests lists each API call with its timing and status. The count is the number of calls recorded for this workspace, not an estimate.</p>
          </section>

          <section id="billing" className="scroll-mt-8">
            <h2 className={`text-2xl font-bold mb-4 ${theme.header}`}>Billing</h2>
            <p>Plan, balance, and invoices are on Settings → Billing. That page is where you review the current plan and open an invoice.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
