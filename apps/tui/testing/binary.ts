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
  /** how long the console is allowed to live, including its own shutdown; derived when not given */
  readonly seconds?: number;
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
  // The deadline has to outlast the keystrokes it is there to backstop, or every run reports the
  // timeout's own exit code and no test can tell a hung console from a slow one.
  const feed = `(sleep ${waitSeconds}; printf %s ${JSON.stringify(keys)}; sleep 2; printf x; sleep 2)`;
  const seconds = options.seconds ?? waitSeconds + 10;
  const tty = `script -qec ${JSON.stringify(`stty cols ${cols} rows ${rows}; ${[binary, ...args].join(" ")}`)} /dev/null`;
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
    timeout: (seconds + 6) * 1000,
  });

  // Whatever survived the window, by the binary's own path, which is unique to this test's temp dir.
  Bun.spawnSync({ cmd: ["pkill", "-9", "-f", binary], stdout: "ignore", stderr: "ignore" });
  const screen = new TextDecoder().decode(run.stdout);
  return { screen, plain: screen.replace(ANSI, ""), exitCode: run.exitCode };
}
