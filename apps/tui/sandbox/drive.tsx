import { render } from "ink";
import { PassThrough, Writable } from "node:stream";
import { App } from "../src/App.js";
import { buildActions, commandActions, findRepoRoot, publisherMode } from "../src/actions.js";
import type { Action } from "../src/action-types.js";
import { type Scenario, fakeSnapshot } from "./world.js";
import type { TxLogLine } from "../src/txlog.js";

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
  /**
   * How many times the screen was written while the driver watched.
   *
   * A console that repaints when nothing has changed costs nothing on a fast machine and everything
   * over an afternoon: at twelve frames a second the terminal saw a quarter of a million frames in
   * half an hour, and the process grew to three gigabytes carrying them. Counting the writes is how
   * that stays fixed.
   */
  readonly repaints: number;
}

export async function drive(
  cols: number,
  rows: number,
  options: {
    scenario?: Scenario;
    keys?: string[];
    armed?: boolean;
    /**
     * Which publisher the console can reach. Stated rather than inherited: whether this machine
     * exports ZENTIS_GCP_PROJECT is not something a test's result should depend on.
     */
    publisher?: "cloud" | "local" | "none";
    /** a stranger's first run: no wallet, no env file, nothing chosen yet */
    onboarding?: boolean;
    /** how long to sit and watch after the keys, for a test about how often the screen repaints */
    watchMs?: number;
    /**
     * The machine's transaction log, recorded. Handed in rather than read: a test that read the
     * real file would draw whatever this machine happens to have sent today, and one that wrote it
     * would put fixtures into the operator's own record of what went on chain.
     */
    txlog?: TxLogLine[];
  } = {},
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

  const project = options.publisher === "cloud" ? "zentis-cg1-2026" : "";
  // Watch-only the way the real binary is when run from the repo: a repository, no signing key.
  // `publisher: "local"` is the operator's other case — a checkout and a key, no cloud project.
  const envFile = options.armed === true || options.publisher === "local" ? "/dev/null" : null;
  const actions: Action[] = buildActions(envFile, undefined, project);
  // The same factory the binary passes, built from the same env file, so a typed command in the
  // sandbox is refused or allowed for exactly the reason it would be live.
  const commands = commandActions(envFile);
  const app = render(
    <App
      actions={actions}
      runAction={null}
      makeStore={makeStore}
      commands={commands}
      publisher={publisherMode(envFile, findRepoRoot(), project)}
      onboarding={options.onboarding === true}
      onChoose={async () =>
        "address 0x0000000000000000000000000000000000000001 · written ~/.zentis/wallet.env mode 600 · the key is in that file and will not be shown again"
      }
      // The fake world has no file to arm on, so continuing leaves the console as it started.
      onArm={() => null}
      readTxLog={() => options.txlog ?? []}
    />,
    {
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
  // Sat through rather than sampled: what a repaint test needs is a window of quiet, and the only
  // honest way to count what a still screen does is to leave it still and watch.
  if (options.watchMs !== undefined) {
    stdout.frames.length = 0;
    await new Promise((resolve) => setTimeout(resolve, options.watchMs));
  }

  const lines = strip(stdout.frames.at(-1) ?? "")
    .replace(/\n$/, "")
    .split("\n");
  app.unmount();

  return {
    lines,
    rows: lines.length,
    width: Math.max(0, ...lines.map((line) => [...line].length)),
    overflows: lines.length >= rows,
    repaints: stdout.frames.length,
  };
}
