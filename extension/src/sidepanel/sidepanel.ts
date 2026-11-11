const hits = document.getElementById('hits') as HTMLDivElement;
const page = document.getElementById('page') as HTMLParagraphElement;
const form = document.getElementById('form') as HTMLFormElement;
const query = document.getElementById('q') as HTMLInputElement;

function show(matches: { title?: string; text?: string; score?: number; source?: string }[], error?: string) {
  hits.replaceChildren();
  if (error) {
    hits.textContent = error;
    return;
  }
  if (!matches.length) {
    hits.textContent = 'No results';
    return;
  }
  for (const match of matches) {
    const card = document.createElement('article');
    card.className = 'card';
    const title = document.createElement('strong');
    title.textContent = match.title || 'Memory';
    const body = document.createElement('p');
    body.className = 'muted';
    body.textContent = String(match.text || '').slice(0, 280);
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = `${match.source || 'memory'} · ${Number(match.score || 0).toFixed(2)}`;
    card.append(title, body, meta);
    hits.append(card);
  }
}

async function related() {
  const out = await chrome.runtime.sendMessage({ type: 'related' });
  page.textContent = out.page?.title || out.page?.url || 'No page shared with the extension yet.';
  show(out.matches || [], out.error);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const q = query.value.trim();
  if (!q) {
    hits.textContent = 'Enter a query';
    return;
  }
  const out = await chrome.runtime.sendMessage({ type: 'search', query: q });
  show(out.matches || [], out.error);
});

void related();
