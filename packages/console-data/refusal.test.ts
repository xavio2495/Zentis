import { expect, test } from "bun:test";
import { parseQuote, refusalSentence } from "./src/quotes.js";

const raw = {
  chainId: 11155111,
  chain: "sepolia",
  amountIn: "413000000000000",
  amountOut: null,
  tokenIn: null,
  tokenOut: null,
  reason: null,
  refMid: null,
  tiltBps: null,
  seq: null,
  refAgeSeconds: null,
  caveats: [],
};

test("a quote from a service that predates refusals reads as having none", () => {
  expect(parseQuote(raw).refusal).toBeNull();
});

test("the decoded refusal is kept whole, keyed by the contract's own error name", () => {
  const refusal = {
    error: "ZentisOutsideBand",
    args: ["29720000000000000000000000", "30730000000000000000000000", "false"],
    sentence: "outside the band: the maker would sell tokenA for 322 bps less tokenB than the floor allows",
  };
  expect(parseQuote({ ...raw, refusal }).refusal).toEqual(refusal);
});

test("the service has no symbols, so the leg's own token names go into its sentence", () => {
  const sentence = refusalSentence(
    { error: "ZentisOutsideBand", args: [], sentence: "the maker would sell tokenA for 322 bps less tokenB than the floor allows" },
    "USDC",
    "WETH",
  );
  expect(sentence).toBe("the maker would sell USDC for 322 bps less WETH than the floor allows");
});
