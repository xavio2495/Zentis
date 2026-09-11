import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The tokens the console route needs and the landing does not.
 *
 * One sheet and one `@theme` block, appended to rather than forked: `docs/console-mock.html` is
 * what a second source of truth looks like six weeks later — `#0a0d12` for the base and `#5ee6c4`
 * for the accent, off-brand on both, and nobody noticed because nothing compared them.
 *
 * The rule these guard is not "use these hexes". It is that a leg is a fact about the position and
 * the accent means "this is what Zentis computed" — so the side colours must never be derived from
 * the accent, or the legs read as outputs of the model.
 */
const css = readFileSync(join(import.meta.dir, "..", "src", "app", "globals.css"), "utf8");

/** Every `prop: value` pair in the sheet, paired with the selector whose block holds it. */
function declarations(): { selector: string; prop: string; value: string }[] {
  const out: { selector: string; prop: string; value: string }[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, rawSelector, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.trim().split("\n").pop()!.trim();
    for (const decl of body.split(";")) {
      const at = decl.indexOf(":");
      if (at === -1) continue;
      out.push({ selector, prop: decl.slice(0, at).trim(), value: decl.slice(at + 1).trim() });
    }
  }
  return out;
}
const valueOf = (prop: string): string | undefined =>
  declarations().find((d) => d.prop === prop)?.value;

describe("console surfaces", () => {
  const expected: [string, string][] = [
    ["--color-panel", "#121212"],
    ["--color-inset", "#0e0e0e"],
    ["--color-line2", "#2c2c2c"],
    // The fourth step of the same ink ladder. The landing stops at three because it draws no rules
    // and has no disabled states; the console has both, and the two surfaces must not disagree
    // about what dim means.
    ["--color-ink-dim", "#4a4a4a"],
    ["--color-warn", "#ffd75f"],
    ["--color-bad", "#ff5f5f"],
  ];
  for (const [prop, value] of expected) {
    test(`${prop} is ${value}`, () => expect(valueOf(prop)).toBe(value));
  }

  test("the console has a mono family, and it is the only surface that does", () => {
    expect(valueOf("--font-mono")).toMatch(/mono/i);
  });
});

describe("the side colours are facts, not signals", () => {
  // Every mechanical way of deriving them from the accent, caught. Someone hand-computing a green
  // is beyond a test's reach; someone writing `var(--color-em)` because it looked tidy is not, and
  // that is the realistic failure.
  for (const prop of ["--color-side-a", "--color-side-b"]) {
    test(`${prop} is a literal hex that is not the accent`, () => {
      const value = valueOf(prop);
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(value?.toLowerCase()).not.toBe("#00ed64");
      expect(value).not.toContain("var(");
      expect(value).not.toContain("color-mix");
    });
  }

  test("they are the leg colours the TUI already uses, so the mapping survives the crossing", () => {
    // A reader who learned that blue is token A on one screen has learned it for both.
    expect(valueOf("--color-side-a")).toBe("#4f8cff");
    expect(valueOf("--color-side-b")).toBe("#b48cff");
  });
});
