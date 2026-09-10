import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      `(sleep 3; printf x; sleep 2) | script -qec ${JSON.stringify(`node ${bundle} watch`)} /dev/null`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const screen = new TextDecoder().decode(run.stdout);
  expect(screen).toContain("reading three chains");
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
  // on disk next to it. `watch` drops the env file whatever the environment says.
  const run = Bun.spawnSync({
    cmd: [
      "sh",
      "-c",
      `(sleep 3; printf r; sleep 2; printf x; sleep 2) | ZENTIS_ENV=/dev/null script -qec ${JSON.stringify(`${binary} watch`)} /dev/null`,
    ],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const screen = new TextDecoder().decode(run.stdout);
  expect(screen).toContain("watch-only");
  expect(screen).not.toContain("press y to broadcast");
  expect(run.exitCode).toBe(0);
}, 90_000);
