/**
 * Builds the `takerTraitsAndData` argument the router expects.
 *
 * The header is ten sixteen-bit slice ends followed by a sixteen-bit flag word, twenty-two
 * bytes in all, which is exactly what the router slices off before treating the rest as taker
 * data. A quote needs no threshold, recipient, deadline, hook data or signature, so every
 * slice end is zero and the header is the whole argument.
 */
const IS_EXACT_IN = 0x0001;
const IS_A_TO_B = 0x0080;

const SLICE_COUNT = 10;

export function buildQuoteTakerTraits(options: {
  isExactIn: boolean;
  isAToB: boolean;
}): `0x${string}` {
  const flags = (options.isExactIn ? IS_EXACT_IN : 0) | (options.isAToB ? IS_A_TO_B : 0);
  const sliceEnds = "0000".repeat(SLICE_COUNT);
  return `0x${sliceEnds}${flags.toString(16).padStart(4, "0")}`;
}
