import type { Snapshot } from "@zentis/console-data";
import { ASSUMED_GAINS, BOOK, LEGS, PAIR, bookTotals, holdingOf, walletCaveats, collapseFeed, decomposeBook, legPnl, loadSimReport, mergeFeed, midOf, parseHistory, parseSeries, recomputeVolatility, spreadStack, type LegSnapshot } from "@zentis/console-data";
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
export type Scenario = "fresh" | "stale" | "docked" | "landing" | "outage" | "partial" | "refused";

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

/** The sandbox's own reference seq, exported so a test can name it without writing it down twice. */
export const SANDBOX_SEQ = 1789049382;

export function fakeSnapshot(scenario: Scenario, now = 1789050000): Snapshot {
  // Ages are what most of the scenarios differ by, so they are set here rather than baked into the
  // fixtures: the same recorded chain state, seen at a different moment.
  const ageSeconds = scenario === "stale" ? 4 * 3600 + 16 * 60 : 3 * 60;
  const updatedAt = BigInt(now - ageSeconds);
  const seq = SANDBOX_SEQ;

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
      // Every source answered in the fake world; the outage scenario is the one that sets these.
      sources: { fills: null, registry: null, pool: null },
      caveats: spread.tooStaleToQuote
        ? [`the reference is ${Math.floor(ageSeconds / 60)}m old, past this leg's limit`]
        : [],
    };
  });

  /**
   * The maker's wallet, built from the same positions the legs above carry.
   *
   * Aqua records a balance against the strategy and pulls from the wallet at settlement, so the
   * committed inventory is still in the wallet's own balance. The fake world holds a multiple of
   * what it committed, which is the ordinary case; the shortfall and short-allowance cases are what
   * `walletCaveats` exists to say, and they are constructed in the tests that are about them.
   */
  const wallet = {
    maker: BOOK.maker,
    chains: legs.map((leg) => {
      const committedA = leg.position?.balanceA ?? 0n;
      const committedB = leg.position?.balanceB ?? 0n;
      return {
        chainId: leg.config.chainId,
        chain: leg.config.name,
        gas: 10n ** 17n,
        tokenA: holdingOf(leg.config.tokenA, committedA * 3n, committedA, committedA * 10n),
        tokenB: holdingOf(leg.config.tokenB, committedB * 3n, committedB, committedB * 10n),
      };
    }),
    caveats: walletCaveats([]),
  };

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
    caveats: [],
  } as Snapshot;
}
