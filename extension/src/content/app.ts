document.documentElement.dataset.rukmerExtension = '1';

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data as { source?: string; type?: string; code?: string };
  if (!data || data.source !== 'rukmer-page' || data.type !== 'pair' || !data.code) return;
  chrome.runtime.sendMessage({ type: 'claim', code: data.code }, (res) => {
    window.postMessage(
      { source: 'rukmer-extension', type: 'paired', ok: !!res?.ok, error: res?.error || (res?.ok ? '' : 'Could not connect this browser') },
      location.origin
    );
  });
});
