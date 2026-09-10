import { expect, test } from "bun:test";
import { ROTATE_MS } from "./src/App.js";
import { drive } from "./sandbox/drive.js";

const text = async (keys: string[]) => (await drive(120, 40, { keys, armed: true })).lines.join("\n");

test("the price chart shows one leg at a time and turns every fifteen seconds", async () => {
  expect(ROTATE_MS).toBe(15_000);
  const frame = await text([]);
  expect(frame).toContain("market price · Sepolia");
  expect(frame).not.toContain("market price · Base");
});

test("the arrow keys step the chart by hand, both ways", async () => {
  expect(await text(["RIGHT"])).toContain("market price · Base");
  expect(await text(["RIGHT", "RIGHT"])).toContain("market price · Arbitrum");
  // Left from the first wraps to the last rather than stopping.
  expect(await text(["LEFT"])).toContain("market price · Arbitrum");
});

test("a leg's number opens its detail where the chart was, and the same number closes it", async () => {
  const open = await text(["2"]);
  expect(open).toContain("2 Base Sepolia");
  expect(open).toContain("esc to close");
  expect(open).not.toContain("market price ·");

  // Inside a detail the numbers have to keep working: closing with the key that opened it, and
  // jumping to another leg without going back through the chart first.
  const closed = await text(["2", "2"]);
  expect(closed).toContain("market price ·");

  const jumped = await text(["2", "3"]);
  expect(jumped).toContain("3 Arbitrum Sepolia");
  expect(jumped).not.toContain("2 Base Sepolia ─");
});

test("the detail carries the position, the pool, the pricing and the leg's own price line", async () => {
  const detail = await text(["1"]);
  for (const part of ["inventory", "shift", "spread", "pool", "reference", "price"]) {
    expect(detail).toContain(part);
  }
});
