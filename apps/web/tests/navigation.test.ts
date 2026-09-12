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
  for (const route of ["console", "sim"]) {
    test(`/${route} links home`, () => {
      const files = [source("app", route, "page.tsx"), ...componentsOf(route)].join("\n");
      expect(files).toMatch(/href="\/"/);
    });

    test(`/${route} links to the other one, so the two mirror each other`, () => {
      const other = route === "console" ? "/sim" : "/console";
      const files = [source("app", route, "page.tsx"), ...componentsOf(route)].join("\n");
      expect(files).toContain(`href="${other}"`);
    });
  }
});

/** The components a route's header actually lives in. */
function componentsOf(route: string): string[] {
  if (route !== "sim") return [];
  return [source("components", "console", "Screen.tsx")];
}
