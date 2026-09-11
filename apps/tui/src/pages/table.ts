import { type Seg, segWidth } from "../layout.js";
import { UI } from "../theme.js";

/**
 * A column table, measured before it is drawn.
 *
 * The pages are all the same shape — a header, then one row per leg or per chain — and the reason
 * they are built through this rather than by padding strings is the reason the feed is: Ink squeezes
 * an overlong row by deleting characters *inside* it, so a row that is one cell too wide loses a
 * digit out of the middle of a number rather than a column off the end.
 *
 * A column may be `optional`, meaning it is given up whole, rightmost first, when the table does not
 * fit. Nothing is ever half-shown: a column is either there with all its rows or it is not there.
 */
export interface Column {
  readonly header: string;
  /** one per row, in row order; a missing entry is an empty cell */
  readonly cells: Seg[][];
  readonly optional?: boolean;
  /** numbers read better right-aligned, so their units line up down the column */
  readonly align?: "left" | "right";
}

export interface Table {
  readonly header: Seg[];
  readonly rows: Seg[][];
}

const GAP = 2;

export function columns(cols: Column[], width: number, rowCount: number): Table {
  const keep = [...cols];
  const widthOf = (list: Column[]) =>
    list.reduce((sum, c, i) => {
      const cells = [c.header.length, ...c.cells.map(segWidth)];
      return sum + Math.max(...cells) + (i === 0 ? 0 : GAP);
    }, 0);

  // Dropped rightmost first: the leftmost column names the row, and a table whose first column went
  // is a table of anonymous numbers.
  for (let i = keep.length - 1; i >= 0 && widthOf(keep) > width; i -= 1) {
    if (keep[i]!.optional === true) keep.splice(i, 1);
  }

  const sizes = keep.map((c) => Math.max(c.header.length, ...c.cells.map(segWidth)));
  const pad = (segs: Seg[], size: number, align: Column["align"]): Seg[] => {
    const room = size - segWidth(segs);
    if (room <= 0) return segs;
    const filler: Seg = { text: " ".repeat(room) };
    return align === "right" ? [filler, ...segs] : [...segs, filler];
  };
  const gap: Seg = { text: " ".repeat(GAP) };
  const line = (get: (c: Column, i: number) => Seg[]): Seg[] =>
    keep.flatMap((c, i) => {
      const cell = pad(get(c, i), sizes[i]!, c.align);
      return i === 0 ? cell : [gap, ...cell];
    });

  return {
    header: line((c) => [{ text: c.header, color: UI.muted }]),
    rows: Array.from({ length: rowCount }, (_, row) => line((c) => c.cells[row] ?? [])),
  };
}
