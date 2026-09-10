/**
 * What is wrong with a recorded fixture set as a single moment, one line per problem.
 *
 * The recorder runs unattended and its log is read hours later, so this is its whole judgement of
 * the run. Three things make a set not one moment: a leg whose history came back without its
 * position, legs whose registries are on different seqs, and a registry ahead of the fills subgraph
 * recorded beside it. The last is the quiet one — the registry is read over RPC and is current
 * within a block, the subgraph lags it by however long indexing takes, and a set recorded in that
 * gap has a newest round missing a leg while every seq still agrees.
 */
export interface RecordedLeg {
  readonly name: string;
  readonly history: { position?: unknown; references?: { seq: number | string }[] };
  readonly ref: { seq: number | string };
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
  return problems;
}
