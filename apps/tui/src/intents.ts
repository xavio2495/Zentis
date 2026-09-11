import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";
import type { LegConfig } from "@zentis/console-data";

/**
 * What the console asks a chain to do, as transaction requests.
 *
 * Every signed action used to be a `cast` invocation in a child shell. Foundry is a developer
 * toolchain: a stranger who installs this console will not have it, and the first fill would fail
 * with "cast: command not found" from inside a shell they never asked for. The binary already
 * carries viem, so these are the same calls built here — `to`, `data`, `value` — and nothing else.
 *
 * The order and the taker traits are **not** rebuilt. They come from the `fill` block recorded
 * beside each deployment, produced by the contract's own builders and written only after the
 * router's hash of the rebuilt order matched the shipped strategy on chain. What is declared here
 * is the *shape* of the call, which is exactly what the recorded `swapSignature` string says.
 */
export interface Request {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
}

/** The order as the router takes it: the three fields the deployment record carries. */
const ORDER = "(address maker, uint256 traits, bytes data)";

export const SWAP_ABI = parseAbi([
  `function swap(${ORDER} order, uint256 amountIn, bytes takerData) returns (uint256, uint256, bytes32)`,
  `function quote(${ORDER} order, uint256 amountIn, bytes takerData) view returns (uint256, uint256, bytes32)`,
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function deposit() payable",
]);

export const AQUA_ABI = parseAbi([
  "function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
]);

export interface FillParams {
  readonly amountRaw: bigint;
  readonly isAToB: boolean;
}

const bytesOf = (leg: LegConfig) => {
  if (leg.fill === null) {
    throw new Error(`no fill bytes recorded for ${leg.name}, so this console cannot build the order`);
  }
  return leg.fill;
};

const orderOf = (leg: LegConfig) => {
  const { order } = bytesOf(leg);
  return { maker: order.maker as Address, traits: BigInt(order.traits), data: order.data as Hex };
};

const takerDataOf = (leg: LegConfig, isAToB: boolean): Hex =>
  (isAToB ? bytesOf(leg).takerDataAToB : bytesOf(leg).takerDataBToA) as Hex;

/** The taker's side of a fill: what they hand over. */
export const tokenIn = (leg: LegConfig, isAToB: boolean) => (isAToB ? leg.tokenA : leg.tokenB);

export function swapRequest(leg: LegConfig, fill: FillParams): Request {
  return {
    to: bytesOf(leg).router as Address,
    data: encodeFunctionData({
      abi: SWAP_ABI,
      functionName: "swap",
      args: [orderOf(leg), fill.amountRaw, takerDataOf(leg, fill.isAToB)],
    }),
    value: 0n,
  };
}

/**
 * The same call, declared as the view it is.
 *
 * An `eth_call` is a static call, which is what `asView()` provides in Solidity — the quote path the
 * contracts require, satisfied the same way `cast call` satisfied it.
 */
export function quoteRequest(leg: LegConfig, fill: FillParams): Request {
  return {
    to: bytesOf(leg).router as Address,
    data: encodeFunctionData({
      abi: SWAP_ABI,
      functionName: "quote",
      args: [orderOf(leg), fill.amountRaw, takerDataOf(leg, fill.isAToB)],
    }),
    value: 0n,
  };
}

export function approveRequest(token: Address, spender: Address, amount: bigint): Request {
  return {
    to: token,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] }),
    value: 0n,
  };
}

/** Wrapping native into the wrapped token, which is how a maker tops up a short WETH balance. */
export function wrapRequest(token: Address, amount: bigint): Request {
  return { to: token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "deposit" }), value: amount };
}

export function pushRequest(
  aqua: Address,
  args: { maker: Address; app: Address; strategyHash: Hex; token: Address; amount: bigint },
): Request {
  return {
    to: aqua,
    data: encodeFunctionData({
      abi: AQUA_ABI,
      functionName: "push",
      args: [args.maker, args.app, args.strategyHash, args.token, args.amount],
    }),
    value: 0n,
  };
}
