import { LEGS } from "@zentis/console-data";
import { tokenAmount } from "./format.js";
import type { LogEntry } from "./journal.js";

/**
 * The transaction log: a file, because the console is not the only thing that sends.
 *
 * A headless taker fills on a timer, `rebalance.py` pushes, `approve.py` approves, and this console
 * signs what the operator presses for. All four are the same book doing the same work, and an
 * operator asking "what has been sent?" is asking about all of them. So the record lives in one
 * append-only file — `~/.zentis/txlog.jsonl`, or wherever `ZENTIS_TXLOG` says — with one JSON object
 * per line, newest last, in a shape agreed with the scripts.
 *
 * Reading and writing that file is `txlog-file.ts`, and the split is not tidiness: the public
 * console is a browser bundle with no filesystem behind it, and it draws this page from a recording.
 * A `node:fs` import in the module that page imports is one the browser build cannot resolve.
 *
 * The console's own memory is still worth something beside it — an action that broadcast nothing,
 * or one still in flight, is a thing done that no chain will ever record — so `mergeRows` puts the
 * two together and drops the console's copy of anything the file already has.
 */
export interface TxLogLine {
  /** ISO-8601, UTC */
  readonly at: string;
  readonly chain: string | null;
  readonly chainId: number | null;
  /** fill · approve · push · wrap · republish · ship, and whatever a later script adds */
  readonly kind: string;
  /** the address that signed it */
  readonly actor: string | null;
  /** absent on a line that records an event rather than a transaction */
  readonly tx: string | null;
  /** 1 ok, 0 reverted, absent where there was no transaction */
  readonly status: number | null;
  readonly amountIn: string | null;
  readonly amountOut: string | null;
  readonly tokenIn: string | null;
  readonly tokenOut: string | null;
  readonly note: string | null;
}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const num = (value: unknown): number | null =>
  typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : null;

/**
 * The file, as far as it can be read.
 *
 * Another process is appending while this one reads, so a half-written last line is ordinary rather
 * than corruption. A line that will not parse is skipped and the rest is kept: the alternative is a
 * log that goes blank for a moment every time something is sent.
 */
export function parseTxLog(text: string): TxLogLine[] {
  const out: TxLogLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const at = str(parsed.at);
    const kind = str(parsed.kind);
    if (at === null || kind === null) continue;
    out.push({
      at,
      chain: str(parsed.chain),
      chainId: num(parsed.chainId),
      kind,
      actor: str(parsed.actor),
      tx: str(parsed.tx),
      status: num(parsed.status),
      amountIn: str(parsed.amountIn),
      amountOut: str(parsed.amountOut),
      tokenIn: str(parsed.tokenIn),
      tokenOut: str(parsed.tokenOut),
      note: str(parsed.note),
    });
  }
  return out;
}

/** What a row of the log page says. One per line of the file, plus this console's own asking. */
export interface LogRow {
  readonly atSeconds: number;
  readonly chain: string | null;
  readonly kind: string;
  /** what moved, or what happened when nothing did */
  readonly flow: string | null;
  /**
   * The two sides on their own, so a narrow column can give up a size rather than cut one in half.
   *
   * "0.15 USDC → 0.0000579…" is not a smaller version of the fill, it is a different number. The
   * page drops to naming the token instead, which says less and nothing untrue.
   */
  readonly from: string | null;
  readonly to: string | null;
  readonly tx: string | null;
  readonly status: "ok" | "reverted" | "running" | "event" | "failed";
  readonly bad: boolean;
}

/** The leg a line belongs to, by chain id first and by the deployment's own name second. */
const legOf = (line: { chainId: number | null; chain: string | null }) =>
  LEGS.find((leg) => leg.chainId === line.chainId) ??
  LEGS.find((leg) => leg.name === line.chain) ??
  null;

const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * A raw amount, said at the decimals of the token it is in.
 *
 * The file carries raw units because that is what a transaction carries, and raw units on a screen
 * are the ordinary way a reader is off by a factor of a million. When the token is not one this
 * book knows, the amount is shown as it is with the token named short: a wrong number of decimals
 * would be worse than none.
 */
function said(amount: string | null, token: string | null, leg: ReturnType<typeof legOf>): string | null {
  if (amount === null) return null;
  const known = [leg?.tokenA, leg?.tokenB].find(
    (candidate) => candidate !== undefined && token !== null && candidate.address.toLowerCase() === token.toLowerCase(),
  );
  if (known === undefined) {
    return token === null ? amount : `${amount} ${shortAddress(token)}`;
  }
  let raw: bigint;
  try {
    raw = BigInt(amount);
  } catch {
    return `${amount} ${known.symbol}`;
  }
  return `${tokenAmount(raw, known.decimals)} ${known.symbol}`;
}

/** The file's lines as rows, newest first — which is the end the operator reads from. */
export function rowsOf(lines: readonly TxLogLine[]): LogRow[] {
  return lines
    .map((line): LogRow => {
      const leg = legOf(line);
      const from = said(line.amountIn, line.tokenIn, leg);
      const to = said(line.amountOut, line.tokenOut, leg);
      const moved = from === null && to === null ? null : `${from ?? "?"} → ${to ?? "?"}`;
      // The note stands in for the amounts when there are none: an event with an empty middle
      // column reads as a transaction whose size nobody recorded, which is a different claim.
      const flow = moved ?? line.note;
      const status: LogRow["status"] = line.tx === null ? "event" : line.status === 0 ? "reverted" : "ok";
      return {
        atSeconds: Math.floor(Date.parse(line.at) / 1000) || 0,
        from,
        to,
        // Short, because the column is four cells wide at eighty and the prefix is what differs.
        chain: line.chain === null ? null : line.chain.split("-")[0]!,
        kind: line.kind,
        flow,
        tx: line.tx,
        status,
        bad: line.status === 0,
      };
    })
    .sort((a, b) => b.atSeconds - a.atSeconds);
}

/**
 * The file and this console's own memory, on one list.
 *
 * An entry that has a hash is already in the file — the child appended it before it answered — so
 * the console's copy is dropped rather than shown twice. What is left is what no chain records: an
 * action still running, and one that finished without broadcasting anything, such as a quote or a
 * refusal.
 */
export function mergeRows(rows: readonly LogRow[], log: readonly LogEntry[]): LogRow[] {
  const mine = log
    .filter((entry) => entry.hashes.length === 0)
    .map((entry): LogRow => {
      const [kind, ...rest] = entry.action.split(" ");
      // The console's actions are typed in the same words the file's `chain` field holds, so the
      // chain column is filled from the words rather than left empty beside a row that names one.
      const named = rest.find((word) => LEGS.some((leg) => leg.name.startsWith(word.toLowerCase())));
      const asked = rest.filter((word) => word !== named).join(" ");
      const flow = entry.outcome === null ? asked : `${asked} · ${entry.outcome}`;
      return {
        atSeconds: entry.atSeconds,
        from: null,
        to: null,
        chain: named === undefined ? null : named.toLowerCase(),
        kind: kind ?? entry.action,
        flow: flow.trim() === "" ? entry.action : flow,
        tx: null,
        status: entry.outcome === null ? "running" : entry.bad ? "failed" : "ok",
        bad: entry.bad,
      };
    });
  return [...rows, ...mine].sort((a, b) => b.atSeconds - a.atSeconds);
}

/** How many of the rows are transactions, and how many are events that sent nothing. */
export const countOf = (rows: readonly LogRow[]) => ({
  transactions: rows.filter((row) => row.tx !== null).length,
  events: rows.filter((row) => row.tx === null).length,
});
