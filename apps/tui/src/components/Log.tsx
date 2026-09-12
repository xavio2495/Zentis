import { Box, Text } from "ink";
import { duration } from "../format.js";
import { padRows, trunc } from "../layout.js";
import { columns } from "../pages/table.js";
import { Segments } from "./Segments.js";
import { UI } from "../theme.js";
import { type LogRow, countOf } from "../txlog.js";

/**
 * What has been sent, in the region the feed usually has.
 *
 * The feed is what the book did; this is what was done to it, and the two answer the same question
 * from opposite ends. What it draws is the machine's transaction log — a file this console's signing
 * child appends to, and so do the headless taker and the rebalance scripts beside it — so a fill
 * sent while the console was closed is on the list when it opens, and one sent by a script is not
 * missing from it.
 *
 * Six columns because a transaction has six facts worth having at a glance: when, on which chain,
 * what kind of thing it was, what moved, its hash, and whether it worked. A line with no hash is an
 * event rather than a transaction — "skipped: gas under floor" is a thing the maker did — and it
 * keeps its row and says so, because an event dropped from the log is the one you go looking for.
 */

/** The hash, short: the full sixty-six characters are most of the region at any width. */
const shortHash = (hash: string, wide: boolean): string =>
  wide ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : `${hash.slice(0, 10)}…`;

const WORDS: Record<LogRow["status"], string> = {
  ok: "ok",
  reverted: "reverted",
  running: "running",
  event: "—",
  failed: "failed",
};

/** Folded to one line and cut to the room it was given: a revert arrives with the whole calldata
 * under it, and a column measured against that squeezes every other row on the screen. */
const oneLine = (text: string, room: number): string => trunc(text.replace(/\s+/g, " ").trim(), room);

/** What the gaps between six columns cost, which is room the middle one does not get. */
const GAPS = 5 * 2;

export function Log({
  entries,
  path,
  nowSeconds,
  width,
  rows,
}: {
  entries: LogRow[];
  /** where the console read, said on screen so an empty page can be explained rather than doubted */
  path: string;
  nowSeconds: number;
  width: number;
  rows: number;
}) {
  const wide = width >= 70;
  const drawn = entries.slice(0, Math.max(0, rows - 2));
  const when = (row: LogRow) => duration(Math.max(0, nowSeconds - row.atSeconds));
  const tx = (row: LogRow) => (row.tx === null ? "—" : shortHash(row.tx, wide));

  // The five columns that are never given up, measured before the sixth is filled. Ink squeezes an
  // overlong row by deleting characters *inside* it, so what is left over after these have their
  // room is the room the middle column gets — rather than the middle column being measured against
  // its longest note and taking the end of every hash with it.
  const widest = (of: (row: LogRow) => string, header: string) =>
    Math.max(header.length, ...drawn.map((row) => of(row).length), 0);
  const fixed =
    widest(when, "when") +
    widest((row) => row.chain ?? "—", "chain") +
    widest((row) => row.kind, "kind") +
    widest(tx, "tx") +
    widest((row) => WORDS[row.status], "status");
  const flowRoom = width - fixed - GAPS;
  // Below this the column says nothing worth the cells it costs, so it is given up whole: a size
  // cut to four characters is not a size, and the hash it crowded out was the point of the row.
  const showFlow = flowRoom >= 12;

  const table = columns(
    [
      { header: "when", cells: drawn.map((row) => [{ text: when(row), color: UI.muted }]) },
      { header: "chain", cells: drawn.map((row) => [{ text: row.chain ?? "—", color: UI.muted }]) },
      { header: "kind", cells: drawn.map((row) => [{ text: row.kind, color: row.bad ? UI.rejection : UI.heading }]) },
      ...(showFlow
        ? [
            {
              header: "in → out",
              cells: drawn.map((row) => [
                { text: row.flow === null ? "" : oneLine(row.flow, flowRoom), color: UI.muted },
              ]),
            },
          ]
        : []),
      {
        header: "tx",
        cells: drawn.map((row) => [{ text: tx(row), color: row.tx === null ? UI.muted : UI.fill }]),
      },
      {
        header: "status",
        cells: drawn.map((row) => [{ text: WORDS[row.status], color: row.bad ? UI.rejection : UI.muted }]),
      },
    ],
    width,
    drawn.length,
  );

  const { transactions, events } = countOf(entries);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  // The count first and the file after it: which file is what the operator needs told when the page
  // is empty and they are sure it should not be.
  const counted = [plural(transactions, "transaction"), events > 0 ? plural(events, "event") : null]
    .filter((part) => part !== null)
    .join(" · ");
  const header = trunc(`${counted} · ${path}`, width);

  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      <Box height={1}>
        <Text color={UI.muted}>{entries.length === 0 ? trunc(`no transactions logged yet · ${path}`, width) : header}</Text>
      </Box>
      <Box height={1}>
        <Segments segs={table.header} />
      </Box>
      {padRows(table.rows, Math.max(0, rows - 2), null).map((row, i) => (
        <Box key={i} height={1}>
          {row === null ? <Text> </Text> : <Segments segs={row} />}
        </Box>
      ))}
    </Box>
  );
}
