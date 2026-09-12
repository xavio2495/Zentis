import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROUTES } from "@/lib/copy";

/**
 * What `/console` is, to everything that is not a browser with JavaScript on.
 *
 * The page is one terminal drawn into a canvas. To a crawler, a preview card, a screen reader or a
 * browser with scripting off it is an empty document with a title borrowed from the landing page —
 * so a link to it says nothing about what is behind it, and a reader who lands there with no
 * scripts sees nothing at all. None of that is visible while developing, because the one way anyone
 * looks at it is the one way it works.
 */
const source = (...parts: string[]) => {
  try {
    return readFileSync(join(import.meta.dir, "..", "src", ...parts), "utf8");
  } catch {
    // Missing is a failure of the test that asked for it, not of the whole file: a throw at module
    // scope takes every other assertion down with it and reports one problem as five.
    return "";
  }
};
const page = () => source("app", "console", "page.tsx");
const layout = () => source("app", "console", "layout.tsx");

test("the route names itself rather than inheriting the landing's title", () => {
  expect(layout()).toContain("export const metadata");
  expect(layout()).toMatch(/title:/);
  expect(layout()).toMatch(/description:/);
  // Its own canonical, or every share of this URL credits the landing page instead.
  expect(layout()).toMatch(/canonical/);
});

test("the page has a heading, even though the screen has no room to draw one", () => {
  expect(page()).toMatch(/<h1/);
  // Visually hidden, not display:none: the first is read aloud, the second is not read at all.
  expect(page()).toMatch(/sr-only/);
});

test("without scripts the page says what it is and how to run the real thing", () => {
  expect(page()).toContain("<noscript");
  expect(page()).toContain("INSTALL_COMMAND");
});

test("the console leads to the replay, as the replay leads to the console", () => {
  // The other half of this pair is asserted in navigation.test.ts; this is the half that was left
  // for the commit that adds the link.
  expect(page()).toContain('href="/sim"');
  expect(page()).toContain("ROUTES");
  expect(ROUTES.some((route) => route.href === "/sim")).toBe(true);
});

test("the mark is the accent, on this route as on the landing", () => {
  expect(page()).toMatch(/fill-em\b/);
});
