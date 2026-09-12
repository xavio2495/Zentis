/**
 * Where the page has actually scrolled to, as the reader sees it.
 *
 * Smoothed scrolling moves the content with a transform, so the scrollbar runs
 * ahead of what is on screen. Anything drawn outside that content — the field,
 * which is fixed — has to follow the lagging value, or it slides against the
 * page by however far the smoothing is behind. Everything reads the position
 * through here so there is one answer to that question.
 */

type Source = () => number;

let source: Source | null = null;

export function setScrollSource(next: Source): void {
  source = next;
}

export function clearScrollSource(): void {
  source = null;
}

export function scrollNow(): number {
  if (source) {
    const value = source();
    if (Number.isFinite(value)) return value;
  }
  return typeof scrollY === "number" ? scrollY : 0;
}
