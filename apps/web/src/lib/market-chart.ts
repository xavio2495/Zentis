/**
 * The market panel's geometry: one price axis, the market's line on it, the legs' published mids
 * over the same axis, and the fills as markers.
 *
 * Two things here are easy to get wrong in a way that still looks like a chart.
 *
 * The first is the direction. `mid` is raw tokenB per 1e18 raw tokenA — the registry's own units —
 * and the price a reader knows is USDC per WETH, which is its reciprocal. Plotting the mid under an
 * axis labelled in dollars draws every move upside down, and nothing about the result looks wrong.
 * So the conversion happens once, here, and everything downstream is already a price.
 *
 * The second is the window. The legs publish over about thirty hours; the market series covers a
 * week; some fills are older than the oldest publish. Scaling x to the rounds would push those
 * fills off the left edge, so the window is the union of everything handed in and the legs' lines
 * simply start partway across — which is the truth about when they shipped.
 *
 * Pure, and tested without a browser.
 */

/** A mid as USDC per WETH: six-decimal A against eighteen-decimal B, reciprocated. */
export function priceOfMid(mid: string): number {
  const perA = Number(BigInt(mid)) / 1e18;
  return perA === 0 ? 0 : 1e12 / perA;
}

export interface Series {
  readonly label: string;
  readonly points: readonly { readonly t: number; readonly mid: string }[];
}

export interface Marker {
  readonly t: number;
  readonly mid: string;
  readonly key: string;
}

export interface PlotPoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly price: number;
}

export interface PlotSeries {
  readonly label: string;
  /** an SVG polyline `points` string, empty when the series has nothing in this window */
  readonly line: string;
  readonly points: PlotPoint[];
}

export interface MarketPlot {
  readonly market: PlotSeries;
  readonly legs: PlotSeries[];
  readonly markers: (PlotPoint & { readonly key: string })[];
  readonly window: { readonly from: number; readonly to: number };
  readonly domain: { readonly low: number; readonly high: number };
  readonly ticks: { readonly y: number; readonly price: number }[];
}

export interface MarketInput {
  readonly market: Series;
  readonly legs: readonly Series[];
  readonly markers: readonly Marker[];
}

/**
 * A price axis with a little air above and below.
 *
 * Deliberately not zero-based: a week of WETH moves a couple of percent, and an axis starting at
 * zero draws that as a flat line. The panel is for reading the move.
 */
function priceDomain(prices: number[]): { low: number; high: number } {
  if (prices.length === 0) return { low: 0, high: 1 };
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  if (high === low) {
    // A flat series still has to divide by something. One per cent either side keeps the line in
    // the middle of the frame instead of on its edge.
    const pad = Math.abs(high) * 0.01 || 1;
    return { low: low - pad, high: high + pad };
  }
  const pad = (high - low) * 0.08;
  return { low: low - pad, high: high + pad };
}

export function plotMarket(
  { market, legs, markers }: MarketInput,
  { width, height, tickCount = 4 }: { width: number; height: number; tickCount?: number },
): MarketPlot {
  const all = [market, ...legs];
  const times = [...all.flatMap((s) => s.points.map((p) => p.t)), ...markers.map((m) => m.t)];
  const prices = [...all.flatMap((s) => s.points.map((p) => priceOfMid(p.mid))), ...markers.map((m) => priceOfMid(m.mid))];

  if (times.length === 0) {
    return {
      market: { label: market.label, line: "", points: [] },
      legs: legs.map((s) => ({ label: s.label, line: "", points: [] })),
      markers: [],
      window: { from: 0, to: 0 },
      domain: { low: 0, high: 1 },
      ticks: [],
    };
  }

  const from = Math.min(...times);
  const to = Math.max(...times);
  const domain = priceDomain(prices);

  const xOf = (t: number) => (to <= from ? width : ((t - from) / (to - from)) * width);
  // y grows downwards, so the high price is at the top.
  const yOf = (price: number) => height - ((price - domain.low) / (domain.high - domain.low)) * height;

  const place = (s: Series): PlotSeries => {
    const points = s.points.map((p) => {
      const price = priceOfMid(p.mid);
      return { x: xOf(p.t), y: yOf(price), t: p.t, price };
    });
    return { label: s.label, line: points.map((p) => `${p.x},${p.y}`).join(" "), points };
  };

  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const price = domain.low + ((domain.high - domain.low) * (i + 0.5)) / tickCount;
    return { y: yOf(price), price };
  });

  return {
    market: place(market),
    legs: legs.map(place),
    markers: markers.map((m) => {
      const price = priceOfMid(m.mid);
      return { x: xOf(m.t), y: yOf(price), t: m.t, price, key: m.key };
    }),
    window: { from, to },
    domain,
    ticks,
  };
}

export interface Agreement {
  /** publishes carried by every leg handed in */
  readonly shared: number;
  readonly identical: number;
  /** the seqs where the legs did not all publish the same mid */
  readonly divergent: number[];
  readonly coincide: boolean;
}

