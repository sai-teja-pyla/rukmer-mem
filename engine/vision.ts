import { geminiKey } from './llm.js';

export async function describeImage(base64: string, mime: string) {
  const kind = mime.startsWith('video/') ? 'video' : 'image';
  return describeMedia(base64, mime, kind);
}

async function describeMedia(base64: string, mime: string, kind: 'image' | 'video') {
  const data = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const key = geminiKey();
  if (!key) return `${kind === 'video' ? 'Video' : 'Image'} stored. Extraction needs GEMINI_API_KEY.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: kind === 'video'
                  ? 'This video is being stored as memory. Write a plain-text note: what happens, any spoken or on-screen text, and durable facts. Skip decoration.'
                  : 'This image is being stored as memory. Write a plain-text memory note: visible text (OCR), what the image shows, and any durable facts about the person. Skip decoration. If nothing important is visible, say so in one line.',
              },
              { inline_data: { mime_type: mime || 'image/png', data } },
            ],
          },
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    return text.trim() || 'Image stored with no extracted text.';
  } catch (err) {
    return `Image stored. Extraction failed: ${(err as Error).message.slice(0, 180)}`;
  } finally {
    clearTimeout(timer);
  }
}
