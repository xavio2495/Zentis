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

test("rebalance opens the positions page, where the panel that answers it lives", async () => {
  const frame = await drive(150, 44, { keys: [":", ...typed("rebalance sepolia"), "ENTER"], scenario: "pinned" });
  const text = frame.lines.join("\n");
  expect(text).toContain("positions");
  expect(text).toContain("rebalance");
  expect(text).not.toContain("not built yet");
}, 60_000);

// `push` used to name `scripts/rebalance.py` for the operator to run. The compiled console is handed
// out as one file to someone who may have no checkout, so it performs the push itself now — three
// `cast` calls, behind the same confirmation every other signing action goes through.

test("push runs through the console's own confirmation, not a script in a checkout", async () => {
  const frame = await drive(150, 44, { keys: [":", ...typed("push sepolia weth 0.0002"), "ENTER"], armed: true, scenario: "pinned" });
  const text = frame.lines.join("\n");
  expect(text).toContain("press y");
  expect(text).not.toContain("rebalance.py");
}, 60_000);

test("watch-only refuses a push with the reason, and runs nothing", async () => {
  const text = (await drive(150, 44, { keys: [":", ...typed("push sepolia weth 0.0002"), "ENTER"] })).lines.join("\n");
  expect(text).toMatch(/ZENTIS_ENV|watch-only/);
  expect(text).not.toContain("press y");
}, 60_000);

test("opening the row takes the keys' row and nothing else, so no gap opens under it", async () => {
  // The command line used to be an extra row below the keys, so the screen paid for it by taking a
  // row off the feed. It is not extra any more — it replaces the hints in the panel they share —
  // and the subtraction stayed behind, leaving the right-hand column one row short of the frame:
  // a strip of empty terminal under the command box that nothing accounts for.
  const shut = await drive(120, 40, {});
  const open = await drive(120, 40, { keys: [":"] });

  // The bottom row of the frame closes both columns, whether the row is open or not.
  const closes = (lines: string[]) => (lines.at(-1) ?? "").trimEnd().endsWith("╯");
  expect(closes(shut.lines)).toBe(true);
  expect(closes(open.lines)).toBe(true);

  // And the panel above keeps its height: the row came from the keys, not from the feed.
  const feedHeight = (lines: string[]) => {
    const from = lines.findIndex((line) => line.includes("┌ feed"));
    if (from === -1) return 0;
    const after = lines.slice(from + 1).findIndex((line) => /│╰─+╯$/.test(line.trimEnd()));
    return after === -1 ? 0 : after + 1;
  };
  expect(feedHeight(open.lines)).toBe(feedHeight(shut.lines));
  expect(feedHeight(shut.lines)).toBeGreaterThan(0);
}, 60_000);
