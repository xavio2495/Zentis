import { expect, test } from "bun:test";
import { SPEEDS, at, bandState, firstClamp, strideFor, visible } from "../src/lib/replay";
import type { Leg, Round } from "../src/lib/replay";

/**
 * The replay, as arithmetic.
 *
 * One integer playhead and everything else derived from it — the reference's own shape, and the
 * reason its terminal is 188 lines instead of a state machine. Kept apart from React here so that
 * what the transport *means* is testable without mounting anything: an off-by-one in the playhead
 * is a screen showing the round before the one the clock says.
 */
const round = (seq: number, tiltBps: number): Round => ({
  seq,
  atSeconds: 1_789_000_000 + seq,
  tiltBps,
  mid: "405423883231363937269991351",
});

const leg: Leg = {
  chainId: 11155111,
  name: "sepolia",
  label: "Sepolia",
  strategyHash: "0x212fec3f",
  maxTiltBps: 500,
  rounds: [round(1, -10), round(2, -120), round(3, -480), round(4, -500), round(5, -200)],
  fills: [],
  rejections: [],
};

test("the playhead is an index, and what is visible is everything up to it", () => {
  expect(visible(leg.rounds, 0)).toHaveLength(1);
  expect(visible(leg.rounds, 2).at(-1)!.seq).toBe(3);
  // Past the end is the end, not undefined: a stride can overshoot and the screen must not blank.
  expect(visible(leg.rounds, 99)).toHaveLength(5);
  expect(at(leg.rounds, 99)!.seq).toBe(5);
  expect(at([], 0)).toBeNull();
});

test("the band is where the shift stands against the leg's own cap, not against a fixed number", () => {
  // In-band, near the edge, and clamped — the three states the reference calls SAFE, ARMED and
  // TRIGGERED. The cap is the leg's `maxTiltBps`, because −500 on a leg capped at 500 is a limit
  // and −500 on a leg capped at 5,000 is an ordinary quote.
  expect(bandState(-10, 500)).toBe("in band");
  expect(bandState(-480, 500)).toBe("near edge");
  expect(bandState(-500, 500)).toBe("clamped");
  expect(bandState(500, 500)).toBe("clamped");
  expect(bandState(-10, 5_000)).toBe("in band");
});

test("the jump goes to the first round that clamped, which is the thing worth watching", () => {
  expect(firstClamp(leg)).toBe(3);
  expect(firstClamp({ ...leg, rounds: [round(1, -10)] })).toBeNull();
});

test("speed is a stride over the same tick, so the clock does not change with it", () => {
  expect(SPEEDS.map((s) => s.label)).toEqual(["1×", "2×", "4×", "8×"]);
  expect(SPEEDS.map((s) => s.stride)).toEqual([1, 3, 6, 12]);
  expect(strideFor(4)).toBe(6);
  expect(strideFor(99)).toBe(1);
});
