import { useCallback, useEffect, useRef, useState } from 'react';

export type MemoryPhase = 'loading' | 'error' | 'ready';

export function useMemoryResource<T>(loader: () => Promise<T>, opts?: { enabled?: boolean; refreshMs?: number; reloadKey?: string }) {
  const enabled = opts?.enabled !== false;
  const refreshMs = opts?.refreshMs ?? 0;
  const reloadKey = opts?.reloadKey ?? '';
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<MemoryPhase>('loading');
  const hasData = useRef(false);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback(() => {
    if (!enabled) return;
    const id = ++seq.current;
    if (!hasData.current) {
      setPhase('loading');
      setError('');
    }
    loaderRef
      .current()
      .then((value) => {
        if (id !== seq.current) return;
        hasData.current = true;
        setData(value);
        setError('');
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (id !== seq.current || hasData.current) return;
        const message = err instanceof Error && err.message ? err.message : 'Could not load';
        setData(null);
        setError(message);
        setPhase('error');
      });
  }, [enabled]);

  const retry = useCallback(() => {
    hasData.current = false;
    setData(null);
    setError('');
    setPhase('loading');
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    load();
    if (!refreshMs) return;
    const timer = setInterval(() => {
      if (hasData.current) load();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [enabled, load, refreshMs, reloadKey]);

  return { data, error, phase, retry, reload: load };
}