/**
 * Whether the legs' published mids actually coincide, computed rather than asserted.
 *
 * The three legs share a reference by construction, so their mids should be the same number at the
 * same seq — but "should" is what the legend would be claiming, and a legend that claims something
 * the recording does not show is worse than no legend. Compared on seq, never on array position:
 * the legs publish at slightly different wall times and a leg can miss a round entirely.
 */
export function legAgreement(legs: readonly { label: string; rounds: readonly { seq: number; mid: string }[] }[]): Agreement {
  if (legs.length === 0) return { shared: 0, identical: 0, divergent: [], coincide: true };
  const tables = legs.map((leg) => new Map(leg.rounds.map((round) => [round.seq, round.mid])));
  const [first, ...rest] = tables;
  let shared = 0;
  let identical = 0;
  const divergent: number[] = [];
  for (const [seq, mid] of first!) {
    const others = rest.map((table) => table.get(seq));
    if (others.some((value) => value === undefined)) continue;
    shared += 1;
    if (others.every((value) => value === mid)) identical += 1;
    else divergent.push(seq);
  }
  return { shared, identical, divergent: divergent.sort((a, b) => a - b), coincide: divergent.length === 0 };
}

/**
 * The points inside a window.
 *
 * `straddle` keeps the last point before the window and the first after it, which is what stops a
 * clipped line detaching from the frame it was clipped to: an hourly series clipped to a span that
 * starts at 08:53 would otherwise begin at 09:00 and leave a gap the reader would take for missing
 * data rather than for the edge of an hour.
 */
export function clipSeries<T extends { t: number }>(
  points: readonly T[],
  from: number,
  to: number,
  { straddle = false }: { straddle?: boolean } = {},
): T[] {
  const inside = points.filter((p) => p.t >= from && p.t <= to);
  if (!straddle || inside.length === 0) return inside;
  const before = [...points].filter((p) => p.t < from).pop();
  const after = points.find((p) => p.t > to);
  return [...(before ? [before] : []), ...inside, ...(after ? [after] : [])];
}

/** The span the legs actually published over: the union of their rounds, or null if none did. */
export function publishSpan(
  legs: readonly { rounds: readonly { atSeconds: number }[] }[],
): { from: number; to: number } | null {
  const times = legs.flatMap((leg) => leg.rounds.map((round) => round.atSeconds));
  if (times.length === 0) return null;
  return { from: Math.min(...times), to: Math.max(...times) };
}

export interface TrackingGap {
  /** the signed worst distance, in basis points of the market's own price */
  readonly worstBps: number;
  readonly worstAt: number;
  readonly meanAbsBps: number;
  readonly compared: number;
}

/**
 * How far the legs' published mid runs from the market series, in basis points of the market.
 *
 * The panel needs this because the obvious legend is wrong. The three legs agree with each other
 * exactly — one reference, by construction — and it is tempting to write that they therefore sit on
 * the market line. They do not: in the recording committed today the published mid is several
 * hundred basis points off the hourly close for the first hours of the window.
 *
 * Part of that is the comparison's own coarseness, and the panel says so: the market series is
 * hourly closes and the legs publish every few minutes, so a fast move shows up as a gap that is
 * really the hour's width. It is still the honest number to put under the chart, because the
 * alternative is a sentence claiming a coincidence the reader can see is not there.
 */
export function trackingGap(
  legs: readonly { rounds: readonly { atSeconds: number; mid: string }[] }[],
  market: readonly { t: number; mid: string }[],
): TrackingGap {
  if (market.length === 0) return { worstBps: 0, worstAt: 0, meanAbsBps: 0, compared: 0 };

  // The market's points are oldest first, so the nearest is found by walking rather than by
  // scanning the series once per round — four hundred rounds against a week of hours otherwise.
  const prices = market.map((point) => ({ t: point.t, price: priceOfMid(point.mid) }));
  let worstBps = 0;
  let worstAt = 0;
  let total = 0;
  let compared = 0;
  let cursor = 0;

  for (const leg of legs) {
    cursor = 0;
    for (const round of leg.rounds) {
      while (cursor + 1 < prices.length && Math.abs(prices[cursor + 1]!.t - round.atSeconds) <= Math.abs(prices[cursor]!.t - round.atSeconds)) {
        cursor += 1;
      }
      const nearest = prices[cursor]!;
      if (nearest.price === 0) continue;
      const bps = ((priceOfMid(round.mid) - nearest.price) / nearest.price) * 10_000;
      total += Math.abs(bps);
      compared += 1;
      if (Math.abs(bps) > Math.abs(worstBps)) {
        worstBps = bps;
        worstAt = round.atSeconds;
      }
    }
  }

  return {
    worstBps: compared === 0 ? 0 : worstBps,
    worstAt,
    meanAbsBps: compared === 0 ? 0 : total / compared,
    compared,
  };
}
