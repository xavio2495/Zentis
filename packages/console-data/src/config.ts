import baseSepolia from "../../../contracts/deployments/base-sepolia.json" with { type: "json" };
import arbitrumSepolia from "../../../contracts/deployments/arbitrum-sepolia.json" with { type: "json" };
import sepolia from "../../../contracts/deployments/sepolia.json" with { type: "json" };
import fastConfig from "../../../cre/fast/config.staging.json" with { type: "json" };
import slowConfig from "../../../cre/slow/config.staging.json" with { type: "json" };

/**
 * One leg, assembled rather than declared.
 *
 * Every field is taken from the file that already owns it: the deployment record owns the chain and
 * its tokens, the fast workflow's config owns the shipped program, the slow workflow's config owns
 * the endpoints it reads. The join is the registry address, which appears in all three and is the
 * one identifier a leg cannot change without being re-deployed. Nothing here is retyped, so a
 * re-ship that edits those files moves the console with it.
 */
export interface LegConfig {
  readonly chainId: number;
  /** the deployment record's own name, e.g. "sepolia" */
  readonly name: string;
  /** short enough for a column header at 40 columns */
  readonly label: string;
  readonly registry: `0x${string}`;
  /** the Zentis router this leg is shipped to */
  readonly app: `0x${string}`;
  readonly aqua: `0x${string}`;
  readonly strategyHash: `0x${string}`;
  /** the maker's signed expiry, which the fill and quote scripts both need */
  readonly deadline: number;
  readonly tokenA: TokenConfig;
  readonly tokenB: TokenConfig;
  /**
   * The testnet pool this leg's price chart is drawn from, or null where it was retired.
   *
   * The book prices off one mainnet mid now, and the slow workflow measures its spread on that one
   * series, so two of the three legs no longer have a reference pool at all. Null rather than a
   * missing field: a leg without one has to say so, and an address read off a config that dropped it
   * arrives as undefined and reaches an RPC as the string "undefined".
   */
  readonly referencePool: `0x${string}` | null;
  readonly fillsSubgraphUrl: string;
  readonly referencePoolSubgraphUrl: string | null;
  readonly rpcUrl: string;
  /** the slow workflow's per-leg override, or the book-wide default when it has none */
  readonly volatilityMultiplierBps: number;
  /**
   * The bytes a fill needs, recorded from the Solidity builders themselves.
   *
   * Null for a leg whose record predates them. The console passes these through to the router and
   * never rebuilds them: an order and its taker traits are the contract's own encoding, and a second
   * implementation here would be the guess the project's first rule forbids. They were written only
   * after the router's hash of the rebuilt order matched the shipped strategy on chain, and
   * `orderHash` is kept so a reader — and a test — can see that it still does.
   */
  readonly fill: FillBytes | null;
  /** how many times this leg has been shipped: the live generation and every record it superseded */
  readonly generations: number;
  /** what this generation was shipped with, from the deployment record; the base of every PnL */
  readonly shipped: ShippedRecord;
}

interface RawShipped {
  shippedBalanceA: string;
  shippedBalanceB?: string | null;
  shippedAgainstRef?: { mid?: string | null; seq?: number | null } | null;
  markAtShip?: string | null;
  shipBlock?: number | null;
}

const shippedOf = (raw: RawShipped): ShippedRecord => ({
  balanceA: BigInt(raw.shippedBalanceA),
  balanceB: raw.shippedBalanceB == null ? null : BigInt(raw.shippedBalanceB),
  mid: raw.shippedAgainstRef?.mid == null ? null : BigInt(raw.shippedAgainstRef.mid),
  markAtShip: raw.markAtShip == null ? null : BigInt(raw.markAtShip),
  seq: raw.shippedAgainstRef?.seq ?? null,
  block: raw.shipBlock ?? null,
});

export interface ShippedRecord {
  readonly balanceA: bigint;
  /** null on generations recorded before the B side was written down */
  readonly balanceB: bigint | null;
  /** the reference mid the ship was sized to, null when the record has only the seq */
  readonly mid: bigint | null;
  /** the mainnet mark at ship, recorded from 2026-09-11; hold profit is null without it */
  readonly markAtShip: bigint | null;
  readonly seq: number | null;
  readonly block: number | null;
}

export interface FillBytes {
  readonly router: `0x${string}`;
  /** the router's own signature string, so `cast` encodes the call the way the contract declares it */
  readonly swapSignature: string;
  /** the order as a cast tuple, already formatted: maker, traits, data */
  readonly orderTuple: string;
  /** the taker the traits embed; a fill is for that address and no other */
  readonly taker: `0x${string}`;
  readonly takerDataAToB: `0x${string}`;
  readonly takerDataBToA: `0x${string}`;
  /** the router's hash of this order, which is the strategy the leg is shipped as */
  readonly orderHash: `0x${string}`;
}

export interface TokenConfig {
  readonly symbol: string;
  readonly decimals: number;
  readonly address: `0x${string}`;
}

/** Book-wide policy parameters, from the two workflow configs. */
export interface BookConfig {
  readonly positionId: `0x${string}`;
  readonly maxTiltBps: number;
  readonly baseSpreadBps: number;
  readonly volatilityHorizonSeconds: number;
  readonly volatilityWindowSeconds: number;
  readonly volatilityCapBps: number;
  readonly maker: `0x${string}`;
}

/**
 * The gains are secret and never leave the enclave, so a client-side decomposition has to assume
 * them. These are the values the harness published and the workflows are running; a maker running
 * other gains will see the enclave's tilt diverge from the console's, which is correct behaviour.
 * Every screen that uses them carries `assumedGains` so it can say so.
 */
export const ASSUMED_GAINS = {
  kappaOwnBps: 10_000n,
  kappaBookBps: 5_000n,
  source: "the published harness gains, not read from the enclave",
} as const;

