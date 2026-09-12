/**
 * The handful of globals a Node-shaped library expects and a browser does not have.
 *
 * Imported first by the browser entry so it runs before any module body that reads `process`, and
 * exported as a function as well because a test can only prove the polyfill is there by taking the
 * real one away first — and a module body runs once per process, long before that.
 */
export function installBrowserGlobals(): void {
  const globals = globalThis as unknown as {
    process?: unknown;
    setImmediate?: unknown;
    clearImmediate?: unknown;
  };
  // The data layer takes endpoint overrides from the environment; in a browser there is none, and an
  // empty one makes those reads fall through to their defaults, which is what a public build wants.
  //
  // The listener methods are here because Ink registers a `beforeExit` handler in `waitUntilExit`
  // and removes it in `unmount`: without them, closing the console threw `process.off is not a
  // function` — the same failure as the missing timer, one line further down the same path. They do
  // nothing, which is correct: a browser tab has no process lifecycle to hold an event.
  const noop = () => globals.process;
  globals.process ??= {
    env: {},
    argv: [],
    platform: "browser",
    on: noop,
    once: noop,
    off: noop,
    addListener: noop,
    removeListener: noop,
    removeAllListeners: noop,
    emit: () => false,
  };
  // Ink resolves its exit promise through `setImmediate`, which is Node's timer and not the
  // platform's: pressing `x` on the site threw "setImmediate is not defined" out of the unmount
  // path, which is a console nobody can close. A macrotask is what Ink wants of it — the callback
  // must run after the current turn, not inside it — so a zero timeout and not a microtask.
  globals.setImmediate ??= (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
    setTimeout(() => fn(...args), 0);
  globals.clearImmediate ??= (id: number) => clearTimeout(id);
}

installBrowserGlobals();
