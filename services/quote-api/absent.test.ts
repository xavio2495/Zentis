import { expect, test } from "bun:test";
import { absenceCaveat } from "./src/reason.js";

test("a leg that could not be read is not reported as a leg that does not exist", () => {
  // With a cold cache against an exhausted allowance, every leg said "this leg has no such
  // position" — a conclusion drawn from a null that meant "not read", not "not there". On a screen
  // whose whole claim is one position on three chains, that reads as the position being gone.
  expect(absenceCaveat("subgraph HTTP 429")).toBe(
    "this leg could not be read, so nothing below is known about it",
  );
  expect(absenceCaveat(null)).toBe("this leg has no such position");
});
