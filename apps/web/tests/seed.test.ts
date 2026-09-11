import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The console route's data, and where every number in it came from.
 *
 * The replay is served from static JSON so a demo cannot fail live, which is the one thing the
 * reference gets unambiguously right. What the reference does *not* get right is the source: its
 * execution legs are synthesised, tx hashes and all. Zentis cannot do that — every figure on the
 * console surface traces to a committed `sim-report` run or to a real testnet read — so the seed is
 * generated from the repo's own recorded fixtures by `scripts/seed.ts` and carries its sources with
 * it.
 *
 * These tests read the seed against the files it was made from. A seed that drifted from them, or
 * one with a round number nobody recorded, fails here rather than on screen.
 */
const root = join(import.meta.dir, "..", "..", "..");
const seed = <T,>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "public", "seed", name), "utf8")) as T;
const source = <T,>(path: string): T => JSON.parse(readFileSync(join(root, path), "utf8")) as T;

interface Round { seq: number; atSeconds: number; tiltBps: number; mid: string }
interface Fill { atSeconds: number; transaction: string; amountIn: string; amountOut: string; isAToB: boolean }
interface Leg {
  chainId: number;
  name: string;
  label: string;
  strategyHash: string;
  maxTiltBps: number;
  rounds: Round[];
  fills: Fill[];
  rejections: { atSeconds: number; transaction: string; reason: string }[];
}
interface Replay {
  provenance: { recordedAtSeconds: number; sources: string[]; note: string };
  legs: Leg[];
}

test("the replay is the three legs as they were actually recorded", () => {
  const replay = seed<Replay>("replay.json");
  expect(replay.legs.map((l) => l.chainId)).toEqual([11155111, 84532, 421614]);
  expect(replay.provenance.recordedAtSeconds).toBe(
    source<{ seconds: number }>("packages/console-data/fixtures/recorded-at.json").seconds,
  );
  for (const path of replay.provenance.sources) expect(() => source(path)).not.toThrow();
});

test("every round and every fill is one the fixtures hold, with its own transaction", () => {
  const replay = seed<Replay>("replay.json");
  const files: Record<number, string> = {
    11155111: "packages/console-data/fixtures/history-sepolia.json",
    84532: "packages/console-data/fixtures/history-base-sepolia.json",
    421614: "packages/console-data/fixtures/history-arbitrum-sepolia.json",
  };
  for (const leg of replay.legs) {
    const from = source<{
      position: { strategyHash: string; maxTiltBps: number };
      references: { seq: number; tiltBps: number; timestamp: string }[];
      fills: { transaction: string; amountIn: string }[];
    }>(files[leg.chainId]!);

    expect(leg.strategyHash).toBe(from.position.strategyHash);
    expect(leg.maxTiltBps).toBe(from.position.maxTiltBps);
    expect(leg.rounds).toHaveLength(from.references.length);
    expect(leg.fills).toHaveLength(from.fills.length);

    // Ascending, because a replay plays forwards and the indexer answers newest first.
    for (let i = 1; i < leg.rounds.length; i += 1) {
      expect(leg.rounds[i]!.atSeconds).toBeGreaterThanOrEqual(leg.rounds[i - 1]!.atSeconds);
    }
    const recorded = new Set(from.references.map((r) => `${r.seq}:${r.tiltBps}`));
    for (const round of leg.rounds) expect(recorded.has(`${round.seq}:${round.tiltBps}`)).toBe(true);

    const hashes = new Set(from.fills.map((f) => f.transaction));
    for (const fill of leg.fills) {
      expect(hashes.has(fill.transaction)).toBe(true);
      expect(fill.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    }
  }
});

test("the run's numbers are the committed run's, and it says what it does not claim", () => {
  const sim = seed<{
    modelCommit: string;
    generatedAt: string;
    bookInA: number;
    caveat: string;
    regimes: { regime: string; seeds: number; seedsAhead: number; meanBpsOfBook: number }[];
  }>("sim.json");
  const run = source<{
    modelCommit: string;
    generatedAt: string;
    bookInA: number;
    regimes: { regime: string; seeds: number; seedsAhead: number; meanVsStaticBpsOfBook: number }[];
  }>("packages/sim-report/results/latest.json");

  expect(sim.modelCommit).toBe(run.modelCommit);
  expect(sim.generatedAt).toBe(run.generatedAt);
  expect(sim.bookInA).toBe(run.bookInA);
  expect(sim.regimes).toHaveLength(run.regimes.length);
  for (const [i, regime] of sim.regimes.entries()) {
    expect(regime.meanBpsOfBook).toBe(run.regimes[i]!.meanVsStaticBpsOfBook);
    expect(regime.seedsAhead).toBe(run.regimes[i]!.seedsAhead);
  }
  // The harness is uncalibrated. The surface that draws these has to say so in the same breath, so
  // the sentence travels with the numbers rather than being remembered by whoever writes the panel.
  expect(sim.caveat).toMatch(/uncalibrated/);
  expect(sim.caveat).toMatch(/ahead/);
});
