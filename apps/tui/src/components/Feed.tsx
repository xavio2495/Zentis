import { Box, Text } from "ink";
import { BOOK, type FoldedRow, type LegSnapshot, type Snapshot, foldRounds, referenceChanges } from "@zentis/console-data";
import { duration, signed, tokenAmount } from "../format.js";
import { type Seg, fitSegments, padRows, segWidth, trunc } from "../layout.js";
import { Segments } from "./Segments.js";
import { LEG_ORDER, UI, legColour } from "../theme.js";
import { spinnerAt } from "../spinner.js";

/** A chain as the rest of the screen names it, so no reader has to learn that SEP means Sepolia. */
const nameOf = (leg: LegSnapshot): string => leg.config.label.split(" ")[0] ?? String(leg.config.chainId);

/**
 * One cell, as its renderings longest first. A layout picks a level, never a per-row choice, so a
 * column is as wide in every row as the widest thing it holds; a cell with fewer renderings than
 * the level uses its shortest.
 */
type Cell = Seg[][];
const cell = (text: string, color?: string, bold?: boolean): Cell => [[{ text, color, bold }]];
const BLANK: Cell = [[]];

interface TableRow {
  readonly when: Cell;
  /** what happened; a publish's event is its seq, the cross-chain claim the row records */
  readonly event: Cell;
  /** one cell per leg, in the cards' order */
  readonly legs: Cell[];
  /** what does not belong to a column, longest first; the last rendering is dropped whole if even it does not fit */
  readonly note: Seg[][];
}

/** A shift, and whether it is sitting on the leg's signed cap — where −500 is a limit, not a size. */
export function shiftCell(leg: LegSnapshot, tiltBps: number): Cell {
  const cap = leg.position?.maxTiltBps ?? BOOK.maxTiltBps;
  const number: Seg = { text: signed(tiltBps), color: UI.heading };
  if (Math.abs(tiltBps) < cap) return [[number]];
  return [
    [number, { text: " at cap", color: UI.muted }],
    [number, { text: " at cap", color: UI.muted }],
    [number, { text: " cap", color: UI.muted }],
  ];
}

/**
 * A leg a publish does not list. The workflow writes every leg in one publish, so a leg missing from
 * a row is usually one the console could not read, and saying so in its own column is what stops
 * the row reading as the workflow having written one leg.
 */
function absentCell(leg: LegSnapshot): Cell {
  return leg.sources.fills !== null ? cell("unread", UI.caveat) : cell("–", UI.muted);
}

function tableRow(
  row: FoldedRow,
  snapshot: Snapshot,
  ordered: LegSnapshot[],
  /** seqs where the published mid changed source rather than moved */
  changed: Set<number> = new Set(),
): TableRow {
  const ago = (t: bigint) => duration(snapshot.takenAtSeconds - Number(t));

  if (row.kind === "round" || row.kind === "fold") {
    const legs = ordered.map((leg) => {
      const entry = row.legs.find((l) => l.chainId === leg.config.chainId);
      return entry === undefined ? absentCell(leg) : shiftCell(leg, entry.tiltBps);
    });
    if (row.kind === "round") {
      return {
        when: cell(ago(row.timestamp), UI.muted),
        // "seq" stays through the middle level: a bare ten-digit number reads as a timestamp.
        event: [
          [{ text: "publish seq ", color: UI.reference }, { text: String(row.seq), color: UI.heading }],
          [{ text: "seq ", color: UI.reference }, { text: String(row.seq), color: UI.heading }],
          [{ text: String(row.seq), color: UI.heading }],
        ],
        legs,
        // A round where the mid came from somewhere else than the one before it. Every leg's shift
        // jumps at that round and none of it is a price move; a reader looking at the row without
        // this note is looking at a market event that did not happen.
        note: changed.has(row.seq)
          ? [
              [{ text: "the reference changed source here", color: UI.caveat }],
              [{ text: "reference changed source", color: UI.caveat }],
              [{ text: "new reference", color: UI.caveat }],
            ]
          : [],
      };
    }
    return {
      // The newest end orders the row, like every other age in the column; how far back the run goes
      // is said in its note, because a range in a column of ages is the one cell that does not line up.
      when: cell(ago(row.to), UI.muted),
      event: cell(`${row.count} publishes`, UI.reference),
      legs,
      note: [
        [{ text: `unchanged back to ${ago(row.from)}`, color: UI.muted }],
        [{ text: "unchanged", color: UI.muted }],
      ],
    };
  }

  const own = (value: Cell) =>
    ordered.map((leg) => (leg.config.chainId === row.chainId ? value : BLANK));

  if (row.kind === "rejection") {
    // Printed as the registry wrote it: `stale seq` is what finality looks like from outside, and the
    // pause in the demo is unintelligible without it.
    return {
      when: cell(ago(row.timestamp), UI.muted),
      event: cell("rejected", UI.rejection),
      legs: own(cell(row.reason, UI.rejection)),
      note: [],
    };
  }

  const leg = ordered.find((l) => l.config.chainId === row.chainId);
  const [from, to] = row.isAToB
    ? [leg?.config.tokenA, leg?.config.tokenB]
    : [leg?.config.tokenB, leg?.config.tokenA];
  const inText = `${tokenAmount(row.amountIn, from?.decimals ?? 18)} ${from?.symbol ?? ""}`;
  const outText = `${tokenAmount(row.amountOut, to?.decimals ?? 18)} ${to?.symbol ?? ""}`;
  const context =
    row.refTiltBps === null
      ? "  no reference had been published"
      : `  reference ${duration(Number(row.refAgeSeconds ?? 0n))} old`;
  return {
    when: cell(ago(row.timestamp), UI.muted),
    event: cell("fill", UI.fill),
    // The leg's column carries the shift the fill was priced at, the same quantity a publish row
    // puts there, so a fill reads against the publishes above and below it.
    legs: own(row.refTiltBps === null ? cell("–", UI.muted) : shiftCell(leg!, row.refTiltBps)),
    // What the taker paid is what makes what they got mean anything, so the in side is the last
    // thing given up rather than the first.
    note: [
      [{ text: `${inText} → ${outText}`, color: UI.heading }, { text: context, color: UI.muted }],
      [{ text: `${inText} → ${outText}`, color: UI.heading }],
    ],
  };
}

