import { createPublicClient, http } from "viem";
import type { LegConfig, TokenConfig } from "./config.js";
import { type Read, failed, ok } from "./graphql.js";

/**
 * The maker's own side: what the signer is, and what the wallet holds on each chain.
 *
 * The subtlety this module exists for is Aqua's custody model. `ship()` and `dock()` move no
 * tokens at all: Aqua records a balance against the strategy and pulls from the maker's wallet at
 * settlement, against the approval. So the committed inventory is *still in the wallet's balance* —
 * a screen that showed "held" and "committed" as separate pots would double-count, and one that
 * showed the wallet balance as free would promise inventory the position has already claimed.
 * Held is the truth; committed is a claim on it; free is the remainder.
 *
 * Two failures are worth naming rather than arithmetic: a wallet that has fallen below what the
 * position committed (the next fill cannot settle) and an approval below the committed balance
 * (the same, for a different reason).
 */

const ERC20 = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const SAFE_BALANCES = [
  {
    name: "safeBalances",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
    ],
    outputs: [
      { name: "balance0", type: "uint256" },
      { name: "balance1", type: "uint256" },
    ],
  },
] as const;

export interface TokenHolding {
  readonly symbol: string;
  readonly decimals: number;
  /** what the wallet's ERC-20 balance says, which includes the committed amount */
  readonly held: bigint;
  /** what Aqua has recorded against the shipped strategy */
  readonly committed: bigint;
  /** held − committed, floored at zero */
  readonly free: bigint;
  /** how far the wallet has fallen below the commitment, zero when it has not */
  readonly shortfall: bigint;
  readonly allowance: bigint;
  readonly allowanceShort: boolean;
}

export interface ChainWallet {
  readonly chainId: number;
  readonly chain: string;
  /** the chain's own gas token, in wei */
  readonly gas: bigint;
  readonly tokenA: TokenHolding;
  readonly tokenB: TokenHolding;
}

export interface Wallet {
  readonly maker: `0x${string}`;
  readonly chains: ChainWallet[];
  readonly caveats: string[];
}

export function holdingOf(token: { symbol: string; decimals: number }, held: bigint, committed: bigint, allowance: bigint): TokenHolding {
  const shortfall = committed > held ? committed - held : 0n;
  return {
    symbol: token.symbol,
    decimals: token.decimals,
    held,
    committed,
    free: held > committed ? held - committed : 0n,
    shortfall,
    allowance,
    allowanceShort: allowance < committed,
  };
}

/** What a screen must say about these holdings beyond their numbers, in the operator's words. */
export function walletCaveats(holdings: readonly (TokenHolding & { chain: string })[]): string[] {
  const caveats: string[] = [];
  for (const h of holdings) {
    if (h.shortfall > 0n) {
      caveats.push(`${h.chain} has committed more ${h.symbol} than the wallet now holds, so a fill that settles against it would fail`);
    }
    if (h.allowanceShort) {
      caveats.push(`${h.chain}'s Aqua allowance for ${h.symbol} is below the committed balance, so the next fill would revert on the approval`);
    }
  }
  return caveats;
}

/** Gas, both token balances, both allowances and the recorded commitment, for one leg. */
export async function fetchChainWallet(leg: LegConfig, maker: `0x${string}`): Promise<Read<ChainWallet>> {
  const client = createPublicClient({ transport: http(leg.rpcUrl, { timeout: 15_000 }) });
  try {
    const erc20 = (token: TokenConfig, fn: "balanceOf" | "allowance") =>
      client.readContract({
        address: token.address,
        abi: ERC20,
        functionName: fn,
        args: fn === "balanceOf" ? [maker] : [maker, leg.aqua],
      } as never) as Promise<bigint>;

    const [gas, heldA, heldB, allowanceA, allowanceB, committed] = await Promise.all([
      client.getBalance({ address: maker }),
      erc20(leg.tokenA, "balanceOf"),
      erc20(leg.tokenB, "balanceOf"),
      erc20(leg.tokenA, "allowance"),
      erc20(leg.tokenB, "allowance"),
      client.readContract({
        address: leg.aqua,
        abi: SAFE_BALANCES,
        functionName: "safeBalances",
        args: [maker, leg.app, leg.strategyHash, leg.tokenA.address, leg.tokenB.address],
      }) as Promise<readonly [bigint, bigint]>,
    ]);

    return ok({
      chainId: leg.chainId,
      chain: leg.label,
      gas,
      tokenA: holdingOf(leg.tokenA, heldA, committed[0], allowanceA),
      tokenB: holdingOf(leg.tokenB, heldB, committed[1], allowanceB),
    });
  } catch (cause) {
    return failed(`could not read ${leg.label}'s wallet: ${String(cause)}`);
  }
}

/** The maker's wallet across every leg, tolerating any chain being unreachable. */
export async function fetchWallet(legs: readonly LegConfig[], maker: `0x${string}`): Promise<Wallet> {
  const reads = await Promise.all(legs.map((leg) => fetchChainWallet(leg, maker)));
  const chains = reads.map((read) => read.value).filter((chain): chain is ChainWallet => chain !== null);
  const caveats = reads.flatMap((read) => (read.error === null ? [] : [read.error]));
  const holdings = chains.flatMap((chain) => [
    { ...chain.tokenA, chain: chain.chain },
    { ...chain.tokenB, chain: chain.chain },
  ]);
  return { maker, chains, caveats: [...caveats, ...walletCaveats(holdings)] };
}

/**
 * A recorded wallet, back as the type the screen renders.
 *
 * Written by `scripts/record.ts` beside the rest of the moment, and read here rather than in the
 * sandbox so that the derived fields — free, shortfall, whether the approval still covers the
 * commitment — come out of the same function the live path uses. A fixture that recomputed them its
 * own way could pass a test the real screen fails.
 */
export interface RawWallet {
  maker: string;
  chains: {
    chainId: number;
    chain: string;
    gas: string;
    tokenA: { symbol: string; decimals: number; held: string; committed: string; allowance: string };
    tokenB: { symbol: string; decimals: number; held: string; committed: string; allowance: string };
  }[];
}

export function parseWalletFixture(raw: RawWallet): Wallet {
  const chains = raw.chains.map((chain) => ({
    chainId: chain.chainId,
    chain: chain.chain,
    gas: BigInt(chain.gas),
    tokenA: holdingOf(chain.tokenA, BigInt(chain.tokenA.held), BigInt(chain.tokenA.committed), BigInt(chain.tokenA.allowance)),
    tokenB: holdingOf(chain.tokenB, BigInt(chain.tokenB.held), BigInt(chain.tokenB.committed), BigInt(chain.tokenB.allowance)),
  }));
  return {
    maker: raw.maker as `0x${string}`,
    chains,
    caveats: walletCaveats(
      chains.flatMap((chain) => [
        { ...chain.tokenA, chain: chain.chain },
        { ...chain.tokenB, chain: chain.chain },
      ]),
    ),
  };
}
