import { Box, Text } from "ink";
import type { LogEntry } from "../journal.js";
import { duration } from "../format.js";
import { type Seg, padRows, trunc } from "../layout.js";
import { columns } from "../pages/table.js";
import { Segments } from "./Segments.js";
import { UI } from "../theme.js";

/**
 * What this console did, in the region the feed usually has.
 *
 * Two columns because there are two facts: what was asked for, and what went on chain because of it.
 * An action that broadcast nothing — a quote, a refusal — keeps its row and leaves the right column
 * empty, which is the honest rendering of it; an action that sent three transactions gets a row
 * each under one name, because they were one thing asked for.
 *
 * The left column says where the action came from as well as what it was. Everything says `key` or
 * `command` today; the column exists because an action arriving from the MCP server is the same
 * kind of fact and will want saying apart from one the operator typed.
 */
const shortHash = (hash: string): string => `${hash.slice(0, 10)}…${hash.slice(-6)}`;

/** One row per transaction, and one row for an action that sent none. */
interface Line {
  readonly when: Seg[];
  readonly action: Seg[];
  readonly transaction: Seg[];
}

/**
 * What the console said, on one line.
 *
 * A child's error is a page: a revert arrives with the raw call arguments and the whole calldata
 * under it. Folded to one line and cut to the room, because the alternative is what happened the
 * first time — the column measured itself against the longest of those and Ink squeezed every row on
 * the screen to make space for it.
 */
const oneLine = (text: string, room: number): string => trunc(text.replace(/\s+/g, " ").trim(), room);

function linesOf(entry: LogEntry, nowSeconds: number, actionRoom: number, txRoom: number): Line[] {
  const ago = Math.max(0, nowSeconds - entry.atSeconds);
  const when: Seg[] = [{ text: duration(ago), color: UI.muted }];
  // The source is said in the action's own cell rather than in a column of its own: at eighty
  // columns a fourth column of one word each is the column that pushes a hash off the screen.
  const named = entry.source === "mcp" ? `${entry.action} · via mcp` : entry.action;
  const action: Seg[] = [
    { text: oneLine(named, actionRoom), color: entry.bad ? UI.rejection : UI.heading },
  ];

  if (entry.outcome === null) {
    return [{ when, action, transaction: [{ text: "running…", color: UI.muted }] }];
  }
  if (entry.hashes.length === 0) {
    // What it answered, where a hash would have been: an action with nothing on chain still owes the
    // reader the reason, and a dash alone would make a refusal look like a quiet success.
    return [
      {
        when,
        action,
        transaction: [{ text: oneLine(entry.outcome, txRoom), color: entry.bad ? UI.rejection : UI.muted }],
      },
    ];
  }
  return entry.hashes.map((hash, i) => ({
    when: i === 0 ? when : [],
    action: i === 0 ? action : [],
    transaction: [{ text: shortHash(hash), color: entry.bad ? UI.rejection : UI.fill }],
  }));
}

export function Log({
  log,
  nowSeconds,
  width,
  rows,
}: {
  log: LogEntry[];
  nowSeconds: number;
  width: number;
  rows: number;
}) {
  // Built through `columns` for the reason the feed is: Ink squeezes an overlong row by deleting
  // characters inside it, so a row one cell too wide loses the middle of a hash rather than its end.
  // The columns are given their room before they are filled, rather than measured from what is in
  // them: an error a hundred characters long would otherwise decide the width of every row.
  const actionRoom = Math.max(10, Math.min(34, Math.floor((width - 12) * 0.45)));
  const txRoom = Math.max(10, width - 12 - actionRoom);
  const lines = log
    .flatMap((entry) => linesOf(entry, nowSeconds, actionRoom, txRoom))
    .slice(0, Math.max(0, rows - 1));
  // The columns are shown before there is anything in them: an empty region with three headings
  // says what will appear here, and an empty region with one sentence says the console is broken.
  const empty = lines.length === 0;
  const table = columns(
    [
      { header: "when", cells: lines.map((l) => l.when) },
      { header: "action", cells: lines.map((l) => l.action) },
      { header: "transaction", cells: lines.map((l) => l.transaction) },
    ],
    width,
    lines.length,
  );

  return (
    <Box flexDirection="column" width={width} height={rows} overflow="hidden">
      <Box height={1}>
        <Segments segs={table.header} />
      </Box>
      {empty && (
        <Box height={1}>
          <Text color={UI.muted}>
            {trunc("nothing yet · what this console does is listed here", width)}
          </Text>
        </Box>
      )}
      {padRows(table.rows, Math.max(0, rows - (empty ? 2 : 1)), null).map((row, i) => (
        <Box key={i} height={1}>
          {row === null ? <Text> </Text> : <Segments segs={row} />}
        </Box>
      ))}
    </Box>
  );
}