/**
 * The table's shape at one width: which rendering level its cells use, how far apart the columns
 * sit, and whether notes may be left out. Tried in order, first fit wins.
 *
 * Spacing outranks notes, and the seq outranks both: it is the cross-chain claim, so it is never
 * dropped, only said more briefly. A fill's amounts are shown whenever the columns leave room.
 */
interface Layout {
  readonly level: number;
  readonly gap: number;
  readonly notesMayDrop: boolean;
}
const LAYOUTS: Layout[] = [
  { level: 0, gap: 2, notesMayDrop: false },
  { level: 1, gap: 2, notesMayDrop: false },
  // The seq goes bare before a fill's amounts go at all: "seq" is a word a reader can supply from
  // the column header, and half a fill is not a fill.
  { level: 2, gap: 2, notesMayDrop: false },
  { level: 1, gap: 2, notesMayDrop: true },
  { level: 2, gap: 2, notesMayDrop: true },
  // One cell between columns is the last resort: "stale seq stale seq" run together is the table
  // failing at the one thing it is for.
  { level: 2, gap: 1, notesMayDrop: true },
];

const pick = (c: Cell, level: number): Seg[] => c[Math.min(level, c.length - 1)]!;
const padTo = (segs: Seg[], width: number): Seg[] => {
  const used = segWidth(segs);
  return used >= width ? segs : [...segs, { text: " ".repeat(width - used) }];
};

/**
 * Fills, refusals and publishes on one clock, in the order they happened, as a table with a column
 * per chain.
 *
 * The columns are the point. The same leg's shift sits at the same place on every row, so a reader
 * follows Base down the page instead of finding "Base" again in each sentence, and a refusal lands
 * under the chain that refused it. Column widths are measured from what the rows actually hold, and
 * every row is built to width before it is drawn: left to Ink, an overlong row loses characters from
 * inside its numbers.
 */
/**
 * Refusals from different chains within this many seconds of each other share a row. The workflow
 * relays one seq to every chain at once, so a stale one is refused everywhere within a block or two;
 * as separate rows, one event took three rows of mostly blank cells.
 */
const SAME_REFUSAL_SECONDS = 120n;

function mergeRefusals(rows: FoldedRow[]): FoldedRow[][] {
  const groups: FoldedRow[][] = [];
  for (const row of rows) {
    const group = groups[groups.length - 1];
    const first = group?.[0];
    if (
      row.kind === "rejection" &&
      first?.kind === "rejection" &&
      group!.every((r) => r.kind === "rejection" && r.chainId !== row.chainId) &&
      first.timestamp - row.timestamp <= SAME_REFUSAL_SECONDS
    ) {
      group!.push(row);
    } else {
      groups.push([row]);
    }
  }
  return groups;
}

/** A merged refusal row: the newest one's age, and each refusal's reason in its own chain's column. */
function refusalRow(group: FoldedRow[], snapshot: Snapshot, ordered: LegSnapshot[]): TableRow {
  const [first] = group.map((row) => tableRow(row, snapshot, ordered));
  return {
    ...first!,
    legs: ordered.map((leg) => {
      const own = group.find((r) => r.kind === "rejection" && r.chainId === leg.config.chainId);
      return own?.kind === "rejection" ? cell(own.reason, UI.rejection) : BLANK;
    }),
  };
}

