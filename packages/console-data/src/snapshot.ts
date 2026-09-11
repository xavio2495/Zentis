import { ASSUMED_GAINS, BOOK, LEGS, PAIR, type LegConfig } from "./config.js";
import { CADENCE_MS, type Cache, createCache } from "./cache.js";
import { type LegDecomposition, decomposeBook } from "./decompose.js";
import { type FeedRow, type IndexedPosition, type LegHistory, collapseFeed, fetchHistory, mergeFeed } from "./fills.js";
import type { PoolSeries } from "./pool.js";
import { type PriceReader, createPriceReader } from "./prices.js";
import { type LegQuote, type QuoteSet, fetchQuotes } from "./quotes.js";
import { type Finality, type StoredRef, fetchFinality, fetchRef } from "./registry.js";
import { type SpreadStack, recomputeVolatility, spreadStack } from "./spread.js";
import { type SimReport, loadSimReport } from "./sim.js";
import { ok } from "./graphql.js";
import { humanDuration } from "./duration.js";
import { type Mark, fetchMarks } from "./mark.js";
import { type LegPnl, legPnl } from "./pnl.js";
import { type Wallet, fetchWallet } from "./wallet.js";
import { type BookTotals, bookTotals } from "./book.js";

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
  /** what this leg's inventory and PnL are valued at; null when the mark could not be read */
  readonly mark: Mark | null;
  readonly pnl: LegPnl | null;
  /**
   * Why each source is missing, when it is.
   *
   * A null `position` means "docked and gone" and "could not be read" equally, and rendering the
   * second as the first tells a viewer the position is absent when it is merely unread. The screen
   * keys its wording off these rather than off the nulls.
   */
  readonly sources: {
    readonly fills: string | null;
    readonly registry: string | null;
    readonly pool: string | null;
  };
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
  /** collapsed: one publish across the legs is one row, so fills and refusals are not crowded out */
  readonly feed: FeedRow[];
  readonly sim: SimReport;
  /** the whole book on one row: inventory, lean and profit, for the overall view */
  readonly book: BookTotals;
  /** the maker's own side; null when no chain answered */
  readonly wallet: Wallet | null;
  readonly caveats: string[];
}

/** The quoted size, in tokenA's own units: small enough to be honest against a 15-unit leg. */
export const QUOTE_SIZE_A = 150_000n;

/** How many collapsed feed rows a snapshot keeps: several screens' worth, for the chart and the fold. */
export const FEED_HISTORY = 120;

/**
 * One pass over every source, in parallel, tolerating any of them being down.
 *
 * The console polls this and re-renders; there is no incremental state, because a partial update
 * across five sources of different latencies is how a screen ends up showing two moments at once
 * and calling it one. A whole snapshot is either the state at a moment or it says which part of it
 * could not be read.
 */
export async function takeSnapshot(
  quoteSize = QUOTE_SIZE_A,
  cache: Cache = createCache(),
  prices: PriceReader = createPriceReader(),
): Promise<Snapshot> {
  const now = Math.floor(Date.now() / 1000);

  // Every read goes through the cache, which decides whether it is due and keeps the last good
  // value when an endpoint refuses. The reference-pool series is the expensive one — a thousand
  // swaps covering a week — and is read every ten minutes rather than every poll.
  const [histories, refs, series, finalities, aToB, bToA] = await Promise.all([
    Promise.all(
      LEGS.map((leg) => cache.get(`fills:${leg.chainId}`, CADENCE_MS.fills, () => fetchHistory(leg, BOOK.positionId))),
    ),
    Promise.all(
      LEGS.map((leg) => cache.get(`ref:${leg.chainId}`, CADENCE_MS.registry, () => fetchRef(leg, BOOK.positionId))),
    ),
    Promise.all(
      // Read from the chain, not the reference-pools subgraph: `slot0()` for the price and the pool's
      // own `Swap` logs for the history. The subgraph's allowance is shared with the fills and both
      // workflows, and a price chart has no business spending it.
      LEGS.map((leg) =>
        cache.get(`pool:${leg.chainId}`, CADENCE_MS.pool, () =>
          prices.read(leg, BigInt(BOOK.volatilityWindowSeconds)),
        ),
      ),
    ),
    Promise.all(
      LEGS.map((leg) => cache.get(`finality:${leg.chainId}`, CADENCE_MS.finality, () => fetchFinality(leg))),
    ),
    cache.get("quotes:AtoB", CADENCE_MS.quotes, () => fetchQuotes(BOOK.positionId, quoteSize, "AtoB")),
    cache.get("quotes:BtoA", CADENCE_MS.quotes, () => quoteForB(quoteSize)),
  ]);

  // The mark and the wallet are read on the fills cadence: neither moves faster than a minute in
  // any way a reader acts on, and both cost a round trip per leg.
  const [marks, wallet] = await Promise.all([
    cache.get("mark", CADENCE_MS.fills, () => fetchMarks()),
    cache.get<Wallet>("wallet", CADENCE_MS.fills, async () => ok(await fetchWallet(LEGS, BOOK.maker))),
  ]);

  const caveats: string[] = [];
  if (aToB.error !== null) caveats.push(`quotes unavailable: ${aToB.error}`);
  if (marks.error !== null) caveats.push(`the mainnet mark: ${marks.error}`);
  if (wallet.error !== null) caveats.push(`the maker's wallet: ${wallet.error}`);

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
    // An error beside a surviving value means the console is showing what it last knew. Saying how
    // old that is turns a silently frozen panel into an honest one.
    const staleness = (label: string, read: { error: string | null; value: unknown; ageSeconds: number }) =>
      read.error !== null && read.value !== null
        ? `${label} unavailable (${read.error}); showing what was read ${read.ageSeconds}s ago`
        : read.error !== null
          ? `${label}: ${read.error}`
          : null;
    for (const caveat of [
      staleness("fills subgraph", history),
      staleness("registry", ref),
      staleness("reference pool", pool),
      staleness("block heights", finalities[i]!),
    ]) {
      if (caveat !== null) legCaveats.push(caveat);
    }
    if (history.indexingErrors) {
      legCaveats.push("the fills indexer reports errors, so this leg's state may be incomplete");
    }
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
        `the reference is ${humanDuration(spread.referenceAgeSeconds)} old, past this leg's limit of ` +
          `${humanDuration(position!.maxStalenessSeconds)}, so the router refuses to price`,
      );
    }

    const mark = marks.value?.get(config.chainId) ?? null;
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
      mark,
      pnl:
        history.value === null
          ? null
          : legPnl(history.value, config.shipped, mark?.mid ?? null, config.shipped.markAtShip),
      sources: {
        fills: history.value === null ? history.error : null,
        registry: ref.value === null ? ref.error : null,
        pool: pool.value === null ? pool.error : null,
      },
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
    feed: collapseFeed(
      mergeFeed(histories.map((h) => h.value).filter((h): h is LegHistory => h !== null), 200),
      // Kept longer than any screen shows: the feed folds unchanged publishes at display time, and
      // the chart draws every publish in its window as a tick, so both need the history behind the
      // rows that happen to be visible.
      FEED_HISTORY,
    ),
    sim: loadSimReport(),
    book: bookTotals(legs),
    wallet: wallet.value,
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
