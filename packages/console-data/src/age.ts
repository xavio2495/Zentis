import type { LegSnapshot } from "./snapshot.js";

/**
 * How old a leg's reference is: one rule, for every place on the screen that says so.
 *
 * The spread stack's own age when the leg is priced; otherwise now less the slot's `updatedAt`, which
 * comes from the registry over RPC and so survives a subgraph outage; null only when neither exists.
 * The status bar and the leg detail once computed this differently, and an unread leg's detail said
 * "0s old" while the status bar said 21m for the same seq.
 */
export function referenceAgeSeconds(leg: LegSnapshot, nowSeconds: number): number | null {
  if (leg.spread !== null) return leg.spread.referenceAgeSeconds;
  if (leg.ref === null) return null;
  return Math.max(0, nowSeconds - Number(leg.ref.updatedAt));
}
