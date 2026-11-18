import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { engine } from '../services/engineClient';
import { auth } from '../firebase';
import { useUserSettings } from '../hooks/useUserSettings';
import { browserKey, saveTeamKey } from '../services/teamKeys';
import { inviteePhase } from '../services/teamInviteFlow';
import { TeamInviteConfirm } from '../components/TeamInviteConfirm';

export default function JoinTeamPage() {
  const { token = '' } = useParams();
  const { settings, loading } = useUserSettings();
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!token || loading || started.current) return;
    started.current = true;
    let stop = false;
    const run = async () => {
      try {
        const displayName = settings?.displayName || auth.currentUser?.displayName || '';
        const keys = await browserKey();
        const accepted = await engine.acceptInvite({ token, publicKey: keys.publicKey, displayName });
        await saveTeamKey(accepted.id, keys.privateKey);
        if (!stop) setInfo(accepted);
      } catch (err: any) {
        if (!stop) setError(err.message || 'This invite is not valid');
      }
    };
    void run();
    return () => {
      stop = true;
    };
  }, [token, loading, settings?.displayName]);

  useEffect(() => {
    if (!info?.id || done) return;
    const tick = () => {
      engine
        .readInvite(info.id)
        .then((row) => {
          setInfo((current: any) => ({ ...current, ...row }));
          if (row.status === 'confirmed') setDone('live');
          if (row.status === 'revoked') setDone('Invite revoked');
        })
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 2000);
    return () => window.clearInterval(timer);
  }, [info?.id, done]);

  const confirm = async (match: boolean) => {
    if (!info?.id) return;
    try {
      const out = await engine.confirmInvite(info.id, match);
      if (!match || out.status === 'revoked') {
        setDone('Invite revoked');
        return;
      }
      setInfo((current: any) => ({ ...current, ...out, inviteeConfirmed: true, status: out.status }));
      if (out.status === 'confirmed') setDone('live');
    } catch (err: any) {
      setError(err.message || 'Could not confirm');
    }
  };

  const phase = done === 'live' ? 'live' : done === 'Invite revoked' ? 'revoked' : info ? inviteePhase(info) : 'waiting-keys';

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-100 flex items-center justify-center px-6">
      <div className="max-w-md w-full rounded-2xl border border-white/[0.08] bg-[#141416] p-6">
        <h1 className="text-[22px] font-semibold">Join {info?.teamName || 'the team'}</h1>
        {error ? <p className="mt-3 text-[13px] text-red-300">{error}</p> : null}
        {info || done ? (
          <>
            {phase === 'confirm' || phase === 'waiting-keys' ? (
              <p className="mt-3 text-[13px] text-zinc-400">{info?.inviterName || 'Your teammate'} invited you. Confirm the same code on both screens.</p>
            ) : null}
            <div className="mt-4">
              <TeamInviteConfirm
                phase={phase}
                sas={info?.sas}
                sasDigits={info?.sasDigits}
                inviterName={info?.inviterName}
                onMatch={() => void confirm(true)}
                onMismatch={() => void confirm(false)}
              />
            </div>
          </>
        ) : !error ? (
          <p className="mt-4 text-[13px] text-zinc-400">Opening the invite…</p>
        ) : null}
      </div>
    </div>
  );
}
