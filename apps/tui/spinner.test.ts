import { expect, test } from "bun:test";
import { SPINNER, spinnerFrame } from "./src/spinner.js";
import { drive } from "./sandbox/drive.js";

/**
 * Waiting says which source it is waiting on, and nothing else.
 *
 * The console used to explain itself while it waited — "reading three chains, three subgraphs and
 * the quote service…", "price history unavailable: subgraph HTTP 429, resets 21:52Z" — a paragraph
 * in the middle of a panel that had no numbers in it yet. The reason belongs on that source's status
 * line, where it is one line among the eleven, and in help. A panel that is waiting shows a spinner
 * and the name of what it is waiting for.
 */
test("the spinner turns, and comes back round", () => {
  expect(SPINNER.length).toBeGreaterThan(1);
  expect(spinnerFrame(0)).toBe(SPINNER[0]);
  expect(spinnerFrame(SPINNER.length)).toBe(SPINNER[0]);
  // Driven by the clock rather than by a render, so a still screen still turns.
  expect(spinnerFrame(1)).not.toBe(spinnerFrame(0));
});

test("the first frame is a spinner and a short label, not a sentence", async () => {
  const first = (await drive(120, 40, { scenario: "loading" })).lines.join("\n");
  expect(first).not.toContain("reading three chains, three subgraphs and the quote service");
  expect(first).toMatch(new RegExp(`[${SPINNER.join("")}]`));
  expect(first).toMatch(/reading|waiting/);
}, 60_000);

test("a chart with no series shows the spinner and the source, not the endpoint's excuse", async () => {
  const text = (await drive(120, 40, { scenario: "outage" })).lines.join("\n");
  expect(text).not.toMatch(/price history unavailable|market series is unavailable, so/);
  // The market panel names what it is waiting on; the reason is on that source's own status line.
  expect(text).toMatch(/market series/);
}, 60_000);

test("an unread leg's card names the source it is waiting on, not the endpoint's message", async () => {
  // "position unread (HTTP 429, resets 21:52Z)" put an endpoint's excuse inside a card. The card
  // says which source has not answered; the panel above says what that source said.
  const text = (await drive(120, 40, { scenario: "partial" })).lines.join("\n");
  expect(text).not.toMatch(/position unread \(/);
  expect(text).toMatch(/waiting on fills|position unread/);
}, 60_000);

test("the state line says a source is down without repeating what it said", async () => {
  const text = (await drive(190, 50, { scenario: "outage" })).lines.join("\n");
  expect(text).not.toContain("showing what it last read");
  // Once, on the source's own line.
  expect((text.match(/429/g) ?? []).length).toBeLessThanOrEqual(4);
}, 60_000);
