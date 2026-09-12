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
  const typists: ((data: string) => void)[] = [];
  const handle: TerminalHandle & { written: string[]; type(data: string): void } = {
    written,
    cols: 120,
    rows: 40,
    write: (data: string) => written.push(data),
    onData: (handler) => typists.push(handler),
    onResize: () => undefined,
    type: (data: string) => {
      for (const typist of typists) typist(data);
    },
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
  }) as unknown as typeof fetch;

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

test("a visitor's keystrokes reach the console, because a console nobody can press is a screenshot", async () => {
  // Ink does not listen for `data`. It listens for `readable` and then calls `read()` — so a stdin
  // shim that fires `data` and answers `read()` with null is one every key falls into silently.
  // The screen still drew, which is why this went unnoticed: only pressing something finds it.
  const handle = terminal();
  const app = mount(handle);
  await new Promise((resolve) => setTimeout(resolve, 300));

  handle.written.length = 0;
  handle.type("p");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const screen = strip(handle.written.join(""));
  app.unmount();

  // `p` is the positions page, which names things the live view never does.
  expect(screen).toMatch(/positions/);
  expect(screen).toMatch(/strategy/);
}, 30_000);

test("pressing x closes the console instead of reaching for a timer no browser has", async () => {
  // Ink resolves its exit promise through `setImmediate`, which is Node's and not the platform's.
  // In the browser that threw "ReferenceError: setImmediate is not defined" out of the unmount path
  // and left the page with a console that could not be closed. Bun has the function, so the browser
  // is what the test has to be: take it away, and put back whatever the bundle installs.
  const had = (globalThis as { setImmediate?: unknown }).setImmediate;
  delete (globalThis as { setImmediate?: unknown }).setImmediate;
  const thrown: unknown[] = [];
  const onError = (event: PromiseRejectionEvent | ErrorEvent) => thrown.push(event);
  process.on("uncaughtException", onError as never);
  process.on("unhandledRejection", onError as never);

  const handle = terminal();
  const app = mount(handle);
  await new Promise((resolve) => setTimeout(resolve, 300));
  handle.type("x");
  await new Promise((resolve) => setTimeout(resolve, 400));
  const screen = strip(handle.written.join(""));

  process.off("uncaughtException", onError as never);
  process.off("unhandledRejection", onError as never);
  (globalThis as { setImmediate?: unknown }).setImmediate = had;
  app.unmount();

  expect(thrown).toEqual([]);
  // And it says what happened: a console that vanished on a keystroke reads as a page that broke.
  expect(screen).toMatch(/console closed/i);
  expect(screen).toMatch(/reload/i);
}, 30_000);
