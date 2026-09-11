import { expect, test } from "bun:test";
import { buildActions, publisherMode } from "./src/actions.js";
import { drive } from "./sandbox/drive.js";

/**
 * Republishing is the operator's, and is hidden from everyone else.
 *
 * The workflows run on their own every five minutes. A reader who cannot reach a publisher has no
 * use for a key that would ask one to run, and a key shown as disabled is still a key they will try:
 * it teaches them that the console is holding something back from them, which it is not — everything
 * else here is theirs, including filling and pushing with their own keys.
 */
test("the console knows which publisher it can reach, if any", () => {
  expect(publisherMode("/tmp/env", "/repo", "zentis-cg1-2026")).toBe("cloud");
  expect(publisherMode("/tmp/env", "/repo", "")).toBe("local");
  // A checkout without a key cannot run cre, so that is not a publisher either.
  expect(publisherMode(null, "/repo", "")).toBe("none");
  expect(publisherMode("/tmp/env", null, "")).toBe("none");
});

test("with no publisher the republish actions do not exist at all", () => {
  const actions = buildActions(null, null, "");
  expect(actions.find((a) => a.key === "r")).toBeUndefined();
  expect(actions.find((a) => a.key === "s")).toBeUndefined();
  // Everything a non-operator does have is still there.
  expect(actions.find((a) => a.key === "q")).toBeDefined();
});

test("with a publisher they are back, and they run", () => {
  const cloud = buildActions(null, null, "zentis-cg1-2026");
  expect(cloud.find((a) => a.key === "r")!.command).not.toBeNull();
  expect(cloud.find((a) => a.key === "s")!.command).not.toBeNull();
});

test("the keys row offers no republish to someone who cannot reach a publisher", async () => {
  const watching = (await drive(120, 40, { publisher: "none" })).lines.join("\n");
  expect(watching).not.toMatch(/\br (republish|fast)\b/);
  expect(watching).not.toMatch(/\bs (republish|slow)\b/);
  // And the rest of the console is untouched.
  expect(watching).toMatch(/q (re-quote|quote)/);
  expect(watching).toMatch(/d status/);

  const operator = (await drive(120, 40, { publisher: "cloud" })).lines.join("\n");
  expect(operator).toMatch(/r (republish |fast)/);
}, 120_000);

test("pressing r without a publisher does nothing at all, rather than explaining itself", async () => {
  const before = (await drive(120, 40, { publisher: "none" })).lines.join("\n");
  const after = (await drive(120, 40, { publisher: "none", keys: ["r"] })).lines.join("\n");
  expect(after).toBe(before);
  expect(after).not.toMatch(/republish/);
}, 120_000);

test("a typed republish is answered with why it is not offered, not with a stack of reasons", async () => {
  const text = (await drive(150, 44, { publisher: "none", keys: [":", ..."republish fast", "ENTER"] })).lines.join("\n");
  expect(text).toContain("operator action");
  expect(text).toMatch(/every five minutes/);
  expect(text).not.toContain("ZENTIS_GCP_PROJECT");
}, 60_000);

test("the status page says which publisher the console is on, including none", async () => {
  const none = (await drive(190, 50, { publisher: "none", keys: ["d"] })).lines.join("\n");
  expect(none).toMatch(/publisher\s+none|publisher: none/);
  const cloud = (await drive(190, 50, { publisher: "cloud", keys: ["d"] })).lines.join("\n");
  expect(cloud).toMatch(/publisher.*cloud/);
}, 120_000);
