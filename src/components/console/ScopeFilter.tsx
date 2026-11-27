import React from 'react';

export type MemoryScope = 'all' | 'private' | 'team';

const LABEL: Record<MemoryScope, string> = { all: 'Search all spaces', private: 'Personal', team: 'Organizations' };

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
    <div className={`flex gap-1 ${className}`} role="group" aria-label="Memory scope">
      {(['all', 'private', 'team'] as const).map((scope) => (
        <button
          key={scope}
          type="button"
          aria-pressed={value === scope}
          onClick={() => onChange(scope)}
          className={`min-h-11 sm:h-7 px-2.5 rounded-md text-base sm:text-[12px] border ${
            value === scope ? 'bg-white/[0.08] border-white/[0.14] text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {LABEL[scope]}
        </button>
      ))}
    </div>
  );
}
