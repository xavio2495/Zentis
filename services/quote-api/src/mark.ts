/**
 * The mainnet mark: the price each testnet leg's book is valued at.
 *
 * A testnet reference pool is not arbitraged and can sit an order of magnitude off the market
 * (Sepolia's was 11.7× the Chainlink feed on 2026-09-10). Marking inventory or PnL at it would
 * report a fortune that does not exist. The slow workflow already values venue crowding at the
 * 1inch spot price of the same pair on the leg's mainnet counterpart; this is the same number,
 * read the same way, exposed so the console and the dashboard mark at it too. The pool mid stays
 * the price the band uses, and the console shows both.
 */

/** The mainnet pair each testnet leg stands in for. Same as the slow workflow's crowding legs. */
export interface MarkSource {
  readonly chainId: number;
  readonly tokenA: `0x${string}`;
  readonly tokenB: `0x${string}`;
  readonly decimalsA: number;
  readonly decimalsB: number;
}

export const MARKS: Record<number, MarkSource> = {
  11155111: {
    chainId: 1,
    tokenA: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    tokenB: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    decimalsA: 6,
    decimalsB: 18,
  },
  421614: {
    chainId: 42161,
    tokenA: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    tokenB: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    decimalsA: 6,
    decimalsB: 18,
  },
  84532: {
    chainId: 8453,
    tokenA: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenB: "0x4200000000000000000000000000000000000006",
    decimalsA: 6,
    decimalsB: 18,
  },
};

const ONE = 10n ** 18n;

/**
 * A mid, in raw tokenB per 1e18 raw tokenA, from two USD prices given as decimal strings.
 * Digit-by-digit rather than through a float, so it equals the enclave's own conversion
 * (`midFromUsdPrices` in the slow workflow). Zero or malformed input returns zero.
 */
export function midFromUsd(priceA: string, priceB: string, decimalsA: number, decimalsB: number): bigint {
  const SCALE = 18;
  const parse = (s: string): bigint | null => {
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const [whole, frac = ""] = s.split(".");
    const digits = (whole + frac.slice(0, SCALE).padEnd(SCALE, "0")).replace(/^0+(?=\d)/, "");
    return BigInt(digits);
  };
  const a = parse(priceA);
  const b = parse(priceB);
  if (a === null || b === null || a === 0n || b === 0n) return 0n;
  const shift = BigInt(decimalsB - decimalsA);
  const scaled = shift >= 0n ? a * 10n ** shift : a / 10n ** -shift;
  return (ONE * scaled) / b;
}

/** The mid from a 1inch spot response, or null when either token is missing or unpriced. */
export function parseMarkResponse(
  prices: Record<string, string>,
  tokenA: string,
  tokenB: string,
  decimalsA: number,
  decimalsB: number,
): bigint | null {
  const a = prices[tokenA.toLowerCase()];
  const b = prices[tokenB.toLowerCase()];
  if (a === undefined || b === undefined) return null;
  const mid = midFromUsd(a, b, decimalsA, decimalsB);
  return mid === 0n ? null : mid;
}

export interface Mark {
  readonly mainnetChainId: number;
  /** raw tokenB per 1e18 raw tokenA, or null with `error` set */
  readonly mid: string | null;
  readonly source: "1inch spot";
  readonly readAtSeconds: number | null;
  readonly error: string | null;
}

const CACHE_SECONDS = Number(process.env["ZENTIS_MARK_CACHE_SECONDS"] ?? "60");
const cache = new Map<number, { at: number; mark: Mark }>();

export async function fetchMark(testnetChainId: number, apiKey: string | undefined): Promise<Mark> {
  const source = MARKS[testnetChainId];
  const now = Math.floor(Date.now() / 1000);
  if (source === undefined) {
    return { mainnetChainId: 0, mid: null, source: "1inch spot", readAtSeconds: null, error: "no mainnet counterpart is configured for this leg" };
  }
  const hit = cache.get(testnetChainId);
  if (hit !== undefined && now - hit.at < CACHE_SECONDS) return hit.mark;
  if (apiKey === undefined || apiKey === "") {
    return { mainnetChainId: source.chainId, mid: null, source: "1inch spot", readAtSeconds: null, error: "no 1inch API key is configured, so there is no mainnet mark" };
  }
  const a = source.tokenA.toLowerCase();
  const b = source.tokenB.toLowerCase();
  let mark: Mark;
  try {
    const response = await fetch(`https://api.1inch.dev/price/v1.1/${source.chainId}/${a},${b}?currency=USD`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`1inch spot HTTP ${response.status}`);
    const mid = parseMarkResponse((await response.json()) as Record<string, string>, a, b, source.decimalsA, source.decimalsB);
    mark = mid === null
      ? { mainnetChainId: source.chainId, mid: null, source: "1inch spot", readAtSeconds: now, error: "the spot response did not price both tokens" }
      : { mainnetChainId: source.chainId, mid: mid.toString(), source: "1inch spot", readAtSeconds: now, error: null };
  } catch (cause) {
    // A stale mark is better than none, and says so.
    if (hit !== undefined && hit.mark.mid !== null) {
      return { ...hit.mark, error: `${String(cause)}; showing the mark read ${now - hit.at}s ago` };
    }
    mark = { mainnetChainId: source.chainId, mid: null, source: "1inch spot", readAtSeconds: null, error: String(cause) };
  }
  if (mark.mid !== null) cache.set(testnetChainId, { at: now, mark });
  return mark;
}
