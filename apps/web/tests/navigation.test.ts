import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROUTES } from "@/lib/copy";

/**
 * Whether a reader can get anywhere.
 *
 * The submission is the console, and until now nothing on the landing page led to it: no link in
 * the nav, the contact section or the footer. A judge who opened the site could not reach the thing
 * being judged except by typing a URL. The routes also have to lead back, or each one is a dead
 * end that costs a browser button.
 */
const source = (...parts: string[]) => readFileSync(join(import.meta.dir, "..", "src", ...parts), "utf8");

describe("the routes are one set, named once", () => {
  test("both routes are declared in copy, so no component invents a path", () => {
    expect(ROUTES.map((route) => route.href).sort()).toEqual(["/console", "/sim"]);
    for (const route of ROUTES) {
      expect(route.label).toBeTruthy();
      expect(route.blurb).toBeTruthy();
    }
  });

  test("the app has a page behind each of them", () => {
    for (const route of ROUTES) {
      expect(() => source("app", route.href.slice(1), "page.tsx")).not.toThrow();
    }
  });
});

describe("the landing leads to them", () => {
  test("the nav carries both, after the anchors", () => {
    const nav = source("components", "Nav.tsx");
    expect(nav).toMatch(/ROUTES/);
    // After the anchors: the sections are the argument, the routes are where it is demonstrated.
    expect(nav.indexOf("SECTIONS.map")).toBeLessThan(nav.indexOf("ROUTES.map"));
  });

  test("the contact section says where they are in words", () => {
    const page = source("app", "page.tsx");
    expect(page).toMatch(/ROUTES/);
  });
});

describe("and they lead back", () => {
  test("/sim links home", () => {
    expect(simHeader()).toMatch(/href="\/"/);
  });

  test("/sim links to the console, so the two routes mirror each other", () => {
    expect(simHeader()).toContain('href="/console"');
  });

  test("/console links home", () => {
    expect(source("app", "console", "page.tsx")).toMatch(/href="\/"/);
  });

  // The matching `/console` → `/sim` link is zentis-59's: that page and its bar belong to that
  // session, and the markup has been handed over rather than reached into. Deliberately not
  // asserted here, so this suite does not fail on work that is not in this session's hands — the
  // assertion belongs in the commit that adds the link.
});

/** Everything /sim's header is actually made of. */
const simHeader = () => [source("app", "sim", "page.tsx"), source("components", "console", "Screen.tsx")].join("\n");

