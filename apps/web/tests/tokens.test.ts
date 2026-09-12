import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "..", "src", "app", "globals.css"), "utf8");

const ACCENT = "#00ED64";

/** Every `prop: value` pair in the sheet, paired with the selector whose block holds it. */
function declarations(): { selector: string; prop: string; value: string }[] {
  const out: { selector: string; prop: string; value: string }[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, rawSelector, body] of blocks) {
    const selector = rawSelector.trim().split("\n").pop()!.trim();
    for (const decl of body.split(";")) {
      const at = decl.indexOf(":");
      if (at === -1) continue;
      out.push({
        selector,
        prop: decl.slice(0, at).trim(),
        value: decl.slice(at + 1).trim(),
      });
    }
  }
  return out;
}

describe("palette", () => {
  const expected: [string, string][] = [
    ["--color-bg", "#0a0a0a"],
    ["--color-stroke", "#1f1f1f"],
    ["--color-ink", "#f5f5f5"],
    ["--color-ink-soft", "#c5c5c5"],
    ["--color-ink-faint", "#8a8a8a"],
    ["--color-em", ACCENT],
    ["--color-em-soft", "#7DF7AF"],
    ["--color-em-deep", "#00803A"],
  ];

  for (const [token, value] of expected) {
    test(`${token} is ${value}`, () => {
      const decl = declarations().find((d) => d.prop === token);
      expect(decl?.value).toBe(value);
    });
  }
});

/*
 * The accent budget moved to `accent-budget.test.ts`, and the reason is worth keeping.
 *
 * What used to stand here counted CSS declarations whose *value* contained the literal `#00ED64`
 * and asserted there were fewer than ten. Exactly one does — the token definition — because every
 * real use goes through `var(--color-em)` or a `text-em` class. So it read `1 < 10` and passed
 * unconditionally; it would have passed with the accent on every element on the page. It was a
 * test that named the rule without testing it, which is worse than no test, because the suite
 * being green was taken as the rule being kept.
 */

describe("scale and motion", () => {
  test("all eight type steps are defined", () => {
    const steps = ["0.9rem", "1.12rem", "1.4rem", "1.75rem", "2.19rem", "2.73rem", "3.42rem", "4.27rem"];
    const defined = declarations().filter((d) => /^--text-fs-\d$/.test(d.prop));
    expect(defined.map((d) => d.value)).toEqual(steps);
  });

  test("one easing curve is shared by everything", () => {
    const ease = declarations().find((d) => d.prop === "--ease-out");
    expect(ease?.value).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
  });

  test("motion is answerable to prefers-reduced-motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
