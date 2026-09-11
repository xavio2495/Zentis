import { expect, test } from "bun:test";
import { LEGS } from "./src/config.js";
import { type TokenHolding, holdingOf, walletCaveats } from "./src/wallet.js";

const leg = LEGS[0]!;

test("committed and free add up to what the wallet holds, because Aqua moves no tokens", () => {
  // ship() and dock() move nothing: Aqua records a balance and pulls from the wallet at
  // settlement against the approval. So the committed amount is still in the wallet's balance,
  // and free is what is left over — never the wallet balance itself.
  const holding = holdingOf({ symbol: "USDC", decimals: 6 }, 18_300_000n, 15_000_000n, 15_000_000n);
  expect(holding.held).toBe(18_300_000n);
  expect(holding.committed).toBe(15_000_000n);
  expect(holding.free).toBe(3_300_000n);
});

test("a position bigger than the wallet leaves no free balance and says the approval is short", () => {
  // A maker who moved tokens out after shipping: Aqua's recorded balance can exceed the wallet's,
  // and the fill that tries to settle will fail. Reporting a negative free balance would hide it.
  const holding = holdingOf({ symbol: "USDC", decimals: 6 }, 10_000_000n, 15_000_000n, 15_000_000n);
  expect(holding.free).toBe(0n);
  expect(holding.shortfall).toBe(5_000_000n);
});

test("an allowance under the committed balance is reported, since the next fill would revert", () => {
  const holding = holdingOf({ symbol: "USDC", decimals: 6 }, 18_300_000n, 15_000_000n, 1_000_000n);
  expect(holding.allowanceShort).toBe(true);
  const caveats = walletCaveats([{ ...holding, chain: leg.label } as never]);
  expect(caveats[0]).toContain("allowance");
  expect(caveats[0]).toContain("Sepolia");
});

test("a healthy holding raises nothing", () => {
  const holding = holdingOf({ symbol: "USDC", decimals: 6 }, 18_300_000n, 15_000_000n, 2n ** 255n);
  expect(holding.allowanceShort).toBe(false);
  expect(holding.shortfall).toBe(0n);
  expect(walletCaveats([{ ...holding, chain: leg.label } as never])).toEqual([]);
});
