export function toast(message: string, onUndo?: () => void) {
  document.querySelector('[data-rukmer-toast]')?.remove();
  const root = document.createElement('div');
  root.setAttribute('data-rukmer-toast', '');
  root.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'right:16px',
    'bottom:16px',
    'display:flex',
    'gap:10px',
    'align-items:center',
    'padding:10px 12px',
    'border-radius:12px',
    'background:#141416',
    'color:#f4f4f5',
    'border:1px solid rgba(255,255,255,.12)',
    'font:13px/1.3 Inter,ui-sans-serif,system-ui,sans-serif',
    'box-shadow:0 12px 30px rgba(0,0,0,.35)',
  ].join(';');
  const label = document.createElement('span');
  label.textContent = message;
  root.append(label);
  if (onUndo) {
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.textContent = 'Undo';
    undo.style.cssText = 'border:0;background:#2563eb;color:white;border-radius:8px;padding:4px 8px;cursor:pointer';
    undo.addEventListener('click', () => {
      onUndo();
      root.remove();
    });
    root.append(undo);
  }
  document.documentElement.append(root);
  window.setTimeout(() => root.remove(), 5000);
}
