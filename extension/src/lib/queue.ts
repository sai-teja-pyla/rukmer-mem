export type Job = {
  id: string;
  sourceRef: string;
  contentHash: string;
  attempts: number;
  nextAt: number;
  body: Record<string, unknown>;
};

export function enqueue(queue: Job[], job: Job) {
  return [...queue.filter((item) => item.sourceRef !== job.sourceRef), job];
}

export function takeReady(queue: Job[], now: number, limit: number) {
  return queue.filter((item) => item.nextAt <= now).slice(0, Math.max(0, limit));
}

export function retryAt(attempts: number, now: number, retryAfterSec = 0) {
  const backoff = Math.min(15 * 60, Math.max(2, 2 ** Math.max(1, attempts)));
  return now + Math.max(backoff, retryAfterSec) * 1000;
}

export function dropJobs(queue: Job[], sourceRefs: string[]) {
  const gone = new Set(sourceRefs);
  return queue.filter((item) => !gone.has(item.sourceRef));
}
