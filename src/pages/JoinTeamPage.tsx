import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { engine } from '../services/engineClient';

const DB = 'rukmer-team-keys';
const STORE = 'keys';

async function browserKey(inviteId: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('spki', pair.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const publicKey = btoa(String.fromCharCode(...new Uint8Array(pub)));
  await new Promise<void>((resolve) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(btoa(String.fromCharCode(...new Uint8Array(priv))), inviteId);
      tx.oncomplete = () => resolve();
    };
    open.onerror = () => resolve();
  });
  return publicKey;
}

export default function JoinTeamPage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    let stop = false;
    const run = async () => {
      try {
        const publicKey = await browserKey(token);
        const accepted = await engine.acceptInvite({ token, publicKey });
        if (!stop) setInfo(accepted);
      } catch (err: any) {
        if (!stop) setError(err.message || 'This invite is not valid');
      }
    };
    if (token) void run();
    return () => {
      stop = true;
    };
  }, [token]);
  useEffect(() => {
    if (!info?.id || done) return;
    const timer = window.setInterval(() => {
      engine.readInvite(info.id).then((row) => {
        if (row.status === 'confirmed') setDone(row.sas || info.sas || '');
      }).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [info, done]);
  const confirm = async (match: boolean) => {
    if (!info?.id) return;
    try {
      const out = await engine.confirmInvite(info.id, match);
      setDone(match ? out.sas || info.sas : 'Invite revoked');
    } catch (err: any) {
      setError(err.message || 'Could not confirm');
    }
  };
  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-100 flex items-center justify-center px-6">
      <div className="max-w-md w-full rounded-2xl border border-white/[0.08] bg-[#141416] p-6">
        <h1 className="text-[22px] font-semibold">Join {info?.teamName || 'the team'}</h1>
        {error ? <p className="mt-3 text-[13px] text-red-300">{error}</p> : null}
        {info && !done ? (
          <>
            <p className="mt-3 text-[13px] text-zinc-400">{info.inviterName} invited you. Confirm the same code on both screens.</p>
            <p className="mt-4 text-[28px] tracking-wide">{info.sas || 'Waiting for both keys…'}</p>
            <p className="text-[13px] text-zinc-500 mt-1">{info.sasDigits}</p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => void confirm(true)} className="h-9 px-3 rounded-lg bg-[#2563eb] text-[13px]">
                They match
              </button>
              <button type="button" onClick={() => void confirm(false)} className="h-9 px-3 rounded-lg border border-white/[0.1] text-[13px]">
                Don't match
              </button>
            </div>
          </>
        ) : null}
        {done ? <p className="mt-4 text-[14px] text-zinc-200">{done === 'Invite revoked' ? done : `Team brain is live ${done}`}</p> : null}
      </div>
    </div>
  );
}
