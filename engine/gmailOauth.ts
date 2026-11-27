export type GmailToken = {
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
  connectedAt?: string;
  historyId?: string;
  lastSyncedAt?: string;
  spaceTag?: string;
  health?: 'ok' | 'reconnect_required';
  healthCheckedAt?: string;
};

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export function mergeGmailTokens(previous: GmailToken | undefined, next: Partial<GmailToken> | null | undefined): GmailToken {
  const incoming = next || {};
  return {
    ...(previous || {}),
    ...incoming,
    refresh_token: incoming.refresh_token || previous?.refresh_token,
    scope: incoming.scope || previous?.scope || GMAIL_SCOPE,
    connectedAt: previous?.connectedAt || new Date().toISOString(),
    historyId: incoming.historyId || previous?.historyId,
    spaceTag: incoming.spaceTag || previous?.spaceTag,
  };
}

export function isGmailAuthFailure(err: { message?: string; code?: string | number; response?: { data?: { error?: string } } } | null | undefined) {
  const blob = `${err?.message || ''} ${err?.code || ''} ${err?.response?.data?.error || ''}`.toLowerCase();
  return blob.includes('invalid_grant') || blob.includes('invalid_token') || blob.includes('unauthorized_client');
}

export function gmailFailureResponse(err: { message?: string; status?: number; code?: string | number; response?: { data?: { error?: string } } }) {
  if (isGmailAuthFailure(err)) {
    return {
      status: 409,
      body: { error: 'reconnect_required', message: 'Gmail access expired. Reconnect Gmail to continue syncing mail.' },
    };
  }
  return { status: err?.status && err.status >= 400 ? err.status : 500, body: { error: 'sync_failed', message: 'Could not sync Gmail.' } };
}

export function gmailConnectionStatus(record: GmailToken | undefined, healthOk?: boolean | null) {
  const scope = String(record?.scope || '');
  if (!record?.refresh_token) {
    return { connected: false, status: 'disconnected' as const, scope };
  }
  if (!scope.includes('gmail.readonly')) {
    return { connected: false, status: 'reconnect_required' as const, scope };
  }
  if (record.health === 'reconnect_required' || healthOk === false) {
    return { connected: false, status: 'reconnect_required' as const, scope };
  }
  return { connected: true, status: 'connected' as const, scope };
}
