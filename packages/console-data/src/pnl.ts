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
  /**
   * Whether this fill belongs to the generation now shipped.
   *
   * The subgraph keeps every fill the position ever took; a re-shipped leg's older ones moved the
   * balance of the generation before this one. Every fill stays on the list — each is a real
   * transaction and the evidence for a number — but only this generation's are summed into the
   * totals beside them.
   */
  readonly thisGeneration: boolean;
}

/** The same arithmetic over a different span: everything the position ever did. */
export interface LifetimePnl {
  readonly fills: number;
  readonly volumeA: bigint;
  readonly edgeA: bigint;
  readonly markoutA: bigint | null;
  readonly tradingA: bigint | null;
  /** how many generations that life covers, when the record says; null when it does not */
  readonly generations: number | null;
}

/**
 * A leg's PnL over the generation now shipped.
 *
 * One total answers one question. Hold values what *this generation* was shipped with, so trading
 * is summed over this generation's fills too — a total that added a lifetime's trading to one
 * generation's hold was the sum of two different spans and was wrong by the difference. What the
 * position did before its last ship is not thrown away: it is `lifetime`, said separately and
 * labelled as the other span.
 */
export interface LegPnl {
  readonly fills: number;
  readonly volumeA: bigint;
  readonly edgeA: bigint;
  /** null until every fill has a reference after it; partial sums would mislead */
  readonly markoutA: bigint | null;
  readonly tradingA: bigint | null;
  readonly holdA: bigint | null;
  readonly totalA: bigint | null;
  /**
   * TokenB the leg holds that `holdA` does not value, signed, in tokenB's own raw units.
   *
   * Hold is the price move on what the leg was *shipped* with. Anything pushed in afterwards is
   * inventory it holds and hold is silent about, and the silence is the problem: the book's hold
   * understates by whatever that inventory has done since. The amount is derivable from what is
   * already read — what the position holds now, less what it was shipped with, less what the fills
   * moved — so the screen can at least name it. Valuing it needs a mark from the moment of each
   * push, which no record carries yet.
   */
  readonly unvaluedB: bigint | null;
  /** why trading/hold are null, when they are */
  readonly caveat: string | null;
  /**
   * What hold was computed from: one entry per parcel of inventory, with the price it entered at.
   *
   * On screen this is the difference between "the book made 0.6 USDC holding" and a number nobody
   * can check. Each entry says where its opening price came from, so the sum can be taken apart.
   */
  readonly holdFrom: Tranche[];
  /** every fill the position ever took, each saying which span it belongs to */
  readonly perFill: FillEconomics[];
  readonly lifetime: LifetimePnl;
}

/**
 * A parcel of tokenB the leg holds, and the price it came in at.
 *
 * Inventory does not arrive all at once. A leg is shipped with a side, and then pushed to — and
 * each parcel entered at whatever the market was that day. Hold is the price move since entry, so
 * it is a sum over parcels rather than one subtraction: valuing a push at the ship's mark credits
 * the leg with a move it was not there for.
 */
export interface Tranche {
  /** tokenB raw units, signed: a withdrawal is a negative parcel */
  readonly amountB: bigint;
  /** the mark when it entered, raw B per 1e18 raw A; null when no record says */
  readonly mark: bigint | null;
  readonly source: "ship" | "push";
  readonly atSeconds: number | null;
}

/**
 * The mark struck at or before a moment, from a series of them.
 *
 * Never the nearest point in either direction: the next point is a price that had not happened yet
 * when the parcel entered, and valuing an entry at it is valuing it at hindsight. Null before the
 * series begins, which is a tranche that cannot be valued rather than one worth guessing at.
 */
