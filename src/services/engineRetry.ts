export function retryDelayMs(attempt: number, retryAfterHeader: string | null) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 8000);
  return Math.min(300 * 2 ** attempt, 4000);
}

export function isTransientStatus(status: number) {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

type RequestOpts = {
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  headers?: () => Promise<Record<string, string>>;
  unauthorized?: () => Promise<boolean>;
  maxRetries?: number;
};

function methodOf(init?: RequestInit) {
  return String(init?.method || 'GET').toUpperCase();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestJson(url: string, init?: RequestInit, opts: RequestOpts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const wait = opts.wait || sleep;
  const maxRetries = opts.maxRetries ?? 3;
  const method = methodOf(init);
  let transient = 0;
  let refreshed = false;

  for (;;) {
    const headers = { ...(opts.headers ? await opts.headers() : {}), ...((init?.headers as Record<string, string>) || {}) };
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, cache: 'no-store', headers });
    } catch {
      if (method === 'GET' && transient < maxRetries) {
        await wait(retryDelayMs(transient, null));
        transient += 1;
        continue;
      }
      throw new Error('Could not reach the memory store');
    }

    const raw = await res.text();
    let data: any = {};
    let parsed = true;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = false;
      data = {};
    }

    if (res.status === 401 && !refreshed && opts.unauthorized) {
      refreshed = true;
      if (await opts.unauthorized()) {
        await wait(400);
        continue;
      }
    }

    const loading = res.status === 503 && (data.error === 'warming_up' || data.ready === false || /still loading|warming/i.test(String(data.error || '')));
    const retryable = !res.ok && (method === 'GET' ? isTransientStatus(res.status) : loading);
    if (retryable && transient < maxRetries) {
      await wait(retryDelayMs(transient, res.headers.get('Retry-After')));
      transient += 1;
      continue;
    }

    if (!res.ok) {
      const message = !parsed
        ? `Memory engine ${res.status}`
        : loading
          ? 'Memory is still loading. Try again.'
          : data.error || `Memory engine ${res.status}`;
      throw new Error(typeof message === 'string' ? message : `Memory engine ${res.status}`);
    }
    if (!parsed && raw) throw new Error('Memory engine returned a non-JSON response');
    return data;
  }
}
