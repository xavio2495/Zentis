import { describe, expect, test } from "bun:test";
import { COPY, INTEGRATIONS, INSTALL_COMMAND, ROUTES } from "../src/lib/copy";
import { DECK_NOSCRIPT, SLIDES, deckProse, nextIndex } from "../src/lib/deck";

/**
 * The deck is presented from a laptop, live, to people who can check every sentence against the
 * repository. So the module it reads from is held to the landing's two rules — a figure has to
 * trace to a committed run, and an integration is described only as the project defines it — and
 * to one more the landing does not need: a reader with no JavaScript still gets the argument,
 * because a deck that only exists as animation is a deck that cannot be linked.
 */

describe("the deck's shape", () => {
  test("seven slides, in the order the argument is made", () => {
    expect(SLIDES.map((s) => s.id)).toEqual([
      "claim",
      "problem",
      "mechanism",
      "integrations",
      "live",
      "unbuilt",
      "ask",
    ]);
  });

  test("every slide carries a kicker, a title and a body", () => {
    for (const slide of SLIDES) {
      expect(slide.kicker.length).toBeGreaterThan(0);
      expect(slide.title.length).toBeGreaterThan(0);
      expect(slide.body.length).toBeGreaterThan(40);
    }
  });

  test("ids are unique, because they address a slide from the URL", () => {
    expect(new Set(SLIDES.map((s) => s.id)).size).toBe(SLIDES.length);
  });
});

describe("the deck makes no claim it cannot source", () => {
  test("no figure appears anywhere in the prose", () => {
    // Same rule as the landing: every number this project shows has to trace to a committed run,
    // and a slide read aloud is the last place to start hand-typing one.
    expect(deckProse().filter((line) => /\d/.test(line))).toEqual([]);
  });

  test("the integrations slide names them from the copy module rather than restating them", () => {
    const slide = SLIDES.find((s) => s.id === "integrations")!;
    for (const integration of INTEGRATIONS) {
      expect(slide.body + slide.points!.join(" ")).toContain(integration.name);
    }
  });

  test("the claim slide carries the claim, not a paraphrase of it", () => {
    const claim = SLIDES[0].body.toLowerCase();
    expect(claim).toMatch(/one mid|same mid/);
    expect(claim).toMatch(/without bridging|no bridge/);
    expect(claim).toMatch(/one book|single book/);
  });

  test("the closing slide carries the install line, which is an address and not prose", () => {
    const ask = SLIDES[SLIDES.length - 1];
    expect(ask.points).toContain(INSTALL_COMMAND);
    expect(deckProse()).not.toContain(INSTALL_COMMAND);
  });

  test("the closing slide is the landing's close: one invitation, the command, and the two doors", () => {
    // The landing's close was reworked to ask the reader to run the thing, with the two places it
    // is already running beneath the command. A deck that still ends on the older close is two
    // pages disagreeing about what the ask is, and the deck is the one read aloud.
    const ask = SLIDES[SLIDES.length - 1];
    expect(ask.title).toBe(COPY.tryItOut);
    expect(ask.doors?.map((door) => door.href)).toEqual(
      ROUTES.filter((route) => route.atClose).map((route) => route.href),
    );
    for (const door of ask.doors ?? []) expect(DECK_NOSCRIPT).toContain(door.label);
  });
});

describe("the noscript is the whole deck as text", () => {
  test("it names every slide", () => {
    for (const slide of SLIDES) {
      expect(DECK_NOSCRIPT).toContain(slide.title);
    }
  });

  test("it carries the bodies too, so a reader without JavaScript gets the argument", () => {
    for (const slide of SLIDES) {
      expect(DECK_NOSCRIPT).toContain(slide.body);
    }
  });
});

describe("moving through the deck", () => {
  const count = SLIDES.length;
  const last = count - 1;

  test("forward on the keys a presenter's hand actually finds", () => {
    for (const key of ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]) {
      expect(nextIndex(0, key, count)).toBe(1);
    }
  });

  test("back on their opposites", () => {
    for (const key of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]) {
      expect(nextIndex(3, key, count)).toBe(2);
    }
  });

  test("Home and End reach the ends in one press", () => {
    expect(nextIndex(4, "Home", count)).toBe(0);
    expect(nextIndex(1, "End", count)).toBe(last);
  });

  test("it stops at both ends rather than wrapping", () => {
    // Wrapping mid-presentation puts the closing slide on screen when the presenter meant to
    // dwell on the last one, which is the one moment a deck cannot afford to move on its own.
    expect(nextIndex(0, "ArrowLeft", count)).toBe(0);
    expect(nextIndex(last, "ArrowRight", count)).toBe(last);
  });

  test("a key the deck does not use leaves the slide alone", () => {
    for (const key of ["Tab", "Shift", "a", "Escape", "F5"]) {
      expect(nextIndex(2, key, count)).toBe(2);
    }
  });
});
