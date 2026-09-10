import results from "../../sim-report/results/latest.json" with { type: "json" };

/**
 * The simulation card's numbers, from the committed run and nowhere else.
 *
 * They are read rather than passed in so that no screen can be handed a figure that did not come
 * from a run someone committed; the file carries the model commit it was produced at, and the card
 * prints it, so a stale card is visible as a stale card rather than as a confident one.
 *
 * There is no "bps saved" here on purpose. The harness is uncalibrated, so these are relative
 * standings between policies over shared seeds — a mean, a spread and a worst case against static —
 * and the card is labelled with the parameters that produced them.
 */
export interface Regime {
  readonly regime: string;
  readonly seeds: number;
  readonly meanVsStatic: number;
  readonly sdVsStatic: number;
  readonly worstVsStatic: number;
  readonly seedsAhead: number;
}

export interface SimReport {
  readonly generatedAt: string;
  readonly modelCommit: string;
  readonly unit: string;
  readonly signal: string;
  readonly kappaBps: number;
  readonly kappaBookBps: number;
  readonly ticks: number;
  readonly regimes: Regime[];
  /** every regime's seeds, when they agree; null when a run mixed them */
  readonly seedsPerRegime: number | null;
}

export function loadSimReport(): SimReport {
  const seeds = new Set(results.regimes.map((r) => r.seeds));
  return {
    generatedAt: results.generatedAt,
    modelCommit: results.modelCommit,
    unit: results.unit,
    signal: results.book.signal,
    kappaBps: results.book.kappa_bps,
    kappaBookBps: results.book.kappa_book_bps,
    ticks: results.series.ticks,
    regimes: results.regimes.map((r) => ({
      regime: r.regime,
      seeds: r.seeds,
      meanVsStatic: r.meanVsStatic,
      sdVsStatic: r.sdVsStatic,
      worstVsStatic: r.worstVsStatic,
      seedsAhead: r.seedsAhead,
    })),
    seedsPerRegime: seeds.size === 1 ? results.regimes[0]!.seeds : null,
  };
}

/**
 * The one line the card can lead with, built from the run rather than written: how many regimes the
 * policy led in every seed of. It says nothing about size, because size from this harness would be
 * a number the harness has not earned.
 */
export function headline(report: SimReport): string {
  const clean = report.regimes.filter((r) => r.seedsAhead === r.seeds);
  const seeds = report.seedsPerRegime;
  return `ahead of static in every seed of ${clean.length} of ${report.regimes.length} regimes` +
    (seeds === null ? "" : ` (${seeds} seeds each)`);
}
