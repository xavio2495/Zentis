import { expect, test } from "bun:test";
import { BOOK } from "@zentis/console-data";
import { drive } from "./sandbox/drive.js";
import { roleOf } from "./src/role.js";

/**
 * What a stranger meets on first run.
 *
 * Three choices and nothing else: make a wallet, point at one, or watch. Everything the console can
 * do afterwards follows from which address it ends up holding — nobody is asked to choose a role,
 * because the chain already decided it.
 */
/** The frame as prose: wrapped lines rejoined, so a sentence is matched rather than a row. */
const said = (lines: string[]) => lines.join(" ").replace(/[│┌┐╰╯─]/g, " ").replace(/\s+/g, " ");

test("with no wallet and no env file, the console opens on the choice rather than the live view", async () => {
  const frame = await drive(120, 40, { onboarding: true });
  const text = said(frame.lines);
  // Three buttons, all three offered at once; the words belong to whichever is under the cursor.
  expect(text).toMatch(/make a wallet/i);
  expect(text).toMatch(/use my own key/i);
  expect(text).toMatch(/watch only/i);
  // And the cursor starts on the first, so its own title is the one being explained.
  expect(text).toMatch(/make one here/i);
  // Not the live view: no cards, no feed, until one of the three is chosen.
  expect(frame.lines.join("\n")).not.toContain("┌ feed");
  expect(frame.overflows).toBe(false);
}, 60_000);

test("choosing to watch goes straight to the live view, with nothing that signs", async () => {
  const text = (await drive(120, 40, { onboarding: true, keys: ["3"] })).lines.join("\n");
  expect(text).toContain("┌ feed");
  expect(text).toContain("watch-only");
}, 60_000);

test("the page says what generating one will do before it does it", async () => {
  const text = said((await drive(120, 40, { onboarding: true })).lines);
  expect(text).toMatch(/\.zentis\/wallet\.env/);
  // The two facts that matter about a key file, said before it exists rather than after.
  expect(text).toMatch(/600/);
  expect(text).toMatch(/not be shown again|never shown/i);
}, 60_000);

test("a role is read off the address, never chosen", () => {
  expect(roleOf(BOOK.maker)).toBe("maker");
  expect(roleOf("0x000000000000000000000000000000000000dEaD")).toBe("taker");
  expect(roleOf(null)).toBe("watcher");
  // Case is not identity: an address is the same address however it is written.
  expect(roleOf(BOOK.maker.toLowerCase() as `0x${string}`)).toBe("maker");
});

test("the status page says which role the console is in, and why", async () => {
  const text = (await drive(190, 50, { keys: ["d"] })).lines.join("\n");
  expect(text).toMatch(/role\s+(watcher|taker|maker)/);
}, 60_000);

test("after a wallet is made there is a way forward, and it does not involve quitting", async () => {
  // Live, this page made a wallet and then offered nothing: the only route to using it was to quit
  // and start again, which is not a route, and the user had to be told it.
  const made = said((await drive(120, 40, { onboarding: true, keys: ["1"] })).lines);
  expect(made).toMatch(/enter to continue/i);

  const continued = (await drive(120, 40, { onboarding: true, keys: ["1", "ENTER"] })).lines.join("\n");
  expect(continued).toContain("┌ feed");
  expect(continued).not.toContain("no wallet yet");
}, 120_000);

test("choosing to watch after making a wallet uses the wallet, because it exists now", async () => {
  const continued = (await drive(120, 40, { onboarding: true, keys: ["1", "3"] })).lines.join("\n");
  expect(continued).toContain("┌ feed");
}, 120_000);

test("the address is the first thing under the choices, and is never cut", async () => {
  const lines = (await drive(80, 24, { onboarding: true, keys: ["1"] })).lines;
  const shown = lines.map((l) => l.replace(/[│┌┐╰╯]/g, "").trimEnd());
  const addressAt = shown.findIndex((l) => /0x[0-9a-fA-F]{40}/.test(l));
  expect(addressAt).toBeGreaterThan(-1);
  // The address is what a reader has to copy into a faucet, so it is whole and it is first.
  expect(shown[addressAt]).not.toContain("…");
  // Before everything the child said about it, and before the way forward: the choices above
  // mention the path too, so this is anchored on what follows the address rather than precedes it.
  const forwardAt = shown.findIndex((l) => /enter to continue/i.test(l));
  expect(addressAt).toBeLessThan(forwardAt);
  expect(shown[addressAt + 1]).toMatch(/written|mode 600/);
}, 60_000);
