import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bottomSlot } from "./src/layout.js";

/**
 * What occupies the row below the feed.
 *
 * The command line used to be rendered after the keys panel rather than instead of it, which was
 * wrong twice over. On screen it pushed the prompt below the key hints, so the operator typed into
 * a row under a list of keys that were no longer the thing to read. Underneath, it added a row the
 * layout had not budgeted: `fit()` divides the height exactly between the status, the chart, the
 * feed and the keys, and `sizing.test.ts` asserts that sum leaves one row of headroom — because Ink
 * repaints the whole terminal the moment its output reaches `stdout.rows`. An unbudgeted row means
 * every keystroke redraws the screen from scratch.
 *
 * So the two share one slot: the keys are what that row says when there is nothing being typed.
 */
const app = readFileSync(join(import.meta.dir, "src", "App.tsx"), "utf8");

describe("bottomSlot", () => {
  test("is the keys when nothing is being typed", () => {
    expect(bottomSlot(null)).toBe("keys");
  });

  test("is the command line the moment the colon is pressed, before a character arrives", () => {
    expect(bottomSlot("")).toBe("command");
  });

  test("stays the command line while a command is being typed", () => {
    expect(bottomSlot("fill sepolia")).toBe("command");
  });
});

describe("the slot is one slot", () => {
  test("the command line is not rendered as a sibling after the keys panel", () => {
    // The shape of the old bug: a second element appended below the budgeted ones.
    expect(app).not.toMatch(/<\/Panel>\s*\)\s*}\s*\{typing !== null && \(\s*<CommandLine/);
  });

  test("both are inside the same panel, so the row does not move when it changes", () => {
    const slot = app.slice(app.indexOf("regions.keyRows > 0"), app.indexOf("</Box>\n    </Box>"));
    expect(slot).toContain("CommandLine");
    expect(slot).toContain("Segments");
    expect(slot).toContain("bottomSlot");
  });

  test("the panel says which of the two it is showing", () => {
    // A prompt in a box still titled "keys" is a box lying about its contents.
    const slot = app.slice(app.indexOf("regions.keyRows > 0"), app.indexOf("</Box>\n    </Box>"));
    expect(slot).toMatch(/title=\{/);
  });
});
