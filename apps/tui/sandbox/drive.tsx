import { render } from "ink";
import { PassThrough, Writable } from "node:stream";
import { App } from "../src/App.js";
import { buildActions, commandActions } from "../src/actions.js";
import type { Action } from "../src/action-types.js";
import { type Scenario, fakeSnapshot } from "./world.js";

/**
 * Headless frame capture.
 *
 * Ink is given a fake stdout that reports whatever size is asked for and collects what is written,
 * so a frame at 190, 120 or 80 columns can be looked at without a terminal, without the network, and
 * without the answer depending on what the testnets are doing this minute. It also checks the one
 * invariant that cannot be seen by reading the frame: a frame as tall as `stdout.rows` makes Ink
 * clear the whole terminal on every repaint.
 */
const ESC = "";
const KEYS: Record<string, string> = {
  ESC,
  ENTER: "\r",
  UP: `${ESC}[A`,
  DOWN: `${ESC}[B`,
  RIGHT: `${ESC}[C`,
  LEFT: `${ESC}[D`,
};
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g");
const strip = (text: string) => text.replace(ANSI, "");

class Sink extends Writable {
  frames: string[] = [];
  constructor(
    public columns: number,
    public rows: number,
  ) {
    super();
  }
  override _write(chunk: unknown, _encoding: unknown, done: () => void) {
    this.frames.push(String(chunk));
    done();
  }
}

export interface Frame {
  readonly lines: string[];
  readonly rows: number;
  readonly width: number;
  /** true when the frame is as tall as the terminal, which is where Ink starts clearing it */
  readonly overflows: boolean;
}

export async function drive(
  cols: number,
  rows: number,
  options: { scenario?: Scenario; keys?: string[]; armed?: boolean } = {},
): Promise<Frame> {
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });
  const stdout = new Sink(cols, rows);

  // The store answers a fixed snapshot: the app under test is the real one, and only the world
  // behind it is fake. A sandbox that needed the app written differently would test a different app.
  const { fixedStore, loadingStore } = await import("./state.js");
  // "loading" is the one scenario with no snapshot at all: the first frame, before any source has
  // answered, which is the state the console opens in every time it is started.
  const makeStore =
    options.scenario === "loading" ? loadingStore() : fixedStore(fakeSnapshot(options.scenario ?? "fresh"));

  const actions: Action[] =
    // Watch-only the way the real binary is when run from the repo: a repository, no signing key.
    options.armed === true ? buildActions("/dev/null") : buildActions(null);
  // The same factory the binary passes, built from the same env file, so a typed command in the
  // sandbox is refused or allowed for exactly the reason it would be live.
  const commands = commandActions(options.armed === true ? "/dev/null" : null);
  const app = render(<App actions={actions} runAction={null} makeStore={makeStore} commands={commands} />, {
    stdout: stdout as never,
    stdin: stdin as never,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const key of options.keys ?? []) {
    stdin.write(KEYS[key] ?? key);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));

  const lines = strip(stdout.frames.at(-1) ?? "")
    .replace(/\n$/, "")
    .split("\n");
  app.unmount();

  return {
    lines,
    rows: lines.length,
    width: Math.max(0, ...lines.map((line) => [...line].length)),
    overflows: lines.length >= rows,
  };
}
