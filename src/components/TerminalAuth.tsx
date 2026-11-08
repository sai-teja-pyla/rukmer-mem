import { useEffect, useRef, useState, type ReactNode } from 'react';

export type TermLine =
  | { kind: 'meta' }
  | { kind: 'gap' }
  | { kind: 'cmd' | 'out' | 'item'; text: string }
  | { kind: 'load'; text: string };

export const signInLines: TermLine[] = [
  { kind: 'meta' },
  { kind: 'gap' },
  { kind: 'cmd', text: 'RUKMER' },
  { kind: 'out', text: 'SYSTEM INITIALIZED...' },
  { kind: 'load', text: 'LOADING MEMORY LAYER' },
  { kind: 'gap' },
  { kind: 'item', text: 'PRIVATE BY DEFAULT' },
  { kind: 'item', text: 'SEARCH WHAT YOU STORED' },
  { kind: 'item', text: 'FORGET ON REQUEST' },
  { kind: 'gap' },
  { kind: 'out', text: 'SIGN IN TO CONTINUE' },
];

export const signUpLines: TermLine[] = [
  { kind: 'meta' },
  { kind: 'gap' },
  { kind: 'cmd', text: 'RUKMER --NEW' },
  { kind: 'out', text: 'SESSION READY...' },
  { kind: 'load', text: 'LOADING CREATIVE MODULES' },
  { kind: 'gap' },
  { kind: 'item', text: 'BUILD YOUR MEMORY' },
  { kind: 'item', text: 'KEEP IT PRIVATE' },
  { kind: 'item', text: 'TAKE IT WITH YOU' },
  { kind: 'gap' },
  { kind: 'out', text: 'CREATE YOUR ACCOUNT' },
];

function stamp() {
  const d = new Date();
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const h24 = d.getHours();
  const h = h24 % 12 || 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  const am = h24 >= 12 ? 'PM' : 'AM';
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} AT ${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${am}`;
}

function prefix(line: TermLine) {
  if (line.kind === 'cmd') return '$ ';
  if (line.kind === 'out' || line.kind === 'load') return '> ';
  if (line.kind === 'item') return '- ';
  return '';
}

export default function TerminalAuth({
  title,
  lines,
  children,
}: {
  title: string;
  lines: TermLine[];
  children: ReactNode;
}) {
  const [loginAt] = useState(stamp);
  const [step, setStep] = useState(0);
  const [partial, setPartial] = useState('');
  const [bar, setBar] = useState(0);
  const [done, setDone] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDone(true);
      setStep(lines.length);
      return;
    }
    alive.current = true;
    const timers: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });

    (async () => {
      for (let i = 0; i < lines.length; i++) {
        if (!alive.current) return;
        const line = lines[i];
        setStep(i);
        setPartial('');
        setBar(0);
        if (line.kind === 'meta') {
          await wait(360);
          continue;
        }
        if (line.kind === 'gap') {
          await wait(140);
          continue;
        }
        for (let c = 1; c <= line.text.length; c++) {
          if (!alive.current) return;
          setPartial(line.text.slice(0, c));
          await wait(16);
        }
        if (line.kind === 'load') {
          for (let p = 4; p <= 100; p += 4) {
            if (!alive.current) return;
            setBar(p);
            await wait(16);
          }
        }
        await wait(line.kind === 'load' ? 280 : 70);
      }
      if (alive.current) {
        setStep(lines.length);
        setPartial('');
        setDone(true);
      }
    })();

    return () => {
      alive.current = false;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [lines]);

  const skip = () => {
    alive.current = false;
    setStep(lines.length);
    setPartial('');
    setBar(100);
    setDone(true);
  };

  const visible = done ? lines.length : step + (partial ? 1 : 1);

  return (
    <div className="min-h-screen bg-[#f3f3f4] text-black flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-3xl bg-white border border-black/10 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="relative flex items-center justify-center h-11 border-b border-black/10">
            <div className="absolute left-4 flex gap-2">
              <span className="w-3 h-3 rounded-full border border-black/30" />
              <span className="w-3 h-3 rounded-full border border-black/30" />
              <span className="w-3 h-3 rounded-full border border-black/30" />
            </div>
            <div className="text-[11px] tracking-[0.28em] font-medium">{title}</div>
            {!done && (
              <button
                type="button"
                onClick={skip}
                className="absolute right-4 text-[11px] tracking-widest text-black/40 hover:text-black"
              >
                SKIP
              </button>
            )}
          </div>

          <div
            className="px-6 sm:px-10 py-8 sm:py-10 min-h-[460px] font-mono text-[13px] sm:text-sm leading-7"
            style={{ fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace' }}
          >
            {lines.slice(0, Math.min(visible, lines.length)).map((line, i) => {
              const active = !done && i === step;
              if (line.kind === 'gap') return <div key={i} className="h-3" />;
              if (line.kind === 'meta') {
                return (
                  <div key={i} className="tracking-wide">
                    LAST LOGIN: {loginAt}
                  </div>
                );
              }
              const text = active ? partial : line.text;
              return (
                <div key={i} className="flex flex-wrap items-center gap-x-3">
                  <span>
                    {prefix(line)}
                    {text}
                    {active && line.kind !== 'load' && <span className="term-cursor" />}
                  </span>
                  {line.kind === 'load' && (active ? bar > 0 : !active) && (
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 bg-black"
                        style={{ width: `${Math.round((active ? bar : 100) * 1.15)}px` }}
                      />
                      <span>{active ? bar : 100}%</span>
                      {active && <span className="term-cursor" />}
                    </span>
                  )}
                </div>
              );
            })}

            {done && <div className="term-form mt-6 border-t border-black/10 pt-6">{children}</div>}
            {!done && step === 0 && !partial && <span className="term-cursor" />}
          </div>
        </div>
      </div>
      <footer className="py-6 text-center text-xs text-black/40 font-mono">
        <div className="flex justify-center gap-6 mb-2">
          <a href="/terms.html" className="hover:text-black">Terms</a>
          <a href="/privacy.html" className="hover:text-black">Privacy</a>
          <a href="/cookies.html" className="hover:text-black">Cookies</a>
        </div>
        <div>&copy; 2026 Rukmer Inc.</div>
      </footer>
    </div>
  );
}
