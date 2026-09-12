import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * `next start`, but not before the build has finished writing itself.
 *
 * `next build` returns a moment before `.next` is complete, and a server started inside that moment
 * dies on a missing prerender manifest. `bun run build && bun run start` is the command anybody
 * types when they are in a hurry, and the shell's `&&` only knows that the first command exited —
 * not that the filesystem has caught up. It cost a session an afternoon of "both routes 500" that
 * cleared on a rebuild and looked, while it lasted, exactly like a broken page.
 *
 * So: wait for the manifest, then hand every argument through to `next start` unchanged.
 */
const manifest = join(process.cwd(), ".next", "prerender-manifest.json");
const DEADLINE_MS = 60_000;
const started = Date.now();

while (!existsSync(manifest)) {
  if (Date.now() - started > DEADLINE_MS) {
    // Gave up rather than hung: a build that never finishes is a state somebody has to be told
    // about, and a server that waits forever tells nobody anything.
    process.stderr.write(
      `no ${manifest} after ${DEADLINE_MS / 1000}s; run \`bun run build\` first, or wait for the one in flight\n`,
    );
    process.exit(1);
  }
  await Bun.sleep(200);
}

const child = Bun.spawn({
  cmd: ["bun", "x", "next", "start", ...process.argv.slice(2)],
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});
// The signals a server is stopped with, passed on rather than swallowed: without this the wrapper
// dies and leaves the server behind, which is how twenty-two orphaned `next start` processes
// accumulated during one afternoon of audits.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    child.kill();
    process.exit(0);
  });
}
process.exit(await child.exited);
