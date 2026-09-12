import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TERMINAL_THEME } from "@/lib/terminal-theme";
import { BRIDGE, CHAIN_A, CHAIN_B } from "@/lib/mark-geometry";

/**
 * The console route wearing the landing's skin.
 *
 * The palette itself is pinned in `console-tokens.test.ts`. What is pinned here is the skin the
 * landing established and the console has to keep: the mark, the grain, one easing, and the one
 * place a colour has to leave the sheet because the library taking it cannot read CSS.
 */
const source = (...parts: string[]) => readFileSync(join(import.meta.dir, "..", "src", ...parts), "utf8");
const css = source("app", "globals.css");
const token = (prop: string): string | undefined =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp(`${prop}\\s*:\\s*([^;]+);`))?.[1].trim();

describe("the terminal's theme is the sheet's, copied under protest", () => {
  // xterm.js takes hexes, not custom properties, so this one table cannot read the sheet at
  // runtime. It can be compared to it at build time, which is the whole reason it is a constant in
  // its own file rather than an object literal inside a component.
  const pairs: [keyof typeof TERMINAL_THEME, string][] = [
    ["background", "--color-bg"],
    ["foreground", "--color-ink"],
    ["cursor", "--color-em"],
  ];
  for (const [key, prop] of pairs) {
    test(`${key} is ${prop}`, () => {
      expect(TERMINAL_THEME[key].toLowerCase()).toBe(token(prop)!.toLowerCase());
    });
  }

  test("the selection is the accent at an alpha, not a second green", () => {
    expect(TERMINAL_THEME.selectionBackground.toLowerCase()).toStartWith(token("--color-em")!.toLowerCase());
  });

  test("no console component carries a hex of its own", () => {
    // The theme constant is the sanctioned exception; anything else is a second source of truth.
    for (const file of ["Screen.tsx", "ui.tsx", "Terminal.tsx", "ShiftPanel.tsx", "FillsPanel.tsx", "SimPanel.tsx", "Transport.tsx"]) {
      expect(source("components", "console", file)).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});

describe("the mark in the header is the landing's mark", () => {
  test("it is drawn from the same three paths the particle field samples", () => {
    const glyph = source("components", "console", "MarkGlyph.tsx");
    for (const path of [BRIDGE, CHAIN_A, CHAIN_B]) {
      // Imported, not pasted: a copy would drift the moment the logo is redrawn.
      expect(glyph).not.toContain(path);
    }
    expect(glyph).toMatch(/BRIDGE/);
    expect(glyph).toMatch(/CHAIN_A/);
    expect(glyph).toMatch(/CHAIN_B/);
  });

  test("the screen wears it", () => {
    expect(source("components", "console", "Screen.tsx")).toMatch(/<MarkGlyph/);
  });
});

describe("the grain and the one easing", () => {
  test("the replay surface carries the grain the landing does", () => {
    expect(source("app", "sim", "page.tsx")).toMatch(/className="grain"/);
  });

  test("nothing in the console eases on the browser's default curve", () => {
    // `transition-colors` alone is 150ms linear-ish: the one curve on the landing is --ease-out,
    // and a screen that eases two ways reads as two screens.
    for (const file of ["ui.tsx", "Transport.tsx", "Screen.tsx"]) {
      expect(source("components", "console", file)).not.toMatch(/\btransition-(colors|all|opacity)\b/);
    }
  });

  test("the shared curve exists as a class the console can wear", () => {
    expect(css).toMatch(/\.tap\s*\{[^}]*var\(--ease-out\)/);
  });
});

describe("the scrollbars are ours", () => {
  /**
   * Five panels on this screen scroll, and a default scrollbar is the one surface the design system
   * does not reach: a light-grey rounded bar on a near-black instrument, drawn by the OS in its own
   * palette. It is also load-bearing rather than cosmetic — the scrollbars are the only clue that a
   * panel has more evidence below the fold, so on a screen whose whole claim is "every number is
   * here and traceable" they need to be visible and on-palette rather than invisible.
   */
  const rule = (selector: string): string | undefined => {
    const at = css.indexOf(selector + " {");
    if (at === -1) return undefined;
    return css.slice(at, css.indexOf("}", at));
  };

  test("the scrolling surface is a class, so nothing gets them by accident", () => {
    expect(rule(".scroll")).toBeDefined();
  });

  test("Firefox is told thin, and told in tokens", () => {
    const block = rule(".scroll")!;
    expect(block).toMatch(/scrollbar-width:\s*thin/);
    expect(block).toMatch(/scrollbar-color:.*var\(--color-/);
  });

  test("the WebKit bar has a width, a track and a thumb", () => {
    expect(rule(".scroll::-webkit-scrollbar")).toMatch(/width:/);
    expect(rule(".scroll::-webkit-scrollbar-track")).toBeDefined();
    expect(rule(".scroll::-webkit-scrollbar-thumb")).toBeDefined();
  });

  test("every colour in them is a token, never a literal", () => {
    for (const selector of [
      ".scroll",
      ".scroll::-webkit-scrollbar",
      ".scroll::-webkit-scrollbar-track",
      ".scroll::-webkit-scrollbar-thumb",
      ".scroll::-webkit-scrollbar-thumb:hover",
    ]) {
      const block = rule(selector);
      if (block === undefined) continue;
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(block).not.toMatch(/\brgb\(|\bhsl\(/);
    }
  });

  test("the thumb answers the cursor on the one curve", () => {
    expect(rule(".scroll::-webkit-scrollbar-thumb:hover")).toBeDefined();
  });

  test("every console container that scrolls wears the class", () => {
    for (const file of ["LegCard.tsx", "FeedPanel.tsx", "PnlPanel.tsx"]) {
      const text = source("components", "console", file);
      for (const [, classes] of text.matchAll(/className="([^"]*overflow-[xy]?-?(?:auto|scroll)[^"]*)"/g)) {
        expect(classes).toContain("scroll");
      }
    }
  });

  test("the tabular-numerals note still sits on the tabular-numerals rule", () => {
    // A block was once inserted between a comment and the rule it explained, which leaves two rules
    // each documented by the other's reasoning.
    const note = css.indexOf("Tabular numerals");
    expect(css.slice(note, css.indexOf("{", note))).toMatch(/\.tnum\s*$/);
  });
});

describe("the bars across the top", () => {
  const screen = () => source("components", "console", "Screen.tsx");
  const book = () => source("components", "console", "BookRow.tsx");

  test("the header centres its middle group instead of leaving it to justify-between", () => {
    // Three groups of unequal width under `justify-between` puts the middle one wherever the
    // outer two leave it, which is never the middle.
    expect(screen()).not.toMatch(/<header[^>]*justify-between/);
    expect(screen()).toMatch(/<header[^>]*grid-cols-\[/);
  });

  test("no divider is drawn on the spacer that holds the two groups apart", () => {
    // `divide-x` borders every child but the first — including a `flex-1` spacer, which then
    // draws a rule floating in the empty middle of the bar. Checked against class attributes
    // rather than the file's text, or the comment explaining the rule fails the rule.
    for (const file of ["Screen.tsx", "BookRow.tsx"]) {
      const markup = source("components", "console", file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const [, classes] of markup.matchAll(/className="([^"]*)"/g)) {
        if (classes.includes("flex-1")) continue;
        expect(classes).not.toContain("divide-x");
      }
    }
  });

  test("the stat bar can grow rather than clipping its own numbers", () => {
    // A two-line Stat in a fixed h-9 clips the value at narrow widths — the unit goes first,
    // which on this screen is the one part of a number that may not be dropped.
    const bar = screen().slice(screen().indexOf("<header"), screen().indexOf("<BookRow"));
    expect(bar).not.toMatch(/className="flex h-9 shrink-0/);
  });

  test("the two seqs on adjacent rows are not both called seq", () => {
    // The stat bar's seq is the round the playhead is on; the book row's is the moment the
    // snapshot was recorded. Two different numbers under one label on touching rows is the
    // screen inviting a reader to think one of them moved.
    const statLabels = [...screen().matchAll(/label="([^"]+)"/g)].map((m) => m[1]);
    const bookLabels = [...book().matchAll(/label="([^"]+)"/g)].map((m) => m[1]);
    const shared = statLabels.filter((label) => bookLabels.includes(label));
    expect(shared).toEqual([]);
  });
});
