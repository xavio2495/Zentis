import { Box, Text } from "ink";
import { type Snapshot, humanDuration, referenceAgeSeconds, weightPercent } from "@zentis/console-data";
import { duration } from "../format.js";
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
  // One rule for a reference's age, shared with the leg detail, so the two cannot disagree about the
  // same seq; it reads the slot over RPC when the fills are unread.
  const oldest = snapshot.legs
    .map((l) => referenceAgeSeconds(l, snapshot.takenAtSeconds))
    .filter((a): a is number => a !== null)
    .reduce<number | null>((max, a) => (max === null || a > max ? a : max), null);
  const limits = snapshot.legs
    .map((l) => l.position?.maxStalenessSeconds)
    .filter((limit): limit is number => limit !== undefined);
  const limit = limits.length === 0 ? null : Math.min(...limits);

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
    // "fresh · 21m" read as a contradiction. Against its limit it does not: 21m of an hour is fresh.
    variants: [
      limit === null
        ? `reference fresh · ${humanDuration(oldest ?? 0)} old`
        : `reference fresh · ${humanDuration(oldest ?? 0)} of ${humanDuration(limit)}`,
      `fresh ${humanDuration(oldest ?? 0)}`,
    ],
  };
}

/**
 * The key hints, always shown, with the keys that cannot run dimmed rather than removed.
 *
 * They used to be replaced by whatever the last action said — including the signing-key sentence
 * when a watch-only viewer pressed `r` — so a viewer could not tell which keys existed. The reason a
 * key is off lives in the `?` overlay, where someone who wants to arm the console will look.
 */
function hints(actions: Action[], width: number): Seg[] {
  const tone = (a: Action) => (a.disabledReason === null ? UI.action : UI.disabled);
  const keys = (long: boolean): Seg[] =>
    actions.flatMap((a, i): Seg[] => [
      ...(i === 0 ? [] : [{ text: long ? " · " : " ", color: UI.muted }]),
      { text: long ? `${a.key} ${a.label}` : a.key, color: tone(a) },
    ]);
  return fitSegments(
    [
      [...keys(true), { text: " · ←→ price · 1-3 detail · t window · ? help · x quit", color: UI.muted }],
      [...keys(true), { text: " · ? help · x quit", color: UI.muted }],
      [...keys(false), { text: " ←→ 1-3 t ? x", color: UI.muted }],
      [...keys(false), { text: " ? x", color: UI.muted }],
    ],
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
  polledAgo,
  loading,
}: {
  snapshot: Snapshot;
  actions: Action[];
  armed: boolean;
  rows: number;
  width: number;
  /**
   * What the last action said, while it matters. `quiet` is for notes that are not warnings — a
   * watch-only viewer pressing a key that is off — and they are drawn dim.
   */
  transient: { text: string; quiet: boolean } | null;
  /** seconds since the last completed poll, or null before the first */
  polledAgo: number | null;
  loading: boolean;
}) {
  const state = bookState(snapshot, armed);
  const symbol = snapshot.legs[0]?.config.tokenA.symbol ?? "";
  // The book split is omitted rather than shown as zero when no leg could be read: a book that
  // reads 0% USDC is a claim about the position, and nothing was read to support it.
  const unread = snapshot.legs.filter((l) => l.sources.fills !== null).length;
  // Ordered by what may be dropped first. The mode is last because it is the only one that is a
  // safety fact: a console that stops saying whether it can sign is one someone may assume can.
  // The seq survives a subgraph outage — the registries are read over RPC — so during an outage it
  // is present and long, and it was pushing the mode off the line.
  // A split computed from the legs that answered is not the book's split; with any leg unread the
  // honest statement is that it is unknown, and why.
  const split =
    unread === 0
      ? `${weightPercent(snapshot.bookWeightA)}% ${symbol}`
      : unread === snapshot.legs.length
        ? null
        : `book split unknown · ${unread} leg${unread === 1 ? "" : "s"} unread`;
  // Proof the screen is live. The first thing dropped when the line is short: it is reassurance, not
  // information about the book.
  const pulse = loading ? "polling…" : polledAgo === null ? null : `polled ${duration(polledAgo)} ago`;
  const optional = [pulse, snapshot.seq === null ? null : `seq ${snapshot.seq}`, split].filter(
    (f): f is string => f !== null,
  );
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

  const note = transient === null ? null : (
    <Text color={transient.quiet ? UI.muted : UI.caveat}>{trunc(transient.text, width)}</Text>
  );

  // Three rows when there is room: the state, the keys, and what the last action said. With two the
  // keys stay and an action's note takes the state's row while it is live — a confirmation prompt
  // has to be seen. With one, the note wins for the same reason.
  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      <Box height={1}>{rows < 3 && note !== null ? note : <Segments segs={line} />}</Box>
      {rows > 1 && (
        <Box height={1}>
          <Segments segs={hints(actions, width)} />
        </Box>
      )}
      {rows > 2 && <Box height={1}>{note ?? <Text> </Text>}</Box>}
    </Box>
  );
}
