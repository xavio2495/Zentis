import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Build the public console and put it where the site serves it, in that order.
 *
 * The recording is compiled *into* this bundle — the public console reads no endpoint — so the
 * bundle is only true of the moment it was built against. Re-recording the fixtures does not reach
 * the page, and the failure is silent: both files are valid JavaScript, neither is newer in a way a
 * bundler notices, and the site quietly serves one moment on `/console` and another on `/sim`. That
 * happened, and what it showed was the console disagreeing with the enclave by 3 bps on a round
 * where the two in fact agree exactly.
 *
 * So there is one command and the site's build runs it — but not every machine that runs the site's
 * build can do the building. On a deploy the project root is `apps/web`: the siblings are in the
 * checkout and nobody installs them, so `bun build` here would fail and take the deploy with it,
 * for a rebuild that would produce the very file committed beside it. There, the honest step is to
 * *check* rather than build, and to fail loudly if the committed copy is from an older recording.
 * The rebuild belongs where the fixtures change, which is a developer's machine, before the commit.
 *
 * Run: `bun run scripts/publish-console.ts` from `apps/tui`.
 * `ZENTIS_PUBLISH_CONSOLE=check` forces the checking half on a machine that could build.
 */
const here = import.meta.dir;
const built = join(here, "..", "dist", "browser", "console.js");
const served = join(here, "..", "..", "web", "public", "console", "console.js");
const fixtures = join(here, "..", "..", "..", "packages", "console-data", "fixtures", "recorded-at.json");
const stampFile = join(here, "..", "..", "web", "public", "console", "console.stamp.json");
const root = join(here, "..", "..", "..");

/**
 * Everything the bundle is made of.
 *
 * The recorded-at stamp catches a moved recording and nothing else — and the console's own code
 * moves far more often than its fixtures do. The first-run page became three buttons and the served
 * bundle stayed as it was: same moment, older console, every check passing. So what is stamped is
 * the source as well: this console's own tree, the data package it reads, the recording it embeds,
 * and the script that builds it.
 */
const INPUTS = [
  join(here, "..", "src"),
  join(here, "..", "sandbox"),
  join(here, "build-browser.ts"),
  join(here, "..", "..", "..", "packages", "console-data", "src"),
  join(here, "..", "..", "..", "packages", "console-data", "fixtures"),
];

const filesUnder = (path: string): string[] => {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => filesUnder(join(path, entry)));
};

/** One hash over those files, path and content, in a stable order. */
export function inputsHash(): string {
  const digest = createHash("sha256");
  for (const file of INPUTS.flatMap(filesUnder).sort()) {
    digest.update(relative(root, file));
    digest.update(readFileSync(file));
  }
  return digest.digest("hex").slice(0, 16);
}

export interface Stamp {
  readonly recordedAt: number;
  readonly inputs: string;
}

/** What the committed bundle says it was built from, or null when nothing says. */
export function readStamp(): Stamp | null {
  try {
    return JSON.parse(readFileSync(stampFile, "utf8")) as Stamp;
  } catch {
    return null;
  }
}

/** Which half to run: building needs this package's own dependencies to be installed. */
export function decide(env: Record<string, string | undefined>, installed: boolean): "build" | "check" {
  if ((env["ZENTIS_PUBLISH_CONSOLE"] ?? "") === "check") return "check";
  return installed ? "build" : "check";
}

/**
 * The committed bundle is this recording's, or the build stops here.
 *
 * The message names both moments, because the person reading it is reading a failed deploy log with
 * no repository in front of them, and "they differ" is not something anybody can act on.
 */
export function verify(servedText: string, stamp: number): void {
  if (servedText.includes(String(stamp))) return;
  // The stamp is compiled into the bundle as a bare literal, so what identifies the older moment is
  // the epoch second sitting in it — the sandbox's clock, which is the recording's own.
  const older = /\b17\d{8}\b/.exec(servedText)?.[0] ?? "an earlier moment";
  throw new Error(
    `the committed console bundle is from ${older}, not from the recording in this checkout (${stamp}); ` +
      "run `bun run scripts/publish-console.ts` in apps/tui and commit the result",
  );
}

if (import.meta.main) {
  // Guarded, because this module is imported by its own test: a script whose side effects run on
  // import rebuilds the bundle every time somebody asks it a question about itself.
  const stamp = (JSON.parse(readFileSync(fixtures, "utf8")) as { seconds: number }).seconds;
  const mode = decide(process.env, existsSync(join(here, "..", "node_modules")));

  if (mode === "check") {
    verify(readFileSync(served, "utf8"), stamp);
    process.stdout.write(`the committed console bundle is this recording's (${stamp}); not rebuilding here\n`);
  } else if (readStamp()?.inputs === inputsHash() && readStamp()?.recordedAt === stamp) {
    // Nothing it is made of has moved, so rebuilding would write the same bytes over the same file
    // and put a diff in front of whoever ran the build. A build step that dirties the tree every
    // time teaches the person reading `git status` to ignore it, which is how a real change to this
    // artifact goes out unlooked at.
    process.stdout.write(`the committed console bundle is already this source and this recording (${stamp}); nothing to do\n`);
  } else {
    const build = Bun.spawnSync({
      cmd: ["bun", "run", join(here, "build-browser.ts")],
      cwd: join(here, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    process.stdout.write(new TextDecoder().decode(build.stdout));
    if (build.exitCode !== 0) {
      process.stderr.write(new TextDecoder().decode(build.stderr));
      throw new Error("the browser bundle did not build, so nothing was copied");
    }

    mkdirSync(dirname(served), { recursive: true });
    copyFileSync(built, served);
    writeFileSync(stampFile, `${JSON.stringify({ recordedAt: stamp, inputs: inputsHash() }, null, 2)}\n`);
    // Said out loud, because this runs inside a longer build and its whole job is to be current: the
    // stamp is the recording's own, and seeing it is how somebody notices it is not today's.
    process.stdout.write(
      `published the console for the moment recorded at ${stamp} (${new Date(stamp * 1000).toISOString()})\n`,
    );
  }
}
