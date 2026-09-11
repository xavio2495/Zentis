import type { IndexedFill, IndexedReference, LegHistory } from "./fills.js";
import type { ShippedRecord } from "./config.js";

/**
 * What a leg has earned, in tokenA's raw units, with the same split the simulation harness uses.
 *
 * The harness's `trading_pnl_a` is the closing value minus the opening value with the hold effect
 * removed, where hold is what the opening balances would be worth at the closing price. Written
 * out per leg: hold = shippedB × (mark − shipMid); trading = (balanceA − shippedA) + (balanceB −
 * shippedB) × mark. Both are valued at one **mark**, and the mark is a parameter, because on a
 * testnet the leg's own pool can sit an order of magnitude off the market: the caller passes the
 * mainnet mark and can pass the pool mid to see the other answer.
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
 */
export function legPnl(history: LegHistory, shipped: ShippedRecord, mark: bigint | null): LegPnl {
  const perFill = history.fills.map((fill) => fillEconomics(fill, history.references));
  const fills = perFill.length;
  const volumeA = perFill.reduce((sum, f) => sum + f.sizeA, 0n);
  const edgeA = perFill.reduce((sum, f) => sum + (f.edgeA ?? 0n), 0n);
  const markoutA = perFill.every((f) => f.markoutA !== null) ? perFill.reduce((sum, f) => sum + (f.markoutA ?? 0n), 0n) : null;

  const position = history.position;
  let caveat: string | null = null;
  if (mark === null) caveat = "no mark, so inventory cannot be valued";
  else if (position === null) caveat = "the position could not be read, so its balances are unknown";
  else if (shipped.balanceB === null || shipped.mid === null) caveat = "this generation's shipped B side was not recorded, so there is no opening value";
  if (caveat !== null || mark === null || position === null) {
    return { fills, volumeA, edgeA, markoutA, tradingA: null, holdA: null, totalA: null, caveat, perFill };
  }
  const shippedB = shipped.balanceB as bigint;
  const shipMid = shipped.mid as bigint;
  const tradingA = position.balanceA - shipped.balanceA + bInA(position.balanceB - shippedB, mark);
  const holdA = bInA(shippedB, mark) - bInA(shippedB, shipMid);
  return { fills, volumeA, edgeA, markoutA, tradingA, holdA, totalA: tradingA + holdA, caveat: null, perFill };
}
