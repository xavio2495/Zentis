import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { clipSeries, legAgreement, plotMarket, priceOfMid, publishSpan, trackingGap, type Series } from "@/lib/market-chart";

/**
 * The market panel's arithmetic, away from any pixels.
 *
 * The trap this file exists for: `mid` is raw tokenB per 1e18 raw tokenA, and the price a reader
 * knows is USDC per WETH, which is its *reciprocal*. Plotting the mid and labelling the axis with
 * the price draws every move upside down — and an upside-down price chart looks entirely
 * reasonable, which is why it has to be a test rather than a glance.
 */
const seed = JSON.parse(readFileSync(join(import.meta.dir, "..", "public", "seed", "replay.json"), "utf8"));

const series = (points: [number, string][]): Series["points"] => points.map(([t, mid]) => ({ t, mid }));

describe("a mid is not a price", () => {
  test("the price is the mid's reciprocal, in USDC per WETH", () => {
    // 3.92e26 raw B per 1e18 raw A is about 2,548 USDC per WETH, not 3.9e26 of anything.
    const price = priceOfMid("392412218630695997888507774");
    expect(price).toBeGreaterThan(2000);
    expect(price).toBeLessThan(3200);
  });

  test("a rising mid is a falling price, and the chart follows the price", () => {
    const rising = series([
      [0, "392412218630695997888507774"],
      [1, "402635964179780951536606012"],
    ]);
    const plot = plotMarket({ market: { label: "market", points: rising }, legs: [], markers: [] }, { width: 100, height: 100 });
    // y grows downwards, so a falling price must end lower on the screen than it started.
    const [first, second] = plot.market.points;
    expect(priceOfMid(rising[1]!.mid)).toBeLessThan(priceOfMid(rising[0]!.mid));
    expect(second!.y).toBeGreaterThan(first!.y);
  });
});

describe("one axis for the market and the legs", () => {
  const market = series([
    [100, "400000000000000000000000000"],
    [200, "390000000000000000000000000"],
  ]);
  const leg: Series = { label: "Sepolia", points: series([[150, "395000000000000000000000000"]]) };

  test("a leg's point lands where the same price on the market line would", () => {
    const plot = plotMarket({ market: { label: "market", points: market }, legs: [leg], markers: [] }, { width: 200, height: 100 });
    const legPoint = plot.legs[0]!.points[0]!;
    // Halfway through the window in time, and at a price between the two market points.
    expect(legPoint.x).toBeCloseTo(100, 6);
    expect(legPoint.y).toBeGreaterThan(0);
    expect(legPoint.y).toBeLessThan(100);
  });

  test("the window is the whole recording, so a marker older than the legs still lands on it", () => {
    const plot = plotMarket(
      { market: { label: "market", points: market }, legs: [leg], markers: [{ t: 100, mid: "400000000000000000000000000", key: "a" }] },
      { width: 200, height: 100 },
    );
    expect(plot.window.from).toBe(100);
    expect(plot.window.to).toBe(200);
    expect(plot.markers[0]!.x).toBeCloseTo(0, 6);
  });

  test("a flat series draws a line rather than dividing by a zero range", () => {
    const flat = series([
      [0, "400000000000000000000000000"],
      [1, "400000000000000000000000000"],
    ]);
    const plot = plotMarket({ market: { label: "market", points: flat }, legs: [], markers: [] }, { width: 100, height: 100 });
    for (const point of plot.market.points) expect(Number.isFinite(point.y)).toBe(true);
  });

  test("nothing to draw is an empty plot, not a crash", () => {
    const plot = plotMarket({ market: { label: "market", points: [] }, legs: [], markers: [] }, { width: 100, height: 100 });
    expect(plot.market.line).toBe("");
    expect(plot.ticks.length).toBe(0);
  });
});

describe("what the legend is allowed to claim", () => {
  // zentis-4c asked for a legend saying the legs separate before the cutover round. In the moment
  // actually committed they never separate at all, so the legend has to be computed from the seed
  // rather than written from the brief.
  const legs = seed.legs as { label: string; rounds: { seq: number; mid: string }[] }[];

  test("the three legs are compared on shared seq, not on position in the array", () => {
    const agreement = legAgreement(legs);
    expect(agreement.shared).toBeGreaterThan(0);
    expect(agreement.identical + agreement.divergent.length).toBe(agreement.shared);
  });

  test("in this recording every shared publish carries the same mid on all three legs", () => {
    const agreement = legAgreement(legs);
    expect(agreement.divergent).toEqual([]);
    expect(agreement.coincide).toBe(true);
  });

  test("a leg that disagrees at one seq is reported at that seq", () => {
    const agreement = legAgreement([
      { label: "a", rounds: [{ seq: 1, mid: "100" }, { seq: 2, mid: "200" }] },
      { label: "b", rounds: [{ seq: 1, mid: "100" }, { seq: 2, mid: "201" }] },
    ]);
    expect(agreement.coincide).toBe(false);
    expect(agreement.divergent).toEqual([2]);
  });
});

