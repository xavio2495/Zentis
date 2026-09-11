import type { Snapshot } from "./snapshot.js";
import { referenceAgeSeconds } from "./age.js";
import { humanDuration } from "./duration.js";

/**
 * Everything the console depends on, and whether it answered.
 *
 * The console reads eleven endpoints — two per chain, plus the quote service, the mark and the
 * gateway behind the market series — and a failure in any of them used to arrive as a sentence
 * somewhere on the screen: in a card, in the feed, in a caveat under the status bar. A reader could
 * not tell which sources were answering without reading the whole screen and inferring it.
 *
 * So this is the list, one entry per thing that can be down, with the short reason when it is. Long
 * explanations belong in help; this is the panel a reader checks when a number looks wrong.
 */
export type ProviderKind = "rpc" | "fills" | "quotes" | "mark" | "market" | "reference";

export interface Provider {
  readonly kind: ProviderKind;
  /** what to call it on screen, chain included where there is one per chain */
  readonly name: string;
  readonly ok: boolean;
  /** why it is down, short enough to sit beside its name at eighty columns */
  readonly reason: string | null;
  /** what it is doing when it is up: an age, a count, whatever the reader would want */
  readonly detail: string | null;
}

/** The first clause of a reason, which is the part that says what happened. */
const short = (reason: string, limit = 40): string => {
  const first = reason.split(/[;.]|, so /)[0]!.trim();
  return first.length <= limit ? first : `${first.slice(0, limit - 1)}…`;
};

/** A caveat the snapshot raised about one of the book-wide services, if it raised one. */
const caveatFor = (snapshot: Snapshot, prefix: string): string | null =>
  snapshot.caveats.find((c) => c.startsWith(prefix))?.slice(prefix.length).replace(/^:?\s*/, "") ?? null;

export function providersOf(snapshot: Snapshot): Provider[] {
  const providers: Provider[] = [];

  for (const leg of snapshot.legs) {
    const chain = leg.config.name.replace(/-sepolia$/, "");
    // The registry is read over RPC, so whether that read answered is what the console knows about
    // the chain's endpoint. Nothing else it does would notice the RPC being down first.
    providers.push({
      kind: "rpc",
      name: `rpc ${chain}`,
      ok: leg.sources.registry === null,
      reason: leg.sources.registry === null ? null : short(leg.sources.registry),
      detail: leg.ref === null ? null : `seq ${leg.ref.seq}`,
    });
    providers.push({
      kind: "fills",
      name: `fills ${chain}`,
      ok: leg.sources.fills === null,
      reason: leg.sources.fills === null ? null : short(leg.sources.fills),
      detail: leg.sources.fills === null ? "indexed" : null,
    });
  }

  const quotes = caveatFor(snapshot, "quotes unavailable");
  providers.push({
    kind: "quotes",
    name: "quote service",
    ok: quotes === null,
    reason: quotes === null ? null : short(quotes),
    detail: quotes === null ? "quoting" : null,
  });

  const mark = caveatFor(snapshot, "the mainnet mark");
  const markSource = snapshot.legs.find((l) => l.mark !== null)?.mark ?? null;
  providers.push({
    kind: "mark",
    name: "mark",
    ok: mark === null && markSource !== null,
    reason: mark === null ? (markSource === null ? "no mark" : null) : short(mark),
    detail: markSource?.source ?? null,
  });

  const market = caveatFor(snapshot, "the market series");
  providers.push({
    kind: "market",
    name: "market series",
    ok: market === null && snapshot.market !== null,
    reason: market === null ? (snapshot.market === null ? "no series" : null) : short(market),
    detail: snapshot.market === null ? null : `${snapshot.market.points.length} points`,
  });

  // The registries are read, but what matters about them is the age of what they hold: a reference
  // nobody has republished is a source that has gone quiet without any endpoint failing.
  const age = snapshot.legs
    .map((leg) => referenceAgeSeconds(leg, snapshot.takenAtSeconds))
    .filter((a): a is number => a !== null)
    .reduce<number | null>((max, a) => (max === null || a > max ? a : max), null);
  const limit = snapshot.legs
    .map((leg) => leg.position?.maxStalenessSeconds)
    .filter((l): l is number => l !== undefined)
    .reduce<number | null>((min, l) => (min === null || l < min ? l : min), null);
  providers.push({
    kind: "reference",
    name: "references",
    ok: age === null || limit === null || age <= limit,
    reason: age !== null && limit !== null && age > limit ? `${humanDuration(age)} old, past ${humanDuration(limit)}` : null,
    detail: age === null ? "none read" : `${humanDuration(age)} old`,
  });

  return providers;
}
