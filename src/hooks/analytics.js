export const initAnalytics = (id) => {
  // 1. Safety check: Don't add the script if it's already there
  if (document.getElementById('google-analytics')) return;

  const script = document.createElement('script');
  script.id = 'google-analytics'; // Give it an ID
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
};

export const trackEvent = (action, category, label) => {
  if (window.gtag) {
    window.gtag('event', action, {
      event_category: category,
      event_label: label,
    });
  }
};