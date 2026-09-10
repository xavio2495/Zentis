import { midFromSqrtPriceX96, type PriceSample } from "@zentis/strategy-sdk";
import { createPublicClient, http, type PublicClient } from "viem";
import type { LegConfig } from "./config.js";
import { type Read, failed, ok } from "./graphql.js";
import type { PoolSeries } from "./pool.js";

/**
 * Each leg's reference-pool price and its history, read from the chain rather than the subgraph.
 *
 * The reference-pools subgraph lives on Subgraph Studio, whose allowance is 3,000 queries per three
 * hours per endpoint and is shared with the fills subgraph and both workflows. The price does not
 * need it: the pools are Uniswap v3 pools, so the current price is one `slot0()` call and the
 * history is the pool's own `Swap` logs. Both are ordinary RPC.
 *
 * The first read backfills the volatility window; every read after that asks only for the blocks
 * since the last one, which is a single small `eth_getLogs` per leg. The public RPCs return
 * `blockTimestamp` on each log, so the history costs one call per chunk rather than one per swap.
 */

const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

const SLOT0 = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * `Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1,
 * uint160 sqrtPriceX96, uint128 liquidity, int24 tick)` — the data is the five non-indexed words, of
 * which the price is the third and the liquidity the fourth.
 */
export function decodeSwapData(data: string): { sqrtPriceX96: bigint; liquidity: bigint } {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const wordAt = (i: number) => BigInt(`0x${hex.slice(i * 64, (i + 1) * 64)}`);
  return { sqrtPriceX96: wordAt(2), liquidity: wordAt(3) };
}

/**
 * The block-range limit an RPC states when it refuses an `eth_getLogs`, or null if it states none.
 *
 * Measured: publicnode's Sepolia refuses past 50,000 blocks, Base Sepolia's past 10,000, Arbitrum
 * Sepolia's accepted 500,000. Each says so in different words, and reading the number out saves
 * halving blindly down to it.
 */
export function rangeLimitFrom(message: string): number | null {
  // Anchored on the sentence, never on the first number in the text: viem wraps the RPC's message
  // after an HTTP status and a request body full of hex block numbers, and the first number there
  // is the status code. Reading `413` as the limit made the Base backfill ~730 calls long.
  const patterns = [
    /limited to (?:a )?(\d[\d,]*)\s*(?:block )?range/i,
    /maximum block range:?\s*(\d[\d,]*)/i,
    /block range (?:is )?(?:limited to|exceeds?|of)\s*(\d[\d,]*)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match !== null) return Number(match[1]!.replace(/,/g, ""));
  }
  return null;
}

