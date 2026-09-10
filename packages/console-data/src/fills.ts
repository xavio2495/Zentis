import { type Read, failed, ok, query } from "./graphql.js";
import type { LegConfig } from "./config.js";

/** The leg's indexed state. Balances are the live ones; the deployment record's are the shipped ones. */
export interface IndexedPosition {
  readonly strategyHash: string;
  readonly active: boolean;
  readonly balanceA: bigint;
  readonly balanceB: bigint;
  readonly maxTiltBps: number;
  readonly maxStalenessSeconds: number;
  readonly widenBpsPerMinute: number;
  readonly maxWidenBps: number;
  readonly fillCount: number;
  /** false means no reference had been published, which is not the same as a reference of zero */
  readonly hasReference: boolean;
  readonly refMid: bigint | null;
  readonly refTiltBps: number | null;
  readonly refSeq: number | null;
  readonly refUpdatedAt: bigint | null;
}

export interface IndexedFill {
  readonly kind: "fill";
  readonly chainId: number;
  readonly timestamp: bigint;
  readonly transaction: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly isAToB: boolean;
  readonly hasReference: boolean;
  readonly refMid: bigint | null;
  readonly refTiltBps: number | null;
  readonly refSeq: number | null;
  readonly refAgeSeconds: bigint | null;
}

export interface IndexedReference {
  readonly kind: "reference";
  readonly chainId: number;
  readonly timestamp: bigint;
  readonly transaction: string;
  readonly mid: bigint;
  readonly tiltBps: number;
  readonly seq: number;
  readonly updatedAt: bigint;
}

export interface IndexedRejection {
  readonly kind: "rejection";
  readonly chainId: number;
  readonly timestamp: bigint;
  readonly transaction: string;
  /** printed verbatim: `stale seq` and `bad timestamp` are part of the story, not noise */
  readonly reason: string;
}

export type FeedEvent = IndexedFill | IndexedReference | IndexedRejection;

export interface LegHistory {
  readonly position: IndexedPosition | null;
  readonly fills: IndexedFill[];
  readonly references: IndexedReference[];
  readonly rejections: IndexedRejection[];
}

interface RawPosition {
  strategyHash: string;
  active: boolean;
  balanceA: string;
  balanceB: string;
  maxTiltBps: number;
  maxStalenessSeconds: number;
  widenBpsPerMinute: number;
  maxWidenBps: number;
  fillCount: number;
  hasReference: boolean;
  refMid: string | null;
  refTiltBps: number | null;
  refSeq: number | null;
  refUpdatedAt: string | null;
}

interface RawHistory {
  position: RawPosition | null;
  fills: {
    timestamp: string;
    transaction: string;
    amountIn: string;
    amountOut: string;
    isAToB: boolean;
    hasReference: boolean;
    refMid: string | null;
    refTiltBps: number | null;
    refSeq: number | null;
    refAgeSeconds: string | null;
  }[];
  references: {
    timestamp: string;
    transaction: string;
    mid: string;
    tiltBps: number;
    seq: number;
    updatedAt: string;
  }[];
  rejections: { timestamp: string; transaction: string; reason: string }[];
}

const big = (v: string | null): bigint | null => (v === null ? null : BigInt(v));

/**
 * `positionId` addresses the same leg on every chain, so the same query text serves all three and
 * the console joins them by asking each endpoint for one id. Histories are bounded by `first`
 * because the feed shows the recent past, not the archive.
 */
export const historyQuery = (positionId: string, first: number): string => `
  position(id: ${JSON.stringify(positionId)}) {
    strategyHash active balanceA balanceB
    maxTiltBps maxStalenessSeconds widenBpsPerMinute maxWidenBps fillCount
    hasReference refMid refTiltBps refSeq refUpdatedAt
  }
  fills(where: { position: ${JSON.stringify(positionId)} }, orderBy: timestamp, orderDirection: desc, first: ${first}) {
    timestamp transaction amountIn amountOut isAToB
    hasReference refMid refTiltBps refSeq refAgeSeconds
  }
  references(where: { positionId: ${JSON.stringify(positionId)} }, orderBy: timestamp, orderDirection: desc, first: ${first}) {
    timestamp transaction mid tiltBps seq updatedAt
  }
  rejections: rejectedReferences(where: { positionId: ${JSON.stringify(positionId)} }, orderBy: timestamp, orderDirection: desc, first: ${first}) {
    timestamp transaction reason
  }
`;

export function parseHistory(chainId: number, raw: RawHistory): LegHistory {
  const p = raw.position;
  return {
    position:
      p === null
        ? null
        : {
            strategyHash: p.strategyHash,
            active: p.active,
            balanceA: BigInt(p.balanceA),
            balanceB: BigInt(p.balanceB),
            maxTiltBps: p.maxTiltBps,
            maxStalenessSeconds: p.maxStalenessSeconds,
            widenBpsPerMinute: p.widenBpsPerMinute,
            maxWidenBps: p.maxWidenBps,
            fillCount: p.fillCount,
            hasReference: p.hasReference,
            // Only meaningful behind hasReference: a nullable Int in this schema reads back as 0,
            // so "no reference existed" and "the reference said zero" are told apart by the flag.
            refMid: p.hasReference ? big(p.refMid) : null,
            refTiltBps: p.hasReference ? p.refTiltBps : null,
            refSeq: p.hasReference ? p.refSeq : null,
            refUpdatedAt: p.hasReference ? big(p.refUpdatedAt) : null,
          },
    fills: raw.fills.map((f) => ({
      kind: "fill" as const,
      chainId,
      timestamp: BigInt(f.timestamp),
      transaction: f.transaction,
      amountIn: BigInt(f.amountIn),
      amountOut: BigInt(f.amountOut),
      isAToB: f.isAToB,
      hasReference: f.hasReference,
      refMid: f.hasReference ? big(f.refMid) : null,
      refTiltBps: f.hasReference ? f.refTiltBps : null,
      refSeq: f.hasReference ? f.refSeq : null,
      refAgeSeconds: f.hasReference ? big(f.refAgeSeconds) : null,
    })),
    references: raw.references.map((r) => ({
      kind: "reference" as const,
      chainId,
      timestamp: BigInt(r.timestamp),
      transaction: r.transaction,
      mid: BigInt(r.mid),
      tiltBps: r.tiltBps,
      seq: r.seq,
      updatedAt: BigInt(r.updatedAt),
    })),
    rejections: raw.rejections.map((r) => ({
      kind: "rejection" as const,
      chainId,
      timestamp: BigInt(r.timestamp),
      transaction: r.transaction,
      reason: r.reason,
    })),
  };
}

export async function fetchHistory(
  leg: LegConfig,
  positionId: string,
  first = 25,
): Promise<Read<LegHistory>> {
  const read = await query<RawHistory>(leg.fillsSubgraphUrl, historyQuery(positionId, first));
  if (read.value === null) return failed(read.error ?? "the fills subgraph returned nothing");
  return ok(parseHistory(leg.chainId, read.value), read.indexingErrors);
}

/** The feed is one list across three chains, so it is merged by the only clock they share. */
export const mergeFeed = (histories: LegHistory[], limit: number): FeedEvent[] =>
  histories
    .flatMap((h): FeedEvent[] => [...h.fills, ...h.references, ...h.rejections])
    .sort((a, b) => (b.timestamp === a.timestamp ? 0 : b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, limit);
