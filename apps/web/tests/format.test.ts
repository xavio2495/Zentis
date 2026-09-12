import { expect, test } from "bun:test";
import { ago, midAsPrice, shortHash, signedBps, tokenAmount } from "../src/lib/format";

/**
 * Every figure on the console surface carries its scale, because `tiltBps` at BPS = 10,000 sits
 * beside fee figures at 1e7 and rate opcodes at 1e18. A bare number here can be read three ways.
 */
test("a shift keeps its sign, and zero is neither", () => {
  expect(signedBps(-251)).toBe("−251");
  expect(signedBps(227)).toBe("+227");
  expect(signedBps(0)).toBe("0");
});

test("a raw amount becomes the decimal a reader recognises, without eighteen places of noise", () => {
  expect(tokenAmount("150000", 6)).toBe("0.15");
  expect(tokenAmount("57941952335277", 18)).toBe("0.000057942");
  expect(tokenAmount("0", 18)).toBe("0");
});

test("a mid reads as the price the rest of the project quotes", () => {
  // Raw token-B per 1e18 raw token-A, six-decimal USDC against eighteen-decimal WETH.
  expect(midAsPrice("406739534865471949822225588")).toBe("2,459");
});

test("a hash is short enough for a column and long enough to find", () => {
  const hash = "0x227404a1d0d0f1f45ae4b2e05eaf7f4b1ea72c0c47c7dd36ee9a71bc8b9b7f2c";
  expect(shortHash(hash)).toBe("0x227404a1…9b7f2c");
});

test("an age is said the way an operator says it", () => {
  expect(ago(100, 130)).toBe("30s");
  expect(ago(0, 600)).toBe("10m");
  expect(ago(0, 7_200)).toBe("2h0m");
});