function table(
  rows: FoldedRow[],
  snapshot: Snapshot,
  width: number,
  limit: number,
): { header: Seg[]; body: { key: string; segs: Seg[] }[] } {
  // The cards' order, not the data layer's, so a column sits in the same order as the cards beside it.
  const ordered = [
    ...LEG_ORDER.flatMap((id) => snapshot.legs.filter((l) => l.config.chainId === id)),
    ...snapshot.legs.filter((l) => !(LEG_ORDER as readonly number[]).includes(l.config.chainId)),
  ];
  // Computed over the whole feed rather than the visible slice: a cutover falls where it falls, and
  // whether its row is on screen must not change what the row says.
  const changed = referenceChanges(snapshot.feed);
  const groups = mergeRefusals(rows).slice(0, limit);
  const built = groups.map((group) =>
    group.length > 1 ? refusalRow(group, snapshot, ordered) : tableRow(group[0]!, snapshot, ordered, changed),
  );
  const headers: TableRow = {
    when: cell("when", UI.muted),
    event: cell("event", UI.muted),
    legs: ordered.map((leg) => cell(nameOf(leg), legColour(leg.config.chainId), true)),
    note: [],
  };
  const all = [headers, ...built];
  const hasNotes = built.some((r) => r.note.length > 0);
  // The least a note needs to say anything whole: its shortest rendering, across every row.
  const noteNeed = Math.max(0, ...built.map((r) => (r.note.length === 0 ? 0 : segWidth(r.note[r.note.length - 1]!))));

  const shape = (layout: Layout) => {
    const w = (get: (r: TableRow) => Cell) => Math.max(...all.map((r) => segWidth(pick(get(r), layout.level))));
    const widths = {
      when: w((r) => r.when),
      event: w((r) => r.event),
      legs: ordered.map((_, i) => w((r) => r.legs[i]!)),
    };
    const columns = [widths.when, widths.event, ...widths.legs];
    const used = columns.reduce((a, b) => a + b, 0) + layout.gap * (columns.length - 1);
    return { widths, used };
  };

  const layout =
    LAYOUTS.find((l) => {
      const { used } = shape(l);
      return used <= width && (l.notesMayDrop || !hasNotes || width - used - l.gap >= noteNeed);
    }) ?? LAYOUTS[LAYOUTS.length - 1]!;
  const { widths, used } = shape(layout);
  const gap: Seg = { text: " ".repeat(layout.gap) };
  const noteRoom = width - used - layout.gap;

  const line = (r: TableRow, note: Seg[][]): Seg[] => {
    const cells: Seg[][] = [
      // Ages are right-aligned, so the units line up and the eye reads the numbers.
      (() => {
        const segs = pick(r.when, layout.level);
        const pad = widths.when - segWidth(segs);
        return pad > 0 ? [{ text: " ".repeat(pad) }, ...segs] : segs;
      })(),
      padTo(pick(r.event, layout.level), widths.event),
      ...r.legs.map((c, i) => padTo(pick(c, layout.level), widths.legs[i]!)),
    ];
    const chosen = note.find((n) => segWidth(n) <= noteRoom);
    const segs = cells.flatMap((c, i) => (i === 0 ? c : [gap, ...c]));
    const out = chosen === undefined ? segs : [...segs, gap, ...chosen];
    // Trailing padding is not content; trimming it keeps the row's measured width honest.
    return fitSegments([out], width);
  };

  return {
    header: line(headers, []),
    body: built.map((r, i) => ({ key: `${groups[i]![0]!.kind}-${i}`, segs: line(r, r.note) })),
  };
}

export function Feed({
  snapshot,
  width,
  rows,
}: {
  snapshot: Snapshot;
  width: number;
  rows: number;
}) {
  // One row goes to the header, which names the columns every other row lines up under.
  const body = Math.max(0, rows - 1);
  const { header, body: lines } = table(foldRounds(snapshot.feed), snapshot, width, body);

  // A blank region during an outage reads as "nothing has happened", which is a claim. It has not
  // been established that nothing happened; the source that would say so has not answered. What that
  // source replied — the 429 and when it resets — is on its own line in the panel above, once for
  // the whole book, rather than clipped into the middle of an empty feed.
  const unread = snapshot.legs.map((l) => l.sources.fills).find((e) => e !== null) ?? null;
  const empty =
    unread !== null
      ? `${spinnerAt(Date.now())} waiting on fills`
      : "nothing indexed yet for this position";

  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      {/* Padded to the region's height so the feed does not resize as events arrive, which would
          drag the charts above it up and down between polls. */}
      {lines.length === 0 ? (
        <Box height={1}>
          <Text color={UI.muted}>{trunc(empty, width)}</Text>
        </Box>
      ) : (
        <Box height={1}>
          <Segments segs={header} />
        </Box>
      )}
      {padRows(
        lines.map(({ key, segs }) => <Segments key={key} segs={segs} />),
        body,
        null,
      ).map((row, i) => (
        <Box key={i} height={1}>
          {row ?? <Text> </Text>}
        </Box>
      ))}
    </Box>
  );
}
