import { humanDuration } from "./duration.js";
import type { LegSnapshot } from "./snapshot.js";

/**
 * What state a leg is in, in one word, from one vocabulary.
 *
 * Two surfaces say this — the console's cards and the web's dots — and if each derived its own word
 * from the nulls they would eventually disagree about the same leg. Worse, they would disagree in
 * the case that matters: a read that failed and a position that is gone both arrive as a null
 * `position`, and calling the first "docked" tells a viewer during a rate-limit outage that the
 * position this whole surface is about has been withdrawn.
 *
 * The colour is not here. What a state looks like belongs to the surface drawing it; which state a
 * leg is in does not.
 */
export type LegStateKind = "unread" | "none" | "docked" | "stale" | "unpriced" | "live";

export interface LegState {
  readonly kind: LegStateKind;
  /** the long form, with the reason or the age where there is one */
  readonly word: string;
  /** the short form, for a column that has to fit at eighty */
  readonly short: string;
}

export function legState(leg: LegSnapshot): LegState {
  if (leg.sources.fills !== null) {
    return { kind: "unread", word: `unavailable — ${leg.sources.fills}`, short: "unread" };
  }
  if (leg.position === null) return { kind: "none", word: "no position", short: "none" };
  if (!leg.position.active) return { kind: "docked", word: "docked", short: "docked" };
  if (leg.spread?.tooStaleToQuote === true) {
    const age = humanDuration(leg.spread.referenceAgeSeconds);
    return { kind: "stale", word: `stale ${age}`, short: `stale ${age}` };
  }
  if (leg.ref === null) return { kind: "unpriced", word: "no reference", short: "no ref" };
  return { kind: "live", word: "live", short: "live" };
}
