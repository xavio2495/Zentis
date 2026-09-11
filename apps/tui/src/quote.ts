import { createPublicClient, decodeFunctionResult, http } from "viem";
import type { LegConfig } from "@zentis/console-data";
import { SWAP_ABI, quoteRequest } from "./intents.js";

/**
 * Asking a router what it would do, from this process.
 *
 * It was `cast call` in a child shell. An `eth_call` is a static call — what `asView()` provides in
 * Solidity — so this is the quote path the contracts require, and now it needs neither a key nor a
 * tool a stranger's device would have to have installed.
 */
export interface Quoted {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  /** the router's hash of the order it quoted, which is the strategy the leg is shipped as */
  readonly orderHash: `0x${string}`;
}

export async function readQuote(
  leg: LegConfig,
  params: { amountRaw: bigint; isAToB: boolean },
): Promise<Quoted> {
  const client = createPublicClient({ transport: http(leg.rpcUrl, { timeout: 15_000 }) });
  const { data } = await client.call(quoteRequest(leg, params));
  if (data === undefined) throw new Error("the router returned nothing");
  const [amountIn, amountOut, orderHash] = decodeFunctionResult({
    abi: SWAP_ABI,
    functionName: "quote",
    data,
  }) as [bigint, bigint, `0x${string}`];
  return { amountIn, amountOut, orderHash };
}
