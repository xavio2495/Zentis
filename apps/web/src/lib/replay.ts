/**
 * The replay, as arithmetic.
 *
 * One integer playhead; everything else is derived from it. That is the shape the reference uses
 * and the reason its terminal is a couple of hundred lines rather than a state machine: there is
 * exactly one piece of state a bug can be in.
 *
 * Kept apart from React so that what the transport means can be tested without mounting anything.
 * Nothing here reads a chain or a clock — the rounds are the recorded ones, in the order they were
 * published.
 */
export interface Round {
  readonly seq: number;
  readonly atSeconds: number;
  /** the signed shift the enclave published for this leg, in basis points */
  readonly tiltBps: number;
  /** raw token-B per 1e18 raw token-A, as a decimal string */
  readonly mid: string;
  /**
   * True where the published mid changed source rather than moved.
   *
   * The fast workflow moved from per-leg pool mids to one mainnet mid on 2026-09-11 and the mid
   * jumped twelvefold in a single round, taking every leg's shift into its band. On a chart that
   * reads as a market event; it was not one, and no statistic should be computed across it.
   */
  readonly referenceChanged?: boolean;
}

export interface Fill {
  readonly atSeconds: number;
  readonly transaction: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly isAToB: boolean;
  /** what the leg was quoting when it was taken */
  readonly refTiltBps: number;
  /** whether this fill belongs to the generation now shipped, as the console counts it */
  readonly thisGeneration?: boolean;
  /** the fill's size in raw tokenA, whichever side tokenA was on */
  readonly sizeA?: string;
  /** signed raw tokenA, positive where the maker did better than the reference at the time */
  readonly edgeA?: string | null;
  /** the same fill scored against the next reference published after it */
  readonly markoutA?: string | null;
}

/**
 * A price series as the seed carries it.
 *
 * `granularity` is not a detail: an hourly series drawn over six hours is a handful of points
 * joined by straight lines, which is not what the market did, so the panel says which it is
 * looking at and the seed carries both windows.
 */
export interface MarkHistory {
  readonly points: { readonly t: number; readonly mid: string }[];
  readonly source: string;
  readonly hours: number;
  readonly granularity: "swaps" | "hours";
  /** set when the series is stale; the points are still the last good ones */
  readonly error: string | null;
}

export interface LegQuote {
  readonly amountIn: string;
  readonly amountOut: string | null;
  readonly tokenIn: string | null;
  readonly tokenOut: string | null;
  readonly reason: string | null;
  readonly refMid: string | null;
  readonly tiltBps: number | null;
  readonly seq: number | null;
  readonly refAgeSeconds: number | null;
  readonly offMidBps: number | null;
  readonly refusal: { error: string; args: string[]; sentence: string } | null;
  readonly caveats: string[];
}

export interface Decomposition {
  readonly weightA: string;
  readonly correction: string;
  readonly ownConcession: string;
  readonly bookConcession: string;
  readonly concessionUncapped: string;
  readonly concession: string;
  readonly tiltBps: string;
  /** the enclave's own, straight off the registry */
  readonly published: number;
  readonly agrees: boolean;
  readonly roomBps: string;
  readonly roomUnknownAtCap: boolean;
  readonly cappedByRoom: boolean;
  readonly clampedByMaxTilt: boolean;
  readonly balancesMatchEnclave: boolean;
  readonly referenceAgeSeconds: number | null;
}

export interface SpreadStack {
  readonly baseBps: number;
  readonly volatilityBps: number;
  readonly markoutBps: number;
  /** the age ramp at the recorded moment, not at the reader's clock */
  readonly stalenessBps: number;
  readonly totalBps: number;
  readonly referenceAgeSeconds: number;
  readonly tooStaleToQuote: boolean;
  readonly recomputedVolatilityBps: number | null;
  readonly widenBpsPerMinute: number;
  readonly maxWidenBps: number;
  readonly maxStalenessSeconds: number;
}

export interface LegPnl {
  readonly fills: number;
  readonly volumeA: string;
  readonly edgeA: string;
  readonly markoutA: string | null;
  readonly tradingA: string | null;
  readonly holdA: string | null;
  readonly totalA: string | null;
  readonly unvaluedB: string | null;
  /** why trading, hold or total are null, when they are */
  readonly caveat: string | null;
  readonly lifetime: {
    readonly fills: number;
    readonly volumeA: string;
    readonly edgeA: string;
    readonly markoutA: string | null;
    readonly tradingA: string | null;
    readonly generations: number | null;
  };
}

