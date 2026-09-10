import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * The feed's own rows, cut out of the frame.
 *
 * Each physical line also carries the leg-card column on its left, so a test that anchors on the
 * start of the line is testing the wrong column.
 */
const feedOf = (lines: string[]) => {
  const header = lines.findIndex((l) => l.includes("─ feed"));
  if (header === -1) return [];
  const column = lines[header]!.indexOf("─ feed");
  return lines
    .slice(header + 1)
    .map((l) => l.slice(column))
    .filter((l) => l.trim() !== "");
};

test("no feed row ends mid-clause", async () => {
  for (const [cols, rows] of [
    [190, 50],
    [120, 40],
    [100, 30],
    [80, 24],
  ] as const) {
    for (const line of feedOf((await drive(cols, rows, { armed: true })).lines)) {
      // The variant ladder drops a trailing clause whole. A row ending in a comma or a preposition
      // is a row that was cut rather than chosen.
      expect(line.trimEnd()).not.toMatch(/(,|·|at shift|reference|→|on)$/);
    }
  }
}, 60_000);

test("feed rows carry an unambiguous age rather than a wall clock that crosses midnight", async () => {
  const lines = feedOf((await drive(190, 50, { armed: true })).lines);
  expect(lines.length).toBeGreaterThan(3);
  for (const line of lines) {
    // `21:56:00` under `07:45:00` is yesterday, and nothing on the row said so.
    expect(line).not.toMatch(/^\s*\d{2}:\d{2}:\d{2}/);
    expect(line).toMatch(/^\s*\d+[smhd]/);
  }
}, 60_000);

test("ages are ordered oldest-last, matching the order the rows are in", async () => {
  const lines = feedOf((await drive(190, 50, { armed: true })).lines);
  const seconds = lines
    .map((l) => /^\s*(\d+)([smhd])/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s"]!);
  for (let i = 1; i < seconds.length; i += 1) {
    expect(seconds[i]!).toBeGreaterThanOrEqual(seconds[i - 1]!);
  }
}, 60_000);
