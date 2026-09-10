import { ASSUMED_GAINS, BOOK, LEGS, PAIR, type LegConfig } from "./config.js";
import { type LegDecomposition, decomposeBook } from "./decompose.js";
import { type FeedEvent, type IndexedPosition, type LegHistory, fetchHistory, mergeFeed } from "./fills.js";
import { type PoolSeries, fetchSeries } from "./pool.js";
import { type LegQuote, type QuoteSet, fetchQuotes } from "./quotes.js";
import { type Finality, type StoredRef, fetchFinality, fetchRef } from "./registry.js";
import { type SpreadStack, midOf, recomputeVolatility, spreadStack } from "./spread.js";
import { type SimReport, loadSimReport } from "./sim.js";

/** Everything one column needs, with the reasons any of it is missing. */
export interface LegSnapshot {
  readonly config: LegConfig;
  readonly position: IndexedPosition | null;
  readonly ref: StoredRef | null;
  readonly series: PoolSeries | null;
  readonly spread: SpreadStack | null;
  readonly shift: LegDecomposition | null;
  readonly quoteAToB: LegQuote | null;
  readonly quoteBToA: LegQuote | null;
  readonly finality: Finality | null;
  /** printed as-is; a missing source is part of the state, not an exception */
  readonly caveats: string[];
}

export interface Snapshot {
  readonly pair: string;
  readonly positionId: `0x${string}`;
  readonly takenAtSeconds: number;
  /** the single seq across the legs, or null when they have drifted apart */
  readonly seq: number | null;
  readonly bookWeightA: bigint;
  readonly gains: typeof ASSUMED_GAINS;
  readonly legs: LegSnapshot[];
  readonly feed: FeedEvent[];
  readonly sim: SimReport;
  readonly caveats: string[];
}

/** The quoted size, in tokenA's own units: small enough to be honest against a 15-unit leg. */
export const QUOTE_SIZE_A = 150_000n;

/**
 * One pass over every source, in parallel, tolerating any of them being down.
 *
 * The console polls this and re-renders; there is no incremental state, because a partial update
 * across five sources of different latencies is how a screen ends up showing two moments at once
 * and calling it one. A whole snapshot is either the state at a moment or it says which part of it
 * could not be read.
 */
export async function takeSnapshot(quoteSize = QUOTE_SIZE_A): Promise<Snapshot> {
  const now = Math.floor(Date.now() / 1000);

  const [histories, refs, series, finalities, aToB, bToA] = await Promise.all([
    Promise.all(LEGS.map((leg) => fetchHistory(leg, BOOK.positionId))),
    Promise.all(LEGS.map((leg) => fetchRef(leg, BOOK.positionId))),
    Promise.all(LEGS.map((leg) => fetchSeries(leg, midOf))),
    Promise.all(LEGS.map((leg) => fetchFinality(leg))),
    fetchQuotes(BOOK.positionId, quoteSize, "AtoB"),
    quoteForB(quoteSize),
  ]);

  const caveats: string[] = [];
  if (aToB.error !== null) caveats.push(`quotes unavailable: ${aToB.error}`);

  // The decomposition is a property of the whole book — the book term reads every leg's weight — so
  // it is computed once over the legs that answered, or not at all. A decomposition over two of
  // three legs would be a different policy's answer, not a partial view of this one's.
  const complete = LEGS.map((leg, i) => ({ leg, history: histories[i]!.value, ref: refs[i]!.value }))
    .filter((entry): entry is { leg: LegConfig; history: LegHistory; ref: StoredRef } =>
      entry.history !== null && entry.ref !== null && entry.history.position !== null);

  let decomposition = null;
  if (complete.length === LEGS.length) {
    decomposition = decomposeBook(complete, ASSUMED_GAINS, BOOK.maxTiltBps);
  } else {
    caveats.push(
      `${LEGS.length - complete.length} of ${LEGS.length} legs could not be read, so the shift is shown as published and not decomposed`,
    );
  }

  const legs = LEGS.map((config, i): LegSnapshot => {
    const history = histories[i]!;
    const ref = refs[i]!;
    const pool = series[i]!;
    const position = history.value?.position ?? null;

    const legCaveats: string[] = [];
    if (history.error !== null) legCaveats.push(`fills subgraph: ${history.error}`);
    if (history.indexingErrors) legCaveats.push("the fills indexer reports errors, so this leg's state may be incomplete");
    if (ref.error !== null) legCaveats.push(`registry: ${ref.error}`);
    if (pool.error !== null) legCaveats.push(`reference pool: ${pool.error}`);
    if (finalities[i]!.error !== null) legCaveats.push(`block heights: ${finalities[i]!.error}`);
    if (position !== null && !position.active) legCaveats.push("this leg is docked, so it holds no committed balance");

    const spread =
      ref.value !== null && position !== null
        ? spreadStack(
            ref.value,
            position,
            BOOK,
            now,
            pool.value === null ? null : recomputeVolatility(pool.value, config, BOOK),
          )
        : null;
    if (spread?.tooStaleToQuote === true) {
      legCaveats.push(
        `the reference is ${spread.referenceAgeSeconds}s old, past this leg's limit of ${position!.maxStalenessSeconds}s, so the router will refuse to price`,
      );
    }

    const shift = decomposition?.legs.find((l) => l.chainId === config.chainId) ?? null;
    if (shift !== null && !shift.agrees) {
      legCaveats.push(
        shift.balancesMatchEnclave
          ? "the recomputed shift differs from the published one although the balances match, so the gains in the enclave are not the ones assumed here"
          : "the recomputed shift differs from the published one because a fill has landed since the enclave priced this leg",
      );
    }

    return {
      config,
      position,
      ref: ref.value,
      series: pool.value,
      spread,
      shift,
      quoteAToB: aToB.value?.quotes.find((q) => q.chainId === config.chainId) ?? null,
      quoteBToA: bToA.value?.quotes.find((q) => q.chainId === config.chainId) ?? null,
      finality: finalities[i]!.value,
      caveats: legCaveats,
    };
  });

  const seqs = new Set(refs.map((r) => r.value?.seq).filter((s): s is number => s !== undefined));
  if (seqs.size > 1) {
    caveats.push("the legs are not on one seq, so they are not currently quoting from one reference");
  }

  return {
    pair: PAIR,
    positionId: BOOK.positionId,
    takenAtSeconds: now,
    seq: seqs.size === 1 ? [...seqs][0]! : null,
    bookWeightA: decomposition?.weightA ?? 0n,
    gains: ASSUMED_GAINS,
    legs,
    feed: mergeFeed(histories.map((h) => h.value).filter((h): h is LegHistory => h !== null), 40),
    sim: loadSimReport(),
    caveats,
  };
}

/**
 * The tokenB side is quoted at whatever a tokenA-sized trade is worth at the first leg's mid, so
 * that both directions ask about the same amount of value rather than the same number of units.
 */
async function quoteForB(quoteSize: bigint) {
  const ref = await fetchRef(LEGS[0]!, BOOK.positionId);
  if (ref.value === null || ref.value.mid === 0n) {
    return { value: null as QuoteSet | null, error: ref.error, indexingErrors: false };
  }
  return fetchQuotes(BOOK.positionId, (quoteSize * ref.value.mid) / 10n ** 18n, "BtoA");
}
