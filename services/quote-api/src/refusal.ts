import { decodeErrorResult, parseAbi } from "viem";

/**
 * Every custom error the Zentis contracts can revert with, so a refusal can be read back.
 *
 * A node answers a reverting `eth_call` with "execution reverted" and the raw revert data beside
 * it. The message is the same for every refusal; the data is not. The band declining a direction,
 * a stale reference and a missed seq pin are three different facts about the position, and the
 * operator's screen should say which one it was, in the same words the mapping uses elsewhere.
 * The list is the union of the `error Zentis*` declarations under contracts/src.
 */
export const ZENTIS_ERRORS = parseAbi([
  "error ZentisBandTooWide(uint256 band)",
  "error ZentisBoundOutOfRange(uint16 maxTiltBps, uint16 maxWidenBps)",
  "error ZentisEmptyPosition(uint256 balanceIn, uint256 balanceOut)",
  "error ZentisNoReference(bytes32 positionId)",
  "error ZentisOutsideBand(uint256 realised, uint256 bound, bool isCeiling)",
  "error ZentisRecomputeDetected()",
  "error ZentisRefBadTimestamp(uint40 updatedAt)",
  "error ZentisRefCreIsLive()",
  "error ZentisRefNotOwner()",
  "error ZentisRefStaleSeq(uint32 incoming, uint32 stored)",
  "error ZentisRefZeroMid()",
  "error ZentisReferenceStale(uint256 age, uint32 maxStaleness)",
  "error ZentisSeqMismatch(uint32 pinned, uint32 actual)",
  "error ZentisSpreadTooWide(uint256 half)",
  "error ZentisStalenessDisabled()",
  "error ZentisZeroAmount(uint256 amountIn, uint256 amountOut)",
]);

export interface Refusal {
  /** the error's name, stable for a screen to key off */
  readonly error: string;
  /** its arguments, as decimal strings in declaration order */
  readonly args: string[];
  /** the refusal in the operator's words */
  readonly sentence: string;
}

const BPS = 10_000n;

/** How far `realised` sits past `bound`, in bps of the bound, as a positive whole number. */
const pastBy = (realised: bigint, bound: bigint): bigint => {
  if (bound === 0n) return 0n;
  const gap = realised > bound ? realised - bound : bound - realised;
  return (gap * BPS + bound / 2n) / bound;
};

function sentenceFor(name: string, args: readonly unknown[]): string {
  const a = args as never[];
  switch (name) {
    case "ZentisOutsideBand": {
      const [realised, bound, isCeiling] = a as unknown as [bigint, bigint, boolean];
      const bps = pastBy(realised, bound);
      // The band is one-sided per direction and holds the maker's side of the price: with the taker
      // paying A the maker gives B and must not give too much (ceiling); with the taker paying B the
      // maker sells A and must not take too little (floor). Either breach is the maker losing.
      return isCeiling
        ? `outside the band: the maker would give ${bps} bps more tokenB per tokenA than the ceiling allows`
        : `outside the band: the maker would sell tokenA for ${bps} bps less tokenB than the floor allows`;
    }
    case "ZentisReferenceStale": {
      const [age, max] = a as unknown as [bigint, number];
      return `the reference is ${age}s old, past this position's limit of ${max}s`;
    }
    case "ZentisNoReference":
      return "no reference has been published for this position";
    case "ZentisEmptyPosition": {
      const [balanceIn, balanceOut] = a as unknown as [bigint, bigint];
      return `the position has nothing to quote on this side (holds ${balanceIn} in, ${balanceOut} out)`;
    }
    case "ZentisSeqMismatch": {
      const [pinned, actual] = a as unknown as [number, number];
      return `the taker pinned seq ${pinned} but the reference is at seq ${actual}`;
    }
    case "ZentisZeroAmount":
      return "the quote rounds to nothing at this size";
    case "ZentisStalenessDisabled":
      return "this position's staleness limit is zero, which rejects every quote";
    case "ZentisRecomputeDetected":
      return "the program re-read the reference mid-quote, which is not allowed";
    default:
      return `${name}(${a.map(String).join(", ")})`;
  }
}

/** The Zentis error behind a revert, or null when the data is empty or is not one of ours. */
export function decodeRefusal(data: string): Refusal | null {
  if (!data.startsWith("0x") || data.length < 10) return null;
  try {
    const decoded = decodeErrorResult({ abi: ZENTIS_ERRORS, data: data as `0x${string}` });
    const args = (decoded.args ?? []) as readonly unknown[];
    return {
      error: decoded.errorName,
      args: args.map(String),
      sentence: sentenceFor(decoded.errorName, args),
    };
  } catch {
    return null;
  }
}
