import type { BookTotals, Leg } from "./replay";

/**
 * The feed and the PnL table, as arithmetic.
 *
 * The rule that shapes the feed: one publish reaches three chains, so three rounds carrying the
 * same seq are one event. Listed separately they would say the book published nine hundred times
 * when it published three hundred — a number a judge checks, and the claim the project is making is
 * precisely that there is *one* book. The fold is the claim, rendered.
 */
export type FeedKind = "publish" | "fill" | "rejection";

export interface FeedRow {
  readonly kind: FeedKind;
  readonly atSeconds: number;
  /** the seq for a publish; null for anything that is not one */
  readonly seq: number | null;
  /** the legs this row happened on, by label */
  readonly legs: string[];
  /** true where every leg in the book has carried this publish by the moment shown */
  readonly acrossAll: boolean;
  /**
   * How many legs carried this seq anywhere in the recording.
   *
   * The legs publish the same seq seconds apart, so a feed cut between them shows one leg holding
   * it. Without this the row reads as a publish the other two missed — the opposite of what the
   * recording shows, on the one claim the project is making.
   */
  readonly legsEver: number;
  /** more legs carry this seq later in the recording than have it at the moment shown */
  readonly stillArriving: boolean;
  /** the shift published, where the row is a publish */
  readonly tiltBps: number | null;
  /** the node's own words for a rejection; the side and size for a fill */
  readonly detail: string | null;
  readonly transaction: string | null;
  readonly referenceChanged: boolean;
  readonly thisGeneration: boolean | null;
  readonly key: string;
}

/**
 * Everything that happened up to `untilSeconds`, newest first.
 *
 * Cut by time rather than by index: the legs publish at slightly different wall clocks, so an index
 * into one leg's rounds is not a moment in the book's life.
 */
export function buildFeed(legs: readonly Leg[], untilSeconds: number): FeedRow[] {
  const rows: FeedRow[] = [];

  // How many legs ever carried each seq, over the whole recording rather than the visible slice.
  const everCarried = new Map<number, number>();
  for (const leg of legs) {
    for (const round of leg.rounds) everCarried.set(round.seq, (everCarried.get(round.seq) ?? 0) + 1);
  }

  // One bucket per seq, gathering whichever legs carried it by the moment shown.
  const publishes = new Map<number, { atSeconds: number; legs: string[]; tiltBps: number; referenceChanged: boolean }>();
  for (const leg of legs) {
    for (const round of leg.rounds) {
      if (round.atSeconds > untilSeconds) continue;
      const existing = publishes.get(round.seq);
      if (existing === undefined) {
        publishes.set(round.seq, {
          atSeconds: round.atSeconds,
          legs: [leg.label],
          tiltBps: round.tiltBps,
          referenceChanged: round.referenceChanged === true,
        });
      } else {
        existing.legs.push(leg.label);
        // The earliest wall time the publish was seen at: the seq is one event, and the event
        // happened when the first leg saw it.
        existing.atSeconds = Math.min(existing.atSeconds, round.atSeconds);
        existing.referenceChanged = existing.referenceChanged || round.referenceChanged === true;
      }
    }
  }

  for (const [seq, publish] of publishes) {
    const ever = everCarried.get(seq) ?? publish.legs.length;
    rows.push({
      kind: "publish",
      atSeconds: publish.atSeconds,
      seq,
      legs: publish.legs,
      acrossAll: publish.legs.length === legs.length,
      legsEver: ever,
      stillArriving: publish.legs.length < ever,
      tiltBps: publish.tiltBps,
      detail: null,
      transaction: null,
      referenceChanged: publish.referenceChanged,
      thisGeneration: null,
      key: `publish-${seq}`,
    });
  }

  for (const leg of legs) {
    for (const fill of leg.fills) {
      if (fill.atSeconds > untilSeconds) continue;
      rows.push({
        kind: "fill",
        atSeconds: fill.atSeconds,
        seq: null,
        legs: [leg.label],
        acrossAll: false,
        legsEver: 1,
        stillArriving: false,
        tiltBps: fill.refTiltBps,
        detail: fill.isAToB ? "USDC → WETH" : "WETH → USDC",
        transaction: fill.transaction,
        referenceChanged: false,
        thisGeneration: fill.thisGeneration ?? null,
        key: `fill-${leg.chainId}-${fill.transaction}`,
      });
    }
    for (const rejection of leg.rejections) {
      if (rejection.atSeconds > untilSeconds) continue;
      rows.push({
        kind: "rejection",
        atSeconds: rejection.atSeconds,
        seq: null,
        legs: [leg.label],
        acrossAll: false,
        legsEver: 1,
        stillArriving: false,
        tiltBps: null,
        // Verbatim. A refusal is evidence, and a paraphrase of evidence is not evidence.
        detail: rejection.reason,
        transaction: rejection.transaction,
        referenceChanged: false,
        thisGeneration: null,
        key: `reject-${leg.chainId}-${rejection.transaction}`,
      });
    }
  }

  return rows.sort((a, b) => b.atSeconds - a.atSeconds);
}

export interface PnlRow {
  readonly label: string;
  readonly fills: number;
  readonly edgeA: string;
  readonly markoutA: string | null;
  readonly tradingA: string | null;
  readonly holdA: string | null;
  readonly totalA: string | null;
  readonly caveat: string | null;
}

export interface PnlFill {
  readonly label: string;
  readonly atSeconds: number;
  readonly transaction: string;
  readonly isAToB: boolean;
  readonly sizeA: string | null;
  readonly edgeA: string | null;
  readonly markoutA: string | null;
  readonly thisGeneration: boolean;
}

export interface PnlTable {
  readonly rows: PnlRow[];
  readonly book: PnlRow | null;
  readonly fills: PnlFill[];
  /**
   * Always false, and asserted in the tests.
   *
   * The book's totals come from `bookTotals`, which knows which legs could be valued and returns a
   * caveat when one could not. Re-summing the leg rows on screen would quietly disagree with it the
   * moment a leg is unread — the screen would show a book richer than the book.
   */
  readonly resums: false;
}

export function pnlTable(legs: readonly Leg[], book: BookTotals | undefined): PnlTable {
  const rows: PnlRow[] = legs.map((leg) => ({
    label: leg.label,
    fills: leg.pnl?.fills ?? 0,
    edgeA: leg.pnl?.edgeA ?? "0",
    markoutA: leg.pnl?.markoutA ?? null,
    tradingA: leg.pnl?.tradingA ?? null,
    holdA: leg.pnl?.holdA ?? null,
    totalA: leg.pnl?.totalA ?? null,
    caveat: leg.pnl?.caveat ?? null,
  }));

  const fills: PnlFill[] = legs
    .flatMap((leg) =>
      leg.fills.map((fill) => ({
        label: leg.label,
        atSeconds: fill.atSeconds,
        transaction: fill.transaction,
        isAToB: fill.isAToB,
        sizeA: fill.sizeA ?? null,
        edgeA: fill.edgeA ?? null,
        markoutA: fill.markoutA ?? null,
        thisGeneration: fill.thisGeneration === true,
      })),
    )
    .sort((a, b) => b.atSeconds - a.atSeconds);

  return {
    rows,
    book:
      book === undefined
        ? null
        : {
            label: "book",
            fills: rows.reduce((n, row) => n + row.fills, 0),
            edgeA: "—",
            markoutA: null,
            tradingA: book.tradingA,
            holdA: book.holdA,
            totalA: book.pnlA,
            caveat: book.caveat,
          },
    fills,
    resums: false,
  };
}
