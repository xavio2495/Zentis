import type { Snapshot } from "@zentis/console-data";
import { ASSUMED_GAINS, BOOK, LEGS, PAIR, decomposeBook, loadSimReport, parseHistory, collapseFeed, mergeFeed, spreadStack, midOf, parseSeries, recomputeVolatility } from "@zentis/console-data";
import historySepolia from "../../../packages/console-data/fixtures/history-sepolia.json" with { type: "json" };
import historyArbitrum from "../../../packages/console-data/fixtures/history-arbitrum-sepolia.json" with { type: "json" };
import historyBase from "../../../packages/console-data/fixtures/history-base-sepolia.json" with { type: "json" };
import poolSepolia from "../../../packages/console-data/fixtures/pool-sepolia.json" with { type: "json" };
import poolArbitrum from "../../../packages/console-data/fixtures/pool-arbitrum-sepolia.json" with { type: "json" };
import poolBase from "../../../packages/console-data/fixtures/pool-base-sepolia.json" with { type: "json" };
import refSepolia from "../../../packages/console-data/fixtures/ref-sepolia.json" with { type: "json" };
import refArbitrum from "../../../packages/console-data/fixtures/ref-arbitrum-sepolia.json" with { type: "json" };
import refBase from "../../../packages/console-data/fixtures/ref-base-sepolia.json" with { type: "json" };

/**
 * A fake world, built from the recorded fixtures.
 *
 * The console's layout has to be checkable at any terminal size without three chains, three
 * subgraphs and a quote service all being up — and without the answer depending on what the testnets
 * happen to be doing this minute. The scenarios are the states worth looking at, including the ones
 * that are awkward to produce on demand: a stale book refusing every quote, a docked leg, a write
 * landing.
 *
 * It is also what the site can show a visitor when the live reference is stale.
 */
export type Scenario = "fresh" | "stale" | "docked" | "landing";

const refs = { 11155111: refSepolia, 421614: refArbitrum, 84532: refBase } as const;
const histories = { 11155111: historySepolia, 421614: historyArbitrum, 84532: historyBase } as const;
const pools = { 11155111: poolSepolia, 421614: poolArbitrum, 84532: poolBase } as const;

const storedRef = (chainId: number, seq: number, updatedAt: bigint) => {
  const raw = refs[chainId as keyof typeof refs];
  return {
    ...raw,
    seq,
    mid: BigInt(raw.mid),
    updatedAt,
    refBalanceA: BigInt(raw.refBalanceA),
    dTiltPerA: BigInt(raw.dTiltPerA),
  };
};

export function fakeSnapshot(scenario: Scenario, now = 1789050000): Snapshot {
  // Ages are what most of the scenarios differ by, so they are set here rather than baked into the
  // fixtures: the same recorded chain state, seen at a different moment.
  const ageSeconds = scenario === "stale" ? 4 * 3600 + 16 * 60 : 3 * 60;
  const updatedAt = BigInt(now - ageSeconds);
  const seq = 1789049382;

  const parsed = LEGS.map((leg) => ({
    leg,
    history: parseHistory(leg.chainId, histories[leg.chainId as keyof typeof histories] as never),
    ref: storedRef(leg.chainId, seq, updatedAt),
  }));

  const active = parsed.map((entry, i) =>
    scenario === "docked" && i === 1
      ? { ...entry, history: { ...entry.history, position: { ...entry.history.position!, active: false } } }
      : entry,
  );

  const book = decomposeBook(active, ASSUMED_GAINS, BOOK.maxTiltBps);

  const legs = active.map((entry) => {
    const series = parseSeries(pools[entry.leg.chainId as keyof typeof pools] as never, midOf);
    const position = entry.history.position!;
    const spread = spreadStack(
      entry.ref,
      position,
      BOOK,
      now,
      series === null ? null : recomputeVolatility(series, entry.leg, BOOK),
    );
    const shift = book.legs.find((l) => l.chainId === entry.leg.chainId) ?? null;
    const priced = !spread.tooStaleToQuote && position.active;
    return {
      config: entry.leg,
      position,
      ref: entry.ref,
      series,
      spread,
      shift,
      quoteAToB: priced
        ? {
            chainId: entry.leg.chainId,
            chain: entry.leg.name,
            amountIn: 150_000n,
            amountOut: (150_000n * entry.ref.mid) / 10n ** 18n,
            tokenIn: entry.leg.tokenA.address,
            tokenOut: entry.leg.tokenB.address,
            reason: null,
            refMid: entry.ref.mid,
            tiltBps: entry.ref.tiltBps,
            seq,
            refAgeSeconds: ageSeconds,
            caveats: [],
          }
        : null,
      quoteBToA: null,
      finality: { head: 11_674_000n, finalized: 11_673_920n },
      caveats: spread.tooStaleToQuote
        ? [`the reference is ${Math.floor(ageSeconds / 60)}m old, past this leg's limit`]
        : [],
    };
  });

  return {
    pair: PAIR,
    positionId: BOOK.positionId,
    takenAtSeconds: now,
    seq,
    bookWeightA: book.weightA,
    gains: ASSUMED_GAINS,
    legs,
    feed: collapseFeed(mergeFeed(active.map((e) => e.history), 200), 40),
    sim: loadSimReport(),
    caveats: [],
  } as Snapshot;
}
