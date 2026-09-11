import { expect, test } from "bun:test";
import { LEGS, QUOTE_SIZE_A } from "@zentis/console-data";
import { decodeFunctionData, toFunctionSelector } from "viem";
import { SWAP_ABI, approveRequest, quoteRequest, swapRequest } from "./src/intents.js";

/**
 * What the console asks a chain to do, as transaction requests rather than shell commands.
 *
 * `cast` was a developer toolchain standing between this console and every signed action; a device
 * that has the binary does not have Foundry. These are the same calls, built with the viem the
 * binary already carries — and the order and taker bytes are still the recorded ones, never rebuilt.
 */
const leg = LEGS.find((l) => l.name === "sepolia")!;

test("a swap is the router's own signature, carrying the recorded order unchanged", () => {
  const request = swapRequest(leg, { amountRaw: QUOTE_SIZE_A, isAToB: true });
  expect(request.to).toBe(leg.fill!.router);
  expect(request.value).toBe(0n);
  // The selector comes from the signature the deployment record carries, not from a name typed here.
  expect(request.data.slice(0, 10)).toBe(toFunctionSelector(leg.fill!.swapSignature));
  // And what was encoded decodes back to the recorded order, field for field.
  const decoded = decodeFunctionData({ abi: SWAP_ABI, data: request.data });
  const [order, amountIn, takerData] = decoded.args as [
    { maker: string; traits: bigint; data: string },
    bigint,
    string,
  ];
  expect(order.maker.toLowerCase()).toBe(leg.fill!.order.maker.toLowerCase());
  expect(order.traits).toBe(BigInt(leg.fill!.order.traits));
  expect(order.data).toBe(leg.fill!.order.data);
  expect(amountIn).toBe(QUOTE_SIZE_A);
  expect(takerData).toBe(leg.fill!.takerDataAToB);
});

test("the other side of the book carries the other side's taker data", () => {
  const request = swapRequest(leg, { amountRaw: 10n ** 15n, isAToB: false });
  const [, , takerData] = decodeFunctionData({ abi: SWAP_ABI, data: request.data }).args as [unknown, bigint, string];
  expect(takerData).toBe(leg.fill!.takerDataBToA);
});

test("a quote is the same call, declared as the view it is", () => {
  const request = quoteRequest(leg, { amountRaw: QUOTE_SIZE_A, isAToB: true });
  expect(request.to).toBe(leg.fill!.router);
  const quoteSignature = leg.fill!.swapSignature.replace(/^swap/, "quote") + "(uint256,uint256,bytes32)";
  expect(request.data.slice(0, 10)).toBe(toFunctionSelector(quoteSignature));
});

test("an approval names its spender and its amount, and nothing else", () => {
  const request = approveRequest(leg.tokenA.address, leg.fill!.router, 150_000n);
  expect(request.to).toBe(leg.tokenA.address);
  expect(request.data.slice(0, 10)).toBe(toFunctionSelector("approve(address,uint256)"));
  expect(request.value).toBe(0n);
});

test("a leg with no recorded bytes cannot be asked to swap", () => {
  expect(() => swapRequest({ ...leg, fill: null }, { amountRaw: 1n, isAToB: true })).toThrow(/no fill bytes/);
});
