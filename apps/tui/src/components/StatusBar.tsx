import { Box, Text } from "ink";
import { type Snapshot, humanDuration, referenceAgeSeconds, weightPercent } from "@zentis/console-data";
import { duration } from "../format.js";
import type { Action } from "../action-types.js";
import { type Seg, fitSegments, trunc } from "../layout.js";
import { Segments } from "./Segments.js";
import { bookSegments } from "./BookRow.js";
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

  // The pages and the command line are keys like any other, and a key a reader is never told about
  // may as well not exist: the help page had them, the row a reader actually looks at did not. What
  // gives way as the row narrows is the words, never the keys themselves.
  const rest = (long: boolean): Seg[] =>
    long
      ? [
          { text: " · p positions · n pnl · w wallet · m sim · : command", color: UI.muted },
          { text: " · ←→ leg · enter detail · t window · ? help · x quit", color: UI.muted },
        ]
      : [{ text: " p n w m : ←→ enter t ? x", color: UI.muted }];

  return fitSegments(
    [
      [...keys(true), ...rest(true)],
      [...keys(true), rest(true)[0]!, { text: " · ? help · x quit", color: UI.muted }],
      [...keys(true), ...rest(false)],
      [...keys(false), ...rest(false)],
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

  // Only the state sentence. The split, the seq, the mode and the pulse belong to the overall view
  // above, and carrying them here too put two splits on screen — one at the pools' mids and one at
  // the mainnet mark — under the same word.
  const line = fitSegments(
    state.variants.map((variant): Seg[] => [{ text: variant, color: state.tone, bold: true }]),
    width,
  );

  const note = transient === null ? null : (
    <Text color={transient.quiet ? UI.muted : UI.caveat}>{trunc(transient.text, width)}</Text>
  );

  // The overall view leads, on every page and at every size: what the maker owns, whether it is one
  // book, and whether it is making money. Then the state, the keys, and what the last action said —
  // shed in that order as the height goes, except that a live note takes the state's row, because a
  // confirmation prompt has to be seen.
  const book = bookSegments(snapshot, armed, polledAgo, loading, width);
  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      <Box height={1}>
        <Segments segs={book} />
      </Box>
      {rows > 1 && <Box height={1}>{rows < 4 && note !== null ? note : <Segments segs={line} />}</Box>}
      {rows > 2 && (
        <Box height={1}>
          <Segments segs={hints(actions, width)} />
        </Box>
      )}
      {rows > 3 && <Box height={1}>{note ?? <Text> </Text>}</Box>}
    </Box>
  );
}
