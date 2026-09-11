import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

const chartPanel = (lines: string[]) => {
  const top = lines.findIndex((l) => l.includes("┌ market"));
  const column = [...lines[top]!].indexOf("┌");
  const rows: string[] = [lines[top]!];
  for (const line of lines.slice(top + 1)) {
    const cell = [...line].slice(column).join("");
    rows.push(cell);
    if (cell.startsWith("╰")) break;
  }
  return rows;
};
const figure = (s: string) => Number(s.replace(/,/g, ""));

test("the axis is labelled with prices, highest at the top", async () => {
  const panel = chartPanel((await drive(120, 40, { armed: true })).lines);
  const numbers = panel
    .slice(1, -1)
    .map((row) => /^│\s*([\d,]+(?:\.\d+)?)\s/.exec(row)?.[1])
    .filter((n): n is string => n !== undefined);
  // A top label and a bottom label, and the top is the higher price: the line rises when the pair's
  // price rises, which is what its title says it shows.
  expect(numbers.length).toBeGreaterThanOrEqual(2);
  expect(figure(numbers[0]!)).toBeGreaterThanOrEqual(figure(numbers[numbers.length - 1]!));
  expect(panel.join("\n")).not.toContain("of its own start");
});

test("the title's current price lies inside the axis it labels", async () => {
  const panel = chartPanel((await drive(120, 40, { armed: true })).lines);
  const current = figure(/= ([\d,]+) USDC/.exec(panel[0]!)![1]!);
  const numbers = panel
    .slice(1, -1)
    .map((row) => /^│\s*([\d,]+)\s/.exec(row)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(figure);
  expect(current).toBeLessThanOrEqual(Math.max(...numbers) * 1.001);
  expect(current).toBeGreaterThanOrEqual(Math.min(...numbers) * 0.999);
});

test("the window is named on the chart, and t steps through the windows", async () => {
  const first = chartPanel((await drive(120, 40, { armed: true })).lines)[0]!;
  expect(first).toMatch(/(1h|24h|7d) window/);
  const stepped = chartPanel((await drive(120, 40, { armed: true, keys: ["t"] })).lines)[0]!;
  expect(stepped).toMatch(/(1h|24h|7d) window/);
  expect(stepped).not.toBe(first);
});

test("the legend counts what is in the window instead of promising markers that are not there", async () => {
  const panel = chartPanel((await drive(120, 40, { armed: true })).lines).join("\n");
  expect(panel).not.toContain("▲ fill   │ publish");
  expect(panel).toMatch(/publish|fill|no fills or publishes/);
});
