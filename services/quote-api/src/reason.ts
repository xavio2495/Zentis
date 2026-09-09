import type { LegPosition } from "./legs.js";

/**
 * Why this leg prices this side the way it does.
 *
 * The sign convention comes from the instruction itself: a positive tilt means the leg is
 * over-weight tokenA, so it makes tokenA cheap. A taker taking tokenA out of an over-weight
 * leg is therefore the side the maker wants filled, and gets the better price for supplying
 * it. This is the whole point of the product, so the endpoint says it out loud.
 */
export function explain(position: LegPosition, isAToB: boolean): string {
  if (!position.hasReference) {
    return "no reference published yet, so this leg prices as a plain constant-product curve";
  }
  const tilt = position.refTiltBps ?? 0;
  const takerReceivesTokenA = !isAToB;

  if (tilt === 0) {
    return "the leg is balanced against its pair, so neither side is favoured";
  }
  const longTokenA = tilt > 0;
  const favoured = longTokenA === takerReceivesTokenA;
  const heldLong = longTokenA ? "tokenA" : "tokenB";
  const wanted = longTokenA ? "take tokenA out of" : "put tokenA into";

  return favoured
    ? `the leg is over-weight ${heldLong} at ${Math.abs(tilt)} bps of tilt and wants takers to ${wanted} it, so this side is discounted`
    : `the leg is over-weight ${heldLong} at ${Math.abs(tilt)} bps of tilt and wants takers to ${wanted} it, so this side pays a premium`;
}
