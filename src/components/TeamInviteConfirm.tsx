import React from 'react';
import { inviteCopy, type InvitePhase } from '../services/teamInviteFlow';

export function TeamInviteConfirm({
  phase,
  sas = '',
  sasDigits = '',
  inviterName = '',
  onMatch,
  onMismatch,
}: {
  phase: InvitePhase;
  sas?: string;
  sasDigits?: string;
  inviterName?: string;
  onMatch?: () => void;
  onMismatch?: () => void;
}) {
  if (phase === 'confirm') {
    return (
      <div>
        <p className="text-[28px] tracking-wide">{sas}</p>
        <p className="text-[13px] text-zinc-500 mt-1">{sasDigits}</p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onMatch} className="h-9 px-3 rounded-lg bg-[#2563eb] text-[13px] text-white">
            They match
          </button>
          <button type="button" onClick={onMismatch} className="h-9 px-3 rounded-lg border border-white/[0.1] text-[13px]">
            Don&apos;t match
          </button>
        </div>
      </div>
    );
  }
  const copy = inviteCopy(phase, inviterName);
  return copy ? <p className="text-[13px] text-zinc-300">{copy}</p> : null;
}
