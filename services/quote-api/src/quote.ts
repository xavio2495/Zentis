import { decodeAbiParameters, encodeFunctionData, parseAbi, decodeFunctionResult } from "viem";
import type { ChainConfig } from "./config.js";
import { buildQuoteTakerTraits } from "./takerTraits.js";

const ORDER_TUPLE = [
  {
    type: "tuple",
    components: [
      { name: "maker", type: "address" },
      { name: "traits", type: "uint256" },
      { name: "data", type: "bytes" }
    ]
  }
] as const;

const QUOTE_ABI = parseAbi([
  "function quote((address maker,uint256 traits,bytes data) order, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)"
]);

export interface QuoteOutcome {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly orderHash: `0x${string}`;
}

export class QuoteRefused extends Error {
  readonly data: string;

  constructor(message: string, data: string) {
    super(message);
    this.name = "QuoteRefused";
    this.data = data;
  }
}

/**
 * Asks the router itself what it would pay, at the current head.
 *
 * The shipped strategy blob is abi.encode(Order), so the order is rebuilt from the chain's own
 * record rather than from any configuration this service holds. A refusal is a real answer —
 * the band declining a direction is the product working — so it is surfaced as a caveat rather
 * than swallowed or turned into a server error.
 */
export async function quoteLeg(
  chain: ChainConfig,
  router: `0x${string}`,
  strategy: `0x${string}`,
  amountIn: bigint,
  isAToB: boolean,
  signal?: AbortSignal
): Promise<QuoteOutcome> {
  const [order] = decodeAbiParameters(ORDER_TUPLE, strategy);

  const callData = encodeFunctionData({
    abi: QUOTE_ABI,
    functionName: "quote",
    args: [order, amountIn, buildQuoteTakerTraits({ isExactIn: true, isAToB })]
  });

  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: router, data: callData }, "latest"]
    })
  };
  if (signal !== undefined) init.signal = signal;

  const response = await fetch(chain.rpcUrl, init);
  const body = (await response.json()) as {
    result?: `0x${string}`;
    error?: { message: string; data?: string };
  };

  if (body.error !== undefined) {
    throw new QuoteRefused(body.error.message, body.error.data ?? "");
  }
  if (body.result === undefined) {
    throw new Error("node returned neither a result nor an error");
  }

  const [returnedIn, amountOut, orderHash] = decodeFunctionResult({
    abi: QUOTE_ABI,
    functionName: "quote",
    data: body.result
  });

  return { amountIn: returnedIn, amountOut, orderHash };
}
