import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * The command line: the same actions the keys run, asked for in words.
 *
 * Every test here drives the real component through real keystrokes, because the part worth pinning
 * is what a sequence of keys does — that a colon takes the keyboard, that the answer lands where the
 * question was asked, and that nothing typed can make the frame taller than its terminal.
 */
const typed = (text: string) => [...text];

test("a colon opens a row to type in, and esc closes it again", async () => {
  const open = await drive(120, 40, { keys: [":"] });
  expect(open.lines.join("\n")).toContain(":");
  expect(open.overflows).toBe(false);

  const closed = await drive(120, 40, { keys: [":", "ESC"] });
  // Back to the live view, with the feed where the row had been.
  expect(closed.lines.join("\n")).toContain("┌ feed");
}, 60_000);

test("a typed page command navigates, exactly as its key does", async () => {
  const frame = await drive(120, 40, { keys: [":", ...typed("page wallet"), "ENTER"] });
  const text = frame.lines.join("\n");
  expect(text).toContain("wallet");
  expect(text).toContain("committed");
  expect(frame.overflows).toBe(false);
}, 60_000);

test("an unknown command answers on the row it was typed on, and the row stays open", async () => {
  const frame = await drive(120, 40, { keys: [":", ...typed("frobnicate"), "ENTER"] });
  const text = frame.lines.join("\n");
  expect(text).toContain("no command called");
  expect(text).toContain("frobnicate");
}, 60_000);

test("the up arrow recalls what was typed last, so a mistyped amount is corrected rather than retyped", async () => {
  const frame = await drive(120, 40, {
    keys: [":", ...typed("page pnl"), "ENTER", ":", "UP"],
  });
  expect(frame.lines.join("\n")).toContain("page pnl");
}, 60_000);

test("watch-only answers a signing command with its reason instead of running it", async () => {
  const frame = await drive(120, 40, { keys: [":", ...typed("fill sepolia 0.15"), "ENTER"] });
  const text = frame.lines.join("\n");
  expect(text).toMatch(/ZENTIS_ENV|watch-only/);
  // Nothing was broadcast and nothing is pending: the row answered and that was all.
  expect(text).not.toContain("press y to broadcast");
}, 60_000);

test("an armed signing command asks for confirmation before it broadcasts", async () => {
  const frame = await drive(120, 40, { keys: [":", ...typed("fill sepolia 0.15"), "ENTER"], armed: true });
  expect(frame.lines.join("\n")).toContain("press y");
}, 60_000);

test("typing never makes the frame taller than the terminal, at either size", async () => {
  for (const [cols, rows] of [
    [190, 50],
    [80, 24],
  ] as const) {
    const frame = await drive(cols, rows, { keys: [":", ...typed("quote sepolia 0.15")], armed: true });
    expect(frame.overflows).toBe(false);
    expect(frame.width).toBeLessThanOrEqual(cols);
  }
}, 120_000);
