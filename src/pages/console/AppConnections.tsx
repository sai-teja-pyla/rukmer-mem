import React, { useEffect, useRef, useState } from 'react';
import { auth } from '../../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { Panel } from '../../components/console/ui';

function browserDisplayStatus(view: { hasKey?: boolean; items?: number }, extensionDetected: boolean) {
  if (!view?.hasKey) return 'disconnected';
  if (!extensionDetected) return 'extension_missing';
  if (!view.items) return 'setup_incomplete';
  return 'connected';
}

type GmailStatus = {
  connected?: boolean;
  status?: string;
  items?: number;
  lastSync?: string | null;
  space?: { label?: string };
  error?: string;
  message?: string;
};

function api(path: string) {
  const host = window.location.hostname;
  const origin = host === 'localhost' || host === '127.0.0.1' ? 'https://app.rukmer.com' : '';
  return `${origin}${path}`;
}

async function token() {
  if (auth.currentUser) return auth.currentUser.getIdToken();
  const user = await new Promise<typeof auth.currentUser>((resolve) => {
    const stop = onAuthStateChanged(auth, (next) => {
      stop();
      resolve(next);
    });
  });
  if (!user) throw new Error('Sign in required');
  return user.getIdToken();
}

async function call(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${await token()}`);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(api(path), { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || data.error || `Request failed (${res.status})`) as Error & { code?: string };
    error.code = data.error;
    throw error;
  }
  return data;
}

function chip(status: string) {
  if (status === 'connected') return 'Connected';
  if (status === 'reconnect_required') return 'Reconnect required';
  if (status === 'extension_missing') return 'Extension not detected';
  if (status === 'setup_incomplete') return 'Setup incomplete';
  if (status === 'error') return 'Error';
  return 'Not connected';
}

function SpacePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    call('/v4/teams').then((data) => setTeams(data.teams || [])).catch(() => setTeams([]));
  }, []);
  return (
    <label className="block text-[12px] text-zinc-400 mt-2">
      Saving new items to
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full max-w-xs rounded-lg border border-white/[0.08] bg-[#0c0c0e] px-2 text-zinc-100">
        <option value="">Personal memory</option>
        {teams.map((team) => (
          <option key={team.id} value={`tm_${team.id}`}>{team.name || 'Organization'}</option>
        ))}
      </select>
    </label>
  );
}

export function GmailAppCard() {
  const [info, setInfo] = useState<GmailStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [space, setSpace] = useState(() => localStorage.getItem('rukmer.app.gmail.space') || '');
  const chosen = space ? 'Organization' : 'Personal';
  const load = () => {
    call('/api/connectors/gmail').then(setInfo).catch(() => setInfo({ status: 'error', error: 'Could not read Gmail' }));
  };
  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail') === 'ok') setNote('Gmail is connected. Recent inbox mail is in memory.');
    if (params.get('gmail') === 'import_error') setNote('Gmail is connected. Recent mail did not finish importing. Sync again.');
    if (params.get('gmail') === 'reconnect') setNote('Gmail access expired. Reconnect Gmail to continue syncing mail.');
  }, []);
  const status = info?.status || 'disconnected';
  const reconnect = status === 'reconnect_required' || status === 'disconnected' || status === 'error';
  const connect = async () => {
    setBusy(true);
    setNote('');
    try {
      localStorage.setItem('rukmer.app.gmail.space', space);
      const data = await call(`/api/auth/gmail${space ? `?space=${encodeURIComponent(space)}` : ''}`);
      if (!data.url) throw new Error('Could not start Gmail');
      window.location.href = data.url;
    } catch (err: unknown) {
      setBusy(false);
      setNote(err instanceof Error ? err.message : 'Could not start Gmail');
    }
  };
  const sync = async () => {
    setBusy(true);
    setNote('');
    try {
      const data = await call('/api/connectors/gmail/sync', { method: 'POST', body: JSON.stringify({ containerTag: space || undefined }) });
      setNote(`Saved ${data.imported || 0} new message${data.imported === 1 ? '' : 's'}.`);
      load();
    } catch (err: unknown) {
      const coded = err as Error & { code?: string };
      setNote(coded.code === 'reconnect_required' ? 'Gmail access expired. Reconnect Gmail to continue syncing mail.' : coded.message || 'Could not sync Gmail');
      load();
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await call('/api/connectors/gmail/disconnect', { method: 'POST' });
      setNote('Disconnected. Mail already saved stays in memory.');
      load();
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : 'Could not disconnect Gmail');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="mb-4 p-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] text-white font-medium">Gmail</p>
          <p className="text-[12.5px] text-zinc-400 mt-1 break-words">Read-only inbox sync. Sign-in codes and password resets are skipped. {chip(status)}.</p>
          <p className="text-[12px] text-zinc-500 mt-2">{info?.items || 0} messages in memory · Saving to {info?.space?.label || chosen} memory</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {reconnect ? (
            <button type="button" onClick={() => void connect()} disabled={busy} className="min-h-11 px-3 rounded-lg bg-[#2563eb] text-[13px] text-white">{status === 'reconnect_required' ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
          ) : (
            <button type="button" onClick={() => void sync()} disabled={busy} className="min-h-11 px-3 rounded-lg bg-[#2563eb] text-[13px] text-white">Sync mail</button>
          )}
          <button type="button" onClick={() => void disconnect()} disabled={status === 'disconnected' || busy} className="min-h-11 px-3 rounded-lg border border-white/[0.08] text-[13px] text-zinc-300 disabled:opacity-40">Disconnect</button>
        </div>
      </div>
      <SpacePicker value={space} onChange={setSpace} />
      {note || info?.error ? <p className="text-[12.5px] mt-2 text-zinc-300 break-words">{note || info?.error}</p> : null}
    </Panel>
  );
}

export function BrowserAppCard() {
  const [info, setInfo] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [note, setNote] = useState('');
  const [pairing, setPairing] = useState(false);
  const load = () => call('/v4/connectors/browser').then(setInfo).catch(() => setInfo(null));
  useEffect(() => {
    load();
    const look = () => setInstalled(document.documentElement.dataset.rukmerExtension === '1');
    look();
    const timer = window.setInterval(look, 500);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; ok?: boolean; error?: string };
      if (!data || data.source !== 'rukmer-extension' || data.type !== 'paired') return;
      setPairing(false);
      setNote(data.ok ? 'This browser is connected. Turn on Manual save in the extension to store a page.' : data.error || 'Could not connect this browser');
      if (data.ok) load();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('message', onMessage);
    };
  }, []);
  const status = browserDisplayStatus(info || {}, installed);
  const install = () => {
    const link = document.createElement('a');
    link.href = '/rukmer-browser.zip';
    link.download = 'rukmer-browser.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setNote('Developer install: open chrome://extensions, turn on Developer mode, unzip the download, and choose Load unpacked. Then reload this page and click Connect Chrome.');
  };
  const connect = async () => {
    setPairing(true);
    setNote('');
    try {
      const pair = await call('/v4/connectors/browser/pair', { method: 'POST', body: '{}' });
      if (!installed) {
        setPairing(false);
        setNote('The Rukmer extension is not detected on this page. Install it, then click Connect Chrome.');
        return;
      }
      window.postMessage({ source: 'rukmer-page', type: 'pair', code: pair.code }, window.location.origin);
      window.setTimeout(() => setPairing(false), 8000);
    } catch (err: unknown) {
      setPairing(false);
      setNote(err instanceof Error ? err.message : 'Could not start the browser connection');
    }
  };
  const auto = useRef(false);
  useEffect(() => {
    if (!installed || auto.current) return;
    if (new URLSearchParams(window.location.search).get('connect') !== 'browser') return;
    auto.current = true;
    void connect();
  }, [installed]);
  const disconnect = async () => {
    await call('/v4/connectors/disconnect', { method: 'POST', body: JSON.stringify({ app: 'browser' }) });
    setNote('Disconnected. Pages already saved stay in memory.');
    load();
  };
  const healthy = status === 'connected';
  return (
    <Panel className="mb-4 p-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] text-white font-medium">Chrome</p>
          <p className="text-[12.5px] text-zinc-400 mt-1 break-words">{chip(status)}. Counts are pages the extension saved, not a server mail sync.</p>
          <p className="text-[12px] text-zinc-500 mt-2">{info?.items || 0} saved items{healthy && info?.lastSync ? ` · Last sync ${new Date(info.lastSync).toLocaleString()}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {installed ? (
            <button type="button" onClick={() => void connect()} disabled={pairing} className="min-h-11 px-3 rounded-lg bg-[#2563eb] text-[13px] text-white">{pairing ? 'Connecting…' : 'Connect Chrome'}</button>
          ) : (
            <button type="button" onClick={install} className="min-h-11 px-3 rounded-lg bg-[#2563eb] text-[13px] text-white">Developer install</button>
          )}
          <button type="button" onClick={() => void disconnect()} disabled={!info?.hasKey} className="min-h-11 px-3 rounded-lg border border-white/[0.08] text-[13px] text-zinc-300 disabled:opacity-40">Disconnect</button>
        </div>
      </div>
      {status === 'setup_incomplete' ? <p className="text-[12.5px] text-zinc-400 mt-2">Open the extension popup, turn on Manual save, then save a page. Gmail, Canvas, and X stay at 0 until those toggles are on.</p> : null}
      {note ? <p className="text-[12.5px] mt-2 text-zinc-300 break-words">{note}</p> : null}
    </Panel>
  );
}
