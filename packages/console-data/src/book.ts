import type { LegSnapshot } from "./snapshot.js";

const ONE = 10n ** 18n;

/**
 * The whole book on one row: what the maker owns, how it leans, and what it has earned.
 *
 * Every number here is a sum over the legs that could be read and valued, and the caveat names the
 * legs that could not. A book total that quietly counted an unreadable leg as zero would say the
 * maker is poorer than it is, which on a screen whose subject is one position across three chains
 * is the same failure as calling an unread leg absent.
 */
export interface BookTotals {
  readonly legs: number;
  readonly legsActive: number;
  /** every readable leg's inventory valued in tokenA at its own mark */
  readonly inventoryA: bigint | null;
  /** the tokenA share of that inventory, at 1e18 scale; null when nothing could be valued */
  readonly weightA: bigint | null;
  /** the sum of the legs' total PnL, or null when any leg has none */
  readonly pnlA: bigint | null;
  readonly tradingA: bigint | null;
  readonly holdA: bigint | null;
  readonly caveat: string | null;
}

const bInA = (amountB: bigint, mid: bigint): bigint => (mid === 0n ? 0n : (amountB * ONE) / mid);

export function bookTotals(legs: readonly LegSnapshot[]): BookTotals {
  let inventoryA: bigint | null = null;
  let valuedA = 0n;
  let valuedB = 0n;
  let unvalued = 0;
  let legsActive = 0;

  for (const leg of legs) {
    if (leg.position?.active === true) legsActive += 1;
    const mid = leg.mark?.mid ?? null;
    if (leg.position === null || mid === null || mid === 0n) {
      unvalued += 1;
      continue;
    }
    const inA = leg.position.balanceA;
    const inB = bInA(leg.position.balanceB, mid);
    valuedA += inA;
    valuedB += inB;
    inventoryA = (inventoryA ?? 0n) + inA + inB;
  }

  const withPnl = legs.filter((leg) => leg.pnl?.totalA != null);
  const pnlA = withPnl.length === legs.length ? withPnl.reduce((sum, leg) => sum + (leg.pnl?.totalA ?? 0n), 0n) : null;
  const tradingA = withPnl.length === legs.length ? withPnl.reduce((sum, leg) => sum + (leg.pnl?.tradingA ?? 0n), 0n) : null;
  const holdA = withPnl.length === legs.length ? withPnl.reduce((sum, leg) => sum + (leg.pnl?.holdA ?? 0n), 0n) : null;

  const notes: string[] = [];
  if (unvalued > 0) notes.push(`${unvalued} of ${legs.length} legs could not be valued, so they are left out of the book`);
  if (pnlA === null && legs.length > 0) {
    notes.push(`${withPnl.length} of ${legs.length} legs have a profit and loss, so there is no book total`);
  }

  const total = valuedA + valuedB;
  return {
    legs: legs.length,
    legsActive,
    inventoryA,
    weightA: total === 0n ? null : (valuedA * ONE) / total,
    pnlA,
    tradingA,
    holdA,
    caveat: notes.length === 0 ? null : notes.join("; "),
  };
}
