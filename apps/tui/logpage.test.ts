import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";

/**
 * The log, where the feed was.
 *
 * The feed is what the book did; the log is what this console did to it. They belong in the same
 * region because they answer the same question from opposite ends, and a reader wants one or the
 * other rather than half of each.
 *
 * Two columns: what was asked for, and what went on chain because of it. The left one is where an
 * action arrives from a keystroke today and from the MCP server later — both are the operator
 * asking for something, and the log does not care which hand typed it.
 */
test("l puts the log where the feed was, and l again puts the feed back", async () => {
  const feed = await drive(120, 40, {});
  expect(feed.lines.join("\n")).toContain("┌ feed");

  const log = await drive(120, 40, { keys: ["l"] });
  const text = log.lines.join("\n");
  expect(text).toContain("┌ log");
  expect(text).not.toContain("┌ feed");
  // Named, so neither column has to be guessed at.
  expect(text).toMatch(/action/);
  expect(text).toMatch(/transaction/);
  expect(log.overflows).toBe(false);

  const back = await drive(120, 40, { keys: ["l", "l"] });
  expect(back.lines.join("\n")).toContain("┌ feed");
}, 60_000);

test("an empty log says it is empty, rather than looking like a feed that has stopped", async () => {
  const frame = await drive(120, 40, { keys: ["l"] });
  expect(frame.lines.join("\n")).toMatch(/nothing yet/);
}, 60_000);

test("the key is offered where every other key is, so nobody has to find it in the help", async () => {
  const frame = await drive(120, 40, {});
  expect(frame.lines.join("\n")).toMatch(/l log/);
}, 60_000);

test("a quote is an action, so the log has it with nothing in the transaction column", async () => {
  // Read-only actions belong in the log too: what the console was asked is the left column's
  // subject, and a quote that answered is as much a thing done as a fill that broadcast.
  // `esc` closes the command row first: while it is open it has the keyboard, so `l` typed there is
  // a letter of a command and not a key.
  const typed = [":", "q", "u", "o", "t", "e", " ", "s", "e", "p", " ", "0", ".", "1", "ENTER", "ESC", "l"];
  const frame = await drive(120, 40, { keys: typed });
  const text = frame.lines.join("\n");
  expect(text).toContain("┌ log");
  expect(text).toMatch(/quote/);
}, 60_000);
