import { ASSUMED_GAINS, BOOK, LEGS, PAIR, POOL_RETIRED, type LegConfig } from "./config.js";
import { type LegHistory, collapseFeed, mergeFeed, parseHistory } from "./fills.js";
import { type MarkHistory, parseMarkHistory } from "./market.js";
import { type Mark } from "./mark.js";
import { type LegQuote, parseQuote } from "./quotes.js";
import { type StoredRef } from "./registry.js";
import { FEED_HISTORY, type Snapshot, type LegSnapshot } from "./snapshot.js";
import { decomposeBook } from "./decompose.js";
import { midOf, recomputeVolatility, spreadStack } from "./spread.js";
import { parseSeries } from "./pool.js";
import { legPnl } from "./pnl.js";
import { loadSimReport } from "./sim.js";
import { bookTotals } from "./book.js";
import { parseWalletFixture } from "./wallet.js";

import historySepolia from "../fixtures/history-sepolia.json" with { type: "json" };
import historyArbitrum from "../fixtures/history-arbitrum-sepolia.json" with { type: "json" };
import historyBase from "../fixtures/history-base-sepolia.json" with { type: "json" };
import refSepolia from "../fixtures/ref-sepolia.json" with { type: "json" };
import refArbitrum from "../fixtures/ref-arbitrum-sepolia.json" with { type: "json" };
import refBase from "../fixtures/ref-base-sepolia.json" with { type: "json" };
import poolSepolia from "../fixtures/pool-sepolia.json" with { type: "json" };
import markFixture from "../fixtures/mark.json" with { type: "json" };
import quotesAToB from "../fixtures/quotes-atob.json" with { type: "json" };
import quotesBToA from "../fixtures/quotes-btoa.json" with { type: "json" };
import quoteSizes from "../fixtures/quote-sizes.json" with { type: "json" };
import market168 from "../fixtures/market-168h.json" with { type: "json" };
import market6 from "../fixtures/market-6h.json" with { type: "json" };
import recordedWallet from "../fixtures/wallet.json" with { type: "json" };
import recordedAt from "../fixtures/recorded-at.json" with { type: "json" };

/**
 * The recorded moment, assembled by the same functions the live console assembles it with.
 *
 * Three surfaces draw this moment: the console under `ZENTIS_FIXTURES`, the public console the site
 * serves, and the web replay. If each derived its own numbers from these fixtures they would drift
 * apart the first time one of them was edited, and the difference would be invisible — two screens
 * showing the same book, disagreeing by a basis point nobody could account for.
 *
 * So it is built once, here, out of `takeSnapshot`'s own parts: `decomposeBook` for the shift,
 * `spreadStack` for the spread, `legPnl` for the PnL, `collapseFeed` for the feed, `bookTotals` for
 * the book. Nothing is constructed for the look of it — the sandbox world is where a synthetic fill
 * and a drawn market series belong, because what that world exists to test is a layout.
 *
 * Every fixture here was read from a real endpoint at one moment, and the recorder refuses to stamp
 * a moment whose legs are on different sequences.
 */
export interface RecordedMoment {
  readonly snapshot: Snapshot;
  /** the two sides of the recorded quote: 0.15 USDC, and the WETH the mark said that was */
  readonly quoteSizes: { readonly amountInA: bigint; readonly amountInB: bigint };
  /**
   * The short window of the market, which the service draws per swap rather than hourly.
   *
   * Kept beside the snapshot rather than in it because a snapshot holds one series — the window the
   * console asked for — and a surface that offers both windows needs the other one to hand.
   */
  readonly recentMarket: MarkHistory | null;
}

const histories: Record<number, unknown> = {
  11155111: historySepolia,
  421614: historyArbitrum,
  84532: historyBase,
};
const refs: Record<number, { mid: string; updatedAt: string; refBalanceA: string; dTiltPerA: string }> = {
  11155111: refSepolia,
  421614: refArbitrum,
  84532: refBase,
};
/** Only Sepolia still has a reference pool; the other two were retired for one mainnet mid. */
const pools: Record<number, unknown> = { 11155111: poolSepolia };

