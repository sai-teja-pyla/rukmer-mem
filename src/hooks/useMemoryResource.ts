import { useCallback, useEffect, useRef, useState } from 'react';

export type MemoryPhase = 'loading' | 'error' | 'ready';

export const MEMORY_LOAD_TIMEOUT_MS = 12000;

export function withTimeout<T>(work: Promise<T>, ms = MEMORY_LOAD_TIMEOUT_MS) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('This is taking too long. Retry.')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function useMemoryResource<T>(loader: () => Promise<T>, opts?: { enabled?: boolean; refreshMs?: number; reloadKey?: string }) {
  const enabled = opts?.enabled !== false;
  const refreshMs = opts?.refreshMs ?? 0;
  const reloadKey = opts?.reloadKey ?? '';
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<MemoryPhase>('loading');
  const hasData = useRef(false);
  const seq = useRef(0);
  const inFlight = useRef(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const load = useCallback((force = false) => {
    if (!enabled) return;
    if (inFlight.current && !force) return;
    const id = ++seq.current;
    inFlight.current = true;
    if (!hasData.current) {
      setPhase('loading');
      setError('');
    }
    withTimeout(loaderRef.current())
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
      })
      .finally(() => {
        if (id === seq.current) inFlight.current = false;
      });
  }, [enabled]);

  const retry = useCallback(() => {
    hasData.current = false;
    inFlight.current = false;
    setData(null);
    setError('');
    setPhase('loading');
    load(true);
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
