import { Box, Text } from "ink";
import { type Snapshot, humanDuration, weightPercent } from "@zentis/console-data";
import type { Action } from "../action-types.js";
import { type Seg, fitSegments, trunc } from "../layout.js";
import { Segments } from "./Segments.js";
import { TERM, UI } from "../theme.js";

/**
 * The first line anyone reads: what state the book is in, and what to press about it.
 *
 * The old console showed a leg's refusal three times, once per column, each truncated. The single
 * most common state a new viewer meets is a stale reference and every quote refused, and nothing on
 * screen said why or what to do. That sentence belongs here, once, in full — which is also why this
 * region is never shed as the terminal shrinks.
 */
export interface BookState {
  readonly tone: string;
  /** longest first; the widest that fits is shown, so the remedy is never half-printed */
  readonly variants: string[];
}

export function bookState(snapshot: Snapshot, armed: boolean): BookState {
  // An outage comes first, and is not the same fact as the legs having drifted apart. During a
  // rate-limit refusal every leg reads as null, and reporting that as "legs are on different
  // references" says the book has come apart when it has only gone unread.
  const unread = snapshot.legs.filter((l) => l.sources.fills !== null);
  if (unread.length === snapshot.legs.length && unread.length > 0) {
    const why = unread[0]!.sources.fills!;
    // Also offered short, because the mode — armed or watch-only — has to survive beside it. A
    // console that stops saying whether it can sign is a console someone may assume can.
    const brief = why.replace(/^subgraph HTTP /, "");
    return {
      tone: UI.rejection,
      variants: [
        `fills subgraph unavailable (${why}) — showing what it last read`,
        `fills subgraph unavailable (${why})`,
        `fills unavailable (${brief})`,
        `fills unavailable`,
      ],
    };
  }

  const refusing = snapshot.legs.filter((l) => l.spread?.tooStaleToQuote === true);
  const docked = snapshot.legs.filter((l) => l.position !== null && !l.position.active);
  const oldest = snapshot.legs
    .map((l) => l.spread?.referenceAgeSeconds)
    .filter((a): a is number => a !== undefined && a !== null)
    .reduce<number | null>((max, a) => (max === null || a > max ? a : max), null);

  if (refusing.length > 0) {
    const limit = refusing[0]!.position?.maxStalenessSeconds ?? 0;
    const age = humanDuration(oldest ?? 0);
    // The remedy depends on whether this console can act. Telling a watch-only viewer to press a
    // key that is disabled would be worse than telling them nothing.
    const remedy = armed ? "press r to republish" : "the operator has to republish";
    const all = refusing.length === snapshot.legs.length;
    const scope = all
      ? `reference stale ${age}, past the ${humanDuration(limit)} limit`
      : `${refusing.length} of ${snapshot.legs.length} legs stale past the ${humanDuration(limit)} limit`;
    return {
      tone: UI.rejection,
      // The remedy is the last thing to go, and it goes whole: half of "press r to republish" is
      // worse than none of it.
      variants: [
        `${scope} — ${all ? "every quote refused, " : ""}${remedy}`,
        `${scope} — ${remedy}`,
        `stale ${age} — ${remedy}`,
        `stale ${age}`,
      ],
    };
  }
  if (docked.length > 0) {
    return {
      tone: TERM.staleness,
      variants: [`${docked.map((l) => l.config.label).join(", ")} docked`, "a leg is docked"],
    };
  }
  if (snapshot.seq === null) {
    return {
      tone: UI.rejection,
      variants: [
        "legs are on different references, so this is not one book",
        "legs are on different references",
      ],
    };
  }
  return {
    tone: UI.fill,
    variants: [`reference fresh · ${humanDuration(oldest ?? 0)}`, `fresh ${humanDuration(oldest ?? 0)}`],
  };
}

/** Key hints, degraded by measured width rather than allowed to overflow. */
function hints(actions: Action[], width: number): string {
  const full = actions.map((a) => `${a.key} ${a.label}`).join(" · ");
  const short = actions.map((a) => a.key).join(" ");
  return trunc(
    [`${full} · ? help · x quit`, `${short} ? x`].find((h) => h.length <= width) ?? short,
    width,
  );
}

export function StatusBar({
  snapshot,
  actions,
  armed,
  rows,
  width,
  transient,
}: {
  snapshot: Snapshot;
  actions: Action[];
  armed: boolean;
  rows: number;
  width: number;
  /** the finality countdown or the landing line, present only while an action is in flight */
  transient: string | null;
}) {
  const state = bookState(snapshot, armed);
  const symbol = snapshot.legs[0]?.config.tokenA.symbol ?? "";
  // The book split is omitted rather than shown as zero when no leg could be read: a book that
  // reads 0% USDC is a claim about the position, and nothing was read to support it.
  const known = snapshot.legs.some((l) => l.sources.fills === null);
  // Ordered by what may be dropped first. The mode is last because it is the only one that is a
  // safety fact: a console that stops saying whether it can sign is one someone may assume can.
  // The seq survives a subgraph outage — the registries are read over RPC — so during an outage it
  // is present and long, and it was pushing the mode off the line.
  const optional = [
    snapshot.seq === null ? null : `seq ${snapshot.seq}`,
    known ? `${weightPercent(snapshot.bookWeightA)}% ${symbol}` : null,
  ].filter((f): f is string => f !== null);
  const mode = armed ? "armed" : "watch-only";
  const factRuns = [...optional.map((_, i) => [...optional.slice(i), mode]), [mode]].map((parts) =>
    parts.join(" · "),
  );

  // The state sentence takes what it needs and the facts take what is left. Both are chosen from
  // whole variants, because a clipped seq is a different seq and a clipped remedy is not a remedy.
  const line = fitSegments(
    state.variants.flatMap((variant): Seg[][] =>
      factRuns.map((facts) => [
        { text: variant, color: state.tone, bold: true },
        { text: `   ${facts}`, color: UI.muted },
      ]),
    ),
    width,
  );

  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      <Box height={1}>
        <Segments segs={line} />
      </Box>
      {rows > 1 && (
        <Text color={transient === null ? UI.muted : UI.caveat}>
          {transient === null ? hints(actions, width) : trunc(transient, width)}
        </Text>
      )}
    </Box>
  );
}
