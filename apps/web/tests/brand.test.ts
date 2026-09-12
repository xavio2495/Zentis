import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIDGE, CHAIN_A, CHAIN_B } from "@/lib/mark-geometry";

/**
 * The mark, wherever it is drawn.
 *
 * The committed `logo.svg` arrived with two full-canvas green rects, the second of them *after* the
 * connector path — so the bridge was painted over and the file rendered as a green square with two
 * bars knocked out and no bridge between them. On a project whose whole claim is the link between
 * chains, that is the one shape that may not go missing, and it is invisible in a file rather than
 * in a diff.
 */
const file = (...p: string[]) => readFileSync(join(import.meta.dir, "..", ...p), "utf8");

describe("the static logo", () => {
  const logo = () => file("public", "brand", "logo.svg");

  test("has one field behind the knockouts, not two", () => {
    expect((logo().match(/<rect\b/g) ?? []).length).toBe(1);
  });

  test("draws all three shapes after the field, so none is covered", () => {
    const svg = logo();
    const field = svg.indexOf("<rect");
    for (const path of [BRIDGE, CHAIN_A, CHAIN_B]) {
      const at = svg.indexOf(path);
      expect(at).toBeGreaterThan(field);
    }
  });

  test("is the same geometry the field samples, so the mark cannot fork", () => {
    for (const path of [BRIDGE, CHAIN_A, CHAIN_B]) expect(logo()).toContain(path);
  });
});

describe("where each file is used", () => {
  test("the animated mark appears on the not-found page and nowhere else", () => {
    const sources = ["app/page.tsx", "app/layout.tsx", "components/Nav.tsx", "components/console/Screen.tsx"];
    for (const path of sources) expect(file("src", ...path.split("/"))).not.toContain("logo-animated");
  });

  test("no create-next-app icon survives in the public folder", () => {
    for (const name of ["file.svg", "globe.svg", "next.svg", "vercel.svg", "window.svg"]) {
      expect(() => file("public", name)).toThrow();
    }
  });
});

describe("the nav wears the mark rather than the word", () => {
  test("the landing's nav links home with the mark", () => {
    const nav = file("src", "components", "Nav.tsx");
    expect(nav).toContain("BrandMark");
    expect(nav).toMatch(/aria-label="Zentis"/);
  });

  test("the mark is drawn inline from the shared paths, so it takes the tokens", () => {
    const mark = file("src", "components", "BrandMark.tsx");
    expect(mark).toMatch(/BRIDGE/);
    expect(mark).toMatch(/CHAIN_A/);
    expect(mark).toMatch(/CHAIN_B/);
    // Imported, never pasted: a copy drifts the first time the logo is redrawn.
    for (const path of [BRIDGE, CHAIN_A, CHAIN_B]) expect(mark).not.toContain(path);
  });
});
