import { createPublicClient, http } from "viem";
import { type Read, failed, ok } from "./graphql.js";
import type { LegConfig } from "./config.js";

/**
 * The reference slot, read from the chain rather than from the index.
 *
 * The fills subgraph carries only mid, tilt, seq and updatedAt, because those are what a fill needs.
 * The spread stack and the boundary live nowhere but this struct, and the boundary is what caps the
 * concession, so the decomposition cannot be recomputed without reading it here.
 */
export interface StoredRef {
  readonly mid: bigint;
  readonly spreadBps: number;
  readonly tiltBps: number;
  /** timestamp of the block the workflow queried, not of the write */
  readonly updatedAt: bigint;
  readonly seq: number;
  readonly refBalanceA: bigint;
  readonly dTiltPerA: bigint;
  readonly maxExtrapBps: number;
  readonly markoutBps: number;
  /** the impulse boundary; the room to concede is this less the shift already quoted */
  readonly bandEdgeBps: number;
}

const REF_OF = [
  {
    type: "function",
    name: "refOf",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "mid", type: "uint128" },
          { name: "spreadBps", type: "uint16" },
          { name: "tiltBps", type: "int16" },
          { name: "updatedAt", type: "uint40" },
          { name: "seq", type: "uint32" },
          { name: "refBalanceA", type: "uint128" },
          { name: "dTiltPerA", type: "int64" },
          { name: "maxExtrapBps", type: "uint32" },
          { name: "markoutBps", type: "uint16" },
          { name: "bandEdgeBps", type: "uint16" },
        ],
      },
    ],
  },
] as const;

export async function fetchRef(leg: LegConfig, positionId: `0x${string}`): Promise<Read<StoredRef>> {
  const client = createPublicClient({ transport: http(leg.rpcUrl, { timeout: 15_000 }) });
  try {
    const raw = await client.readContract({
      address: leg.registry,
      abi: REF_OF,
      functionName: "refOf",
      args: [positionId],
    });
    return ok({
      mid: raw.mid,
      spreadBps: raw.spreadBps,
      tiltBps: raw.tiltBps,
      updatedAt: BigInt(raw.updatedAt),
      seq: raw.seq,
      refBalanceA: raw.refBalanceA,
      dTiltPerA: raw.dTiltPerA,
      maxExtrapBps: raw.maxExtrapBps,
      markoutBps: raw.markoutBps,
      bandEdgeBps: raw.bandEdgeBps,
    });
  } catch (cause) {
    return failed(`could not read ${leg.label}'s registry: ${String(cause)}`);
  }
}

export interface Finality {
  readonly head: bigint;
  readonly finalized: bigint;
}

/**
 * The countdown behind the demo's pause: the fast workflow prices from finalized state, so a fill
 * changes nothing it can see until the block it landed in is final. Reading both heights is what
 * lets the screen say how far off that is instead of "waiting".
 */
export async function fetchFinality(leg: LegConfig): Promise<Read<Finality>> {
  const client = createPublicClient({ transport: http(leg.rpcUrl, { timeout: 15_000 }) });
  try {
    const [head, finalized] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.getBlock({ blockTag: "finalized" }),
    ]);
    return ok({ head: head.number, finalized: finalized.number });
  } catch (cause) {
    return failed(`could not read ${leg.label}'s block heights: ${String(cause)}`);
  }
}
