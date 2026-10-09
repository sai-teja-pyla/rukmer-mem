import React from 'react';
import { Link } from 'react-router-dom';

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-5">
      <div className="min-w-0">
        <h1 className="text-[20px] sm:text-[22px] font-semibold text-white tracking-tight">{title}</h1>
        <p className="text-[13px] text-zinc-400 mt-1 leading-relaxed">{subtitle}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function DocLink({ children }: { children: React.ReactNode }) {
  return (
    <Link to="/docs" className="text-[#60a5fa] hover:underline">
      {children}
    </Link>
  );
}

export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.08] bg-[#111113] ${className}`}>{children}</div>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-6 px-4 py-3.5 border-t border-white/[0.06] first:border-t-0">
      <div className="min-w-0">
        <p className="text-[13.5px] text-zinc-200">{label}</p>
        {hint && <p className="text-[12px] text-zinc-500 mt-0.5 max-w-md">{hint}</p>}
      </div>
      <div className="shrink-0 max-w-full overflow-x-auto">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="h-10 w-10 rounded-lg border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-zinc-500 mb-3">
        {icon}
      </div>
      <p className="text-[15px] font-medium text-zinc-100">{title}</p>
      <p className="text-[13px] text-zinc-500 mt-1 max-w-sm">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`h-[22px] w-10 rounded-full relative shrink-0 transition-colors ${on ? 'bg-[#2563eb]' : 'bg-zinc-700'}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-[3px]'}`} />
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-[13px] font-medium ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/[0.1] text-[13px] text-zinc-300 hover:bg-white/[0.04] ${className}`}
    >
      {children}
    </button>
  );
}

export function FilterChip({ children }: { children: React.ReactNode }) {
  return (
    <button className="h-8 px-3 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300 inline-flex items-center gap-1.5">
      {children}
    </button>
  );
}

export function TableHead({ cols }: { cols: string[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="grid px-4 py-2.5 text-[11px] tracking-[0.08em] text-zinc-500 border-b border-white/[0.06] whitespace-nowrap min-w-[560px]" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0,1fr))` }}>
        {cols.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
    </div>
  );
}

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          /* ignore */
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-2 h-8 max-w-full px-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0e] text-[12.5px] text-zinc-300 font-mono truncate"
    >
      {copied ? 'Copied' : value}
    </button>
  );
}
