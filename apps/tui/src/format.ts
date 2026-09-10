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
  // Wrapped the way a terminal wraps — greedily, on whole words — rather than by counting
  // characters. A character count is wrong in the direction that costs a row: `columns * rows`
  // characters only fit if no word ever straddles a line end, and every word that does wastes the
  // rest of that line. Getting this wrong pushes every panel below the column down one.
  const words = text.split(/\s+/).filter((w) => w !== "")
  const lines: string[] = []
  let line = ""
  let overflowed = false

  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`
    if (candidate.length <= columns) {
      line = candidate
      continue
    }
    if (lines.length + 1 === rows) {
      overflowed = true
      break
    }
    lines.push(line)
    // A single word longer than the column is cut rather than allowed to wrap on its own.
    line = word.length <= columns ? word : word.slice(0, columns)
  }
  if (!overflowed) return text

  const room = columns - 1
  lines.push(line.length <= room ? `${line}…` : `${line.slice(0, room)}…`)
  return lines.join(" ")
}

/**
 * The widest of several renderings that fits, or the shortest one visibly cut.
 *
 * Every row that carries numbers goes through here. Ink shortens an overlong row by deleting
 * characters from *inside* it, so `10+49+0+200` becomes `10+4+0+20` — a smaller number that still
 * looks like a number and no longer sums to its own total. A row must therefore never be handed to
 * Ink wider than its column. Callers give the same row at decreasing levels of detail, and detail is
 * what gets dropped; a trailing ellipsis is the last resort and is at least visible.
 */
export function chooseFit(renderings: string[], width: number): string {
  for (const rendering of renderings) {
    if (rendering.length <= width) return rendering
  }
  const shortest = renderings[renderings.length - 1] ?? ''
  return width <= 1 ? '…'.slice(0, Math.max(0, width)) : `${shortest.slice(0, width - 1)}…`
}

/**
 * The spread row: the terms are never dropped, the explanation around them is.
 *
 * In order of what goes first: the age arithmetic, then the word `spread`, then the total. The four
 * terms and their `+` signs are what the row exists to show and survive to the narrowest column.
 */
export function spreadRow(
  stack: {
    totalBps: number
    baseBps: number
    volatilityBps: number
    markoutBps: number
    stalenessBps: number
  },
  widenBpsPerMinute: number,
  ageMinutes: number,
  width: number,
): { numbers: string; note: string } {
  const terms = `${stack.baseBps}+${stack.volatilityBps}+${stack.markoutBps}+${stack.stalenessBps}`
  const numbers = chooseFit(
    [`spread ${stack.totalBps} ${terms}`, `spread ${terms}`, `${stack.totalBps} ${terms}`, terms],
    width,
  )
  if (stack.stalenessBps === 0) return { numbers, note: '' }

  const note = ` (${widenBpsPerMinute}/m × ${ageMinutes}m)`
  return { numbers, note: numbers.length + note.length <= width ? note : '' }
}

/**
 * The shift row, which has to explain why its own numbers do not add up.
 *
 * `-1631 + 1131` is `-500` only because the maker's signed cap intervened. Printed bare, the three
 * numbers read as arithmetic that does not work — worse than printing nothing, because the reader
 * concludes the screen is broken rather than that the policy was clamped.
 */
export function shiftRow(
  tiltBps: bigint,
  correction: bigint,
  concession: bigint,
  capped: boolean,
  width: number,
): string {
  const total = capped ? `shift ${signed(tiltBps)} (capped)` : `shift ${signed(tiltBps)}`
  const split = `corr ${signed(correction)} | conc ${signed(concession)}`
  return chooseFit(
    [
      capped ? `${total} = ${split} before cap` : `${total}  ${split}`,
      `${total}  ${split}`,
      `shift ${signed(tiltBps)} ${split}`,
      total,
      `shift ${signed(tiltBps)}`,
    ],
    width,
  )
}

/**
 * A raw token amount as the token, with three significant digits.
 *
 * The screen used to print `4.13e14` for a WETH balance, which is wrong twice over: it is the raw
 * unit rather than the token, and scientific notation of an eighteen-decimal integer is not a
 * quantity anyone can size at a glance. Three significant digits rather than a fixed number of
 * places, because the amounts here span a taker's 0.15 USDC and a maker's 0.000004 WETH and a fixed
 * precision renders one of them as zero.
 */
export function tokenAmount(raw: bigint, decimals: number, significant = 3): string {
  if (raw === 0n) return '0'
  const negative = raw < 0n
  const value = negative ? -raw : raw
  const scale = 10n ** BigInt(decimals)
  const whole = value / scale
  const sign = negative ? '-' : ''
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  if (whole > 0n) {
    // Above one unit the integer part already carries the magnitude; the fraction only refines it.
    const spare = Math.max(0, significant - whole.toString().length)
    if (spare === 0) return `${sign}${grouped}`
    const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, spare).replace(/0+$/, '')
    return fraction === '' ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`
  }

  // Below one unit, count places from the first digit that is not a leading zero, so a very small
  // balance keeps its precision instead of rounding away.
  const fraction = (value % scale).toString().padStart(decimals, '0')
  const firstSignificant = fraction.search(/[1-9]/)
  const kept = fraction.slice(0, firstSignificant + significant).replace(/0+$/, '')
  return `${sign}0.${kept}`
}

/** A duration as an operator says it, at any scale: seconds, then minutes, then hours and minutes. */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest === 0 ? `${hours}h` : `${hours}h${rest}m`
  }
  // A week-long window read as "166h40m ago", which nobody converts in their head.
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours === 0 ? `${days}d` : `${days}d${restHours}h`
}

/**
 * A pool's mid as the price a person would quote: one whole unit of tokenB, in tokenA.
 *
 * `mid` is raw tokenB per 1e18 raw tokenA — the unit the policy computes in, and one nobody reads.
 * For USDC/WETH that is the number of wei a millionth of a dollar buys; the screen says what a WETH
 * costs instead. Rounded half-up to the whole unit, because a price is a quotation rather than a
 * balance, and a quotation that floors reads as wrong by one against any other source.
 */
export function pairPrice(
  mid: bigint,
  tokenA: { symbol: string; decimals: number },
  tokenB: { symbol: string; decimals: number },
): string {
  if (mid <= 0n) return "no price";
  return `1 ${tokenB.symbol} = ${priceFigure(mid, tokenA, tokenB)} ${tokenA.symbol}`;
}

/** The number in `pairPrice`, alone: what one whole tokenB costs in tokenA, for an axis label. */
export function priceFigure(
  mid: bigint,
  tokenA: { decimals: number },
  tokenB: { decimals: number },
): string {
  if (mid <= 0n) return "—";
  // raw tokenA per one whole tokenB = 1e18 * 10^decB / mid, then shown at tokenA's decimals.
  const rawA = (10n ** 18n * 10n ** BigInt(tokenB.decimals) + mid / 2n) / mid;
  const scale = 10n ** BigInt(tokenA.decimals);
  const whole = (rawA + scale / 2n) / scale;
  return whole >= 100n
    ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : tokenAmount(rawA, tokenA.decimals, 4);
}
