import { expect, test } from "bun:test";
import { mount } from "./src/browser.js";
import type { TerminalHandle } from "./src/browser.js";

/**
 * The console as a visitor gets it: the same screen, over the recorded moment.
 *
 * The public build must not read a live source. Every visitor to the site would otherwise spend the
 * maker's Subgraph Studio allowance — the same allowance a leaky test drained once already — and a
 * page that costs money per view is a page that gets taken down the day it starts working.
 *
 * So this build serves the recording, which is real data read from the real endpoints at a moment
 * somebody committed, and says on screen that it is a recording rather than letting it pass for a
 * live read.
 */
const terminal = () => {
  const written: string[] = [];
  const handle: TerminalHandle & { written: string[] } = {
    written,
    cols: 120,
    rows: 40,
    write: (data: string) => written.push(data),
    onData: () => undefined,
    onResize: () => undefined,
  };
  return handle;
};

const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;?]*[a-zA-Z]", "g");
const strip = (text: string) => text.replace(ANSI, "");

test("the public console draws the recorded moment without reaching for a single endpoint", async () => {
  // Any read at all fails loudly here: if this build still made a live store, the screen would come
  // up as an outage rather than as a book.
  const original = globalThis.fetch;
  let reached = 0;
  globalThis.fetch = (() => {
    reached += 1;
    throw new Error("the public console must not read anything");
  }) as typeof fetch;

  const handle = terminal();
  const app = mount(handle);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const screen = strip(handle.written.join(""));
  app.unmount();
  globalThis.fetch = original;

  expect(reached).toBe(0);
  expect(screen).toContain("Sepolia");
  // A real published sequence out of the recording, not an empty frame.
  expect(screen).toMatch(/seq \d{6,}/);
  // And it says what it is, so a recorded moment never passes for a live one.
  expect(screen).toMatch(/recorded/i);
}, 30_000);
