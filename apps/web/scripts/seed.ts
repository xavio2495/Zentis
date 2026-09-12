/**
 * The console route's data, taken from the repo's own records.
 *
 * Static JSON behind trivial routes is what keeps a demo from failing live, and generating it here —
 * rather than writing it by hand — is what keeps it true. Every figure comes from a file already in
 * the repository: the recorded testnet reads in `packages/console-data/fixtures`, and the committed
 * simulation run in `packages/sim-report/results/latest.json`. Nothing is invented, and the sources
 * travel with the output so a reader can check it.
 *
 * Run with `bun scripts/seed.ts` from `apps/web`. It is deliberately not part of `next build`: the
 * seed is committed, so what ships is a file somebody looked at.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordedMoment } from "../../../packages/console-data/src/recorded.js";
import { legState } from "../../../packages/console-data/src/status.js";
import { offMidBps } from "../../../packages/console-data/src/quotes.js";
import { providersOf } from "../../../packages/console-data/src/providers.js";
import type { LegQuote } from "../../../packages/console-data/src/quotes.js";
import type { LegSnapshot } from "../../../packages/console-data/src/snapshot.js";

const root = join(import.meta.dir, "..", "..", "..");
const read = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), "utf8")) as T;

/** The three legs, in the order every other surface stacks them. */
const LEGS = [
  { chainId: 11155111, name: "sepolia", label: "Sepolia", file: "packages/console-data/fixtures/history-sepolia.json" },
  { chainId: 84532, name: "base-sepolia", label: "Base Sepolia", file: "packages/console-data/fixtures/history-base-sepolia.json" },
  { chainId: 421614, name: "arbitrum-sepolia", label: "Arbitrum Sepolia", file: "packages/console-data/fixtures/history-arbitrum-sepolia.json" },
] as const;

interface History {
  position: { strategyHash: string; maxTiltBps: number; balanceA: string; balanceB: string };
  references: { timestamp: string; transaction: string; mid: string; tiltBps: number; seq: number }[];
  fills: {
    timestamp: string;
    transaction: string;
    amountIn: string;
    amountOut: string;
    isAToB: boolean;
    refTiltBps: number;
  }[];
  rejections: { timestamp: string; transaction: string; reason: string }[];
}

const recordedAt = read<{ seconds: number }>("packages/console-data/fixtures/recorded-at.json");

/**
 * When each leg's current generation was shipped, from its deployment record.
 *
 * The position keeps every fill it ever took, across re-ships. The console's totals cover the
 * generation now shipped — they have to, because hold values what *that* generation was shipped
 * with — so the replay marks its fills the same way rather than inventing a second rule for the
 * web.
 */
interface Deployment {
  position: { markAtShipAt?: number | null; shipBlock?: number | null };
}
const shippedAt = (name: string): number | null =>
  read<Deployment>(`contracts/deployments/${name}.json`).position.markAtShipAt ?? null;

/**
 * A round where the published mid changed by more than half again, either way.
 *
 * On 2026-09-11 the fast workflow moved from per-leg pool mids to one mainnet mid and the published
 * mid jumped twelvefold in a single round; every leg's shift slammed into its band. That reads as a
 * market event on a chart and was not one — it is the reference changing source — so the round is
 * marked and the surface drawing it says so.
 */
const CHANGED_BY = BigInt(3); // a third or triple, which no market move between two publishes will reach
const referenceChanged = (mid: string, previous: string | null): boolean => {
  if (previous === null) return false;
  const now = BigInt(mid);
  const before = BigInt(previous);
  if (before === BigInt(0) || now === BigInt(0)) return false;
  return now > before * CHANGED_BY || now * CHANGED_BY < before;
};

/**
 * Everything the instrument page draws, as the console computes it.
 *
 * Not recomputed for the web: the moment is assembled by `recordedMoment`, which is `takeSnapshot`'s
 * own parts over the recorded fixtures, and what follows only serialises it. A number on the page
 * and the same number on the console cannot drift apart, because there is only one of it.
 *
 * Bigints become decimal strings, and nulls stay null. A null here is a defined state with a caveat
 * next to it saying why — "no mark, so inventory cannot be valued" — and a zero in its place would
 * be a figure on screen that traces to nothing, which is the one thing this seed exists to prevent.
 */
const moment = recordedMoment();
const big = (value: bigint | null | undefined): string | null => (value == null ? null : String(value));

