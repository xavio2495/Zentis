const ONE = 10n ** 18n;
const BPS = 10_000n;

/**
 * What it would take to put a leg's own curve back on the published mid.
 *
 * The shift is the symptom: when a leg's reserves price its curve away from the mid, the workflow
 * corrects the quote, and when that correction runs into the cap the leg quotes off the market until
 * someone moves inventory. The cause is the reserves themselves, so this is sized from them —
 * `wantedB = balanceA × mid / 1e18` — which is the same arithmetic `scripts/rebalance.py` does
 * against the chain, not a second opinion derived from the shift.
 *
 * Aqua's `push()` only adds. A leg holding *more* tokenB than the mid says it should cannot be
 * corrected by a top-up at all, and this says so rather than returning an amount that would be
 * refused: a screen that prints a command the script declines has wasted the operator's attention
 * twice.
 */
export interface RebalancePlan {
  /** the tokenB a leg's own tokenA is worth at the mid; null when there is no mid to ask */
  readonly wantedB: bigint | null;
  /** what a push would have to add, zero when a push cannot help */
  readonly topUpB: bigint;
  /** how far the leg's own curve sits from the mid, signed, positive when it holds too little tokenB */
  readonly offMidBps: number | null;
  readonly canFix: boolean;
  /** why not, when `canFix` is false */
  readonly reason: string | null;
}

export function rebalanceOf(leg: { balanceA: bigint; balanceB: bigint; mid: bigint }): RebalancePlan {
  if (leg.mid <= 0n) {
    return {
      wantedB: null,
      topUpB: 0n,
      offMidBps: null,
      canFix: false,
      reason: "no published mid for this leg, so there is nothing to put its curve back onto",
    };
  }

  const wantedB = (leg.balanceA * leg.mid) / ONE;
  // Signed against what the leg should hold: positive means short of tokenB, which is the case a
  // push can fix. Measured on the tokenB side because that is the side being moved.
  const offMidBps = wantedB === 0n ? null : Number(((wantedB - leg.balanceB) * BPS) / wantedB);

  if (leg.balanceB === wantedB) {
    return { wantedB, topUpB: 0n, offMidBps, canFix: false, reason: "this leg is already on the mid" };
  }
  if (leg.balanceB > wantedB) {
    return {
      wantedB,
      topUpB: 0n,
      offMidBps,
      canFix: false,
      reason: "this leg holds more than the mid says it should, and a push only adds, so a top-up cannot correct it",
    };
  }
  return { wantedB, topUpB: wantedB - leg.balanceB, offMidBps, canFix: true, reason: null };
}
