/**
 * What this console did, kept so it can be looked at afterwards.
 *
 * The status bar says what the last action answered and is then overwritten by the next one, which
 * is enough while watching and nothing afterwards: an operator who filled twice and wants the
 * second transaction has nowhere to look. This is that place.
 *
 * Two things are worth knowing about an action and they are not the same thing: what was asked for,
 * and what went on chain because of it. They are kept apart here and drawn as two columns, because a
 * request that broadcast nothing and a request that broadcast three transactions are both ordinary
 * and neither reads properly as one line of prose.
 *
 * Nothing here reads a chain. An entry is written when the console asks for something and finished
 * when the child answers, so this is a record of the console's own actions and not a second, worse
 * copy of the feed.
 */

/** Where an action came from. `mcp` is not used yet; it is the reason this column exists. */
export type Source = "key" | "command" | "mcp";

export interface LogEntry {
  readonly id: number;
  readonly atSeconds: number;
  readonly source: Source;
  /** what was asked for, in the words it was asked in */
  readonly action: string;
  /** what came back, or null while it is still running */
  readonly outcome: string | null;
  /** every transaction the action sent, in the order it sent them */
  readonly hashes: string[];
  readonly bad: boolean;
}

/**
 * How many entries are kept.
 *
 * A console left running for a day should not grow without bound, and a log longer than this is one
 * nobody scrolls: what is wanted from it is the last thing that happened, or the one before it.
 */
export const KEPT = 100;

/**
 * The transactions named in a line.
 *
 * Exactly thirty-two bytes, so a wallet address — twenty — is not one, and the word boundary keeps a
 * longer run of hex, such as a quote's return data, from being read as a hash with a tail.
 */
export function hashesIn(text: string): string[] {
  return [...text.matchAll(/0x[0-9a-fA-F]{64}\b/g)].map((match) => match[0]);
}

/** An action, written down as it is asked for. Newest first, because that is what is looked at. */
export function record(
  log: LogEntry[],
  entry: Omit<LogEntry, "outcome" | "hashes" | "bad">,
): LogEntry[] {
  return [{ ...entry, outcome: null, hashes: [], bad: false }, ...log].slice(0, KEPT);
}

/**
 * The same action, finished.
 *
 * What it was asked as is never rewritten by what it answered: the two columns are two facts, and an
 * action that failed is still the action that was taken.
 */
export function settle(log: LogEntry[], id: number, said: string, bad: boolean): LogEntry[] {
  return log.map((entry) =>
    entry.id === id ? { ...entry, outcome: said, hashes: hashesIn(said), bad } : entry,
  );
}
