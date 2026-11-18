import React from 'react';

export function JoinTeamCard({
  teamName,
  inviterName,
  state,
  wrongEmail = '',
  onJoin,
}: {
  teamName: string;
  inviterName: string;
  state: 'ready' | 'joined' | 'pending' | 'wrong';
  wrongEmail?: string;
  onJoin?: () => void;
}) {
  return (
    <div>
      <h1 className="text-[22px] font-semibold">Join {teamName}</h1>
      <p className="mt-2 text-[13px] text-zinc-400">{inviterName} invited you.</p>
      {state === 'wrong' ? <p className="mt-4 text-[14px] text-zinc-200">This invite was sent to {wrongEmail} — switch account</p> : null}
      {state === 'ready' ? (
        <button type="button" onClick={onJoin} className="mt-5 h-9 px-3 rounded-lg bg-[#2563eb] text-[13px] text-white">
          Accept
        </button>
      ) : null}
      {state === 'pending' ? <p className="mt-4 text-[14px] text-zinc-200">Pending approval</p> : null}
      {state === 'joined' ? <p className="mt-4 text-[14px] text-zinc-200">You joined {teamName}</p> : null}
    </div>
  );
}
