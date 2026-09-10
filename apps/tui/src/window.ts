/**
 * The chart's time windows, and which one to open on.
 *
 * Over seven days the last hour is a single column, so the thirteen publishes that make up the demo's
 * beat collapse into one tick at the right edge and the fill that started it is invisible. The
 * default is therefore the shortest window that still contains the leg's last fill; `t` cycles the
 * rest by hand. Seven days is the longest because it is the window the volatility term measures.
 */
export interface Window {
  readonly seconds: number;
  readonly label: string;
}

export const WINDOWS: readonly Window[] = [
  { seconds: 3_600, label: "1h" },
  { seconds: 86_400, label: "24h" },
  { seconds: 604_800, label: "7d" },
];

/** The shortest window that reaches back to `lastFillAt`, or the longest when nothing is in reach. */
export function autoWindow(lastFillAt: number | null, nowSeconds: number): Window {
  const longest = WINDOWS[WINDOWS.length - 1]!;
  if (lastFillAt === null) return longest;
  const age = nowSeconds - lastFillAt;
  return WINDOWS.find((w) => age <= w.seconds) ?? longest;
}
