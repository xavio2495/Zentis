import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runBinary } from "./testing/binary.js";

const dir = mkdtempSync(join(tmpdir(), "zentis-bundle-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const pkg = JSON.parse(readFileSync(join(import.meta.dir, "package.json"), "utf8")) as {
  bin: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
};

// The npm package is run by `npx`/`bunx`, which means node, which cannot read TSX. So the bin has to
// point at a built bundle and the build has to be part of the package's own scripts — a `bin` aimed
// at a source file publishes something that only works on the machine it was written on.
test("the package's bin points at a built bundle, not at source", () => {
  const target = Object.values(pkg.bin)[0]!;
  expect(target).toMatch(/\.js$/);
  expect(target).not.toMatch(/\.tsx?$/);
  expect(pkg.files).toContain("dist");
  expect(pkg.scripts["bundle"]).toContain("--target");
});

test("the node bundle runs the console under node and draws its first frame", () => {
  const bundle = join(dir, "cli.js");
  const build = Bun.spawnSync({
    cmd: ["bun", "build", "src/main.tsx", "--target", "node", "--outfile", bundle],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(new TextDecoder().decode(build.stderr)).not.toContain("error");
  expect(build.exitCode).toBe(0);

  const run = Bun.spawnSync({
    cmd: [
      "sh",
      "-c",
      `(sleep 3; printf x; sleep 2) | script -qec ${JSON.stringify(`stty cols 120 rows 44; node ${bundle} watch`)} /dev/null`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const screen = new TextDecoder().decode(run.stdout);
  expect(screen).toContain("reading the chains");
  expect(screen).not.toContain("Raw mode is not supported");
  expect(run.exitCode).toBe(0);
}, 90_000);

test("`watch` refuses to sign even when an env file is present", () => {
  const binary = join(dir, "zentis");
  const build = Bun.spawnSync({
    cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(build.exitCode).toBe(0);
  expect(statSync(binary).size).toBeGreaterThan(0);

  // The site serves this mode, so it must not become signing-capable because a file happens to be
  // on disk next to it. `watch` drops the env file whatever the environment says. Driven against the
  // recorded fixtures, like every other binary test: a console a test starts must not be able to
  // reach an indexer, and this one used to run for three seconds against the live ones.
  const { screen, exitCode } = runBinary(binary, {
    keys: "r",
    waitSeconds: 3,
    args: ["watch"],
    env: { ZENTIS_ENV: "/dev/null", ZENTIS_FIXTURES: "1" },
  });
  expect(screen).toContain("watch-only");
  expect(screen).not.toContain("press y to broadcast");
  expect(exitCode).toBe(0);
}, 90_000);

test("the compiled binary finds the repository from its working directory, not from its own path", () => {
  const binary = join(dir, "zentis-cwd");
  const build = Bun.spawnSync({
    cmd: ["bun", "build", "--compile", "src/main.tsx", "--outfile", binary],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(build.exitCode).toBe(0);

  const envFile = join(dir, "operator.env");
  writeFileSync(envFile, "CRE_ETH_PRIVATE_KEY=0x00\n");
  const repo = resolve(import.meta.dir, "..", "..");

  // Against the recorded fixtures, so the screen is up immediately and no indexer is read: what this
  // test is about is where the console looks for the scripts, not what the chains say.
  const drive = (cwd: string, env: Record<string, string>) =>
    runBinary(binary, { keys: "r", waitSeconds: 3, cwd, env: { ZENTIS_FIXTURES: "1", ...env } }).screen;

  // Inside the repository the action is offered, and the confirmation is reached.
  const inside = drive(repo, { ZENTIS_ENV: envFile, ZENTIS_GCP_PROJECT: "" });
  expect(inside).toContain("press y to broadcast");

  // Outside it, the keys are disabled with a reason the operator can act on, rather than failing at
  // spawn time after they have already confirmed a broadcast.
  // Outside a checkout, with no cloud project, there is no publisher to ask — so the key is not
  // offered at all rather than offered and refused, and nothing can be confirmed.
  const outside = drive(dir, { ZENTIS_ENV: envFile, ZENTIS_GCP_PROJECT: "" });
  expect(outside).not.toMatch(/r republish|r fast/);
  expect(outside).not.toContain("press y to broadcast");

  const pointed = drive(dir, { ZENTIS_ENV: envFile, ZENTIS_REPO: repo, ZENTIS_GCP_PROJECT: "" });
  expect(pointed).toContain("press y to broadcast");
}, 180_000);

test("a compiled binary's working directories exist, which is what /$bunfs made false", () => {
  const probe = join(dir, "probe");
  const build = Bun.spawnSync({
    cmd: ["bun", "build", "--compile", "scripts/probe-repo-root.ts", "--outfile", probe],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(build.exitCode).toBe(0);

  // Asked of the compiled code, from inside the repository, without pressing the key that would
  // broadcast to find out. A root taken from `import.meta.url` answers `/$bunfs/root/cre`, which
  // does not exist, and the spawn then fails against the command name instead of the directory.
  const out = new TextDecoder().decode(
    Bun.spawnSync({ cmd: [probe], cwd: resolve(import.meta.dir, "..", ".."), stdout: "pipe" }).stdout,
  );

  expect(out).not.toContain("$bunfs");
  expect(out).toContain(`root=${resolve(import.meta.dir, "..", "..")}`);
  for (const key of ["r", "s", "f"]) {
    expect(out).toMatch(new RegExp(`^${key} cwd=\\S+ exists=true$`, "m"));
  }
}, 120_000);