const DEPLOYMENTS = [sepolia, arbitrumSepolia, baseSepolia];

/** Sepolia first: it is the leg the demo's beat runs on. */
const LABELS: Record<string, string> = {
  sepolia: "Sepolia",
  "arbitrum-sepolia": "Arbitrum Sepolia",
  "base-sepolia": "Base Sepolia",
};

const RPC_ENV: Record<string, [string, string]> = {
  sepolia: ["ZENTIS_RPC_SEPOLIA", "https://ethereum-sepolia-rpc.publicnode.com"],
  "arbitrum-sepolia": ["ZENTIS_RPC_ARBITRUM_SEPOLIA", "https://sepolia-rollup.arbitrum.io/rpc"],
  "base-sepolia": ["ZENTIS_RPC_BASE_SEPOLIA", "https://sepolia.base.org"],
};

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Every endpoint the console reads is overridable by the environment, per leg.
 *
 * Not a convenience: a test that starts the real binary must be able to point it away from the live
 * indexers. A compiled console polls the fills subgraphs once a minute, and a handful left running
 * by a leaky test drained two legs' daily allowance to nothing. An empty variable is not an
 * override, because that is what a shell leaves behind when one is unset.
 */
const overridden = (variable: string, fallback: string, env: Record<string, string | undefined>): string => {
  const override = env[variable];
  return override === undefined || override === "" ? fallback : override;
};

const envVariable = (prefix: string, name: string) => `${prefix}_${name.toUpperCase().replace(/-/g, "_")}`;

export function rpcOverride(name: string, env: Record<string, string | undefined> = process.env): string {
  const entry = RPC_ENV[name];
  if (entry === undefined) throw new Error(`no rpc endpoint is configured for ${name}`);
  const [variable, fallback] = entry;
  return overridden(variable, fallback, env);
}

/** The leg's fills subgraph, or whatever `ZENTIS_FILLS_<LEG>` points at instead. */
export function fillsSubgraphUrl(
  name: string,
  configured: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return overridden(envVariable("ZENTIS_FILLS", name), configured, env);
}

export const BOOK: BookConfig = {
  positionId: fastConfig.positionId as `0x${string}`,
  maxTiltBps: fastConfig.maxTiltBps,
  baseSpreadBps: slowConfig.baseSpreadBps,
  volatilityHorizonSeconds: slowConfig.volatilityHorizonSeconds,
  volatilityWindowSeconds: slowConfig.volatilityWindowSeconds,
  volatilityCapBps: slowConfig.volatilityCapBps,
  maker: fastConfig.maker as `0x${string}`,
};

export const LEGS: readonly LegConfig[] = DEPLOYMENTS.map((deployment) => {
  const registry = deployment.contracts.ZentisRefRegistry.address;
  const fast = fastConfig.legs.find((leg) => sameAddress(leg.registry, registry));
  const slow = slowConfig.legs.find((leg) => sameAddress(leg.registry, registry));
  if (fast === undefined || slow === undefined) {
    throw new Error(`${deployment.name} is deployed but no workflow leg reads its registry`);
  }
  const label = LABELS[deployment.name];
  if (label === undefined) throw new Error(`${deployment.name} has no column label`);
  const pool = (deployment as { referencePool?: { address?: string } }).referencePool;
  const subgraphs = (deployment as { subgraphs?: { referencePool?: string } }).subgraphs;

  return {
    chainId: deployment.chainId,
    name: deployment.name,
    label,
    registry: registry as `0x${string}`,
    app: fast.app as `0x${string}`,
    aqua: fast.aqua as `0x${string}`,
    strategyHash: fast.strategyHash as `0x${string}`,
    deadline: deployment.position.deadline,
    tokenA: deployment.tokens.tokenA as TokenConfig,
    tokenB: deployment.tokens.tokenB as TokenConfig,
    // From the deployment record, which is where a pool address belongs: it is a fact about the
    // chain rather than a workflow parameter, and the workflow stopped carrying it when the book
    // moved to one mainnet mid.
    referencePool: (pool?.address as `0x${string}` | undefined) ?? null,
    fillsSubgraphUrl: fillsSubgraphUrl(deployment.name, slow.fillsSubgraphUrl),
    referencePoolSubgraphUrl: subgraphs?.referencePool ?? null,
    rpcUrl: rpcOverride(deployment.name),
    // Read through a widened type: `markAtShip` is written by `scripts/reship.py` from 2026-09-11
    // and is simply absent on every generation shipped before it, which is what leaves the hold
    // effect unknown on those. The rest is present on every record.
    // Counted from the record rather than configured: a re-ship appends the old position to
    // `supersededPositions`, so the count is a fact about the file and never drifts from it.
    generations: ((deployment as { supersededPositions?: unknown[] }).supersededPositions?.length ?? 0) + 1,
    fill: ((deployment as { fill?: FillBytes }).fill ?? null) as FillBytes | null,
    shipped: shippedOf(deployment.position as RawShipped),
    // The per-leg override went with the one-mid change; the book-wide figure is what the workflow
    // now applies to every leg, so it is what the console recomputes against.
    volatilityMultiplierBps:
      (slow as { volatilityMultiplierBps?: number }).volatilityMultiplierBps ?? slowConfig.volatilityMultiplierBps,
  };
});

/**
 * Why a leg has no price chart, in one sentence, so every screen that has to say it says it the same.
 */
export const POOL_RETIRED =
  "this leg's reference pool was retired when the book moved to one mainnet mid";

/** The pair, taken from the legs rather than named, so a different book renames the header. */
export const PAIR = `${LEGS[0]!.tokenA.symbol}/${LEGS[0]!.tokenB.symbol}`;
