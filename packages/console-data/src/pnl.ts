import type { IndexedFill, IndexedReference, LegHistory } from "./fills.js";
import type { ShippedRecord } from "./config.js";

/**
 * What a leg has earned, in tokenA's raw units, with the same split the simulation harness uses.
 *
 * The harness's `trading_pnl_a` is the closing value minus the opening value with the hold effect
 * removed. Written out per leg: hold = shippedB × (mark − openingMark), and trading is the sum over
 * the leg's fills of what each one moved, valued at the mark.
 *
 * Trading is summed from the fills rather than read off the balance delta against what was shipped,
 * and the difference matters the moment the maker rebalances. `push()` raises a leg's recorded
 * balance with no trade behind it, so a balance delta counts the top-up as profit: the Sepolia leg
 * was pushed 0.005575 WETH on 2026-09-11 to put its curve back on the mid, which would have read as
 * about 13.77 USDC nobody earned. The fills are the only record of what trading actually did, and
 * they are immune to top-ups, to withdrawals, and to who performed them.
 *
 * The mark is a parameter because on a testnet the leg's own pool can sit an order of magnitude off
 * the market: the caller passes the mainnet mark and can pass the pool mid to see the other answer.
 *
 * Hold takes a **second** mark, the one the same source gave when the leg was shipped, and returns
 * null without it. Trading applies one mark to a balance *delta*, so any mark answers it; hold is a
 * price change over time, so a closing mark from the market against an opening mark from the pool
 * would report the gap between two price sources as a move the maker lived through. It never
 * happened, and on these testnets that gap is an order of magnitude.
 *
 * Per fill, the edge is what the maker took against the reference at the time, and the markout is
 * the same fill scored against the next reference published after it, which is the adverse
 * selection the slow workflow charges for. Everything here is a pure function of indexed data.
 */
const ONE = 10n ** 18n;

export interface FillEconomics {
  readonly transaction: string;
  readonly timestamp: bigint;
  readonly isAToB: boolean;
  /** the fill's size in tokenA raw units, whichever side tokenA was on */
  readonly sizeA: bigint;
  /** signed, tokenA raw units, positive when the maker did better than the reference */
  readonly edgeA: bigint | null;
  /** the same fill against the next reference, null when none has been published since */
  readonly markoutA: bigint | null;
}

export interface LegPnl {
  readonly fills: number;
  readonly volumeA: bigint;
  readonly edgeA: bigint;
  /** null until every fill has a reference after it; partial sums would mislead */
  readonly markoutA: bigint | null;
  readonly tradingA: bigint | null;
  readonly holdA: bigint | null;
  readonly totalA: bigint | null;
  /** why trading/hold are null, when they are */
  readonly caveat: string | null;
  readonly perFill: FillEconomics[];
}

/** tokenB raw units valued in tokenA raw units at a mid (raw B per 1e18 raw A). */
export const bInA = (amountB: bigint, mid: bigint): bigint => (mid === 0n ? 0n : (amountB * ONE) / mid);

/** What one fill moved the maker's two sides by, signed, in each token's own raw units. */
export function fillDelta(fill: IndexedFill): { deltaA: bigint; deltaB: bigint } {
  // Taker sold A: the maker took amountIn of A in and gave amountOut of B away. And the reverse.
  return fill.isAToB
    ? { deltaA: fill.amountIn, deltaB: -fill.amountOut }
    : { deltaA: -fill.amountOut, deltaB: fill.amountIn };
}

/** What the maker took against `mid` on this fill, in tokenA raw units, signed. */
export function edgeAgainst(fill: IndexedFill, mid: bigint): bigint {
  // Taker sold A: the maker received amountIn A and gave amountOut B, worth amountOut/mid in A.
  if (fill.isAToB) return fill.amountIn - bInA(fill.amountOut, mid);
  // Taker sold B: the maker received amountIn B, worth amountIn/mid in A, and gave amountOut A.
  return bInA(fill.amountIn, mid) - fill.amountOut;
}

/** The first reference published after the fill, by timestamp, or null. */
export function referenceAfter(fill: IndexedFill, references: readonly IndexedReference[]): IndexedReference | null {
  let best: IndexedReference | null = null;
  for (const ref of references) {
    if (ref.timestamp <= fill.timestamp) continue;
    if (best === null || ref.timestamp < best.timestamp) best = ref;
  }
  return best;
}

export function fillEconomics(fill: IndexedFill, references: readonly IndexedReference[]): FillEconomics {
  const sizeA = fill.isAToB ? fill.amountIn : fill.amountOut;
  const edgeA = fill.hasReference && fill.refMid !== null && fill.refMid !== 0n ? edgeAgainst(fill, fill.refMid) : null;
  const next = referenceAfter(fill, references);
  const markoutA = next === null || next.mid === 0n ? null : edgeAgainst(fill, next.mid);
  return { transaction: fill.transaction, timestamp: fill.timestamp, isAToB: fill.isAToB, sizeA, edgeA, markoutA };
}

/**
 * The leg's PnL at `mark`. `history.position` supplies the live balances; `shipped` the opening.
 * `openingMark` is what the same source said when the leg was shipped; null means hold is unknown.
 */
export function legPnl(
  history: LegHistory,
  shipped: ShippedRecord,
  mark: bigint | null,
  openingMark: bigint | null,
): LegPnl {
  const perFill = history.fills.map((fill) => fillEconomics(fill, history.references));
  const fills = perFill.length;
  const volumeA = perFill.reduce((sum, f) => sum + f.sizeA, 0n);
  const edgeA = perFill.reduce((sum, f) => sum + (f.edgeA ?? 0n), 0n);
  const markoutA = perFill.every((f) => f.markoutA !== null) ? perFill.reduce((sum, f) => sum + (f.markoutA ?? 0n), 0n) : null;

  let caveat: string | null = null;
  if (mark === null) caveat = "no mark, so inventory cannot be valued";
  else if (shipped.balanceB === null) caveat = "this generation's shipped B side was not recorded, so there is no opening value";
  if (caveat !== null || mark === null) {
    return { fills, volumeA, edgeA, markoutA, tradingA: null, holdA: null, totalA: null, caveat, perFill };
  }
  const shippedB = shipped.balanceB as bigint;
  // Summed over the fills, not taken from the balance: see the note at the top of this file.
  const tradingA = history.fills.reduce((sum, fill) => {
    const { deltaA, deltaB } = fillDelta(fill);
    return sum + deltaA + bInA(deltaB, mark);
  }, 0n);
  if (openingMark === null || openingMark === 0n) {
    return {
      fills,
      volumeA,
      edgeA,
      markoutA,
      tradingA,
      holdA: null,
      totalA: null,
      caveat: "no mark was recorded from this source when the leg was shipped, so the hold effect cannot be separated from the trading",
      perFill,
    };
  }
  const holdA = bInA(shippedB, mark) - bInA(shippedB, openingMark);
  return { fills, volumeA, edgeA, markoutA, tradingA, holdA, totalA: tradingA + holdA, caveat: null, perFill };
}
