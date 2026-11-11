export type Features = {
  manual: boolean;
  autoRead: boolean;
  highlights: boolean;
  bookmarksImport: boolean;
  bookmarksSync: boolean;
  history: boolean;
  aiChat: boolean;
  gmail: boolean;
  gmailImportant: boolean;
  canvas: boolean;
  canvasAuto: boolean;
  canvasGrades: boolean;
  x: boolean;
  xAuto: boolean;
  xThread: boolean;
  xMessages: boolean;
};

export type Settings = {
  onboarded: boolean;
  captureEnabled: boolean;
  pauseUntil: number;
  features: Features;
  blocklist: string[];
  removedDefaults: string[];
  allowlistOnly: boolean;
  allowlist: string[];
  containerTag: string;
  gmailTag: string;
  canvasTag: string;
  xTag: string;
  gmailSenders: string[];
  gmailLabels: string[];
  gmailKeywords: string[];
  canvasDomain: string;
  historyDays: number;
  apiBase: string;
};

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  captureEnabled: false,
  pauseUntil: 0,
  features: {
    manual: false,
    autoRead: false,
    highlights: false,
    bookmarksImport: false,
    bookmarksSync: false,
    history: false,
    aiChat: false,
    gmail: false,
    gmailImportant: false,
    canvas: false,
    canvasAuto: false,
    canvasGrades: false,
    x: false,
    xAuto: false,
    xThread: false,
    xMessages: false,
  },
  blocklist: [],
  removedDefaults: [],
  allowlistOnly: false,
  allowlist: [],
  containerTag: 'browser',
  gmailTag: 'gmail',
  canvasTag: 'canvas',
  xTag: 'x',
  gmailSenders: [],
  gmailLabels: [],
  gmailKeywords: [],
  canvasDomain: '',
  historyDays: 7,
  apiBase: 'https://app.rukmer.com',
};

export function mergeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const input = raw || {};
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    features: { ...DEFAULT_SETTINGS.features, ...(input.features || {}) },
    blocklist: Array.isArray(input.blocklist) ? input.blocklist.map(String) : [],
    removedDefaults: Array.isArray(input.removedDefaults) ? input.removedDefaults.map(String) : [],
    allowlist: Array.isArray(input.allowlist) ? input.allowlist.map(String) : [],
    gmailSenders: Array.isArray(input.gmailSenders) ? input.gmailSenders.map(String) : [],
    gmailLabels: Array.isArray(input.gmailLabels) ? input.gmailLabels.map(String) : [],
    gmailKeywords: Array.isArray(input.gmailKeywords) ? input.gmailKeywords.map(String) : [],
    historyDays: Math.min(90, Math.max(1, Number(input.historyDays || DEFAULT_SETTINGS.historyDays))),
    apiBase: String(input.apiBase || DEFAULT_SETTINGS.apiBase).replace(/\/$/, ''),
    pauseUntil: Number(input.pauseUntil || 0),
  };
}

export function lines(value: string) {
  return value
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}
