import { QUOTE_API_URL } from "./quotes.js";
import { type Read, failed, ok } from "./graphql.js";
import { json } from "./graphql.js";

/**
 * The price each leg's inventory and PnL are valued at.
 *
 * Not the leg's own pool mid. A testnet reference pool is not arbitraged and can sit an order of
 * magnitude off the market, so marking a book at it reports a fortune that is not there. The quote
 * service reads the 1inch spot price of the same pair on the leg's mainnet counterpart — the same
 * number, from the same source, that the enclave values venue crowding at — and this is the reader
 * for it. The pool mid stays on screen beside it, because the pool mid is what the band uses.
 */
export interface Mark {
  readonly mainnetChainId: number;
  readonly mid: bigint;
  readonly source: string;
  readonly readAtSeconds: number | null;
  /** set when the mark is stale or absent; the mid is then the last good one, or absent with it */
  readonly error: string | null;
}

interface RawMark {
  chainId: number;
  chain: string;
  mainnetChainId: number;
  mid: string | null;
  source: string;
  readAtSeconds: number | null;
  error: string | null;
}

/** Every leg's mark, keyed by the testnet chain id. */
export async function fetchMarks(): Promise<Read<Map<number, Mark>>> {
  const read = await json<{ marks: RawMark[] }>(`${QUOTE_API_URL}/mark`);
  if (read.value === null) return failed(read.error ?? "the quote service returned no marks");
  const marks = new Map<number, Mark>();
  for (const raw of read.value.marks) {
    if (raw.mid === null) continue;
    marks.set(raw.chainId, {
      mainnetChainId: raw.mainnetChainId,
      mid: BigInt(raw.mid),
      source: raw.source,
      readAtSeconds: raw.readAtSeconds,
      error: raw.error,
    });
  }
  const missing = read.value.marks.filter((m) => m.mid === null);
  return missing.length === 0
    ? ok(marks)
    : { value: marks, error: `${missing.length} of ${read.value.marks.length} legs have no mark: ${missing[0]!.error}`, indexingErrors: false };
}