describe("the window the panel is read at", () => {
  // The legs publish over about thirty hours; the market series covers a week. Drawn over the week,
  // the legs are a fifth of the axis wide and the thing the panel exists to show — the legs sitting
  // on the market — is unreadable. So the window is a choice, and clipping the market to it is
  // arithmetic rather than a CSS crop: a clipped line must keep the points that straddle the edges
  // or it detaches from the frame.
  const points = series([
    [0, "400000000000000000000000000"],
    [10, "399000000000000000000000000"],
    [20, "398000000000000000000000000"],
    [30, "397000000000000000000000000"],
    [40, "396000000000000000000000000"],
  ]);

  test("a clip keeps the points inside the window", () => {
    expect(clipSeries(points, 15, 35).map((p) => p.t)).toEqual([20, 30]);
  });

  test("a clip that lands between points still spans the window", () => {
    // Without the straddling points either side, a line clipped to 15..35 would start at 20 and
    // leave a gap against the frame it was clipped to.
    expect(clipSeries(points, 15, 35, { straddle: true }).map((p) => p.t)).toEqual([10, 20, 30, 40]);
  });

  test("a window with nothing in it clips to nothing rather than to everything", () => {
    expect(clipSeries(points, 100, 200)).toEqual([]);
  });

  test("the legs' own span is where they actually published", () => {
    const span = publishSpan(seed.legs);
    expect(span).not.toBeNull();
    expect(span!.to).toBeGreaterThan(span!.from);
    const earliest = Math.min(...seed.legs.flatMap((l: { rounds: { atSeconds: number }[] }) => l.rounds.map((r) => r.atSeconds)));
    expect(span!.from).toBe(earliest);
  });

  test("clipped to the legs' span, the market reaches back past the window's start", () => {
    const span = publishSpan(seed.legs)!;
    const clipped = clipSeries(seed.market.points, span.from, span.to, { straddle: true });
    expect(clipped.length).toBeGreaterThan(1);
    expect(clipped[0]!.t).toBeLessThanOrEqual(span.from);
  });

  test("the market series may end before the legs stop publishing, and is not padded to hide it", () => {
    // The legs' last publish is minutes after the last hourly close, so there is no market point
    // after it. Extending the line to the frame would draw a price the series never carried; the
    // honest picture is a market line that stops where the series stops.
    const span = publishSpan(seed.legs)!;
    const clipped = clipSeries(seed.market.points, span.from, span.to, { straddle: true });
    const last = clipped[clipped.length - 1]!;
    expect(last.t).toBeLessThanOrEqual(span.to);
    expect(seed.market.points.some((p: { t: number }) => p.t > span.to)).toBe(false);
  });
});

describe("how closely the legs track the market", () => {
  /**
   * The legend's first draft said the legs "sit exactly under the market's" line. That conflated
   * two different claims: the three legs agree with *each other* exactly, which is true and is what
   * `legAgreement` measures, and the legs sit on the *market* line, which in this recording they
   * plainly do not — the published mid runs several hundred basis points away from the hourly close
   * for the first few hours of the window. A legend that says the second because the first is true
   * is the panel misreading its own chart.
   */
  test("the gap is measured against the market's nearest point, in basis points of it", () => {
    const market = series([
      [0, "400000000000000000000000000"],
      [100, "400000000000000000000000000"],
    ]);
    // A mid one per cent away is a hundred basis points away, whichever way the reciprocal runs.
    const leg = { label: "a", rounds: [{ atSeconds: 50, mid: "404000000000000000000000000" }] };
    const gap = trackingGap([leg], market);
    expect(Math.abs(gap.worstBps)).toBeGreaterThan(90);
    expect(Math.abs(gap.worstBps)).toBeLessThan(110);
  });

  test("a leg that sits on the market has no gap", () => {
    const market = series([[0, "400000000000000000000000000"], [100, "400000000000000000000000000"]]);
    const gap = trackingGap([{ label: "a", rounds: [{ atSeconds: 50, mid: "400000000000000000000000000" }] }], market);
    expect(gap.worstBps).toBe(0);
    expect(gap.meanAbsBps).toBe(0);
  });

  test("nothing to compare is no gap rather than a divide by zero", () => {
    expect(trackingGap([], []).worstBps).toBe(0);
    expect(Number.isFinite(trackingGap([{ label: "a", rounds: [] }], []).meanAbsBps)).toBe(true);
  });

  test("in this recording the legs leave the market line by more than a hundred basis points", () => {
    // The number the legend has to carry. If a future recording tracks tightly this fails, and the
    // legend's wording should soften with it rather than the test being deleted.
    const gap = trackingGap(seed.legs, seed.market.points);
    expect(Math.abs(gap.worstBps)).toBeGreaterThan(100);
    expect(gap.meanAbsBps).toBeGreaterThan(0);
    expect(gap.worstAt).toBeGreaterThan(0);
  });
});
