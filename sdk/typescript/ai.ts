import { RukmerClient } from './client.js';

type TextPart = { type?: string; text?: string };
type PromptMessage = { role?: string; content?: string | TextPart[] };

function textOf(message: PromptMessage) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) return message.content.map((p) => p.text || '').join(' ');
  return '';
}

/**
 * Vercel AI SDK middleware shape. Pass the return value as `middleware` on wrapLanguageModel.
 * This file does not import the `ai` package.
 */
export function rukmerMiddleware(client: RukmerClient, extra: Record<string, unknown> = {}) {
  return {
    specificationVersion: 'v3' as const,
    transformParams: async ({ params }: { params: { prompt?: PromptMessage[] } }) => {
      const prompt = params.prompt || [];
      const last = [...prompt].reverse().find((m) => m.role === 'user');
      const query = last ? textOf(last) : '';
      if (!query) return params;
      const injected = (await client.inject(query, extra)) as { injection?: string };
      if (!injected.injection) return params;
      return {
        ...params,
        prompt: [{ role: 'system', content: injected.injection }, ...prompt],
      };
    },
  };
}
