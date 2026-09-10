import type { LegSnapshot } from "./snapshot.js";
import { weightPercent } from "./decompose.js";

/**
 * One sentence naming the term that is doing the most to this leg's quote, and what it means.
 *
 * A column of basis points tells a reader who already knows the policy what happened. This is for
 * the reader who does not: it picks the largest term the leg is carrying and says, in the plain
 * words of the mapping, why the quote sits where it does. It is generated from the leg's own
 * numbers, so it cannot drift from the panel above it.
 */
export function why(leg: LegSnapshot): string {
  const { shift, spread, config, position } = leg;
  if (position === null) return "this leg has no indexed position, so nothing here is priced";
  if (!position.active) return "this leg is docked: it holds no committed balance and quotes nothing";
  if (shift === null || spread === null) return "not every source answered, so this leg is shown as published";

  const magnitude = (v: bigint | number) => Math.abs(Number(v));
  const candidates = [
    {
      size: magnitude(shift.correction),
      say:
        `this leg's reserves put its own curve ${(magnitude(shift.correction) / 100).toFixed(2)}% off the mid, ` +
        `so the quote is corrected back onto it`,
    },
    {
      size: magnitude(shift.ownConcession),
      say:
        `this leg holds ${weightPercent(shift.weightA)}% ${config.tokenA.symbol}, so it pays ` +
        `${magnitude(shift.ownConcession)} bps to shed it`,
    },
    {
      size: magnitude(shift.bookConcession),
      say: `the whole book leans, so every leg concedes ${magnitude(shift.bookConcession)} bps of it here`,
    },
    {
      size: spread.volatilityBps,
      say:
        `the pool this leg prices from moved enough over the week to carry ` +
        `${spread.volatilityBps} bps of the spread`,
    },
    {
      size: spread.stalenessBps,
      say:
        `the reference is ${Math.floor(spread.referenceAgeSeconds / 60)} minutes old, so the quote has ` +
        `widened ${spread.stalenessBps} bps with its age`,
    },
    { size: spread.markoutBps, say: `recent fills went against the maker, so ${spread.markoutBps} bps is charged for it` },
  ];

  // A boundary on the cap is an artefact and not a budget: it is published as the shift plus the
  // room and then clamped, so on the cap it could be any shift plus any room. Reading the zero it
  // arithmetically comes to as a refusal to concede would invent a decision the enclave never made.
  if (shift.roomUnknownAtCap) {
    return `this leg's boundary sits on the cap, so how much room it has left to concede cannot be read back`;
  }
  // The boundary running out is a bigger fact than any term's size: it means the leg wanted to
  // concede and was not allowed to, which no basis-point figure on the screen says by itself.
  if (shift.cappedByRoom && shift.roomBps === 0n) {
    return `the boundary leaves no room to concede here, so the whole shift is correction`;
  }
  if (shift.clampedByMaxTilt) {
    return `the shift wanted more than the cap the maker signed, so it sits at ${shift.tiltBps} bps`;
  }

  const largest = candidates.reduce((best, c) => (c.size > best.size ? c : best));
  return largest.size === 0 ? "every term is at zero: this leg is quoting the mid" : largest.say;
}
