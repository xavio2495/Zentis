import { describe, expect, test } from "bun:test";
import { spherePush } from "../src/lib/disperse";

const CENTRE = { x: 0, y: 0, z: 0 };
const RADIUS = 1;

describe("spherePush", () => {
  test("leaves anything beyond its reach alone", () => {
    const p = { x: 2, y: 0, z: 0 };
    expect(spherePush(p, CENTRE, RADIUS, 1)).toEqual(p);
  });

  test("puts a point at the centre out on the rim", () => {
    const out = spherePush({ x: 0.001, y: 0, z: 0 }, CENTRE, RADIUS, 1);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(RADIUS, 4);
  });

  test("clears a sphere, not a tube: depth counts toward the distance", () => {
    // Same x and y, but deep enough to be outside the sphere. A cylindrical
    // push would move this point; a spherical one must not.
    const deep = { x: 0.5, y: 0, z: 1.4 };
    expect(spherePush(deep, CENTRE, RADIUS, 1)).toEqual(deep);
  });

  test("pushes out of the plane, not only across it", () => {
    const out = spherePush({ x: 0.2, y: 0, z: 0.3 }, CENTRE, RADIUS, 1);
    expect(Math.abs(out.z)).toBeGreaterThan(0.3);
  });

  test("pushes along the line from the centre, never sideways", () => {
    const p = { x: 0.3, y: 0.4, z: 0.2 };
    const out = spherePush(p, CENTRE, RADIUS, 1);
    const before = Math.hypot(p.x, p.y, p.z);
    const after = Math.hypot(out.x, out.y, out.z);
    expect(out.x / after).toBeCloseTo(p.x / before, 6);
    expect(out.y / after).toBeCloseTo(p.y / before, 6);
    expect(out.z / after).toBeCloseTo(p.z / before, 6);
  });

  test("does nothing at no strength, and everything at full", () => {
    const p = { x: 0.25, y: 0, z: 0 };
    expect(spherePush(p, CENTRE, RADIUS, 0)).toEqual(p);
    expect(spherePush(p, CENTRE, RADIUS, 1).x).toBeCloseTo(RADIUS, 4);
  });

  test("follows the cursor rather than the origin", () => {
    const centre = { x: 3, y: -1, z: 0 };
    const out = spherePush({ x: 3.05, y: -1, z: 0 }, centre, RADIUS, 1);
    expect(Math.hypot(out.x - centre.x, out.y - centre.y, out.z - centre.z)).toBeCloseTo(
      RADIUS,
      4,
    );
  });
});
