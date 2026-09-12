import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { legAgreement, plotMarket, priceOfMid, type Series } from "@/lib/market-chart";

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
