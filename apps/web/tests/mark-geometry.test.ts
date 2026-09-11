import { describe, expect, test } from "bun:test";
import {
  BRIDGE,
  CHAIN_A,
  CHAIN_B,
  BAR,
  parsePolygon,
  pointInPolygon,
  sampleMark,
} from "../src/lib/mark-geometry";

describe("parsePolygon", () => {
  test("reads the bridge as a quadrilateral", () => {
    expect(parsePolygon(BRIDGE)).toHaveLength(4);
  });

  test("expands the horizontal and vertical shorthands of the two chains", () => {
    expect(parsePolygon(CHAIN_A)).toHaveLength(6);
    expect(parsePolygon(CHAIN_B)).toHaveLength(6);
  });

  test("drops the closing vertex rather than repeating the first", () => {
    const ring = parsePolygon(CHAIN_A);
    expect(ring[0]).not.toEqual(ring[ring.length - 1]);
  });

  test("carries the shorthand's implied coordinate across", () => {
    // `M999.999 636.737 H727.272` holds y while x moves.
    const ring = parsePolygon(CHAIN_A);
    expect(ring[1].y).toBeCloseTo(ring[0].y, 6);
    expect(ring[1].x).toBeCloseTo(727.272, 3);
  });
});

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  test("accepts an interior point", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  test("rejects an exterior point", () => {
    expect(pointInPolygon(15, 5, square)).toBe(false);
  });
});

describe("sampleMark", () => {
  const opts = { count: 2000, outlineShare: 0.26, depthJitter: 0.09, seed: 1 };

  test("is deterministic for a seed", () => {
    const a = sampleMark(opts);
    const b = sampleMark(opts);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.roles)).toEqual(Array.from(b.roles));
  });

  test("returns one position triple and one role per point", () => {
    const { positions, roles } = sampleMark(opts);
    expect(positions).toHaveLength(opts.count * 3);
    expect(roles).toHaveLength(opts.count);
  });

  test("normalises into a centred unit square", () => {
    const { positions } = sampleMark(opts);
    for (let i = 0; i < opts.count; i++) {
      expect(Math.abs(positions[i * 3])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(positions[i * 3 + 1])).toBeLessThanOrEqual(0.5);
    }
  });

  test("keeps depth inside the jitter envelope", () => {
    const { positions } = sampleMark(opts);
    for (let i = 0; i < opts.count; i++) {
      expect(Math.abs(positions[i * 3 + 2])).toBeLessThanOrEqual(opts.depthJitter);
    }
  });

  test("spends roughly the requested share on the outline", () => {
    const { outlineCount } = sampleMark(opts);
    expect(outlineCount / opts.count).toBeCloseTo(opts.outlineShare, 1);
  });

  test("every point lands on one of the three shapes", () => {
    const { positions, roles } = sampleMark(opts);
    const rings = [BRIDGE, CHAIN_A, CHAIN_B].map(parsePolygon);
    let off = 0;
    for (let i = 0; i < opts.count; i++) {
      // back to user space: the sampler centres and flips y
      const x = (positions[i * 3] + 0.5) * 1000;
      const y = (0.5 - positions[i * 3 + 1]) * 1000;
      const hit = rings.some((r) => pointInPolygon(x, y, r, 1.5));
      if (!hit) off++;
      expect(roles[i] === BAR || roles[i] === 1).toBe(true);
    }
    expect(off).toBe(0);
  });

  test("tags the bridge apart from the two bars", () => {
    const { positions, roles } = sampleMark(opts);
    const bridge = parsePolygon(BRIDGE);
    let tagged = 0;
    for (let i = 0; i < opts.count; i++) {
      if (roles[i] === BAR) continue;
      tagged++;
      const x = (positions[i * 3] + 0.5) * 1000;
      const y = (0.5 - positions[i * 3 + 1]) * 1000;
      expect(pointInPolygon(x, y, bridge, 1.5)).toBe(true);
    }
    // the connector is the smallest of the three shapes but must be present
    expect(tagged).toBeGreaterThan(0);
    expect(tagged).toBeLessThan(opts.count / 2);
  });
});
