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

/**
 * The three transactions a top-up takes, sized from what the chain says.
 *
 * `push()` is a `transferFrom`: it spends the allowance now, and every later fill that takes tokenB
 * from the maker is settled by Aqua pulling against whatever is left, up to the whole committed
 * balance. So the approval has two jobs and must cover `topUp + wantedB`. Sizing it to the top-up
 * alone is what left every leg at a zero WETH allowance with its commitment intact on 2026-09-11 —
 * found by this console's own wallet page, which is why the number is computed here rather than
 * anywhere a screen could round it.
 *
 * Wrapping comes first and only for the shortfall: the maker's ETH is gas, and wrapping more of it
 * than the push needs is a decision nobody asked for.
 */
export interface PushPlan {
  readonly topUpB: bigint;
  readonly wantedB: bigint;
  /** what the allowance must be after this push, so the next settlement still has room */
  readonly approval: bigint;
  readonly needsApproval: boolean;
  /** native to wrap first, when the wallet does not hold enough tokenB free */
  readonly wrap: bigint;
}

export function pushPlan(leg: {
  balanceA: bigint;
  balanceB: bigint;
  mid: bigint;
  /** the wallet's own tokenB balance, which includes what is already committed */
  held: bigint;
  allowance: bigint;
}): PushPlan | null {
  const plan = rebalanceOf(leg);
  if (!plan.canFix || plan.wantedB === null || plan.topUpB <= 0n) return null;
  const free = leg.held > leg.balanceB ? leg.held - leg.balanceB : 0n;
  const approval = plan.topUpB + plan.wantedB;
  return {
    topUpB: plan.topUpB,
    wantedB: plan.wantedB,
    approval,
    needsApproval: leg.allowance < approval,
    wrap: plan.topUpB > free ? plan.topUpB - free : 0n,
  };
}
