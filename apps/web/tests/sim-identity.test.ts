import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What `/sim` is, to everything that is not a browser running its clock.
 *
 * The replay is a client component: a crawler, a preview card, a screen reader or a browser with
 * scripting off gets an empty document wearing the landing page's title. A link to the strongest
 * thing in the submission then says nothing about what is behind it, and a reader who lands there
 * without scripts sees a black rectangle.
 *
 * The sponsor chips belong to the same argument. They were `hidden md:flex`, so on a phone the
 * three integrations this project is judged on were not on the page at all.
 */
const source = (...parts: string[]) => {
  try {
    return readFileSync(join(import.meta.dir, "..", "src", ...parts), "utf8");
  } catch {
    return "";
  }
};
const page = () => source("app", "sim", "page.tsx");
const layout = () => source("app", "sim", "layout.tsx");
const screen = () => source("components", "console", "Screen.tsx");

test("the replay names itself rather than inheriting the landing's title", () => {
  expect(layout()).toContain("export const metadata");
  expect(layout()).toMatch(/title:/);
  expect(layout()).toMatch(/description:/);
  expect(layout()).toMatch(/canonical/);
});

test("the page has a heading, even though the screen is all panels", () => {
  expect(page()).toMatch(/<h1/);
  expect(page()).toMatch(/sr-only/);
});

test("without scripts the replay states its argument rather than drawing nothing", () => {
  const text = page();
  expect(text).toContain("<noscript");
  // The argument itself, not an apology: one position, three chains, priced rather than bridged.
  expect(text).toMatch(/three chains/i);
  expect(text).toMatch(/recorded/i);
});

test("the sponsor chips are on the page at every width, because they are part of the claim", () => {
  // Comments stripped first: the sentence explaining why they are no longer hidden contains the
  // word, and a test that reads its own explanation as the code is a test of nothing.
  const header = screen().replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const at = header.indexOf("1inch · Aqua");
  expect(at).toBeGreaterThan(-1);
  const container = header.slice(Math.max(0, at - 200), at);
  expect(container).not.toMatch(/hidden/);
});
