import { articleText, fieldCounts } from './article.js';

(globalThis as typeof globalThis & { __rukmerExtract?: () => unknown }).__rukmerExtract = () => ({
  title: document.title,
  url: location.href,
  text: articleText(),
  ...fieldCounts(),
});