const quoteOf = (quote: LegQuote | null, isAToB: boolean) =>
  quote === null
    ? null
    : {
        amountIn: String(quote.amountIn),
        amountOut: big(quote.amountOut),
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        reason: quote.reason,
        refMid: big(quote.refMid),
        tiltBps: quote.tiltBps,
        seq: quote.seq,
        refAgeSeconds: quote.refAgeSeconds,
        // Computed here by the console's own function rather than left to the page: "how far off the
        // mid" is a claim about the maker's pricing and belongs where the pricing is understood.
        offMidBps: offMidBps(quote, isAToB),
        refusal: quote.refusal,
        caveats: quote.caveats,
      };

const decompositionOf = (leg: LegSnapshot) =>
  leg.shift === null
    ? null
    : {
        weightA: String(leg.shift.weightA),
        correction: String(leg.shift.correction),
        ownConcession: String(leg.shift.ownConcession),
        bookConcession: String(leg.shift.bookConcession),
        concessionUncapped: String(leg.shift.concessionUncapped),
        concession: String(leg.shift.concession),
        tiltBps: String(leg.shift.tiltBps),
        published: leg.shift.published,
        agrees: leg.shift.agrees,
        roomBps: String(leg.shift.roomBps),
        roomUnknownAtCap: leg.shift.roomUnknownAtCap,
        cappedByRoom: leg.shift.cappedByRoom,
        clampedByMaxTilt: leg.shift.clampedByMaxTilt,
        balancesMatchEnclave: leg.shift.balancesMatchEnclave,
        referenceAgeSeconds: leg.shift.referenceAgeSeconds,
        // A carried round is the slow workflow republishing the last fast round's tilt against a
        // newly budgeted boundary. The recomputation then lands a few bps away on every leg at
        // once, which is not the console and the enclave disagreeing — and a panel drawing it as
        // one would report a fault that is not there.
        carried: leg.shift.carried,
        carriedFromSeq: leg.shift.carriedFromSeq,
      };

const spreadOf = (leg: LegSnapshot) =>
  leg.spread === null
    ? null
    : {
        baseBps: leg.spread.baseBps,
        volatilityBps: leg.spread.volatilityBps,
        markoutBps: leg.spread.markoutBps,
        // The age ramp evaluated at the moment of recording, not at publish. A surface drawing it
        // says so; the position's own widenBpsPerMinute and maxWidenBps travel with it so a surface
        // that would rather recompute at its own clock can.
        stalenessBps: leg.spread.stalenessBps,
        totalBps: leg.spread.totalBps,
        referenceAgeSeconds: leg.spread.referenceAgeSeconds,
        tooStaleToQuote: leg.spread.tooStaleToQuote,
        recomputedVolatilityBps: leg.spread.recomputedVolatilityBps,
        widenBpsPerMinute: leg.position?.widenBpsPerMinute ?? null,
        maxWidenBps: leg.position?.maxWidenBps ?? null,
        maxStalenessSeconds: leg.position?.maxStalenessSeconds ?? null,
      };

const pnlOf = (leg: LegSnapshot) =>
  leg.pnl === null
    ? null
    : {
        fills: leg.pnl.fills,
        volumeA: String(leg.pnl.volumeA),
        edgeA: String(leg.pnl.edgeA),
        markoutA: big(leg.pnl.markoutA),
        tradingA: big(leg.pnl.tradingA),
        holdA: big(leg.pnl.holdA),
        totalA: big(leg.pnl.totalA),
        unvaluedB: big(leg.pnl.unvaluedB),
        caveat: leg.pnl.caveat,
        // The position's whole life, said separately and labelled as the other span: this
        // generation's hold and a lifetime's trading added together is the sum of two questions.
        lifetime: {
          fills: leg.pnl.lifetime.fills,
          volumeA: String(leg.pnl.lifetime.volumeA),
          edgeA: String(leg.pnl.lifetime.edgeA),
          markoutA: big(leg.pnl.lifetime.markoutA),
          tradingA: big(leg.pnl.lifetime.tradingA),
          generations: leg.pnl.lifetime.generations,
        },
      };

/** What each fill earned, by transaction, so a fill row and its economics cannot come apart. */
const economicsOf = (leg: LegSnapshot) =>
  new Map((leg.pnl?.perFill ?? []).map((fill) => [fill.transaction, fill]));

const marketOf = (history: typeof moment.snapshot.market) =>
  history === null
    ? null
    : {
        points: history.points.map((point) => ({ t: Number(point.timestamp), mid: String(point.mid) })),
        source: history.source,
        hours: history.hours,
        granularity: history.granularity,
        error: history.error,
      };

