export function scrolledMeaningfully(scrollY: number, scrollHeight: number, viewport: number) {
  if (scrollY >= 400) return true;
  const range = Math.max(0, scrollHeight - viewport);
  return range > 0 && scrollY / range >= 0.25;
}

export function dwellReady(activeMs: number) {
  return activeMs >= 30_000;
}
