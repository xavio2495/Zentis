import type { LegHistory, Snapshot } from "@zentis/console-data";
import { ASSUMED_GAINS, BOOK, LEGS, PAIR, POOL_RETIRED, bookTotals, parseWalletFixture, collapseFeed, decomposeBook, legPnl, loadSimReport, mergeFeed, midOf, parseHistory, parseSeries, recomputeVolatility, spreadStack, type LegSnapshot } from "@zentis/console-data";
import recordedWallet from "../../../packages/console-data/fixtures/wallet.json" with { type: "json" };
import recordedAt from "../../../packages/console-data/fixtures/recorded-at.json" with { type: "json" };
import historySepolia from "../../../packages/console-data/fixtures/history-sepolia.json" with { type: "json" };
import historyArbitrum from "../../../packages/console-data/fixtures/history-arbitrum-sepolia.json" with { type: "json" };
import historyBase from "../../../packages/console-data/fixtures/history-base-sepolia.json" with { type: "json" };
import poolSepolia from "../../../packages/console-data/fixtures/pool-sepolia.json" with { type: "json" };
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
export type Scenario =
  | "fresh"
  | "stale"
  | "docked"
  | "landing"
  | "outage"
  | "partial"
  | "refused"
  | "pinned"
  | "long";

const refs = { 11155111: refSepolia, 421614: refArbitrum, 84532: refBase } as const;
const histories = { 11155111: historySepolia, 421614: historyArbitrum, 84532: historyBase } as const;
// Only Sepolia still has a reference pool; the other two were retired when the book moved to one
// mainnet mid, and the fake world says so the same way the live one does rather than drawing a
// price from a recording of a pool nobody reads any more.
const pools: Record<number, typeof poolSepolia | undefined> = { 11155111: poolSepolia };

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

/**
 * The sandbox's own reference seq, read from the recording rather than written down: a re-record
 * changes it, and a number typed here turns that into a rendering failure about nothing.
 */
export const SANDBOX_SEQ = (refSepolia as { seq: number }).seq;

/**
 * The moment the fixtures were taken, which is the fake world's clock.
 *
 * It was a constant, and when a re-record moved the fixtures past it every age in the feed came out
 * as "0s" — the publishes were in the screen's future, so their ages clamped to nothing.
 */
export const SANDBOX_NOW = (recordedAt as { seconds: number }).seconds;

/**
 * The demo's beat, added to the recorded history: one fill, and one publish refused on every chain.
 *
 * Constructed rather than recorded, because whether the market gave the book a fill in the recorded
 * week is not something the screen's layout should depend on. The morning's clean re-record had
 * neither, and three tests about how a fill and a refusal are drawn went red over a quiet market.
 * The publishes around them are the real ones.
 */
function withBeat(leg: (typeof LEGS)[number], history: LegHistory, now: number): LegHistory {
  const isFirst = leg.chainId === LEGS[0]!.chainId;
  return {
    ...history,
    fills: [
      ...history.fills,
      ...(isFirst
        ? [
            {
              kind: "fill" as const,
              chainId: leg.chainId,
              timestamp: BigInt(now - 20 * 60),
              transaction: "0xfill000000000000000000000000000000000000000000000000000000000beat",
              amountIn: 150_000n,
              amountOut: 60_700_000_000_000n,
              isAToB: true,
              hasReference: true,
              refMid: (history.references[0]?.mid ?? 10n ** 27n),
              refTiltBps: history.references[0]?.tiltBps ?? 0,
              refSeq: history.references[0]?.seq ?? 0,
              refAgeSeconds: 180n,
            },
          ]
        : []),
    ],
    // One relayed seq refused everywhere, within a few seconds, which is what finality looks like
    // from outside and what the feed folds into a single row.
    rejections: [
      ...history.rejections,
      {
        kind: "rejection" as const,
        chainId: leg.chainId,
        timestamp: BigInt(now - 40 * 60 + LEGS.findIndex((l) => l.chainId === leg.chainId) * 4),
        transaction: "0xrej0000000000000000000000000000000000000000000000000000000000beat",
        reason: "stale seq",
      },
    ],
  };
}