const legs = LEGS.map((leg) => {
  const history = read<History>(leg.file);
  const computed = moment.snapshot.legs.find((l) => l.config.chainId === leg.chainId)!;
  const economics = economicsOf(computed);
  return {
    chainId: leg.chainId,
    name: leg.name,
    label: leg.label,
    strategyHash: history.position.strategyHash,
    // The band edge is the leg's own cap, read off the position rather than assumed.
    maxTiltBps: history.position.maxTiltBps,
    balanceA: history.position.balanceA,
    balanceB: history.position.balanceB,
    // Oldest first: the indexer answers newest first and a replay plays forwards.
    shippedAtSeconds: shippedAt(leg.name),
    // The console's own word for what state this leg is in, so the page draws a vocabulary rather
    // than inventing one out of the booleans.
    status: legState(computed).word,
    statusKind: legState(computed).kind,
    quotes: {
      aToB: quoteOf(computed.quoteAToB, true),
      bToA: quoteOf(computed.quoteBToA, false),
    },
    decomposition: decompositionOf(computed),
    spread: spreadOf(computed),
    pnl: pnlOf(computed),
    mark: computed.mark === null ? null : { mid: String(computed.mark.mid), source: computed.mark.source, readAtSeconds: computed.mark.readAtSeconds },
    rounds: [...history.references]
      .map((r) => ({ seq: r.seq, atSeconds: Number(r.timestamp), tiltBps: r.tiltBps, mid: r.mid }))
      .sort((a, b) => a.atSeconds - b.atSeconds)
      .map((round, index, all) => ({
        ...round,
        referenceChanged: referenceChanged(round.mid, index === 0 ? null : all[index - 1]!.mid),
      })),
    fills: [...history.fills]
      .map((f) => ({
        atSeconds: Number(f.timestamp),
        transaction: f.transaction,
        amountIn: f.amountIn,
        amountOut: f.amountOut,
        isAToB: f.isAToB,
        // What the leg was quoting when it was taken, which is the whole point of showing the fill
        // on the same axis as the shift.
        refTiltBps: f.refTiltBps,
        thisGeneration: economics.get(f.transaction)?.thisGeneration ?? false,
        // What this fill earned, from `fillEconomics`: the edge against the reference that priced
        // it, and the same fill against the next reference published after it, which is the adverse
        // selection the slow workflow charges for. Null where no later reference exists yet.
        sizeA: String(economics.get(f.transaction)?.sizeA ?? BigInt(0)),
        edgeA: big(economics.get(f.transaction)?.edgeA),
        markoutA: big(economics.get(f.transaction)?.markoutA),
      }))
      .sort((a, b) => a.atSeconds - b.atSeconds),
    rejections: [...history.rejections]
      .map((r) => ({ atSeconds: Number(r.timestamp), transaction: r.transaction, reason: r.reason }))
      .sort((a, b) => a.atSeconds - b.atSeconds),
  };
});

/**
 * The one round worth jumping to, and why.
 *
 * The replay's jump chip is for a reader with thirty seconds, and it was dead: it jumped to the
 * first round that hit the cap, and this recording has none — the reference cutover that produced
 * them aged out of the window. A control that does nothing reads as a broken page rather than a
 * quiet one, so the seed names the round itself rather than leaving the surface to hunt for one.
 *
 * In order: a round where the reference changed source, because it is the only round on the chart
 * that is not a market move and the one most worth explaining; then a round where the boundary took
 * some of a leg's concession, because that is the policy meeting its limit; then simply the largest
 * shift the recording holds, which is the most the book ever leaned.
 */
type Highlight = { seq: number; atSeconds: number; kind: string; why: string } | null;

const highlightOf = (): Highlight => {
  const rounds = legs.flatMap((leg) =>
    leg.rounds.map((round) => ({ ...round, leg: leg.label, capped: leg.decomposition?.cappedByRoom === true })),
  );
  if (rounds.length === 0) return null;

  const changed = rounds.filter((round) => round.referenceChanged).sort((a, b) => a.seq - b.seq)[0];
  if (changed !== undefined) {
    return {
      seq: changed.seq,
      atSeconds: changed.atSeconds,
      kind: "reference-change",
      why: "the reference changed source here, so every leg's shift moved without the market moving: not a price event",
    };
  }

  // A round where a leg sat on its own band edge. Read per round from what was published rather
  // than from the leg's state now: "capped at the end" is not a moment anybody can jump to, and the
  // playhead finishes there anyway.
  const onTheCap = legs
    .flatMap((leg) => leg.rounds.filter((round) => Math.abs(round.tiltBps) >= leg.maxTiltBps).map((round) => ({ ...round, leg: leg.label })))
    .sort((a, b) => a.atSeconds - b.atSeconds)[0];
  if (onTheCap !== undefined) {
    return {
      seq: onTheCap.seq,
      atSeconds: onTheCap.atSeconds,
      kind: "capped",
      why: `${onTheCap.leg} is pinned against its own band edge here, with no room left to concede`,
    };
  }

  const deepest = rounds.reduce((worst, round) => (Math.abs(round.tiltBps) > Math.abs(worst.tiltBps) ? round : worst));
  return {
    seq: deepest.seq,
    atSeconds: deepest.atSeconds,
    kind: "largest-shift",
    why: `the widest the book leaned in this recording: ${deepest.leg} at ${deepest.tiltBps} bps of shift`,
  };
};

