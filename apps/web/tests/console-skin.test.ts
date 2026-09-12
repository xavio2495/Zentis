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
