import { BAR } from "./theme.js";

/**
 * A raw token amount as a human figure, with the token's own decimals and no rounding that could
 * flatter it. Amounts on this screen are small against their decimals — 0.15 of a six-decimal token,
 * a few picograms of an eighteen-decimal one — so the integer part is printed in full and the
 * fraction is trimmed to `places` rather than to a fixed width.
 */
export function amount(raw: bigint, decimals: number, places = 4): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === "" ? "" : `.${fraction}`}`;
}

/**
 * Eighteen-decimal amounts are printed in exponent form when they are small enough that the decimal
 * form is all zeroes: `3.88e12 wei` says more at a glance than `0.0000038` does.
 */
export function weiish(raw: bigint, decimals: number): string {
  if (decimals < 12 || raw === 0n) return amount(raw, decimals);
  const digits = (raw < 0n ? -raw : raw).toString();
  const exponent = digits.length - 1;
  const mantissa = `${digits[0]}.${digits.slice(1, 3)}`;
  return `${raw < 0n ? "-" : ""}${mantissa}e${exponent}`;
}

/** Signed basis points, always with their sign, because an unsigned tilt reads as a magnitude. */
export const signed = (bps: bigint | number): string => {
  const value = typeof bps === "bigint" ? Number(bps) : bps;
  return value > 0 ? `+${value}` : String(value);
};

/** A duration as an operator says it: seconds under a minute, then minutes, then hours. */
export function since(seconds: number): string {
  if (seconds < 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  return `${hours}h${Math.floor((seconds % 3600) / 60)}m`;
}

export const clock = (timestamp: bigint): string =>
  new Date(Number(timestamp) * 1000).toISOString().slice(11, 19);

/**
 * A bar with the even split marked, for an inventory that is interesting only in how far from even
 * it is. `fraction` is 1e18-scaled, as every weight in the policy is.
 */
export function weightBar(fraction: bigint, width: number): string {
  const ONE = 10n ** 18n;
  const filled = Number((fraction * BigInt(width)) / ONE);
  const clamped = Math.max(0, Math.min(width, filled));
  const cells: string[] = Array.from({ length: width }, (_, i) => (i < clamped ? BAR.filled : BAR.empty));
  const middle = Math.floor(width / 2);
  cells[middle] = BAR.marker;
  return cells.join("");
}

/**
 * The shift as a gauge from `-max` to `+max`, zero at the centre, split into the two terms that
 * made it.
 *
 * The run's length is the whole shift and its direction is the shift's sign, because that is what
 * the curve actually quotes. Inside the run, the terms take the share of the cells their magnitudes
 * earn — so a shift that is nearly all correction reads as nearly all correction at a glance, which
 * is the one thing the on-chain number cannot say. Returned as spans rather than a string so the
 * caller can give each term its own colour.
 */
export type GaugeSpan = { text: string; term: "correction" | "concession" | "empty" };

export function stackedGauge(
  correction: bigint,
  concession: bigint,
  max: bigint,
  width: number,
): GaugeSpan[] {
  const half = Math.floor(width / 2);
  const total = correction + concession;
  const magnitude = total < 0n ? -total : total;
  const cells = Math.min(half, Number((magnitude * BigInt(half)) / (max <= 0n ? 1n : max)));

  const weights = [correction, concession].map((t) => (t < 0n ? -t : t));
  const sum = weights[0]! + weights[1]!;
  const correctionCells = sum === 0n ? 0 : Math.round((cells * Number(weights[0]!)) / Number(sum));
  const concessionCells = cells - correctionCells;

  const run: GaugeSpan[] = [
    { text: BAR.filled.repeat(correctionCells), term: "correction" },
    { text: BAR.filled.repeat(concessionCells), term: "concession" },
  ];
  const pad: GaugeSpan = { text: BAR.empty.repeat(half - cells), term: "empty" };
  const rest: GaugeSpan = { text: BAR.empty.repeat(half), term: "empty" };

  // A negative run grows leftward from the centre, so the correction stays the term nearest zero
  // and the spans come out reversed. Keeping each span labelled means the colours follow the term
  // rather than the position.
  return total < 0n ? [pad, ...run.reverse(), rest] : [rest, ...run, pad];
}

/**
 * Clamps a sentence to a whole number of wrapped rows.
 *
 * The `why` line is the one piece of variable-height content in a leg column, and a column that
 * grows by a row pushes every panel below it down — which is how a layout that fits a 720p recording
 * stops fitting one. Clamping here rather than letting Ink wrap freely keeps the column's height a
 * constant, and the sentences are written to say the important half first.
 */
export function clampToRows(text: string, columns: number, rows: number): string {
  const limit = columns * rows;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > limit / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}
