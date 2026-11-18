import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { engine } from '../services/engineClient';
import { auth } from '../firebase';
import { useUserSettings } from '../hooks/useUserSettings';
import { browserKey, saveTeamKey } from '../services/teamKeys';
import { inviteePhase } from '../services/teamInviteFlow';
import { TeamInviteConfirm } from '../components/TeamInviteConfirm';
import { JoinTeamCard } from '../components/JoinTeamCard';

function sameEmail(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase() && !!left.trim();
}

export default function JoinTeamPage() {
  const { token = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { settings } = useUserSettings();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [preview, setPreview] = useState<any>(null);
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'joined' | 'pending' | 'wrong' | 'sas'>('loading');
  const autoStarted = useRef(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!token) return;
    let stop = false;
    engine
      .previewInvite(token)
      .then((row) => {
        if (stop) return;
        setPreview(row);
      })
      .catch((err) => {
        if (!stop) setError(err.message || 'This invite is not valid');
      });
    return () => {
      stop = true;
    };
  }, [token]);

  const join = async () => {
    setError('');
    try {
      const displayName = settings?.displayName || user?.displayName || '';
      const sas = preview?.sasRequired ? await browserKey() : null;
      const accepted = await engine.acceptInvite({ token, publicKey: sas?.publicKey || '', displayName });
      if (sas && accepted.id) await saveTeamKey(accepted.id, sas.privateKey);
      setInfo(accepted);
      if (accepted.sasRequired && !accepted.joined) {
        setState('sas');
        return;
      }
      if (accepted.status === 'pending') {
        setState('pending');
        return;
      }
      sessionStorage.setItem('rukmer.joinedTeam', String(accepted.teamName || preview?.teamName || 'the team'));
      navigate('/overview');
    } catch (err: any) {
      setError(err.message || 'Could not join the team');
    }
  };

  useEffect(() => {
    if (!preview || user === undefined) return;
    const invited = String(preview.email || '');
    if (!user) {
      const next = `/join/${token}?auto=1`;
      navigate(`/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invited)}`, { replace: true });
      return;
    }
    const mine = String(user.email || '').toLowerCase();
    if (invited && !sameEmail(mine, invited)) {
      setState('wrong');
      return;
    }
    if (search.get('auto') === '1' && !autoStarted.current) {
      autoStarted.current = true;
      void join();
      return;
    }
    setState((current) => (current === 'loading' ? 'ready' : current));
  }, [preview, user, token, search]);

  const confirm = async (match: boolean) => {
    if (!info?.id) return;
    try {
      const out = await engine.confirmInvite(info.id, match);
      if (!match || out.status === 'revoked') {
        setError('Invite revoked');
        return;
      }
      setInfo((current: any) => ({ ...current, ...out, inviteeConfirmed: true, status: out.status }));
      if (out.status === 'confirmed') {
        sessionStorage.setItem('rukmer.joinedTeam', String(preview?.teamName || 'the team'));
        navigate('/overview');
      }
    } catch (err: any) {
      setError(err.message || 'Could not confirm');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-100 flex items-center justify-center px-6">
      <div className="max-w-md w-full rounded-2xl border border-white/[0.08] bg-[#141416] p-6">
        {error ? <p className="mb-3 text-[13px] text-red-300">{error}</p> : null}
        {state === 'loading' && !error ? <p className="text-[13px] text-zinc-400">Opening the invite…</p> : null}
        {preview && (state === 'ready' || state === 'pending' || state === 'wrong') ? (
          <JoinTeamCard
            teamName={preview.teamName || 'the team'}
            inviterName={preview.inviterName || 'A teammate'}
            state={state}
            wrongEmail={preview.email}
            onJoin={() => void join()}
          />
        ) : null}
        {state === 'sas' && info ? (
          <TeamInviteConfirm
            phase={inviteePhase(info)}
            sas={info.sas}
            sasDigits={info.sasDigits}
            inviterName={info.inviterName}
            onMatch={() => void confirm(true)}
            onMismatch={() => void confirm(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