/** Newest first, deduplicated, and no older than `windowSeconds` behind the newest. */
export function mergeWindow(
  existing: PriceSample[],
  incoming: PriceSample[],
  windowSeconds: bigint,
): PriceSample[] {
  const seen = new Set<string>();
  const merged = [...incoming, ...existing]
    .sort((a, b) => (a.timestamp === b.timestamp ? 0 : a.timestamp > b.timestamp ? -1 : 1))
    .filter((s) => {
      const key = `${s.timestamp}:${s.mid}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const newest = merged[0]?.timestamp;
  return newest === undefined ? [] : merged.filter((s) => newest - s.timestamp <= windowSeconds);
}

/**
 * A log's own timestamp, or null when it cannot be believed.
 *
 * Sepolia's and Base's RPCs fill `blockTimestamp` on each log with the real block time. Arbitrum
 * Sepolia's includes the key and sets it to `0x0`. Checking only that the field is present passed
 * that as a timestamp, dated every Arbitrum swap to 1970, and the week-long window then discarded
 * all of them — the leg drew as a single point. Zero is not a block time.
 */
export function trustedTimestamp(log: { blockTimestamp?: string }): bigint | null {
  if (log.blockTimestamp === undefined) return null;
  const value = BigInt(log.blockTimestamp);
  return value > 0n ? value : null;
}

/**
 * A block's time from the nearest blocks whose times are known, clamped at the ends.
 *
 * Used only past the cap on exact lookups, so a busy pool cannot turn one read into thousands of
 * `eth_getBlockByNumber` calls. Clamped rather than extrapolated: a swap placed beyond the newest
 * known block would be drawn in the future.
 */
export function interpolateTime(block: bigint, anchors: Map<bigint, bigint>): bigint {
  const known = [...anchors.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (known.length === 0) return 0n;
  if (block <= known[0]![0]) return known[0]![1];
  if (block >= known[known.length - 1]![0]) return known[known.length - 1]![1];
  for (let i = 1; i < known.length; i += 1) {
    const [hiBlock, hiTime] = known[i]!;
    if (block > hiBlock) continue;
    const [loBlock, loTime] = known[i - 1]!;
    if (hiBlock === loBlock) return loTime;
    return loTime + ((hiTime - loTime) * (block - loBlock)) / (hiBlock - loBlock);
  }
  return known[known.length - 1]![1];
}

/** How many distinct blocks one read will look up exactly before interpolating the rest. */
const MAX_BLOCK_LOOKUPS = 200;
const LOOKUP_CONCURRENCY = 8;

/** raw tokenB per 1e18 raw tokenA, for a pool that orders the pair the other way. */
export const invertMid = (mid: bigint): bigint => (mid === 0n ? 0n : 10n ** 36n / mid);

interface LegState {
  samples: PriceSample[];
  lastBlock: bigint | null;
  /** the widest `eth_getLogs` range this RPC has accepted, learned from its refusals */
  chunk: bigint;
  /** whether the pool's token0 is the leg's tokenA; checked once, because a reversed pool inverts */
  aligned: boolean | null;
  /** the live-price sample appended at the head, replaced each read rather than accumulated */
  head: PriceSample | null;
  /** block times already looked up, kept so an incremental read never asks twice */
  blockTimes: Map<bigint, bigint>;
}

const START_CHUNK = 500_000n;

export interface PriceReader {
  /**
   * The leg's price history, as far as it has been read.
   *
   * Returns within `budgetMs` whatever happens. The first read backfills a week — fifteen seconds on
   * Base, whose RPC allows only 10,000 blocks per call — and a console that waited on it would show
   * nothing at all for that long. A read that overruns keeps going in the background and lands in
   * the next poll; until the first one lands the reader says it is still reading rather than failing.
   */
  read(leg: LegConfig, windowSeconds: bigint, budgetMs?: number): Promise<Read<PoolSeries>>;
}

/** What a read that has not finished its first backfill reports, so the screen can say so plainly. */
export const BACKFILLING = "reading a week of swaps from the chain…";

export function createPriceReader(
  clientFor: (leg: LegConfig) => PublicClient = (leg) =>
    createPublicClient({ transport: http(leg.rpcUrl, { timeout: 20_000 }) }) as PublicClient,
): PriceReader {
  const states = new Map<number, LegState>();
  const clients = new Map<number, PublicClient>();

  const pending = new Map<number, Promise<Read<PoolSeries>>>();
  const latest = new Map<number, Read<PoolSeries>>();

  const work = async (leg: LegConfig, windowSeconds: bigint): Promise<Read<PoolSeries>> => {
    {
      const client = clients.get(leg.chainId) ?? clientFor(leg);
      clients.set(leg.chainId, client);
      const state: LegState = states.get(leg.chainId) ?? {
        samples: [],
        lastBlock: null,
        chunk: START_CHUNK,
        aligned: null,
        head: null,
        blockTimes: new Map(),
      };
      states.set(leg.chainId, state);

      try {
        const pool = leg.referencePool;
        if (state.aligned === null) {
          const token0 = await client.readContract({ address: pool, abi: SLOT0, functionName: "token0" });
          state.aligned = token0.toLowerCase() === leg.tokenA.address.toLowerCase();
        }
        const toMid = (sqrt: bigint) => {
          const mid = midFromSqrtPriceX96(sqrt);
          return state.aligned === false ? invertMid(mid) : mid;
        };

        const head = await client.getBlock({ blockTag: "latest" });
        const [slot0, liquidity] = await Promise.all([
          client.readContract({ address: pool, abi: SLOT0, functionName: "slot0" }),
          client.readContract({ address: pool, abi: SLOT0, functionName: "liquidity" }),
        ]);

        // Where to start. On the first read, far enough back to cover the window, estimated from
        // the chain's own block time; after that, the block after the last one read.
        let from: bigint;
        if (state.lastBlock === null) {
          const probe = head.number > 10_000n ? head.number - 10_000n : 0n;
          const earlier = await client.getBlock({ blockNumber: probe });
          const secondsPerBlock =
            Number(head.timestamp - earlier.timestamp) / Math.max(1, Number(head.number - probe));
          const span = BigInt(Math.ceil(Number(windowSeconds) / Math.max(secondsPerBlock, 0.01)));
          from = head.number > span ? head.number - span : 0n;
        } else {
          from = state.lastBlock + 1n;
        }

        const raw: { block: bigint; time: bigint | null; sqrt: bigint }[] = [];
        let cursor = from;
        while (cursor <= head.number) {
          const to = cursor + state.chunk - 1n < head.number ? cursor + state.chunk - 1n : head.number;
          let logs: { data: string; blockTimestamp?: string; blockNumber: string }[];
          try {
            logs = (await client.request({
              method: "eth_getLogs",
              params: [
                {
                  address: pool,
                  topics: [SWAP_TOPIC],
                  fromBlock: `0x${cursor.toString(16)}`,
                  toBlock: `0x${to.toString(16)}`,
                },
              ],
            } as never)) as typeof logs;
          } catch (cause) {
            // A refusal that names its limit is taken at its word; one that does not is halved.
            // Either way the chunk is remembered, so the next read does not rediscover it.
            const stated = rangeLimitFrom(String(cause));
            const next = stated === null ? state.chunk / 2n : BigInt(Math.max(1, stated - 1));
            if (next < 1n || next >= state.chunk) throw cause;
            state.chunk = next;
            continue;
          }
          for (const log of logs) {
            raw.push({
              block: BigInt(log.blockNumber),
              time: trustedTimestamp(log),
              sqrt: decodeSwapData(log.data).sqrtPriceX96,
            });
          }
          cursor = to + 1n;
        }

        // Blocks whose logs did not carry a believable time are looked up, a few at a time and at
        // most MAX_BLOCK_LOOKUPS per read; anything past that is interpolated between the blocks
        // that are known. The head is always an anchor.
        state.blockTimes.set(head.number, head.timestamp);
        const unknown = [...new Set(raw.filter((r) => r.time === null).map((r) => r.block))].filter(
          (block) => !state.blockTimes.has(block),
        );
        const lookups = unknown.slice(0, MAX_BLOCK_LOOKUPS);
        for (let i = 0; i < lookups.length; i += LOOKUP_CONCURRENCY) {
          const batch = lookups.slice(i, i + LOOKUP_CONCURRENCY);
          const blocks = await Promise.all(batch.map((blockNumber) => client.getBlock({ blockNumber })));
          for (const block of blocks) state.blockTimes.set(block.number, block.timestamp);
        }

        const incoming: PriceSample[] = [];
        let lastSwapAt: bigint | null = null;
        for (const r of raw) {
          const at = r.time ?? state.blockTimes.get(r.block) ?? interpolateTime(r.block, state.blockTimes);
          incoming.push({ timestamp: at, mid: toMid(r.sqrt) });
          lastSwapAt = lastSwapAt === null || at > lastSwapAt ? at : lastSwapAt;
        }
        state.lastBlock = head.number;

        // The live price as of the head, so the line runs to "now" even when nobody has swapped
        // since. It replaces any earlier head sample rather than piling up one per poll.
        const now: PriceSample = { timestamp: head.timestamp, mid: toMid(slot0[0]) };
        const swaps = state.samples.filter((s) => s !== state.head);
        state.samples = mergeWindow(swaps, [...incoming, now], windowSeconds);
        state.head = state.samples.find((s) => s.timestamp === now.timestamp && s.mid === now.mid) ?? null;

        return ok({
          mid: now.mid,
          liquidity,
          updatedAtTimestamp: lastSwapAt ?? swaps[0]?.timestamp ?? head.timestamp,
          samples: state.samples,
        });
      } catch (cause) {
        return failed(`could not read ${leg.label}'s reference pool over RPC: ${String(cause).slice(0, 160)}`);
      }
    }
  };

  return {
    async read(leg, windowSeconds, budgetMs = 2_500) {
      // One read in flight per leg; a second request joins it rather than racing it, which would
      // fetch the same blocks twice and could land them out of order.
      let running = pending.get(leg.chainId);
      if (running === undefined) {
        running = work(leg, windowSeconds).then((result) => {
          latest.set(leg.chainId, result);
          pending.delete(leg.chainId);
          return result;
        });
        pending.set(leg.chainId, running);
      }
      const overran = Symbol("overran");
      const settled = await Promise.race([
        running,
        new Promise<typeof overran>((resolve) => setTimeout(() => resolve(overran), budgetMs)),
      ]);
      if (settled !== overran) return settled;
      return latest.get(leg.chainId) ?? failed(BACKFILLING);
    },
  };
}
