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
  test("every route is declared in copy, so no component invents a path", () => {
    expect(ROUTES.map((route) => route.href).sort()).toEqual(["/console", "/deck", "/sim"]);
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
    expect(contact()).toMatch(/<DockRoom/);
  });

  test("the two calls to action are the routes, and nothing is said about them beyond their names", () => {
    expect(contact()).toContain("ROUTES.filter");
    expect(contact()).not.toContain("route.blurb");
  });

  test("they are one size rather than two, so neither reads as the lesser", () => {
    // The size is carried by the `.cta` rule, not by a class on each link — two buttons sized
    // separately are two buttons that will eventually differ.
    expect(contact()).toMatch(/className="cta"/);
    const css = readFileSync(join(import.meta.dir, "..", "src", "app", "globals.css"), "utf8");
    const rule = css.slice(css.indexOf(".cta {"), css.indexOf("}", css.indexOf(".cta {")));
    expect(rule).toMatch(/min-width:/);
    expect(rule).toMatch(/justify-content:\s*center/);
  });

  test("the close offers two doors, and the deck is not one of them", () => {
    // The deck is a thing you are shown by a presenter, not a thing you go and run. Adding it here
    // because it happens to be in the same list is the list making a design decision by accident.
    expect(ROUTES.filter((route) => route.atClose).map((route) => route.label)).toEqual(["Console", "Replay"]);
  });

  test("the source is still reachable now that the section no longer carries it", () => {
    // The nav's own Source entry has to lead somewhere real, or removing the link from the page
    // quietly breaks a nav item rather than tidying a section.
    expect(source("components", "Nav.tsx")).toContain("REPO_URL");
  });
});

describe("the last screen is one screen", () => {
  test("the closing section and the footer together fit in a viewport", () => {
    /*
     * At the very bottom of the page the reader sees the last viewport-height of it, and that has
     * to be the whole close: the title, the install line, the two buttons and the outro. When the
     * section was a full screen tall and the footer another 40% on top, the last viewport began
     * below the title — so the section's own heading was never visible at the point the reader
     * stops scrolling.
     */
    const page = source("app", "page.tsx");
    const heights = [...page.matchAll(/min-h-\[(\d+)vh\]/g)].map((m) => Number(m[1]));
    const closing = heights.slice(-2);
    expect(closing).toHaveLength(2);
    expect(closing[0]! + closing[1]!).toBeLessThanOrEqual(100);
  });

  test("neither the section nor the footer is a full screen on its own", () => {
    const page = source("app", "page.tsx");
    const contact = page.slice(page.indexOf('id="contact"'), page.indexOf("</footer>"));
    expect(contact).not.toMatch(/min-h-screen/);
  });
});