export function markAt(
  series: readonly { timestamp: bigint; mid: bigint }[],
  atSeconds: number,
): bigint | null {
  let best: bigint | null = null;
  let bestAt = -1n;
  for (const point of series) {
    if (point.timestamp > BigInt(atSeconds)) continue;
    if (point.timestamp > bestAt) {
      bestAt = point.timestamp;
      best = point.mid;
    }
  }
  return best;
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

export function fillEconomics(
  fill: IndexedFill,
  references: readonly IndexedReference[],
  /** when the generation now shipped was shipped; null when the record does not say */
  shipAt: number | null = null,
): FillEconomics {
  const sizeA = fill.isAToB ? fill.amountIn : fill.amountOut;
  const edgeA = fill.hasReference && fill.refMid !== null && fill.refMid !== 0n ? edgeAgainst(fill, fill.refMid) : null;
  const next = referenceAfter(fill, references);
  const markoutA = next === null || next.mid === 0n ? null : edgeAgainst(fill, next.mid);
  return {
    transaction: fill.transaction,
    timestamp: fill.timestamp,
    isAToB: fill.isAToB,
    sizeA,
    edgeA,
    markoutA,
    thisGeneration: shipAt === null ? false : Number(fill.timestamp) >= shipAt,
  };
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
  /** how many generations this position has had, from the deployment record; null when unknown */
  generations: number | null = null,
  /**
   * The parcels pushed into this leg since it was shipped, each with the mark when it landed.
   *
   * Empty when nothing has been pushed, or when nothing recorded what the marks were: inventory
   * with no entry price is left out of hold and named in `unvaluedB` instead, because valuing it at
   * today's mark would report a gain of exactly zero on it, and that is a claim rather than a gap.
   */
  pushes: readonly Tranche[] = [],
): LegPnl {
  // `?? null` and not a bare read: a record written before this field existed has it undefined, and
  // `Number(timestamp) >= undefined` is false for every fill — which silently emptied the span
  // rather than reporting it unknown.
  const shipAt = shipped.markAtShipAt ?? null;
  const perFill = history.fills.map((fill) => fillEconomics(fill, history.references, shipAt));
  // The generation's own fills, which is the span every figure beside them covers.
  const mine = perFill.filter((f) => f.thisGeneration);
  const sum = (list: FillEconomics[], of: (f: FillEconomics) => bigint | null) =>
    list.reduce((total, f) => total + (of(f) ?? 0n), 0n);
  const markoutOver = (list: FillEconomics[]) =>
    list.every((f) => f.markoutA !== null) ? sum(list, (f) => f.markoutA) : null;

  const tradingOver = (list: FillEconomics[]): bigint | null => {
    if (mark === null) return null;
    const wanted = new Set(list.map((f) => f.transaction));
    return history.fills
      .filter((fill) => wanted.has(fill.transaction))
      .reduce((total, fill) => {
        const { deltaA, deltaB } = fillDelta(fill);
        return total + deltaA + bInA(deltaB, mark);
      }, 0n);
  };

  // The position's whole life, kept and labelled rather than discarded: it is the only place the
  // work of a superseded generation is still visible.
  const lifetime: LifetimePnl = {
    fills: perFill.length,
    volumeA: sum(perFill, (f) => f.sizeA),
    edgeA: sum(perFill, (f) => f.edgeA),
    markoutA: markoutOver(perFill),
    tradingA: tradingOver(perFill),
    generations,
  };

  const fills = shipAt === null ? 0 : mine.length;
  const volumeA = shipAt === null ? 0n : sum(mine, (f) => f.sizeA);
  const edgeA = shipAt === null ? 0n : sum(mine, (f) => f.edgeA);
  const markoutA = shipAt === null ? null : markoutOver(mine);

  let caveat: string | null = null;
  if (shipAt === null) {
    // Not a lifetime number in its place: the two spans are different questions, and answering the
    // one that was asked with the other is how a total comes to mean nothing.
    caveat =
      "no ship time was recorded for this generation, so its own fills cannot be told from the position's earlier ones";
  } else if (mark === null) caveat = "no mark, so inventory cannot be valued";
  else if (shipped.balanceB === null) caveat = "this generation's shipped B side was not recorded, so there is no opening value";
  if (caveat !== null || mark === null) {
    return {
      fills,
      volumeA,
      edgeA,
      markoutA,
      tradingA: null,
      holdA: null,
      totalA: null,
      unvaluedB: null,
      caveat,
      holdFrom: [],
      perFill,
      lifetime,
    };
  }
  const shippedB = shipped.balanceB as bigint;
  // The ship is a tranche like any other; a leg nobody has pushed to simply has one of them.
  const tranches: Tranche[] = [
    { amountB: shippedB, mark: shipped.markAtShip ?? openingMark, source: "ship", atSeconds: shipAt },
    ...pushes.filter((push) => shipAt === null || push.atSeconds === null || push.atSeconds >= shipAt),
  ];
  // What the leg holds that hold does not speak for. Zero on a leg nobody has pushed to.
  //
  // Only this generation's fills count. The subgraph keeps every fill the position ever took, and a
  // re-shipped leg's older ones moved the balance of the generation before this one — counting them
  // put half a milli-WETH of imaginary inventory on two legs. Without the ship's own timestamp
  // there is no way to tell the two apart, so the answer is null rather than a number that looks
  // plausible.
  const heldB = history.position?.balanceB ?? null;
  // What the leg holds that no tranche speaks for: its inventory, less every parcel that entered
  // with a price on it, less what this generation's fills moved. Zero on a leg whose whole side is
  // accounted for; on a leg pushed to before anything recorded the marks, it is that push.
  const unvaluedB =
    heldB === null || shipAt === null
      ? null
      : heldB -
        tranches.reduce((sum, tranche) => sum + tranche.amountB, 0n) -
        history.fills
          .filter((fill) => Number(fill.timestamp) >= shipAt)
          .reduce((sum, fill) => sum + fillDelta(fill).deltaB, 0n);
  // Summed over the fills, not taken from the balance: see the note at the top of this file. Over
  // this generation's fills only, so it covers the same span hold does.
  const tradingA = tradingOver(mine) as bigint;
  if (openingMark === null || openingMark === 0n) {
    return {
      fills,
      volumeA,
      edgeA,
      markoutA,
      tradingA,
      holdA: null,
      totalA: null,
      unvaluedB,
      caveat: "no mark was recorded from this source when the leg was shipped, so the hold effect cannot be separated from the trading",
      holdFrom: [],
      perFill,
      lifetime,
    };
  }

  // A parcel with no entry price is left out rather than valued at the mark: the second reports a
  // gain of zero on it, which reads as a fact and is a guess.
  const valued = tranches.filter((tranche) => tranche.mark !== null && tranche.mark !== 0n);
  const holdA = valued.reduce(
    (sum, tranche) => sum + bInA(tranche.amountB, mark) - bInA(tranche.amountB, tranche.mark as bigint),
    0n,
  );
  const strayB = (unvaluedB ?? 0n) + tranches.filter((t) => !valued.includes(t)).reduce((sum, t) => sum + t.amountB, 0n);
  return {
    fills,
    volumeA,
    edgeA,
    markoutA,
    tradingA,
    holdA,
    totalA: tradingA + holdA,
    unvaluedB: unvaluedB === null ? null : strayB,
    // Said whenever some of the leg's own inventory is outside hold, with the amount, because a
    // hold that covers part of a book and does not say so is the shape of a number that misleads.
    caveat:
      strayB === 0n
        ? null
        : "some of this leg's tokenB entered without a recorded price, so hold does not speak for it",
    holdFrom: valued,
    perFill,
    lifetime,
  };
}
