import React from 'react';

export type MemoryScope = 'all' | 'private' | 'team';

const SHORT: Record<MemoryScope, string> = { all: 'All', private: 'Personal', team: 'Org' };
const FULL: Record<MemoryScope, string> = { all: 'Search all spaces', private: 'Personal', team: 'Organizations' };

export function ScopeFilter({
  value,
  onChange,
  className = '',
}: {
  value: MemoryScope;
  onChange: (scope: MemoryScope) => void;
  className?: string;
}) {
  return (
    <div className={`flex w-full min-w-0 gap-1 overflow-hidden ${className}`} role="group" aria-label="Memory scope">
      {(['all', 'private', 'team'] as const).map((scope) => (
        <button
          key={scope}
          type="button"
          aria-pressed={value === scope}
          aria-label={FULL[scope]}
          title={FULL[scope]}
          onClick={() => onChange(scope)}
          className={`${scope === 'private' ? 'flex-[1.8]' : 'flex-1'} min-w-0 truncate whitespace-nowrap min-h-11 sm:h-7 px-1 rounded-md text-base sm:text-[12px] border ${
            value === scope ? 'bg-white/[0.08] border-white/[0.14] text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {SHORT[scope]}
        </button>
      ))}
    </div>
  );
}
