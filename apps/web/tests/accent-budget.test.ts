import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The accent budget, actually counted.
 *
 * The rule the reference calls the most transferable on the site: the highlight appears in a fixed
 * handful of places and nowhere else, and body copy is never green. The previous test claimed to
 * enforce it and did not — it counted CSS declarations whose *value* contained the literal
 * `#00ED64`, and exactly one does, the token definition. Every real use goes through
 * `var(--color-em)` or a Tailwind `text-em` class, so the assertion read `1 < 10` and would have
 * passed with the accent on every element on the page.
 *
 * This counts every form: the raw hex, `var(--color-em*)`, and the `*-em` utilities, across the
 * whole of `src`. Each is matched against an allowlist that names what the accent is doing there.
 * A new use fails until someone adds it here and says why — which is the point, because the way
 * this rule dies is one reasonable-looking green at a time.
 */
const SRC = join(import.meta.dir, "..", "src");

/** Where the accent is permitted in the stylesheet, keyed by selector, with what it is for. */
const CSS_ALLOWED: Record<string, string> = {
  "@theme": "the token definition itself",
  "::selection": "selected text — the reference spends it here",
  ":focus-visible": "the focus ring, which must be the most visible thing on the page",
  ".loader-fill": "the loader's fill gradient",
  ".bracket": "the sponsor cards' corner brackets",
  ".cur-ring.over": "the cursor ring over a magnetic target",
  ".cur-trail": "the cursor's trail dots",
  ".nav-link.on": "the section the reader is in",
  ".dock-icon.done": "the copy confirmation",
};

/**
 * Where it is permitted in components, by file, with a count.
 *
 * Counted per file rather than per line so the list does not rot every time something moves down
 * a few lines, but still fails the moment a file grows a use it did not have.
 */
const TSX_ALLOWED: Record<string, { uses: number; why: string }> = {
  "components/CopyCommand.tsx": { uses: 1, why: "the copy toast" },
  "components/CopyLink.tsx": { uses: 2, why: "the copy toast, and the repo link's hover" },
  "components/console/MarkGlyph.tsx": { uses: 0, why: "takes its fill from the caller" },
  "components/console/Screen.tsx": { uses: 1, why: "the mark in the bar, as on /console" },
  "app/console/page.tsx": { uses: 1, why: "the mark in the bar" },
  // The console's own rule, from console-tokens.test.ts: the accent means "this is what Zentis
  // computed". Numbers the model produced may wear it; states, health and row types may not.
  "components/console/ui.tsx": { uses: 2, why: "the `signal` stat tone, and the active chip" },
  "components/console/ShiftPanel.tsx": { uses: 1, why: "the published shift — the signal itself" },
  "components/console/LegCard.tsx": { uses: 2, why: "the recomputed shift, and the concession it produced" },
  "components/console/PnlPanel.tsx": { uses: 1, why: "the book's own total" },
  "components/console/MarketPanel.tsx": { uses: 1, why: "the legend word keyed to the accent line it names" },
  "components/console/FillsPanel.tsx": { uses: 1, why: "the shift a fill was taken at" },
};

const PATTERNS = [/#00ED64/gi, /var\(--color-em[^)]*\)/g, /\b(?:text|bg|border|fill|stroke)-em\b/g];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const relative = (path: string) => path.slice(SRC.length + 1);

/** Accent uses in a file, ignoring comments — prose about the rule is not a use of it. */
function countUses(text: string): number {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  return PATTERNS.reduce((total, pattern) => total + (code.match(pattern)?.length ?? 0), 0);
}

describe("every accent in the stylesheet is one the design asked for", () => {
  const css = readFileSync(join(SRC, "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Map<string, number>();
  for (const [, rawSelector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.trim().split("\n").pop()!.trim();
    for (const decl of body.split(";")) {
      if (/var\(--color-em[^)]*\)/.test(decl) || /#00ED64/i.test(decl)) {
        found.set(selector, (found.get(selector) ?? 0) + 1);
      }
    }
  }

  test("no selector wears it without a reason on the list", () => {
    const unlisted = [...found.keys()].filter((selector) => !(selector in CSS_ALLOWED));
    expect(unlisted).toEqual([]);
  });

  test("the list does not rot: every entry is still a real use", () => {
    const gone = Object.keys(CSS_ALLOWED).filter((selector) => !found.has(selector));
    expect(gone).toEqual([]);
  });
});

describe("every accent in a component is one the design asked for", () => {
  const files = walk(SRC).filter((path) => path.endsWith(".tsx"));
  const found = new Map<string, number>();
  for (const path of files) {
    const uses = countUses(readFileSync(path, "utf8"));
    if (uses > 0) found.set(relative(path), uses);
  }

  test("no component wears it without a reason on the list", () => {
    const unlisted = [...found.keys()].filter((file) => !(file in TSX_ALLOWED));
    expect(unlisted).toEqual([]);
  });

  test("no component wears it more times than the list permits", () => {
    const over = [...found.entries()]
      .filter(([file, uses]) => file in TSX_ALLOWED && uses > TSX_ALLOWED[file]!.uses)
      .map(([file, uses]) => `${file}: ${uses} > ${TSX_ALLOWED[file]!.uses}`);
    expect(over).toEqual([]);
  });

  test("every entry on the list says what the accent is doing", () => {
    for (const [file, entry] of Object.entries(TSX_ALLOWED)) expect(entry.why.length).toBeGreaterThan(10);
  });
});

describe("the accent is never the page's prose", () => {
  test("no landing copy is set in it", () => {
    // The statement, the tagline, the outro and the body paragraphs are the argument, not the
    // signal. The reference's rule is flat: body copy is never green.
    const page = readFileSync(join(SRC, "app", "page.tsx"), "utf8");
    expect(countUses(page)).toBe(0);
  });
});