export function fakeSnapshot(scenario: Scenario, now = SANDBOX_NOW): Snapshot {
  // Ages are what most of the scenarios differ by, so they are set here rather than baked into the
  // fixtures: the same recorded chain state, seen at a different moment.
  const ageSeconds = scenario === "stale" ? 4 * 3600 + 16 * 60 : 3 * 60;
  const updatedAt = BigInt(now - ageSeconds);
  const seq = SANDBOX_SEQ;

  const parsed = LEGS.map((leg) => ({
    leg,
    history: withBeat(leg, parseHistory(leg.chainId, histories[leg.chainId as keyof typeof histories] as never), now),
    ref: storedRef(leg.chainId, seq, updatedAt),
  }));

  const active = parsed.map((entry, i) =>
    scenario === "docked" && i === 1
      ? { ...entry, history: { ...entry.history, position: { ...entry.history.position!, active: false } } }
      : entry,
  );

  const book = decomposeBook(active, ASSUMED_GAINS, BOOK.maxTiltBps);

  const legs = active.map((entry) => {
    // Null for a leg whose pool was retired, which is what the live reader returns for it.
    const recordedPool = pools[entry.leg.chainId];
    const series = recordedPool === undefined ? null : parseSeries(recordedPool as never, midOf);
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
      // Both directions, each a spread's width worse than the mid, so the card has a real two-sided
      // quote to draw. Amounts are derived from the leg's own mid, never typed.
      ...(() => {
        if (!priced) return { quoteAToB: null, quoteBToA: null };
        const cut = (raw: bigint) => (raw * BigInt(10_000 - spread.totalBps)) / 10_000n;
        const base = {
          chainId: entry.leg.chainId,
          chain: entry.leg.name,
          reason: null,
          refMid: entry.ref.mid,
          tiltBps: entry.ref.tiltBps,
          seq,
          refAgeSeconds: ageSeconds,
          refusal: null,
          caveats: [],
        };
        const inB = (150_000n * entry.ref.mid) / 10n ** 18n;
        return {
          quoteAToB: {
            ...base,
            amountIn: 150_000n,
            amountOut: cut(inB),
            tokenIn: entry.leg.tokenA.address,
            tokenOut: entry.leg.tokenB.address,
          },
          quoteBToA: {
            ...base,
            amountIn: inB,
            amountOut: cut((inB * 10n ** 18n) / entry.ref.mid),
            tokenIn: entry.leg.tokenB.address,
            tokenOut: entry.leg.tokenA.address,
          },
        };
      })(),
      finality: { head: 11_674_000n, finalized: 11_673_920n },
      // A mainnet mark near the real one, so the sandbox's book is a plausible size rather than a
      // testnet pool's fantasy. The hold effect is deliberately unknown here: the legs this world
      // stands in for were shipped before the mark was recorded, and a sandbox that quietly had a
      // number the live console cannot have would hide the case the screen has to render.
      mark: { mainnetChainId: 1, mid: 405_837_064_044_766_950_299_015_618n, source: "1inch spot", readAtSeconds: now, error: null },
      pnl: legPnl(entry.history, entry.leg.shipped, 405_837_064_044_766_950_299_015_618n, null),
      // Every source answered in the fake world, except a venue that no longer exists to answer:
      // the outage scenario is the one that sets the others.
      sources: { fills: null, registry: null, pool: series === null ? POOL_RETIRED : null },
      caveats: spread.tooStaleToQuote
        ? [`the reference is ${Math.floor(ageSeconds / 60)}m old, past this leg's limit`]
        : [],
    };
  });

  /**
   * A week of the book's market, hourly, walked deterministically around the mark the legs are
   * valued at. Constructed rather than recorded: the shape of the line is what the chart's layout is
   * tested against, and a recorded week would make every re-record a rendering change.
   */
  const market = {
    points: Array.from({ length: 168 }, (_, i) => {
      const step = BigInt(Math.round(Math.sin(i / 12) * 40) + 1000);
      return {
        timestamp: BigInt(now - (167 - i) * 3600),
        mid: (405_837_064_044_766_950_299_015_618n * step) / 1000n,
      };
    }),
    source: "Uniswap v3 mainnet USDC/WETH, via The Graph",
    hours: 168,
    granularity: "hours" as const,
    error: null,
  };

  /**
   * The maker's wallet, as the chains really answered when it was recorded.
   *
   * It was synthetic until now — a multiple of what each leg committed — which meant the two cases
   * the page exists to warn about, a balance below the commitment and an approval that no longer
   * covers it, were never drawn from anything real. The recording carries the second of them on all
   * three legs.
   */
  const wallet = parseWalletFixture(recordedWallet as never);

  if (scenario === "pinned" || scenario === "long") {
    const target = scenario === "pinned" ? "sepolia" : "arbitrum-sepolia";
    const moved = legs.map((leg) =>
      leg.config.name !== target || leg.position === null
        ? leg
        : {
            ...leg,
            position: {
              ...leg.position,
              balanceB: scenario === "pinned" ? leg.position.balanceB / 2n : leg.position.balanceB * 2n,
            },
          },
    );
    return {
      ...(fakeSnapshot("fresh", now) as Snapshot),
      legs: moved,
      book: bookTotals(moved as LegSnapshot[]),
    } as unknown as Snapshot;
  }

  if (scenario === "refused") {
    // Seen live: the router answers USDC → WETH on Sepolia and reverts WETH → USDC. The quote service
    // reports the revert as a caveat with no amount.
    const base = fakeSnapshot("fresh", now);
    return {
      ...base,
      legs: base.legs.map((leg) =>
        leg.config.name !== "sepolia" || leg.quoteBToA === null
          ? leg
          : {
              ...leg,
              quoteBToA: {
                ...leg.quoteBToA,
                amountOut: null,
                // As the quote service words it since it decodes the contract's errors: the sentence
                // names tokenA and tokenB, because the service has no symbols.
                refusal: {
                  error: "ZentisOutsideBand",
                  args: ["29720000000000000000000000", "30730000000000000000000000", "false"],
                  sentence: "outside the band: the maker would sell tokenA for 322 bps less tokenB than the floor allows",
                },
                caveats: [
                  "the router refused this quote: outside the band: the maker would sell tokenA for 322 bps less tokenB than the floor allows",
                ],
              },
            },
      ),
    } as unknown as Snapshot;
  }

  if (scenario === "partial") {
    // What the user's first outage screenshot actually showed: Sepolia's fills endpoint answering,
    // Base's and Arbitrum's refusing. The feed then holds one leg's publishes, and has to say the
    // other two were unread rather than that the workflow only wrote one.
    const refusal = "subgraph HTTP 429, resets 21:52Z";
    const sepoliaOnly = active.filter((e) => e.leg.name === "sepolia").map((e) => e.history);
    const unreadLegs = legs.map((leg) =>
      leg.config.name === "sepolia"
        ? leg
        : {
            ...leg,
            position: null,
            shift: null,
            spread: null,
            quoteAToB: null,
            quoteBToA: null,
            mark: null,
            pnl: null,
            sources: { fills: refusal, registry: null, pool: null },
          },
    );
    return {
      pair: PAIR,
      positionId: BOOK.positionId,
      takenAtSeconds: now,
      seq,
      bookWeightA: book.weightA,
      gains: ASSUMED_GAINS,
      legs: unreadLegs,
      feed: collapseFeed(mergeFeed(sepoliaOnly, 200), 40),
      sim: loadSimReport(),
      // Derived from the legs above, like the other scenarios: a book handed a total its own legs do
      // not add up to would let the overall view pass a test the real one fails.
      book: bookTotals(unreadLegs as LegSnapshot[]),
      wallet: null,
      market,
      caveats: [],
    } as unknown as Snapshot;
  }

  if (scenario === "outage") {
    // What the user's screenshot caught: every fills read refused with a cold cache, so every leg
    // arrives null. The console has to say the legs are unread, never that they are gone.
    const refusal = "subgraph HTTP 429, resets 21:52Z";
    return {
      pair: PAIR,
      positionId: BOOK.positionId,
      takenAtSeconds: now,
      // The registries are read over RPC, which answers while Studio does not, so a subgraph outage
      // leaves the seq known. Setting it null here made the scenario easier than the real thing.
      seq,
      bookWeightA: 0n,
      gains: ASSUMED_GAINS,
      legs: legs.map((leg) => ({
        ...leg,
        position: null,
        shift: null,
        spread: null,
        // The quote service reads the same fills subgraph, so its quotes go with the position.
        quoteAToB: null,
        quoteBToA: null,
        // The pool price is read over RPC, not from Studio, so a subgraph outage leaves it standing.
        // This scenario used to blank it too, which was true before the price moved off the subgraph
        // and is now an outage worse than the real one.
        sources: { fills: refusal, registry: null, pool: null },
        caveats: [`fills subgraph unavailable (${refusal})`],
      })),
      feed: [],
      sim: loadSimReport(),
      book: bookTotals([]),
      wallet: null,
      // The outage takes the market with it: the same service answers for both.
      market: null,
      caveats: [],
    } as unknown as Snapshot;
  }

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
    // Derived, not written down: the sandbox's book has to be the one the legs above add up to, or
    // a scenario would assert against a total no arrangement of its own legs could produce.
    book: bookTotals(legs as LegSnapshot[]),
    wallet,
    market,
    caveats: [],
  } as Snapshot;
}
