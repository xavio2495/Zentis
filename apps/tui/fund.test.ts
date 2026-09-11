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
  // it. Aqua pulls the fill's own amount at settlement against this approval, so a fill larger than
  // the allowance reverts on it rather than on price.
  // A wallet fresh from onboarding has approved nothing, which is where this matters.
  const text = said((await drive(190, 50, { scenario: "empty", keys: ["w"] })).lines);
  expect(text).toMatch(/approve/i);
  expect(text).toMatch(/: ?approve sepolia/);
}, 60_000);

test("a chain is told to approve exactly when its allowance no longer covers what it committed", async () => {
  // Asserted against the recorded wallet rather than against a remembered state of it. Three fills
  // on Sepolia spent that leg's allowance down past its committed balance, and the recording after
  // them says so — a test that had learned "the wallet is approved" would have called the console
  // wrong for telling the truth.
  const snapshot = fakeSnapshot("fresh");
  const text = said((await drive(190, 50, { keys: ["w"] })).lines);
  for (const chain of snapshot.wallet!.chains) {
    const name = (chain.chain.split(" ")[0] ?? "").toLowerCase();
    const short = chain.tokenA.allowance < chain.tokenA.committed;
    expect(new RegExp(`: ?approve ${name}\\b`, "i").test(text)).toBe(short);
  }
}, 60_000);

test("a typed approve is the binary signing for itself, for the router that will pull", async () => {
  const frame = await drive(150, 44, { keys: [":", ..."approve sepolia", "ENTER"], armed: true });
  const text = frame.lines.join("\n");
  expect(text).toContain("press y");
  // "broadcast" contains the word; what must not be there is the tool.
  expect(text).not.toMatch(/\bcast /);
}, 60_000);

test("watch-only is told why it cannot approve, and nothing is asked of it", async () => {
  const text = (await drive(150, 44, { keys: [":", ..."approve sepolia", "ENTER"] })).lines.join("\n");
  expect(text).toMatch(/ZENTIS_ENV|watch-only/);
  expect(text).not.toContain("press y");
}, 60_000);