const storedRef = (chainId: number): StoredRef => {
  const raw = refs[chainId] as unknown as StoredRef & {
    mid: string;
    updatedAt: string;
    refBalanceA: string;
    dTiltPerA: string;
  };
  return {
    ...raw,
    mid: BigInt(raw.mid),
    updatedAt: BigInt(raw.updatedAt),
    refBalanceA: BigInt(raw.refBalanceA),
    dTiltPerA: BigInt(raw.dTiltPerA),
  };
};

const marks = (): Map<number, Mark> => {
  const out = new Map<number, Mark>();
  for (const raw of (markFixture as { marks: { chainId: number; mainnetChainId: number; mid: string | null; source: string; readAtSeconds: number | null; error: string | null }[] }).marks) {
    if (raw.mid === null) continue;
    out.set(raw.chainId, {
      mainnetChainId: raw.mainnetChainId,
      mid: BigInt(raw.mid),
      source: raw.source,
      readAtSeconds: raw.readAtSeconds,
      error: raw.error,
    });
  }
  return out;
};

const quoteFor = (side: typeof quotesAToB, chainId: number): LegQuote | null => {
  const raw = (side as { quotes: Parameters<typeof parseQuote>[0][] }).quotes.find((q) => q.chainId === chainId);
  return raw === undefined ? null : parseQuote(raw);
};

export function recordedMoment(): RecordedMoment {
  const now = (recordedAt as { seconds: number }).seconds;
  const marked = marks();

  const parsed = LEGS.map((leg: LegConfig) => ({
    leg,
    history: parseHistory(leg.chainId, histories[leg.chainId] as never) as LegHistory,
    ref: storedRef(leg.chainId),
  }));

  const book = decomposeBook(parsed, ASSUMED_GAINS, BOOK.maxTiltBps);

  const legs: LegSnapshot[] = parsed.map((entry) => {
    const recordedPool = pools[entry.leg.chainId];
    const series = recordedPool === undefined ? null : parseSeries(recordedPool as never, midOf);
    const position = entry.history.position;
    const spread =
      position === null
        ? null
        : spreadStack(
            entry.ref,
            position,
            BOOK,
            now,
            series === null ? null : recomputeVolatility(series, entry.leg, BOOK),
          );
    const mark = marked.get(entry.leg.chainId) ?? null;
    return {
      config: entry.leg,
      position,
      ref: entry.ref,
      series,
      spread,
      shift: book.legs.find((l) => l.chainId === entry.leg.chainId) ?? null,
      quoteAToB: quoteFor(quotesAToB, entry.leg.chainId),
      quoteBToA: quoteFor(quotesBToA, entry.leg.chainId),
      // Not recorded: finality is a pair of block numbers read per poll, and a recorded pair would
      // be stale the second after it was written. The screens that use it say so when it is absent.
      finality: null,
      mark,
      pnl:
        mark === null
          ? null
          : legPnl(entry.history, entry.leg.shipped, mark.mid, entry.leg.shipped.markAtShip, entry.leg.generations),
      sources: {
        fills: null,
        registry: null,
        pool: series === null ? POOL_RETIRED : null,
        fillsQuota: null,
      },
      caveats: [],
    };
  });

  const snapshot: Snapshot = {
    pair: PAIR,
    positionId: BOOK.positionId,
    takenAtSeconds: now,
    seq: book.seq,
    bookWeightA: book.weightA,
    gains: ASSUMED_GAINS,
    legs,
    feed: collapseFeed(mergeFeed(parsed.map((entry) => entry.history), FEED_HISTORY), FEED_HISTORY),
    sim: loadSimReport(),
    book: bookTotals(legs),
    wallet: parseWalletFixture(recordedWallet as never),
    walletAddress: BOOK.maker,
    // Said in the data rather than by whichever surface draws it: a recording that does not carry
    // this sentence is one somebody will eventually present as a live read.
    caveats: ["recorded testnet reads, not live: every figure here was read at one moment and committed"],
    market: parseMarkHistory(market168 as never),
  };

  return {
    snapshot,
    quoteSizes: {
      amountInA: BigInt((quoteSizes as { amountInA: string }).amountInA),
      amountInB: BigInt((quoteSizes as { amountInB: string }).amountInB),
    },
    recentMarket: parseMarkHistory(market6 as never),
  };
}
