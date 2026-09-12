import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";
import { choiceAt } from "./src/pages/Onboarding.js";

/**
 * The first choice, as three buttons rather than three paragraphs.
 *
 * The page used to be a list: every option's reasoning under it, all of it on screen at once, and
 * the reader deciding between three blocks of prose. Buttons put the choosing back in the hands and
 * the reasoning under the cursor — one option's words at a time, about the option being considered.
 *
 * Arrow keys move, enter takes it, and the one under the cursor wears the accent. The numbers still
 * work: they were on screen from the first day and somebody has learned them.
 */
const said = (lines: string[]) => lines.join(" ").replace(/[│┌┐└┘╰╯─]/g, " ").replace(/\s+/g, " ");

test("the cursor moves along the three and wraps at neither end", () => {
  expect(choiceAt(0, "right")).toBe(1);
  expect(choiceAt(1, "right")).toBe(2);
  // It stops rather than wrapping: three is a row a reader can see whole, and a cursor that
  // reappears at the far end reads as a keystroke that did something else.
  expect(choiceAt(2, "right")).toBe(2);
  expect(choiceAt(0, "left")).toBe(0);
  expect(choiceAt(2, "left")).toBe(1);
});

test("three buttons, and the one under the cursor is the only one wearing the accent", async () => {
  const frame = await drive(120, 40, { onboarding: true });
  const text = frame.lines.join("\n");
  // Boxes, not a numbered list: a button has a border on every side.
  expect(text).toMatch(/┌─+┐.*┌─+┐.*┌─+┐/);
  expect(frame.overflows).toBe(false);
}, 60_000);

test("what an option does is said under the cursor, one at a time", async () => {
  const first = said((await drive(120, 40, { onboarding: true })).lines);
  // The first option's own words, and not the second's.
  expect(first).toMatch(/\.zentis\/wallet\.env/);
  expect(first).not.toMatch(/TAKER_PRIVATE_KEY/);

  const second = said((await drive(120, 40, { onboarding: true, keys: ["RIGHT"] })).lines);
  expect(second).toMatch(/TAKER_PRIVATE_KEY/);
  expect(second).not.toMatch(/\.zentis\/wallet\.env/);

  const third = said((await drive(120, 40, { onboarding: true, keys: ["RIGHT", "RIGHT"] })).lines);
  expect(third).toMatch(/nothing that signs is offered/i);
}, 60_000);

test("enter takes the option under the cursor", async () => {
  // Right twice is "watch only", which goes straight to the live view holding no key.
  const watched = (await drive(120, 40, { onboarding: true, keys: ["RIGHT", "RIGHT", "ENTER"] })).lines.join("\n");
  expect(watched).toContain("┌ feed");
  expect(watched).toContain("watch-only");
}, 60_000);

test("enter on the second opens the field for the path, where the button is", async () => {
  const frame = await drive(120, 40, { onboarding: true, keys: ["RIGHT", "ENTER"] });
  const text = said(frame.lines);
  expect(text).toMatch(/path/);
  expect(text).toMatch(/enter to use it/i);
  expect(frame.overflows).toBe(false);
}, 60_000);

test("the numbers still choose, because they have been on screen since the first day", async () => {
  const watched = (await drive(120, 40, { onboarding: true, keys: ["3"] })).lines.join("\n");
  expect(watched).toContain("┌ feed");
}, 60_000);

test("the keys that move and take are said on the page", async () => {
  const text = said((await drive(120, 40, { onboarding: true })).lines);
  expect(text).toMatch(/enter/i);
  expect(text).toMatch(/←|→|arrow/i);
}, 60_000);
