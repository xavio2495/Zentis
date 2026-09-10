import { expect, test } from "bun:test";
import { decodeSwapData, invertMid, mergeWindow, rangeLimitFrom } from "./src/prices.js";

const word = (v: bigint) => (v < 0n ? (1n << 256n) + v : v).toString(16).padStart(64, "0");

test("a Swap log's data decodes to the price and liquidity it carries", () => {
  // data is abi.encode(int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
  const sqrt = 1558891114935227120975015310626977n;
  const liquidity = 294013957027927n;
  const data = `0x${word(-150000n)}${word(4000000000000n)}${word(sqrt)}${word(liquidity)}${word(-201234n)}`;
  expect(decodeSwapData(data)).toEqual({ sqrtPriceX96: sqrt, liquidity });
});

test("an RPC's block-range limit is read out of its refusal, whichever wording it uses", () => {
  // The three public RPCs refuse an oversized eth_getLogs in three different ways; the limit is the
  // number in the message, and reading it saves halving blindly down to it.
  expect(rangeLimitFrom("exceed maximum block range: 50000")).toBe(50_000);
  expect(rangeLimitFrom("eth_getLogs is limited to a 10,000 range")).toBe(10_000);
  expect(rangeLimitFrom("query returned more than 10000 results")).toBe(null);
  expect(rangeLimitFrom("rate limited")).toBe(null);
});

test("new samples are merged in, the window is enforced, and the result is newest first", () => {
  const existing = [
    { timestamp: 900n, mid: 1n },
    { timestamp: 100n, mid: 2n },
  ];
  const incoming = [
    { timestamp: 1000n, mid: 3n },
    { timestamp: 950n, mid: 4n },
  ];
  // A 500-second window from the newest (1000) keeps 500 and later.
  expect(mergeWindow(existing, incoming, 500n)).toEqual([
    { timestamp: 1000n, mid: 3n },
    { timestamp: 950n, mid: 4n },
    { timestamp: 900n, mid: 1n },
  ]);
});

test("a sample already held is not added twice when a range is re-read", () => {
  const held = [{ timestamp: 900n, mid: 1n }];
  expect(mergeWindow(held, [{ timestamp: 900n, mid: 1n }], 1000n)).toHaveLength(1);
});

test("a pool whose token0 is not the leg's tokenA has its price inverted, not reported backwards", () => {
  // mid is raw tokenB per 1e18 raw tokenA. A pool that orders the pair the other way reports the
  // reciprocal, and drawing it uninverted would draw every rise as a fall.
  const mid = 2n * 10n ** 18n;
  expect(invertMid(mid)).toBe(5n * 10n ** 17n);
  expect(invertMid(invertMid(mid))).toBe(mid);
});

import { interpolateTime, trustedTimestamp } from "./src/prices.js";

test("a log timestamp of zero is not believed", () => {
  // Arbitrum Sepolia's RPC returns `blockTimestamp: "0x0"` on every log: the key is present and the
  // value is empty. Taking it at its word dated every Arbitrum swap to 1970, and the week-long
  // window then discarded all of them, which drew the leg as a single point.
  expect(trustedTimestamp({ blockTimestamp: "0x0" })).toBeNull();
  expect(trustedTimestamp({})).toBeNull();
  expect(trustedTimestamp({ blockTimestamp: "0x6a9c7e2c" })).toBe(0x6a9c7e2cn);
});

test("a block's time is interpolated between the nearest blocks whose times are known", () => {
  const anchors = new Map<bigint, bigint>([
    [1000n, 10_000n],
    [2000n, 20_000n],
  ]);
  expect(interpolateTime(1500n, anchors)).toBe(15_000n);
  expect(interpolateTime(1000n, anchors)).toBe(10_000n);
  // Outside the anchors it is clamped to the nearest one rather than extrapolated into the future.
  expect(interpolateTime(2500n, anchors)).toBe(20_000n);
  expect(interpolateTime(500n, anchors)).toBe(10_000n);
});

test("the range limit is read from the sentence that states it, not from the first number in the error", () => {
  // viem wraps Base's refusal as `HTTP request failed. Status: 413 ... Request body: {...0x2c7a...}
  // Details: {..."eth_getLogs is limited to a 10,000 range"}`. Taking the first number read the HTTP
  // status, set the chunk to 412 blocks, and turned a 31-call backfill into ~730 calls and 200 s.
  const wrapped =
    'HttpRequestError: HTTP request failed. Status: 413 URL: https://sepolia.base.org Request body: ' +
    '{"method":"eth_getLogs","params":[{"fromBlock":"0x2c7a1b3","toBlock":"0x2cb2c1f"}]} ' +
    'Details: {"code":-32614,"message":"eth_getLogs is limited to a 10,000 range"} Version: viem@2.34.0';
  expect(rangeLimitFrom(wrapped)).toBe(10_000);
  expect(rangeLimitFrom('Details: {"code":-32701,"message":"exceed maximum block range: 50000"}')).toBe(50_000);
  // A refusal that names no limit is halved from, never guessed at from an unrelated number.
  expect(rangeLimitFrom("HTTP request failed. Status: 413 Request body: range 0x1f4 to 0x3e8")).toBeNull();
});

import { BACKFILLING, createPriceReader } from "./src/prices.js";
import { LEGS } from "./src/config.js";

/** A chain that answers after `delayMs`, with one swap in its history. */
const slowChain = (delayMs: number) => {
  const wait = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), delayMs));
  const sqrt = 1n << 96n; // mid of exactly 1e18
  return {
    readContract: ({ functionName }: { functionName: string }) =>
      wait(
        functionName === "token0"
          ? LEGS[0]!.tokenA.address
          : functionName === "slot0"
            ? [sqrt, 0, 0, 0, 0, 0, true]
            : 1000n,
      ),
    getBlock: ({ blockNumber }: { blockNumber?: bigint } = {}) =>
      wait({ number: blockNumber ?? 20_000n, timestamp: blockNumber === undefined ? 200_000n : 100_000n }),
    request: () =>
      wait([
        {
          blockNumber: "0x4e20",
          blockTimestamp: "0x30d40",
          data: `0x${"0".repeat(128)}${sqrt.toString(16).padStart(64, "0")}${"0".repeat(128)}`,
        },
      ]),
  } as never;
};

test("a slow first read returns within its budget and says it is still reading", async () => {
  // Base's backfill takes ~15 s. A console that waited on it would draw nothing for that long.
  const reader = createPriceReader(() => slowChain(300));
  const started = Date.now();
  const first = await reader.read(LEGS[0]!, 604_800n, 100);
  expect(Date.now() - started).toBeLessThan(250);
  expect(first.value).toBeNull();
  expect(first.error).toBe(BACKFILLING);
});

test("the overrunning read keeps going, and the next read returns what it found", async () => {
  const reader = createPriceReader(() => slowChain(40));
  await reader.read(LEGS[0]!, 604_800n, 1); // starts the backfill, returns at once
  await new Promise((resolve) => setTimeout(resolve, 600));
  const later = await reader.read(LEGS[0]!, 604_800n, 2_000);
  expect(later.error).toBeNull();
  expect(later.value!.samples.length).toBeGreaterThan(0);
  expect(later.value!.mid).toBe(10n ** 18n);
});
