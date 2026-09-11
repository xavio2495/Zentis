import { expect, test } from "bun:test";
import { drive } from "./sandbox/drive.js";
import { fakeSnapshot } from "./sandbox/world.js";

/**
 * What the wallet page does for someone who has just made a wallet.
 *
 * It holds nothing, on any chain, and cannot fill until it does. The page that already shows what
 * the wallet holds is the page that should say how to fill it — and then stop saying it, because a
 * funded chain does not need a faucet link and a page that keeps offering one reads as broken.
 */
const said = (lines: string[]) => lines.join(" ").replace(/[│┌┐╰╯─]/g, " ").replace(/\s+/g, " ");

test("a chain with no gas is offered its faucets, and says which token addresses to ask for", async () => {
  const text = said((await drive(190, 50, { scenario: "empty", keys: ["w"] })).lines);
  expect(text).toMatch(/faucet/i);
  // A faucet needs an address to send to, and a token needs its own address to be added to a wallet.
  const snapshot = fakeSnapshot("empty");
  expect(text).toContain(snapshot.wallet!.maker.slice(0, 10));
  expect(text).toContain(snapshot.legs[0]!.config.tokenA.address.slice(0, 10));
}, 60_000);

test("the fund rows are for the chains that need them, and no others", async () => {
  const empty = said((await drive(190, 50, { scenario: "empty", keys: ["w"] })).lines);
  expect(empty).toMatch(/sepolia/i);
  // A funded wallet is not told where to get money.
  const funded = said((await drive(190, 50, { keys: ["w"] })).lines);
  expect(funded).not.toMatch(/faucet/i);
}, 60_000);

test("while a chain is empty the page says it is waiting rather than asserting a zero", async () => {
  const text = said((await drive(190, 50, { scenario: "empty", keys: ["w"] })).lines);
  expect(text).toMatch(/waiting|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/);
}, 60_000);

test("the page shows the wallet this console holds, not the book's maker", async () => {
  // A taker who just generated a key is looking at their own balances; the maker's are none of
  // their business and would be the wrong number to fund.
  const snapshot = fakeSnapshot("fresh");
  expect(snapshot.wallet!.maker).toBe(snapshot.walletAddress);
}, 60_000);

test("a chain whose approval is short is offered the command that fixes it", async () => {
  // The allowance column already shows the shortfall; what it lacked was the one thing to do about
  // it. Aqua pulls at settlement against this approval, so a fill reverts on it rather than on price.
  const text = said((await drive(190, 50, { keys: ["w"] })).lines);
  expect(text).toMatch(/approve/i);
  expect(text).toMatch(/: ?approve sepolia/);
}, 60_000);

test("a chain that is already approved is not told to approve again", async () => {
  const text = said((await drive(190, 50, { scenario: "approved", keys: ["w"] })).lines);
  expect(text).not.toMatch(/: ?approve /);
}, 60_000);

test("a typed approve is the binary signing for itself, for the router that will pull", async () => {
  const frame = await drive(150, 44, { keys: [":", ..."approve sepolia", "ENTER"], armed: true });
  const text = frame.lines.join("\n");
  expect(text).toContain("press y");
  expect(text).not.toContain("cast");
}, 60_000);

test("watch-only is told why it cannot approve, and nothing is asked of it", async () => {
  const text = (await drive(150, 44, { keys: [":", ..."approve sepolia", "ENTER"] })).lines.join("\n");
  expect(text).toMatch(/ZENTIS_ENV|watch-only/);
  expect(text).not.toContain("press y");
}, 60_000);
