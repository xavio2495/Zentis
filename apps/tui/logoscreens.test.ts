import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * Where the mark is shown, and what it shares the screen with.
 *
 * Three screens have nothing else to say: the one waiting for a first poll, the one saying the
 * terminal is too small, and the one asking a stranger what kind of console they want. The logo goes
 * in the same place on each so that moving between them does not move it.
 */
/**
 * Rows of the mark, told apart from the inventory bar.
 *
 * That bar is blocks too, but it is always drawn with its empty half and its end caps beside it, so
 * a row with a block and none of those is the logo's.
 */
const marked = (lines: string[]) => lines.filter((l) => /█/.test(l) && !/[░▕▏]/.test(l)).length;

test("the first frame is the mark, with what it is waiting for underneath", async () => {
  const frame = await drive(120, 40, { scenario: "loading" });
  expect(marked(frame.lines)).toBeGreaterThan(3);
  const text = frame.lines.join("\n");
  expect(text).toMatch(/reading the chains/);
  // The text sits below the mark, not beside it.
  const lastMark = frame.lines.findLastIndex((l) => /█/.test(l));
  const textAt = frame.lines.findIndex((l) => /reading the chains/.test(l));
  expect(textAt).toBeGreaterThan(lastMark);
  expect(frame.overflows).toBe(false);
}, 60_000);

test("a terminal too small to draw the console still gets the mark and the reason", async () => {
  const frame = await drive(60, 20, {});
  const text = frame.lines.join("\n");
  expect(text).toContain("at least 80×24");
  expect(marked(frame.lines)).toBeGreaterThan(3);
  expect(frame.overflows).toBe(false);
  expect(frame.width).toBeLessThanOrEqual(60);
}, 60_000);

test("onboarding keeps the mark where the loading screen had it, and asks underneath", async () => {
  const frame = await drive(120, 40, { onboarding: true });
  expect(marked(frame.lines)).toBeGreaterThan(3);
  const lastMark = frame.lines.findLastIndex((l) => /█/.test(l));
  const choiceAt = frame.lines.findIndex((l) => /make one here/.test(l));
  expect(choiceAt).toBeGreaterThan(lastMark);
  // The choices are in the lower half, which is what the mark leaves them.
  expect(choiceAt).toBeGreaterThan(frame.lines.length / 2 - 4);
  expect(frame.overflows).toBe(false);
}, 60_000);

test("the live view has no mark on it, because it has the book to show instead", async () => {
  const frame = await drive(120, 40, {});
  expect(marked(frame.lines)).toBe(0);
}, 60_000);

test("where the screen is short the choices win, because a choice nobody can see is not offered", async () => {
  // At eighty by twenty-four the mark and three choices do not both fit. The mark is the part that
  // can be spared: it says whose console this is, and they are already looking at it.
  const frame = await drive(80, 24, { onboarding: true });
  const text = frame.lines.join("\n");
  for (const choice of ["make one here", "use a key you already have", "watch only"]) {
    expect(text).toContain(choice);
  }
  expect(frame.overflows).toBe(false);
}, 60_000);

test("the mark stands outside the border, which holds only what there is to choose", () => {
  return drive(120, 40, { onboarding: true }).then((frame) => {
    const lastMark = frame.lines.findLastIndex((l) => /█/.test(l));
    // The frame opens under the mark rather than around it: a border drawn around a logo reads as a
    // box somebody put a logo in, and this one belongs to the choices.
    const borderTop = frame.lines.findIndex((l) => /┌/.test(l));
    expect(borderTop).toBeGreaterThan(lastMark);
    for (const line of frame.lines.slice(0, lastMark + 1)) expect(line).not.toMatch(/[│┌╰]/);
  });
}, 60_000);

test("the second choice asks for the path where it was offered, rather than elsewhere", async () => {
  const frame = await drive(120, 40, { onboarding: true, keys: ["2", "/", "t", "m", "p", "/", "k"] });
  const text = frame.lines.join("\n");
  expect(text).toMatch(/path to an env file/);
  // What was typed is on the page that asked for it, and it says how to send it and how to go back.
  expect(text).toContain("/tmp/k");
  expect(text).toMatch(/enter/);
  expect(text).toMatch(/esc/);
  expect(frame.overflows).toBe(false);
}, 60_000);

test("the mark goes on the three pages that are the wallet's, and on no other", async () => {
  // Wallet, simulation and status end well short of their panel and are the pages a reader lingers
  // on. Positions and pnl are tables to be read against each other; the mark under one of them is
  // decoration where a number was expected.
  for (const key of ["w", "m"]) {
    const frame = await drive(120, 40, { keys: [key] });
    expect(marked(frame.lines)).toBeGreaterThan(3);
    expect(frame.overflows).toBe(false);
  }
  // Status earns its mark only where its own content leaves the room: it grew a provenance note for
  // the mark each leg was shipped against, which at a hundred and twenty columns takes the rows the
  // mark had. Words before decoration, every time — and at a hundred and ninety there is room for
  // both.
  expect(marked((await drive(120, 40, { keys: ["d"] })).lines)).toBe(0);
  expect(marked((await drive(190, 50, { keys: ["d"] })).lines)).toBeGreaterThan(3);
  for (const key of ["p", "n"]) {
    expect(marked((await drive(120, 40, { keys: [key] })).lines)).toBe(0);
  }
}, 60_000);

test("the mark on a page is the finished one, since a page does not repaint to animate it", async () => {
  const frame = await drive(120, 40, { keys: ["?"] });
  // Help is prose, and at a hundred and twenty columns it already scrolls, so there is nothing spare
  // to draw into. What the pages get instead is checked above.
  expect(frame.lines.join("\n")).toContain("what this is");
  expect(frame.overflows).toBe(false);
}, 60_000);

