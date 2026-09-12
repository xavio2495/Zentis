import { useEffect, useState } from "react";
import { useStdout } from "ink";

/**
 * Sizing. Knows nothing about Zentis.
 *
 * `fit()` is pure so that the guarantee that matters — the regions always sum to less than the
 * terminal's height, at every width — is testable without a renderer. It has to hold: Ink clears the
 * whole terminal the moment its output reaches `stdout.rows`, and a console that repaints from
 * scratch every frame is unusable. Hence `draw = rows - 1`, one row of headroom, always.
 */

/** Below this the console draws one line saying so, because the wireframe's shape cannot survive it. */
export const MIN_COLS = 80;
export const MIN_ROWS = 24;

export interface Size {
  readonly cols: number;
  readonly rows: number;
  readonly tooSmall: boolean;
}

/**
 * The live terminal size, unclamped.
 *
 * Deliberately not clamped here: clamping at the source is how a frame ends up wider than the
 * terminal it is in, which is the exact wrap-and-overflow failure the clamp was meant to prevent.
 * `fit()` does its own clamping, and it is the only thing that should.
 */
export function useSize(): Size {
  const { stdout } = useStdout();
  const read = (): Size => {
    // A terminal that reports 0 is reporting "I do not know", not "I am zero wide" — a pty opened
    // without a size does exactly this. `??` does not catch it, and treating it as a real size makes
    // the console refuse to draw in a terminal that is actually fine.
    const known = (value: number | undefined, fallback: number) =>
      value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : value;
    const cols = known(stdout?.columns, 80);
    const rows = known(stdout?.rows, 24);
    return { cols, rows, tooSmall: cols < MIN_COLS || rows < MIN_ROWS };
  };
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (stdout?.on === undefined) return undefined;
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off?.("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdout]);
  return size;
}

export interface Regions {
  /** the terminal's height less one row of headroom */
  readonly draw: number;
  /** the three stacked leg cards, left third */
  readonly legsWidth: number;
  readonly cardHeights: [number, number, number];
  /** status bar, graphs and feed, right two thirds */
  readonly rightWidth: number;
  /** the status bar's content rows, not counting its border */
  readonly statusRows: number;
  readonly graphRows: number;
  readonly feedRows: number;
  /** the keys' own section, below the feed */
  readonly keyRows: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Every region's size, from the terminal's.
 *
 * The wireframe's proportions — a left third of stacked leg cards, a right two thirds carrying a
 * status bar, a chart region of roughly half the height, and the feed below — hold at any size. What
 * gives ground as the terminal shrinks is the chart, then the feed, and never the status bar: the
 * status bar is where the reason a quote is refused and the key that fixes it are written, so a
 * console that shed it would drop the one thing a new reader needs.
 */
export function fit(cols: number, rows: number): Regions {
  const draw = Math.max(1, rows - 1);

  // The left third, bounded: below 28 a leg card cannot hold a quote and a gauge, and above 40 the
  // extra width is gutter rather than information while the charts still want room.
  const legsWidth = clamp(Math.floor(cols * 0.33), 28, 40);
  const rightWidth = Math.max(20, cols - legsWidth - 1); // one column of gutter

  // Two rows: the state and its call to action, then the key hints. One row when there is no height
  // for the second, in which case the hints are what goes — `?` still reaches them.
  // Every region is a bordered panel now, and a border costs two rows. The status bar's own content
  // is one or two lines inside that.
  // Three when there is room — the state, the keys, and what the last action said — so a note never
  // has to displace the keys. Two on a short terminal, one on the smallest.
  // The top panel is the critical information, and it is short: the book's own row, the state it is
  // in, one mark per source, and what the last action said. The sources' own detail is a page, which
  // is what keeps the rest of this height with the chart and the feed.
  // Two: the book, and the reference's state with the source marks beside it. A note from the last
  // action takes the book's row while it is live rather than adding one of its own.
  const statusRows = 2;

  const BORDER = 2;
  // The keys have a section of their own below the feed now: one row inside its own border. They are
  // not critical information, and they were sitting above the one thing that is.
  const keyRows = 1;
  const rightBody = Math.max(0, draw - statusRows - BORDER - (keyRows + BORDER));
  // Roughly half to the charts, per the wireframe, but never so little that a chart is a single row
  // of noise, and never so much that the feed cannot show a publish and the fill that preceded it.
  const graphRows = rightBody < 10 ? 0 : clamp(Math.floor(rightBody * 0.5), 7, 22);
  const feedRows = Math.max(0, rightBody - graphRows);

  // The three cards divide the full height; the remainder goes to the last so the column always
  // fills exactly, rather than leaving a ragged row that shifts as the terminal changes.
  const each = Math.floor(draw / 3);
  const cardHeights: [number, number, number] = [each, each, draw - each * 2];

  return { draw, legsWidth, cardHeights, rightWidth, statusRows, graphRows, feedRows, keyRows };
}

/** Truncate to width, with an ellipsis when it bites. */
export const trunc = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

/** Truncate, then pad — the shape every fixed cell in this UI uses. */
export const pad = (text: string, width: number): string => trunc(text, width).padEnd(width);

/**
 * Hard wrap, to a fixed number of lines.
 *
 * Ink's own wrapping gives no way to bound the result, and a region whose height depends on how much
 * there was to say drags every region below it up and down between polls.
 */
export function wrapLines(text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== "");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (candidate.length <= width) {
      line = candidate;
      continue;
    }
    if (lines.length + 1 === maxLines) {
      return [...lines, trunc(`${line} ${word}`, width)];
    }
    lines.push(line);
    line = word.length <= width ? word : word.slice(0, width);
  }
  if (line !== "") lines.push(line);
  return lines.length === 0 ? [""] : lines;
}

