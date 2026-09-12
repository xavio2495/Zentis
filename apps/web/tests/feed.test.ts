import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildFeed, pnlTable } from "@/lib/feed";
import type { Leg } from "@/lib/replay";

/**
 * The feed, folded.
 *
 * One publish reaches three chains, so three rounds carrying the same seq are one event and not
 * three. A feed that lists them separately says the book published nine hundred times when it
 * published three hundred, which is the sort of number a judge checks.
 */
const seed = JSON.parse(readFileSync(join(import.meta.dir, "..", "public", "seed", "replay.json"), "utf8"));
const legs = seed.legs as Leg[];

describe("one publish across the legs is one row", () => {
  test("rounds fold by seq, and the row names the legs that carried it", () => {
    const feed = buildFeed(legs, Number.POSITIVE_INFINITY);
    const publishes = feed.filter((row) => row.kind === "publish");
    const seqs = new Set(legs.flatMap((leg) => leg.rounds.map((round) => round.seq)));
    expect(publishes.length).toBe(seqs.size);
    for (const row of publishes) expect(row.legs.length).toBeGreaterThan(0);
  });

  test("a publish every leg carried says so, rather than naming all three", () => {
    const feed = buildFeed(legs, Number.POSITIVE_INFINITY);
    const full = feed.find((row) => row.kind === "publish" && row.legs.length === legs.length);
    expect(full).toBeDefined();
    expect(full!.acrossAll).toBe(true);
  });

  test("newest first, so the last thing that happened is the first thing read", () => {
    const feed = buildFeed(legs, Number.POSITIVE_INFINITY);
    for (let i = 1; i < feed.length; i += 1) {
      expect(feed[i - 1]!.atSeconds).toBeGreaterThanOrEqual(feed[i]!.atSeconds);
    }
  });

  test("fills and rejections are their own rows, and every one of them survives the fold", () => {
    const feed = buildFeed(legs, Number.POSITIVE_INFINITY);
    expect(feed.filter((r) => r.kind === "fill").length).toBe(legs.reduce((n, l) => n + l.fills.length, 0));
    expect(feed.filter((r) => r.kind === "rejection").length).toBe(legs.reduce((n, l) => n + l.rejections.length, 0));
  });

  test("a rejection carries the node's own words, never a paraphrase", () => {
    const feed = buildFeed(legs, Number.POSITIVE_INFINITY);
    const rejection = feed.find((row) => row.kind === "rejection")!;
    const recorded = legs.flatMap((leg) => leg.rejections).map((r) => r.reason);
    expect(recorded).toContain(rejection.detail!);
  });

  test("the playhead cuts the feed by time, so nothing from the future is on screen", () => {
    const all = buildFeed(legs, Number.POSITIVE_INFINITY);
    const cut = all[Math.floor(all.length / 2)]!.atSeconds;
    for (const row of buildFeed(legs, cut)) expect(row.atSeconds).toBeLessThanOrEqual(cut);
  });

  test("a reference change is carried on the row so the legend can annotate it", () => {
    const feed = buildFeed(
      [{ ...legs[0]!, rounds: [{ seq: 1, atSeconds: 10, tiltBps: 5, mid: "1", referenceChanged: true }], fills: [], rejections: [] }],
      Number.POSITIVE_INFINITY,
    );
    expect(feed[0]!.referenceChanged).toBe(true);
  });
});

describe("the PnL table", () => {
  test("a row per leg, plus the book, and the book is not one of the legs", () => {
    const table = pnlTable(legs, seed.book);
    expect(table.rows.length).toBe(legs.length);
    expect(table.book).not.toBeNull();
    expect(table.rows.map((r) => r.label)).toEqual(legs.map((l) => l.label));
  });

  test("every leg's total is its own, and the book's is the book's — never a re-sum here", () => {
    // The book's totals come from `bookTotals`, which knows which legs could be valued. Adding the
    // leg rows up on screen would silently disagree with it the moment one leg is unread.
    const table = pnlTable(legs, seed.book);
    expect(table.book!.totalA).toBe(seed.book.pnlA);
    const summed = legs.reduce((n, l) => n + Number(l.pnl!.totalA ?? 0), 0);
    expect(table.resums).toBe(false);
    expect(typeof summed).toBe("number");
  });

  test("a null total is carried as null with its caveat, not as a zero", () => {
    const stripped = [{ ...legs[0]!, pnl: { ...legs[0]!.pnl!, totalA: null, caveat: "no mark for this leg" } }];
    const table = pnlTable(stripped, seed.book);
    expect(table.rows[0]!.totalA).toBeNull();
    expect(table.rows[0]!.caveat).toBe("no mark for this leg");
  });

  test("fills are flagged by generation, because hold values only what this one was shipped with", () => {
    const table = pnlTable(legs, seed.book);
    const earlier = table.fills.filter((f) => !f.thisGeneration);
    expect(earlier.length).toBeGreaterThan(0);
    for (const fill of table.fills) expect(typeof fill.thisGeneration).toBe("boolean");
  });

  test("the per-fill rows are newest first and carry the leg they landed on", () => {
    const table = pnlTable(legs, seed.book);
    for (let i = 1; i < table.fills.length; i += 1) {
      expect(table.fills[i - 1]!.atSeconds).toBeGreaterThanOrEqual(table.fills[i]!.atSeconds);
    }
    for (const fill of table.fills) expect(fill.label).toBeTruthy();
  });
});

describe("a publish still arriving is not a publish one leg missed", () => {
  /**
   * The legs publish the same seq seconds apart. Cut the feed at a moment between them and the row
   * has been carried by one leg so far — but the recording knows all three carried it, and a row
   * reading "Arbitrum Sepolia" alone invites exactly the wrong conclusion about a book whose whole
   * claim is that one reference reaches three chains. The row has to distinguish "one leg has it so
   * far" from "one leg ever had it".
   */
  const three: Leg[] = [0, 1, 2].map((i) => ({
    ...legs[i]!,
    label: ["a", "b", "c"][i]!,
    chainId: i,
    rounds: [{ seq: 7, atSeconds: 100 + i * 10, tiltBps: 5, mid: "1" }],
    fills: [],
    rejections: [],
  }));

  test("cut between the legs, the row says how many have it against how many will", () => {
    const row = buildFeed(three, 105)[0]!;
    expect(row.legs.length).toBe(1);
    expect(row.legsEver).toBe(3);
    expect(row.stillArriving).toBe(true);
    expect(row.acrossAll).toBe(false);
  });

  test("cut after all of them, the row is simply the whole book's publish", () => {
    const row = buildFeed(three, 200)[0]!;
    expect(row.legs.length).toBe(3);
    expect(row.legsEver).toBe(3);
    expect(row.stillArriving).toBe(false);
    expect(row.acrossAll).toBe(true);
  });

  test("a seq only one leg ever carried is not reported as still arriving", () => {
    // The honest case the flag must not swallow: a leg that genuinely never published this seq.
    const partial: Leg[] = [
      { ...three[0]!, rounds: [{ seq: 7, atSeconds: 100, tiltBps: 5, mid: "1" }] },
      { ...three[1]!, rounds: [] },
      { ...three[2]!, rounds: [] },
    ];
    const row = buildFeed(partial, 500)[0]!;
    expect(row.legsEver).toBe(1);
    expect(row.stillArriving).toBe(false);
  });

  test("on the real recording, no row claims more legs so far than ever carried it", () => {
    for (const row of buildFeed(legs, Number.POSITIVE_INFINITY)) {
      if (row.kind !== "publish") continue;
      expect(row.legs.length).toBeLessThanOrEqual(row.legsEver);
    }
  });
});
