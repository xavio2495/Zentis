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

/**
 * One reference is one publish across every leg, so the feed shows it as one row.
 *
 * Left raw, the feed spends itself restating the header: three chains times a write a minute buries
 * the fill and the refusals, which are the only rows on this screen that record something changing.
 * References sharing a seq therefore collapse into a single round carrying what each leg's shift
 * became — which is also the shape the demo's beat wants, since the point of the beat is that one
 * publish moved three legs and no transaction touched two of them.
 *
 * The fold is by seq across the whole window rather than by consecutive run. One seq is one
 * decision by construction: the enclave computes a single report and every leg's write carries its
 * number. The legs' writes land seconds apart, and anything landing in between — a fill, a refusal —
 * used to break the run and split one publish into two rows, one claiming a single leg and one
 * claiming two. On a console whose claim is one mid and one book, that is the worst available lie.
 * A round is dated by the last leg to land and carries the span, so a reader can see that the
 * writes are not atomic instead of inferring it from rows that disagree.
 *
 * Fills and refusals never collapse, and keep their own place in time.
 */
export interface FeedRound {
  readonly kind: 'round'
  readonly timestamp: bigint
  readonly seq: number
  /** how many writes were folded in: one per leg that published this seq */
  readonly count: number
  /** seconds between the first and last leg's write; zero when they landed in the same second */
  readonly spanSeconds: number
  readonly legs: { chainId: number; tiltBps: number; mid: bigint; transaction: string }[]
}

export type FeedRow = IndexedFill | IndexedRejection | FeedRound

/**
 * How many rows the screen gives the feed. Shared with the tests so that "the fill and the refusals
 * are visible" is asserted about the feed the operator actually sees, and not about a longer one.
 */
export const FEED_ROWS = 13

export function collapseFeed(events: FeedEvent[], limit: number): FeedRow[] {
  // One pass to gather every leg that published each seq, wherever in the window its write landed.
  const rounds = new Map<number, { newest: bigint; oldest: bigint; legs: FeedRound['legs'] }>()
  for (const event of events) {
    if (event.kind !== 'reference') continue
    const leg = { chainId: event.chainId, tiltBps: event.tiltBps, mid: event.mid, transaction: event.transaction }
    const round = rounds.get(event.seq)
    if (round === undefined) {
      rounds.set(event.seq, { newest: event.timestamp, oldest: event.timestamp, legs: [leg] })
      continue
    }
    round.legs.push(leg)
    if (event.timestamp > round.newest) round.newest = event.timestamp
    if (event.timestamp < round.oldest) round.oldest = event.timestamp
  }

  const rows: FeedRow[] = []
  const emitted = new Set<number>()
  for (const event of events) {
    if (rows.length >= limit) break
    if (event.kind !== 'reference') {
      rows.push(event)
      continue
    }
    // The round takes the place of its newest write, so it sorts where the publish finished and is
    // emitted exactly once however far apart its legs landed.
    if (emitted.has(event.seq)) continue
    const round = rounds.get(event.seq)
    if (round === undefined || event.timestamp !== round.newest) continue
    emitted.add(event.seq)
    rows.push({
      kind: 'round',
      timestamp: round.newest,
      seq: event.seq,
      count: round.legs.length,
      spanSeconds: Number(round.newest - round.oldest),
      legs: round.legs,
    })
  }
  return rows
}

/**
 * A run of consecutive publishes that changed no shift, shown as one row.
 *
 * The workflow publishes every few minutes whether or not anything moved, so the feed filled with
 * the same three shifts row after row, and the rows that record something happening — a fill, a
 * refusal, a shift that actually changed — were pushed off the bottom. Folding happens at display
 * time, never in the snapshot: the chart counts every publish as a tick from the same list.
 */
export interface FeedFold {
  readonly kind: 'fold'
  /** the newest publish in the run, which is where it sits in time order */
  readonly timestamp: bigint
  readonly from: bigint
  readonly to: bigint
  readonly count: number
  readonly firstSeq: number
  readonly lastSeq: number
  readonly legs: FeedRound['legs']
}

export type FoldedRow = FeedRow | FeedFold

const sameShifts = (a: FeedRound, b: FeedRound): boolean =>
	a.legs.length === b.legs.length &&
	a.legs.every((leg) => b.legs.some((other) => other.chainId === leg.chainId && other.tiltBps === leg.tiltBps))

/**
 * The rounds where the published mid changed source rather than moved.
 *
 * On 2026-09-11 the fast workflow moved from per-leg pool mids to one mainnet mid: the published
 * mid jumped twelvefold between two publishes and every leg's shift went into its band. On a feed
 * or a chart that reads as a market event, and it was not one — the shift either side of it was
 * quoted against a different number, so the series is not continuous across it and no statistic
 * should be computed over it.
 *
 * A factor of three either way, which no market reaches between two publishes minutes apart, and
 * which the twelvefold cutover clears easily. Returns the seqs, since that is what a row carries.
 */
export function referenceChanges(rows: readonly FeedRow[]): Set<number> {
	const changed = new Set<number>()
	// Newest first, as the feed is ordered: the row after each one in the list is the one before it
	// in time.
	const rounds = rows.filter((row): row is FeedRound => row.kind === 'round')
	for (let i = 0; i < rounds.length - 1; i += 1) {
		const now = rounds[i]!
		const before = rounds[i + 1]!
		for (const leg of now.legs) {
			const previous = before.legs.find((other) => other.chainId === leg.chainId)
			if (previous === undefined || previous.mid === 0n || leg.mid === 0n) continue
			if (leg.mid > previous.mid * 3n || leg.mid * 3n < previous.mid) changed.add(now.seq)
		}
	}
	return changed
}

export function foldRounds(rows: FeedRow[]): FoldedRow[] {
	const out: FoldedRow[] = []
	for (let i = 0; i < rows.length; ) {
		const row = rows[i]!
		if (row.kind !== 'round') {
			out.push(row)
			i += 1
			continue
		}
		// Only adjacent rounds fold: anything between two identical publishes breaks the run, so the
		// feed's time order survives and a fill is never hidden inside a fold.
		let j = i + 1
		while (j < rows.length) {
			const next = rows[j]!
			if (next.kind !== 'round' || !sameShifts(row, next)) break
			j += 1
		}
		if (j - i === 1) {
			out.push(row)
		} else {
			const run = rows.slice(i, j) as FeedRound[]
			out.push({
				kind: 'fold',
				timestamp: run[0]!.timestamp,
				from: run[run.length - 1]!.timestamp,
				to: run[0]!.timestamp,
				count: run.length,
				firstSeq: run[run.length - 1]!.seq,
				lastSeq: run[0]!.seq,
				legs: row.legs,
			})
		}
		i = j
	}
	return out
}
