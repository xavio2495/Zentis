import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBinary } from "./testing/binary.js";

/**
 * The driver that types at a compiled console, and the assumption in it that only fails elsewhere.
 *
 * It typed after a fixed two or three seconds and gave the whole run a deadline counted from the
 * moment the process started. On this machine the binary is warm, the page cache is hot and the
 * first frame is up in well under a second, so both numbers were always generous. On a cold CI
 * runner a freshly written hundred-megabyte binary takes longer to reach its first render than the
 * entire deadline allowed: the run was killed at nineteen seconds and the test read back the
 * alternate-screen prologue and nothing else — an empty screen, which reads as a broken pty rather
 * than as a console that was still starting.
 *
 * What the driver should wait for is the thing it needs: a drawn frame, with the interaction window
 * measured from there. This stands a console in for the binary that takes its time getting there,
 * which is the state a cold runner is always in.
 */
const dir = mkdtempSync(join(tmpdir(), "zentis-driver-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A console that enters the alternate screen at once and draws its first frame seconds later. */
const slowConsole = (seconds: number): string => {
  const path = join(dir, `slow-${seconds}.sh`);
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      // The prologue every start writes immediately, before anything is rendered.
      "printf '\\033[?1049h\\033[H\\033[2J'",
      `sleep ${seconds}`,
      "printf '┌ zentis ─────────┐\\n'",
      // Only now is it listening, which is the whole point: a key typed before this is a key typed
      // at a program that has not started reading.
      "char=$(dd bs=1 count=1 2>/dev/null)",
      'printf "pressed:%s\\n" "$char"',
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return path;
};

test("the keys are typed when the screen is there, not when a stopwatch says so", () => {
  // Twenty seconds to the first frame, against a deadline that used to be eighteen from process
  // start. That is the cold-runner shape exactly, and the failure it produced: the run was killed
  // before the console drew anything, so the screen came back holding only the prologue. Here it is
  // deterministic rather than a matter of what else the machine is doing.
  const { screen } = runBinary(slowConsole(20), { keys: "p", waitSeconds: 2 });
  expect(screen).toContain("┌ zentis");
  expect(screen).toContain("pressed:p");
}, 60_000);

test("a console that never draws ends the run rather than hanging on it", () => {
  // The other half: waiting for a frame must not mean waiting forever for one that never comes.
  const path = join(dir, "silent.sh");
  writeFileSync(path, "#!/bin/sh\nprintf '\\033[?1049h'\nsleep 30\n");
  chmodSync(path, 0o755);
  const started = Date.now();
  runBinary(path, { keys: "p", waitSeconds: 0, seconds: 8, frameSeconds: 3 });
  // It gives up on the frame and finishes; the number is loose because what matters is that it
  // returns at all, and well inside the deadline the test itself would hit.
  expect(Date.now() - started).toBeLessThan(45_000);
}, 90_000);

test("the console is handed an environment that is not a CI, whatever the parent's is", () => {
  // Ink decides whether to be interactive before it looks at the tty: `interactive ?? (!isInCi &&
  // isTTY)`, and `is-in-ci` is `'CI' in env && env.CI !== '0' && env.CI !== 'false'`. On a GitHub
  // runner CI=true is set for everything, so Ink ran non-interactive inside a perfectly good pty:
  // no raw mode, no cursor hiding, no repaints — one frame at unmount and every keystroke ignored.
  // The screen came back looking like a pty that had failed, which is where two sessions went
  // looking.
  //
  // Empty string does not clear it: present-but-empty counts as set. Only "0" or "false" do.
  const console = join(dir, "reports-env.sh");
  writeFileSync(
    console,
    [
      "#!/bin/sh",
      "printf '┌ zentis ─────────┐\\n'",
      'printf "CI=[%s] CONTINUOUS_INTEGRATION=[%s]\\n" "$CI" "$CONTINUOUS_INTEGRATION"',
      "",
    ].join("\n"),
  );
  chmodSync(console, 0o755);

  const { screen } = runBinary(console, { keys: "", waitSeconds: 0, seconds: 10, frameSeconds: 5 });
  expect(screen).toContain("CI=[0]");
  expect(screen).toContain("CONTINUOUS_INTEGRATION=[0]");
}, 60_000);
