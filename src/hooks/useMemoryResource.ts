import { useQuery, useQueryClient } from '@tanstack/react-query';

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
  const reloadKey = opts?.reloadKey ?? '';
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['memory-resource', reloadKey],
    queryFn: () => withTimeout(loader()),
    enabled,
    placeholderData: (previous) => previous,
  });
  const phase: MemoryPhase = query.isPending ? 'loading' : query.isError && query.data == null ? 'error' : 'ready';
  const retry = () => {
    void client.resetQueries({ queryKey: ['memory-resource', reloadKey] });
  };
  return { data: (query.data as T | undefined) ?? null, error: query.error instanceof Error ? query.error.message : '', phase, retry, reload: () => void query.refetch() };
}
