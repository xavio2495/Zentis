import type { Action, ActionCommand } from "./actions.js";

export interface RunResult {
  readonly exitCode: number;
  /** the last few lines of combined output, which is what fits on the screen */
  readonly tail: string;
}

/** How many trailing lines of a child's output the actions row keeps. */
export const TAIL_LINES = 3;

const lastLines = (text: string, count: number): string =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .slice(-count)
    .join(" · ");

/**
 * Runs an action's command and returns what it said.
 *
 * The child gets `stdin: "ignore"`. A child inheriting this process's stdin would be reading from a
 * terminal in raw mode that Ink is also reading, and the two would take alternate keystrokes — the
 * console would stop responding for reasons that look nothing like their cause.
 *
 * Output is captured rather than inherited for the same sort of reason: a `forge` progress bar
 * writing straight to the terminal would scribble over a screen Ink believes it owns.
 */
export async function run(command: ActionCommand): Promise<RunResult> {
  const child = Bun.spawn({
    cmd: command.cmd,
    cwd: command.cwd,
    // The parent's environment is passed through so `cre` and `forge` are found on PATH; the extra
    // entries are the ones built from the deployment records. Nothing read from the env file is
    // here — that file is opened by the child, never by this process.
    env: { ...process.env, ...command.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  const combined = `${stdout}\n${stderr}`;
  return { exitCode, tail: lastLines(combined, TAIL_LINES) };
}

/**
 * What the actions row says once a command has finished.
 *
 * A zero exit is reported as "finished", not as "succeeded": the simulator prints a green result and
 * exits zero even when the forwarder rejected the report, so the console would be vouching for
 * something it has not checked. What it can vouch for is the next poll, where a write that landed
 * shows up as a new seq.
 */
export const summarise = (action: Action, result: RunResult): string =>
  result.exitCode === 0
    ? `${action.label} finished — watch the feed for the write to land`
    : `${action.label} exited ${result.exitCode}: ${result.tail}`;
