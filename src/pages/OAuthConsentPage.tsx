import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { engine } from '../services/engineClient';

export default function OAuthConsentPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = params.get('client_id') || 'unknown client';
  const redirect = params.get('redirect_uri') || '';

  const allow = async () => {
    setBusy(true);
    setError('');
    try {
      const out = await engine.oauthCode({
        client_id: params.get('client_id'),
        redirect_uri: params.get('redirect_uri'),
        state: params.get('state'),
        code_challenge: params.get('code_challenge'),
        code_challenge_method: params.get('code_challenge_method'),
      });
      if (out.redirect) {
        window.location.assign(out.redirect);
        return;
      }
      throw new Error('No redirect from Rukmer');
    } catch (e: any) {
      setError(e.message || 'Could not connect');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-200 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#141416] p-6">
        <p className="text-[11px] tracking-[0.14em] text-zinc-500 mb-2">RUKMER MEMORY</p>
        <h1 className="text-[22px] font-semibold text-white mb-2">Allow this app to use your memory?</h1>
        <p className="text-[13px] text-zinc-400 leading-relaxed mb-4">
          {client} wants to search and save durable facts in your private Rukmer space. It cannot read other users, and it cannot import ChatGPT/Claude history.
        </p>
        {redirect && <p className="text-[11px] font-mono text-zinc-500 break-all mb-4">{redirect}</p>}
        {error && <p className="text-[13px] text-red-400 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={allow}
            className="h-10 px-4 rounded-lg bg-[#2563eb] text-[13px] text-white disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Allow'}
          </button>
          <button type="button" onClick={() => navigate('/overview')} className="h-10 px-4 text-[13px] text-zinc-400">
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