/** The vocabulary a leg's state is said in. Colour is the screen's business, not the data's. */
export type StatusKind = "live" | "docked" | "stale" | "unpriced" | "none" | "unread";

export interface Leg {
  readonly chainId: number;
  readonly name: string;
  readonly label: string;
  readonly strategyHash: string;
  /** the leg's own band edge, read off the position rather than assumed */
  readonly maxTiltBps: number;
  /** what the position committed, as raw amounts, from the deployment record */
  readonly balanceA: string;
  readonly balanceB: string;
  /** when the generation now shipped was shipped */
  readonly shippedAtSeconds?: number | null;
  /** the long form, carrying the age or the reason; the kind is the vocabulary */
  readonly status?: string;
  readonly statusKind?: StatusKind;
  readonly quotes?: { aToB: LegQuote; bToA: LegQuote };
  readonly decomposition?: Decomposition;
  readonly spread?: SpreadStack;
  readonly pnl?: LegPnl;
  /** the mainnet price this leg's inventory is valued at, never its own testnet pool mid */
  readonly mark?: { mid: string; source: string; readAtSeconds: number };
  readonly rounds: Round[];
  readonly fills: Fill[];
  readonly rejections: { atSeconds: number; transaction: string; reason: string }[];
}

export interface BookTotals {
  readonly legs: number;
  readonly legsActive: number;
  readonly inventoryA: string | null;
  readonly weightA: string | null;
  readonly pnlA: string | null;
  readonly tradingA: string | null;
  readonly holdA: string | null;
  readonly caveat: string | null;
  readonly seq: number | null;
  /** the reference's age at the recorded moment — never recomputed against the reader's clock,
      or a recording ages into a staleness alarm on screen */
  readonly ageSeconds: number;
  readonly quoteSizeA: string;
  readonly quoteSizeB: string;
}

export interface Provider {
  readonly kind: string;
  readonly name: string;
  readonly state: "up" | "stale" | "down";
  readonly reason: string | null;
  readonly detail: string | null;
}

export interface Replay {
  readonly provenance: { recordedAtSeconds: number; sources: string[]; note: string };
  /** the week, hourly */
  readonly market?: MarkHistory;
  /** the last hours, per swap; use this for any window under a day */
  readonly marketRecent?: MarkHistory;
  readonly book?: BookTotals;
  readonly providers?: Provider[];
  readonly legs: Leg[];
}

/** Everything published up to and including the playhead. Past the end is the end. */
export const visible = <T>(rounds: readonly T[], playhead: number): T[] =>
  rounds.slice(0, Math.max(0, Math.min(playhead, rounds.length - 1)) + 1);

/** The round the playhead is on, or null when there is nothing to be on. */
export const at = <T>(rounds: readonly T[], playhead: number): T | null =>
  rounds.length === 0 ? null : (rounds[Math.max(0, Math.min(playhead, rounds.length - 1))] ?? null);

export type BandState = "in band" | "near edge" | "clamped";

/**
 * Where a shift stands against its leg's own cap.
 *
 * Against the leg's cap and never a fixed number: −500 on a leg capped at 500 is a limit, and −500
 * on a leg capped at 5,000 is an ordinary quote. "Near edge" is the last tenth before the cap,
 * which is the warning the reference gives a whole state to.
 */
export function bandState(tiltBps: number, maxTiltBps: number): BandState {
  const room = Math.abs(tiltBps) / Math.max(1, maxTiltBps);
  if (room >= 1) return "clamped";
  return room >= 0.9 ? "near edge" : "in band";
}

/** The first round this leg spent sitting on its cap, which is the thing worth jumping to. */
export function firstClamp(leg: Leg): number | null {
  const index = leg.rounds.findIndex((round) => bandState(round.tiltBps, leg.maxTiltBps) === "clamped");
  return index === -1 ? null : index;
}

/**
 * Speed as a stride over the same tick.
 *
 * Changing the interval instead would make the clock itself run at four different rates; striding
 * the index keeps one timer and one cadence, and the screen simply skips rounds.
 */
export const SPEEDS = [
  { label: "1×", stride: 1 },
  { label: "2×", stride: 3 },
  { label: "4×", stride: 6 },
  { label: "8×", stride: 12 },
] as const;

/** The stride for a multiplier, or one for a multiplier nobody offers. */
export const strideFor = (multiplier: number): number => {
  const found = SPEEDS.find((speed) => speed.label === `${multiplier}×`);
  return found?.stride ?? 1;
};

/** How often the playhead advances. One cadence, whatever the speed. */
export const TICK_MS = 90;
