import type { Decomposition, SpreadStack } from "./replay";

/**
 * What a per-leg card draws, as arithmetic.
 *
 * One trap runs through this file. The decomposition's terms do not add up to the shift the way a
 * stacked bar assumes: `ownConcession + bookConcession` is the concession *before* the boundary,
 * and what the leg actually conceded is `concession`, which the boundary can cut. A stack built
 * from own and book sums to a shift the enclave never published, and looks like an ordinary chart
 * while doing it. So the stack carries correction and the surviving concession — which do sum to
 * the shift — and what the boundary took is said separately, as its own number.
 */

export interface ShiftTerm {
  readonly key: "correction" | "concession";
  readonly label: string;
  /** signed, basis points at BPS = 10,000 */
  readonly bps: number;
  /** where the segment starts and ends on a 0..1 axis whose centre is zero */
  readonly from: number;
  readonly to: number;
}

export interface ShiftStack {
  readonly terms: ShiftTerm[];
  /** correction + concession: the console's own shift, which must equal `tiltBps` */
  readonly total: number;
  /** the enclave's, straight off the registry */
  readonly published: number;
  readonly agrees: boolean;
  /** what the boundary removed from the concession, or null where it removed nothing */
  readonly cutByBoundary: number | null;
  /** the concession's two parts, for the line under the bar */
  readonly own: number;
  readonly book: number;
  readonly roomBps: number;
  readonly cappedByRoom: boolean;
  readonly clampedByMaxTilt: boolean;
  readonly carriedFromSeq: number | null;
  /**
   * Whether the enclave priced from the balances the console is recomputing from.
   *
   * It prices at a finalized block and the subgraph answers at the head, so a fill landing between
   * the two is enough to move the recomputation — on a forty-five USDC leg, one 0.45 USDC fill
   * moves it about two hundred basis points, because the anchor is that steep. That is not the two
   * models disagreeing, and the screen must not say it is.
   */
  readonly balancesMatchEnclave: boolean;
  /** a disagreement the carry does not explain: the only case worth alarming about */
  readonly disputed: boolean;
  readonly domainBps: number;
  readonly zeroAt: number;
  readonly publishedAt: number;
}

export function shiftStack(decomposition: Decomposition): ShiftStack {
  const correction = Number(decomposition.correction);
  const concession = Number(decomposition.concession);
  const uncapped = Number(decomposition.concessionUncapped);
  const total = Number(decomposition.tiltBps);
  const carried = decomposition.carried === true;

  // Symmetric about zero and scaled to the widest thing drawn, so no segment runs off the end.
  const widest = Math.max(Math.abs(correction), Math.abs(concession), Math.abs(total), Math.abs(decomposition.published), 1);
  const domainBps = widest * 1.15;
  const at = (bps: number) => 0.5 + (bps / domainBps) * 0.5;

  // Laid end to end from zero, so the bar reads as correction first and then what was conceded on
  // top of it — which is the order the two are computed in.
  const terms: ShiftTerm[] = [
    { key: "correction", label: "correction", bps: correction, from: at(0), to: at(correction) },
    { key: "concession", label: "concession", bps: concession, from: at(correction), to: at(correction + concession) },
  ];

  return {
    terms,
    total,
    published: decomposition.published,
    agrees: decomposition.agrees,
    cutByBoundary: uncapped === concession ? null : uncapped - concession,
    own: Number(decomposition.ownConcession),
    book: Number(decomposition.bookConcession),
    roomBps: Number(decomposition.roomBps),
    cappedByRoom: decomposition.cappedByRoom,
    clampedByMaxTilt: decomposition.clampedByMaxTilt,
    carriedFromSeq: carried ? (decomposition.carriedFromSeq ?? null) : null,
    balancesMatchEnclave: decomposition.balancesMatchEnclave !== false,
    // A carry explains a gap; anything else does not, and only the unexplained kind is worth a
    // colour that says something is wrong.
    // A dispute is what is left when neither a carry nor a fill explains the difference: the same
    // balances, a recomputed round, and two different answers. That is the only state the screen
    // should draw in red, because it is the only one that says the model is wrong.
    disputed: !decomposition.agrees && !carried && decomposition.balancesMatchEnclave !== false,
    domainBps,
    zeroAt: at(0),
    publishedAt: at(decomposition.published),
  };
}

export interface SpreadBar {
  readonly key: "base" | "volatility" | "markout" | "staleness";
  readonly label: string;
  readonly bps: number;
  /** this term's share of the quoted total, 0..1 */
  readonly share: number;
}

/**
 * The four terms the router adds up, each with its share of the total.
 *
 * Every term is kept even at zero: "markout 0" is a fact about what the workflow charged, and a bar
 * that silently drops it leaves a reader to wonder whether it was zero or unread.
 */
export function spreadBars(spread: SpreadStack): SpreadBar[] {
  const terms: [SpreadBar["key"], string, number][] = [
    ["base", "base", spread.baseBps],
    ["volatility", "volatility", spread.volatilityBps],
    ["markout", "markout", spread.markoutBps],
    ["staleness", "staleness", spread.stalenessBps],
  ];
  const total = spread.totalBps;
  return terms.map(([key, label, bps]) => ({ key, label, bps, share: total === 0 ? 0 : bps / total }));
}

export interface InventorySplit {
  /** the tokenA share of this leg's inventory, 0..1 */
  readonly shareA: number;
  /** the even split the bar is read against; it is a target, not a constraint */
  readonly evenAt: number;
  readonly leansTo: "A" | "B";
}

/** The leg's balance as a share, or null when nothing could be valued — never a silent even split. */
export function inventorySplit(weightA: string | null): InventorySplit | null {
  if (weightA === null) return null;
  const shareA = Number(BigInt(weightA)) / 1e18;
  return { shareA, evenAt: 0.5, leansTo: shareA > 0.5 ? "A" : "B" };
}
