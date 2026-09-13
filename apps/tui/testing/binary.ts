import { LEGS } from "@zentis/console-data";

/**
 * Driving the compiled console from a test, without leaving one behind.
 *
 * The binary needs a real tty to render into, so it is run under `script`, which means the shell
 * that spawns it is not its parent in any useful sense: killing the shell leaves `script` and the
 * console alive, and a console left alive polls three fills subgraphs once a minute. Seventeen of
 * them, spawned a minute apart by a leaky test, drained two legs' daily indexer allowance to zero.
 *
 * So the window is enforced by `timeout` rather than by the test runner, and whatever survives it is
 * killed by the binary's own unique path afterwards. And the environment points every endpoint the
 * console reads at a closed port: a test process must not be able to spend the maker's allowance
 * even for the seconds it is up.
 */
const NOWHERE = "http://127.0.0.1:1";

const variableFor = (prefix: string, name: string) => `${prefix}_${name.toUpperCase().replace(/-/g, "_")}`;

export const OFFLINE_ENV: Record<string, string> = {
  ZENTIS_QUOTE_API: NOWHERE,
  ...Object.fromEntries(LEGS.flatMap((leg) => [
    [variableFor("ZENTIS_FILLS", leg.name), NOWHERE],
    [variableFor("ZENTIS_RPC", leg.name), NOWHERE],
  ])),
};

export interface RunOptions {
  /** keystrokes sent once the app has mounted and raw mode is armed */
  readonly keys?: string;
  /**
   * How long to wait before sending them. Two seconds is enough for raw mode to arm; a test about
   * what the console offers *after* its first poll has to wait for that poll.
   */
  readonly waitSeconds?: number;
  /**
   * How long the console is allowed to live *once it has drawn*, including its own shutdown.
   *
   * Measured from the first frame rather than from the process start: a cold machine spends its
   * first seconds paging in a hundred megabytes of binary, and a budget that included those seconds
   * killed the console before it had rendered anything at all.
   */
  readonly seconds?: number;
  /** how long to wait for that first frame before giving up on one and typing anyway */
  readonly frameSeconds?: number;
  /** arguments after the binary, e.g. `watch` */
  readonly args?: string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly cols?: number;
  readonly rows?: number;
}

export interface Run {
  readonly screen: string;
  /** the same frames with the colour codes taken out, for matching words rather than sequences */
  readonly plain: string;
  readonly exitCode: number | null;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, "g");

export function runBinary(binary: string, options: RunOptions = {}): Run {
  const { keys = "", waitSeconds = 2, args = [], cwd, env = {}, cols = 120, rows = 44 } = options;
  const frameSeconds = options.frameSeconds ?? 30;
  const seconds = options.seconds ?? waitSeconds + 10;

  /**
   * The typescript, written to a file so that the feeder can watch for the screen.
   *
   * `script` has always been handed `/dev/null` here, because the run was read from its stdout. It
   * takes a path, and a path is what turns "wait two seconds and hope" into "wait until it has
   * drawn". The file is the same bytes the test reads back; nothing else uses it.
   */
  const log = `${binary}.typescript`;

  /**
   * Type when the screen exists, not when a stopwatch says so.
   *
   * The proof is that the console has written something past entering the alternate screen — a
   * dozen bytes of prologue go out the instant the process starts, and everything after them is
   * Ink. Deliberately not a box corner: the first frame of a console whose sources have not
   * answered yet is the mark and a line of text, with no panel in it, and waiting for a border
   * there would wait through a screen that was already up.
   *
   * The wait is bounded. A console that never draws is a failure for the test to report in its own
   * words, not a suite that hangs.
   */
  const untilDrawn =
    `i=0; while [ $i -lt ${Math.max(1, Math.round(frameSeconds * 10))} ]; do ` +
    `[ "$(wc -c < ${JSON.stringify(log)} 2>/dev/null || echo 0)" -gt 64 ] && break; sleep 0.1; i=$((i+1)); done`;
  const feed = `(${untilDrawn}; sleep ${waitSeconds}; printf %s ${JSON.stringify(keys)}; sleep 2; printf x; sleep 2)`;
  const tty = `script -qec ${JSON.stringify(`stty cols ${cols} rows ${rows}; ${[binary, ...args].join(" ")}`)} ${JSON.stringify(log)}`;
  const run = Bun.spawnSync({
    // No `timeout` in the pipeline: wrapping `script` in one stops the keystrokes reaching the pty,
    // so every run ended at the deadline and no test could tell a hung console from a quitting one.
    // The deadline is the spawn's own, and the cleanup below is what actually guarantees nothing is
    // left behind — it kills by the binary's path, which is unique to this test's temp directory.
    cmd: ["sh", "-c", `${cwd === undefined ? "" : `cd ${JSON.stringify(cwd)} && `}${feed} | ${tty}`],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...OFFLINE_ENV,
      // Stated rather than inherited: the same binary emits 24-bit codes under a truecolour terminal
      // and 256-colour codes without COLORTERM, which made a colour assertion pass on one machine
      // and fail on the next with nothing about the build having changed.
      COLORTERM: "truecolor",
      TERM: "xterm-256color",
      ...env,
    },
    // The frame wait is added rather than included: `seconds` is the window the caller wants *with*
    // a console on screen, and on a cold runner reaching that point is most of the wall clock.
    timeout: (frameSeconds + seconds + 6) * 1000,
  });

  // Whatever survived the window, by the binary's own path, which is unique to this test's temp dir.
  Bun.spawnSync({ cmd: ["pkill", "-9", "-f", binary], stdout: "ignore", stderr: "ignore" });
  const screen = new TextDecoder().decode(run.stdout);
  return { screen, plain: screen.replace(ANSI, ""), exitCode: run.exitCode };
}
