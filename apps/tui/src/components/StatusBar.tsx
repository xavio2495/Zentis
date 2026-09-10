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
  const facts = [
    snapshot.seq === null ? null : `seq ${snapshot.seq}`,
    `${weightPercent(snapshot.bookWeightA)}% ${symbol}`,
    armed ? "armed" : "watch-only",
  ]
    .filter((f): f is string => f !== null)
    .join(" · ");

  // The state sentence takes what it needs and the facts take what is left. Both are chosen from
  // whole variants, because a clipped seq is a different seq and a clipped remedy is not a remedy.
  const line = fitSegments(
    state.variants.flatMap((variant): Seg[][] => [
      [
        { text: variant, color: state.tone, bold: true },
        { text: `   ${facts}`, color: UI.muted },
      ],
      [{ text: variant, color: state.tone, bold: true }],
    ]),
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
