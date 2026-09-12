/**
 * What is wrong with a recorded fixture set as a single moment, one line per problem.
 *
 * The recorder runs unattended and its log is read hours later, so this is its whole judgement of
 * the run. Three things make a set not one moment: a leg whose history came back without its
 * position, legs whose registries are on different seqs, and a registry ahead of the fills subgraph
 * recorded beside it. The last is the quiet one — the registry is read over RPC and is current
 * within a block, the subgraph lags it by however long indexing takes, and a set recorded in that
 * gap has a newest round missing a leg while every seq still agrees.
 *
 * A fourth makes a set a poor moment rather than a broken one: a round whose tilt was carried. The
 * slow workflow republishes the last fast round's tilt against a freshly budgeted boundary, so the
 * slot holds a tilt priced with one room beside a boundary that recovers a different one — and the
 * console's recomputation then lands a few basis points away on every leg at once. Reproducing the
 * enclave's number is the claim this surface exists to make, so a moment that cannot demonstrate it
 * is one to record again after the next fast round.
 */
export interface RecordedLeg {
  readonly name: string;
  readonly history: { position?: unknown; references?: { seq: number | string; tiltBps?: number }[] };
  readonly ref: { seq: number | string; tiltBps?: number };
}

export function momentProblems(legs: RecordedLeg[], legCount: number): string[] {
  const problems: string[] = [];
  for (const leg of legs) {
    if (leg.history.position == null) problems.push(`history-${leg.name}: written without its position`);
  }

  const seqs = new Set(legs.map((leg) => Number(leg.ref.seq)));
  if (legs.length === legCount && seqs.size !== 1) {
    problems.push(`legs are on different seqs (${[...seqs].join(", ")}), so this is not one moment`);
  }

  for (const leg of legs) {
    const indexed = Math.max(0, ...(leg.history.references ?? []).map((r) => Number(r.seq)));
    const seq = Number(leg.ref.seq);
    if (indexed < seq) {
      problems.push(
        `${leg.name}: the registry is at seq ${seq} but its fills subgraph has indexed only up to ${indexed || "none"}; record again once it catches up`,
      );
    }
  }
  // Carried on every leg, or it is not a carried round: the slow workflow republishes the whole
  // book, so one leg repeating a tilt by coincidence is a coincidence.
  const carries = legs.map((leg) => {
    const seq = Number(leg.ref.seq);
    const previous = (leg.history.references ?? []).find((r) => Number(r.seq) === seq - 1);
    return previous !== undefined && previous.tiltBps !== undefined && leg.ref.tiltBps !== undefined
      ? previous.tiltBps === leg.ref.tiltBps
      : false;
  });
  if (legs.length === legCount && carries.length > 0 && carries.every(Boolean)) {
    problems.push(
      `seq ${Number(legs[0]!.ref.seq)} carried its tilt from the round before and re-budgeted the boundary, ` +
        "so the console cannot reproduce the published shift from it; record again after the next fast round",
    );
  }
  return problems;
}
