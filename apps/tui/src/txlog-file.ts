import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type TxLogLine, parseTxLog } from "./txlog.js";

/**
 * The transaction log on disk: where it is, how it is read, and the one way it is written.
 *
 * Kept apart from the shape and the rendering because the public console is a browser bundle with
 * no filesystem behind it — it draws the same page from a recording — and a `node:fs` import in the
 * module that page imports is one the browser build cannot resolve.
 *
 * Append-only, by everybody. Nothing here rewrites the file: a reader that rewrote it would race
 * every writer on the machine, and what it would race away is the only record of what was sent.
 * That rule is why this module opens with `flag: "a"` and has no other way to touch the file.
 */

/** Where the file is. The environment moves it so a test never writes the operator's own log. */
export function txlogPath(env: Record<string, string | undefined> = process.env): string {
  const named = env.ZENTIS_TXLOG ?? "";
  if (named !== "") return named;
  return join(env.HOME ?? homedir(), ".zentis", "txlog.jsonl");
}

/** A log that does not exist yet is an empty log, not an error on the screen. */
export function readTxLog(path: string): TxLogLine[] {
  try {
    return parseTxLog(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

/** One object, one line, on the end. The only way anything here touches the file. */
export function appendTxLog(path: string, line: TxLogLine): void {
  const folder = dirname(path);
  if (!existsSync(folder)) mkdirSync(folder, { recursive: true, mode: 0o700 });
  appendFileSync(path, `${JSON.stringify(line)}\n`, { flag: "a", mode: 0o600 });
}
