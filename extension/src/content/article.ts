import { Readability } from '@mozilla/readability';

export function fieldCounts() {
  return {
    passwordFields: document.querySelectorAll('input[type="password"]').length,
    cardFields: document.querySelectorAll('input[autocomplete="cc-number"], input[autocomplete="cc-csc"], input[name*="cardnumber" i], input[name*="card-number" i]').length,
  };
}

export function articleText() {
  const clone = document.cloneNode(true) as Document;
  clone.querySelectorAll('input, textarea, select').forEach((node) => node.removeAttribute('value'));
  try {
    const parsed = new Readability(clone).parse();
    const text = String(parsed?.textContent || '').replace(/[ \t]+\n/g, '\n').trim();
    if (text) return text.slice(0, 20000);
  } catch {
    /* the page has no readable article */
  }
  const main = document.querySelector('article, main');
  return String(main?.textContent || '').replace(/[ \t]+\n/g, '\n').trim().slice(0, 20000);
}
