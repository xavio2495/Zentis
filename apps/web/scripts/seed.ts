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

const legs = LEGS.map((leg) => {
  const history = read<History>(leg.file);
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
        thisGeneration: shippedAt(leg.name) !== null && Number(f.timestamp) >= shippedAt(leg.name)!,
      }))
      .sort((a, b) => a.atSeconds - b.atSeconds),
    rejections: [...history.rejections]
      .map((r) => ({ atSeconds: Number(r.timestamp), transaction: r.transaction, reason: r.reason }))
      .sort((a, b) => a.atSeconds - b.atSeconds),
  };
});

const replay = {
  provenance: {
    recordedAtSeconds: recordedAt.seconds,
    sources: [...LEGS.map((l) => l.file), "packages/console-data/fixtures/recorded-at.json"],
    note: "recorded testnet reads; no value here is synthesised",
  },
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
