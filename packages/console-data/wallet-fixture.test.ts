import { expect, test } from "bun:test";
import { parseWalletFixture } from "./src/wallet.js";

import recorded from "./fixtures/wallet.json" with { type: "json" };

/**
 * The maker's wallet, as the chains really answered.
 *
 * The wallet page has only ever been drawn from synthetic numbers, so the cases that matter — a
 * balance that has fallen below what the position committed, an approval that no longer covers it —
 * have never been rendered against anything real. This is the recorded moment the sandbox uses.
 */
test("the recorded wallet is one moment across three chains, in the legs' own tokens", () => {
  const wallet = parseWalletFixture(recorded as never);
  expect(wallet.maker).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(wallet.chains).toHaveLength(3);
  for (const chain of wallet.chains) {
    for (const token of [chain.tokenA, chain.tokenB]) {
      // Held is the truth; committed is a claim on it, and free is what is left of it.
      expect(token.free).toBe(token.held > token.committed ? token.held - token.committed : 0n);
      expect(token.shortfall).toBe(token.committed > token.held ? token.committed - token.held : 0n);
      expect(token.allowanceShort).toBe(token.allowance < token.committed);
    }
  }
});
