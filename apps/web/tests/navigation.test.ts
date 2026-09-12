import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COPY, ROUTES } from "@/lib/copy";

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


describe("the closing section is the install line and two ways in", () => {
  const page = () => source("app", "page.tsx");
  const contact = () => {
    const text = page();
    return text.slice(text.indexOf('id="contact"'), text.indexOf("<footer"));
  };

  test("it opens with the invitation, not with a second tagline", () => {
    expect(COPY.tryItOut).toBeTruthy();
    expect(contact()).toContain("COPY.tryItOut");
    // The serif contact line and the repo link were the clutter: three headings, a link, a label
    // and two blurbs stacked over the install command the section exists for.
    expect(contact()).not.toContain("COPY.contactLine");
    expect(contact()).not.toContain("CopyLink");
  });

  test("it leaves the middle of the viewport empty for the install line to arrive in", () => {
    // The dock is fixed and eases to `innerHeight / 2` as the page closes. Anything placed there
    // would be underneath it.
    expect(contact()).toMatch(/dock-room/);
  });

  test("the two calls to action are the routes, and nothing is said about them beyond their names", () => {
    expect(contact()).toContain("ROUTES.map");
    expect(contact()).not.toContain("route.blurb");
  });

  test("they are one size rather than two, so neither reads as the lesser", () => {
    expect(contact()).toMatch(/basis-|min-w-|w-\[/);
  });

  test("the source is still reachable now that the section no longer carries it", () => {
    // The nav's own Source entry has to lead somewhere real, or removing the link from the page
    // quietly breaks a nav item rather than tidying a section.
    expect(source("components", "Nav.tsx")).toContain("REPO_URL");
  });
});
