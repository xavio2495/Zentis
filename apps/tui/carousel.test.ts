import { expect, test } from "bun:test";
import { ROTATE_MS } from "./src/App.js";
import { drive } from "./sandbox/drive.js";

const text = async (keys: string[]) => (await drive(120, 40, { keys, armed: true })).lines.join("\n");

test("the chart is the book's one market, so there is nothing left to rotate between", async () => {
  // Three charts rotated because each leg quoted from its own reference pool. One mid for the book
  // means one line, and a carousel over three copies of it would be motion without information.
  expect(ROTATE_MS).toBe(15_000);
  const frame = await text([]);
  expect(frame).toContain("market");
  for (const title of ["market price · Sepolia", "market price · Base", "market price · Arbitrum"]) {
    expect(frame).not.toContain(title);
  }
});

test("the arrow keys step which leg the numbers and the detail act on, both ways", async () => {
  // The chart no longer moves with them; what they choose is the leg, and the detail is where that
  // choice becomes visible.
  const detailTitle = (frame: string) => frame.split("\n").find((line) => line.includes("esc to close")) ?? "";
  expect(detailTitle(await text(["RIGHT", "ENTER"]))).toContain("Base Sepolia");
  expect(detailTitle(await text(["RIGHT", "RIGHT", "ENTER"]))).toContain("Arbitrum Sepolia");
  expect(detailTitle(await text(["LEFT", "ENTER"]))).toContain("Arbitrum Sepolia");
});

test("a leg's number opens its detail where the chart was, and the same number closes it", async () => {
  const open = await text(["2"]);
  expect(open).toContain("2 Base Sepolia");
  expect(open).toContain("esc to close");
  expect(open).not.toContain("┌ market");

  // Inside a detail the numbers have to keep working: closing with the key that opened it, and
  // jumping to another leg without going back through the chart first.
  const closed = await text(["2", "2"]);
  expect(closed).toContain("┌ market");

  // The detail panel is the one whose title carries "esc to close"; the cards carry the same leg
  // names, so the leg shown in detail has to be read off that line specifically.
  const detailTitle = (frame: string) => frame.split("\n").find((line) => line.includes("esc to close")) ?? "";
  const jumped = await text(["2", "3"]);
  expect(detailTitle(jumped)).toContain("3 Arbitrum Sepolia");
  expect(detailTitle(jumped)).not.toContain("2 Base Sepolia");
});

test("the detail carries the position, the pool, the pricing and the leg's own price line", async () => {
  const detail = await text(["1"]);
  // "venue" rather than "pool": the per-leg reference pools were retired when the book moved to one
  // mainnet mid, and the row now says where the leg's trades settle.
  for (const part of ["inventory", "shift", "spread", "venue", "reference"]) {
    expect(detail).toContain(part);
  }
  // And a price, written as one: the word "price" is not on the row, the figure is.
  expect(detail).toMatch(/1 WETH = [\d,]+ USDC/);
  {
  }
});