const replay = {
  provenance: {
    recordedAtSeconds: recordedAt.seconds,
    sources: [...LEGS.map((l) => l.file), "packages/console-data/fixtures/recorded-at.json"],
    note: "recorded testnet reads; no value here is synthesised",
  },
  // Where a reader with thirty seconds should be sent, named here rather than hunted for by the
  // surface that draws the jump.
  highlight: highlightOf(),
  // The one mainnet series every leg prices from, in both windows the service draws: a week hourly,
  // and the recent hours per swap.
  market: marketOf(moment.snapshot.market),
  marketRecent: marketOf(moment.recentMarket),
  book: {
    legs: moment.snapshot.book.legs,
    legsActive: moment.snapshot.book.legsActive,
    inventoryA: big(moment.snapshot.book.inventoryA),
    weightA: big(moment.snapshot.book.weightA),
    pnlA: big(moment.snapshot.book.pnlA),
    tradingA: big(moment.snapshot.book.tradingA),
    holdA: big(moment.snapshot.book.holdA),
    caveat: moment.snapshot.book.caveat,
    seq: moment.snapshot.seq,
    // How old the reference was when this moment was recorded: the page says "3m old" from this
    // rather than from the reader's own clock, which would age a recording into a staleness alarm.
    ageSeconds:
      moment.snapshot.legs[0]?.ref === null || moment.snapshot.legs[0] === undefined
        ? null
        : Math.max(0, moment.snapshot.takenAtSeconds - Number(moment.snapshot.legs[0].ref!.updatedAt)),
    quoteSizeA: String(moment.quoteSizes.amountInA),
    quoteSizeB: String(moment.quoteSizes.amountInB),
  },
  // The providers as they answered, so the page's dots are a reading rather than a decoration.
  providers: providersOf(moment.snapshot).map((provider) => ({
    kind: provider.kind,
    name: provider.name,
    state: provider.state,
    reason: provider.reason,
    detail: provider.detail,
  })),
  legs,
};

interface Run {
  generatedAt: string;
  modelCommit: string;
  unit: string;
  bookInA: number;
  book: { signal: string; kappa_bps: number; kappa_book_bps: number };
  series: { ticks: number };
  regimes: {
    regime: string;
    seeds: number;
    seedsAhead: number;
    meanVsStaticBpsOfBook: number;
    worstVsStaticBpsOfBook: number;
  }[];
}
const run = read<Run>("packages/sim-report/results/latest.json");

const sim = {
  generatedAt: run.generatedAt,
  modelCommit: run.modelCommit,
  unit: run.unit,
  bookInA: run.bookInA,
  signal: run.book.signal,
  kappaBps: run.book.kappa_bps,
  kappaBookBps: run.book.kappa_book_bps,
  ticks: run.series.ticks,
  regimes: run.regimes.map((r) => ({
    regime: r.regime,
    seeds: r.seeds,
    seedsAhead: r.seedsAhead,
    meanBpsOfBook: r.meanVsStaticBpsOfBook,
    worstBpsOfBook: r.worstVsStaticBpsOfBook,
  })),
  // Carried with the numbers rather than written on the panel that draws them: the sentence is the
  // limit of what they claim, and a limit that lives somewhere else gets left behind.
  caveat:
    "The harness is uncalibrated: this ranks the policy against static over shared seeds and says " +
    "which is ahead, not what either is worth.",
  source: "packages/sim-report/results/latest.json",
};

mkdirSync(join(import.meta.dir, "..", "public", "seed"), { recursive: true });
const out = (name: string, value: unknown) =>
  writeFileSync(join(import.meta.dir, "..", "public", "seed", name), `${JSON.stringify(value, null, 2)}\n`);
out("replay.json", replay);
out("sim.json", sim);
console.log(
  `seed written: ${legs.reduce((n, l) => n + l.rounds.length, 0)} rounds, ` +
    `${legs.reduce((n, l) => n + l.fills.length, 0)} fills, ${sim.regimes.length} regimes`,
);
