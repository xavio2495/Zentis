import { type Read, failed, json, ok } from "./graphql.js";

/**
 * The live two-sided quote, from the service that already asks the router itself.
 *
 * The console does not price anything: it asks `services/quote-api`, which rebuilds the shipped
 * order and puts the question to the deployed program. That is the only number on the screen the
 * router would honour, and re-deriving it here would be a second opinion nobody trades on.
 */
/**
 * Why the router refused a quote, as the quote service decodes the revert.
 *
 * `error` is the contract's custom error name and is the stable thing to key off; `sentence` is the
 * service's wording for an operator, written in `tokenA`/`tokenB` because the service has no symbols.
 * Null when the leg priced, when the revert carried no data, or when it was not one of ours — the
 * node's own message is then in `caveats`, as it always was.
 */
export interface Refusal {
  readonly error: string;
  /** decimal strings, in the error's declaration order */
  readonly args: string[];
  readonly sentence: string;
}

export interface LegQuote {
  readonly chainId: number;
  readonly chain: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint | null;
  readonly tokenIn: string | null;
  readonly tokenOut: string | null;
  readonly reason: string | null;
  readonly refMid: bigint | null;
  readonly tiltBps: number | null;
  readonly seq: number | null;
  readonly refAgeSeconds: number | null;
  readonly refusal: Refusal | null;
  readonly caveats: string[];
}

export interface QuoteSet {
  readonly side: "AtoB" | "BtoA";
  readonly amountIn: bigint;
  readonly quotes: LegQuote[];
  readonly caveats: string[];
}

interface RawQuote {
  chainId: number;
  chain: string;
  amountIn: string;
  amountOut: string | null;
  tokenIn: string | null;
  tokenOut: string | null;
  reason: string | null;
  refMid: string | null;
  tiltBps: number | null;
  seq: number | null;
  refAgeSeconds: number | null;
  /** absent from a service older than its error decoding */
  refusal?: Refusal | null;
  caveats: string[];
}

export function parseQuote(q: RawQuote): LegQuote {
  return {
    chainId: q.chainId,
    chain: q.chain,
    amountIn: BigInt(q.amountIn),
    amountOut: q.amountOut === null ? null : BigInt(q.amountOut),
    tokenIn: q.tokenIn,
    tokenOut: q.tokenOut,
    reason: q.reason,
    refMid: q.refMid === null ? null : BigInt(q.refMid),
    tiltBps: q.tiltBps,
    seq: q.seq,
    refAgeSeconds: q.refAgeSeconds,
    refusal: q.refusal ?? null,
    caveats: q.caveats,
  };
}

/** The refusal's sentence with the leg's symbols in place of the service's `tokenA` and `tokenB`. */
export function refusalSentence(refusal: Refusal, symbolA: string, symbolB: string): string {
  return refusal.sentence.replace(/\btokenA\b/g, symbolA).replace(/\btokenB\b/g, symbolB);
}

export const QUOTE_API_URL = process.env.ZENTIS_QUOTE_API ?? "http://localhost:8787";

export async function fetchQuotes(
  positionId: string,
  amountIn: bigint,
  side: "AtoB" | "BtoA",
): Promise<Read<QuoteSet>> {
  const url = `${QUOTE_API_URL}/quote?positionId=${positionId}&amountIn=${amountIn}&side=${side}`;
  const read = await json<{ quotes: RawQuote[]; caveats: string[] }>(url);
  if (read.value === null) {
    return failed(read.error ?? "the quote service returned nothing");
  }
  return ok({
    side,
    amountIn,
    quotes: read.value.quotes.map(parseQuote),
    caveats: read.value.caveats,
  });
}

/**
 * How far the quoted price sits from the reference's mid, in basis points, signed so that negative
 * means the taker got less than the mid would have paid. Returns null rather than zero when either
 * side is missing: an unpriced leg has no distance from anything.
 */
export function offMidBps(quote: LegQuote, isAToB: boolean): number | null {
  if (quote.amountOut === null || quote.refMid === null || quote.amountIn === 0n) return null;
  const ONE = 10n ** 18n;
  // mid is raw tokenB per 1e18 raw tokenA, so the direction decides which way it converts.
  const atMid = isAToB
    ? (quote.amountIn * quote.refMid) / ONE
    : (quote.amountIn * ONE) / quote.refMid;
  if (atMid === 0n) return null;
  return Number(((quote.amountOut - atMid) * 10_000n) / atMid);
}
