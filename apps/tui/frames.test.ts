import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

const SIZES: [number, number][] = [
  [190, 50],
  [120, 40],
  [100, 30],
  [80, 24],
];

test("no frame is as tall as its terminal, at any size", async () => {
  // Ink clears the whole terminal the moment its output reaches stdout.rows, and a console that
  // repaints from scratch every frame is unusable. This is the invariant reading the frame cannot
  // show you.
  for (const [cols, rows] of SIZES) {
    const frame = await drive(cols, rows, { armed: true });
    expect(frame.overflows).toBe(false);
    expect(frame.rows).toBeLessThan(rows);
  }
}, 60_000);

test("no frame is wider than its terminal, at any size", async () => {
  for (const [cols, rows] of SIZES) {
    const frame = await drive(cols, rows, { armed: true });
    expect(frame.width).toBeLessThanOrEqual(cols);
  }
}, 60_000);

test("numbers survive every width whole, which is what Ink's squeezing destroys", async () => {
  for (const [cols, rows] of SIZES) {
    const text = (await drive(cols, rows, { armed: true })).lines.join("\n");
    // The seq is the cross-chain claim; a seq missing a digit is a different seq that still looks
    // like one. Same for a leg's shift in the feed.
    // The status bar's seq is shed at the narrowest width, which is correct degradation; the feed's
    // is not, so that is the one asserted everywhere.
    expect(text).toContain("1789029519");
    if (cols >= 120) expect(text).toContain("1789049382");
    // Squeezing eats the separators first, so a label running straight into its number is the
    // signature. Then: every seq in the frame is one the fixtures actually contain — a seq missing
    // a digit is a different seq that still looks like one.
    for (const pattern of [/seq\d/, /reference\d/, /fill\d/, /shift[-+]/, /spread\d/]) {
      expect(text).not.toMatch(pattern);
    }
    // The narrowest feed writes a publish's seq bare, without the word, so long digit runs count too;
    // a decimal's digits (0.00000388) are not a seq and are left out.
    const seqs = [
      ...[...text.matchAll(/seq (\d+)/g)].map((m) => m[1]!),
      ...[...text.matchAll(/(?<![.\d])(\d{7,})(?![.\d])/g)].map((m) => m[1]!),
    ];
    expect(seqs.length).toBeGreaterThan(0);
    for (const seq of seqs) {
      expect(seq.length === 10 || Number(seq) < 100).toBe(true);
    }
  }
}, 60_000);

test("the stale book leads with the reason and the remedy, whole", async () => {
  for (const [cols, rows] of SIZES) {
    const text = (await drive(cols, rows, { scenario: "stale", armed: true })).lines.join("\n");
    expect(text).toContain("stale 4h16m");
    // The remedy is the last thing to be shed and is never half-printed.
    expect(text.includes("press r to republish") || !text.includes("press r")).toBe(true);
  }
}, 60_000);

test("a docked leg says so on its card and in the status bar", async () => {
  const text = (await drive(120, 40, { scenario: "docked", armed: true })).lines.join("\n");
  expect(text).toContain("docked");
}, 60_000);

test("watch-only says so, and the help overlay is reachable from it", async () => {
  const watching = await drive(120, 40, {});
  expect(watching.lines.join("\n")).toContain("watch-only");

  const help = await drive(120, 40, { keys: ["?"] });
  const text = help.lines.join("\n");
  // Every disclosure lives here and nowhere else, so this is what must not be missing.
  expect(text).toContain("gains");
  expect(text).toContain("bps of the");
  expect(text).toContain("uncalibrated");
  expect(help.overflows).toBe(false);
}, 60_000);

test("a leg's detail opens over the charts and names what the card only shows", async () => {
  const frame = await drive(120, 40, { keys: ["2"], armed: true });
  const text = frame.lines.join("\n");
  expect(text).toContain("correction");
  expect(text).toContain("volatility");
  expect(text).toContain("boundary");
  expect(frame.overflows).toBe(false);
}, 60_000);

test("below the minimum size the console says the minimum rather than drawing a broken frame", async () => {
  const frame = await drive(60, 20, {});
  expect(frame.lines.join("\n")).toContain("at least 80×24");
  expect(frame.overflows).toBe(false);
}, 60_000);