/** Pad a list of rows to exactly `height`, so a region never changes size as its contents do. */
export const padRows = <T,>(rows: T[], height: number, blank: T): T[] =>
  rows.length >= height ? rows.slice(0, height) : [...rows, ...Array(height - rows.length).fill(blank)];

/**
 * A run of text with its colour — the unit every row on this screen is built from.
 *
 * Ink shortens a row of adjacent `<Text>` nodes that overruns its box by deleting characters from
 * inside each one, so `seq 1789029519` becomes `seq1789029` and a leg's `-349` becomes `-1`. Numbers
 * get smaller while still looking like numbers. The only defence is to never hand Ink a row that
 * might not fit, which means measuring it first — and measuring means the row has to exist as data
 * before it exists as elements.
 */
export interface Seg {
  readonly text: string;
  readonly color?: string;
  readonly bold?: boolean;
}

export const segWidth = (segs: Seg[]): number => segs.reduce((n, s) => n + s.text.length, 0);

/**
 * The widest variant that fits, or the last one cut to width.
 *
 * Variants are given longest first and are complete rows, not fragments: what narrowing drops is
 * context — a symbol, a label, a chain's full name — and never a digit. Cutting the last variant is
 * the floor, and it cuts at the end where an ellipsis is visible, rather than in the middle where a
 * deletion is not.
 */
/**
 * The first variant that fits every row, as an index into each row's own variant list.
 *
 * Rows that belong together have to degrade together. The card's two quote sides are the case:
 * one is longer than the other, so fitting each on its own left the shorter side carrying its
 * distance from the mid and the longer side not, and a reader comparing a number against a blank
 * concludes the second side has no distance rather than that the card ran out of room.
 *
 * Falls back to the last index, where `fitSegments` truncates, exactly as fitting one row does.
 */
export function fitTogether(rows: Seg[][][], width: number): Seg[][] {
  const depth = Math.min(...rows.map((variants) => variants.length))
  for (let i = 0; i < depth; i += 1) {
    if (rows.every((variants) => segWidth(variants[i]!) <= width)) {
      return rows.map((variants) => variants[i]!)
    }
  }
  return rows.map((variants) => fitSegments(variants.slice(depth - 1), width))
}

export function fitSegments(variants: Seg[][], width: number): Seg[] {
  for (const variant of variants) {
    if (segWidth(variant) <= width) return variant;
  }
  const last = variants[variants.length - 1] ?? [];
  const out: Seg[] = [];
  let used = 0;
  for (const seg of last) {
    if (used >= width) break;
    const room = width - used;
    if (seg.text.length <= room) {
      out.push(seg);
      used += seg.text.length;
      continue;
    }
    out.push({ ...seg, text: trunc(seg.text, room) });
    used = width;
  }
  return out;
}

/**
 * What the row below the feed is showing.
 *
 * The keys and the command line share one slot rather than stacking. The operator presses `:` to
 * say "I am giving an instruction", and the key hints are the answer to a question they have just
 * stopped asking — so the hints give way to the prompt rather than sitting above it. It also keeps
 * the height budget exact: `fit()` divides the terminal between the status, the chart, the feed and
 * this one row, and a prompt rendered underneath all of them is a row nobody allowed for.
 */
export function bottomSlot(typing: string | null): "keys" | "command" {
  // The empty string is a command line with nothing typed into it yet, not the absence of one.
  return typing === null ? "keys" : "command";
}
