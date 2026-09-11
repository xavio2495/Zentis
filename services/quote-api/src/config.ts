/** One Zentis leg: a chain, the subgraph that indexes it, and a node to ask for prices. */
export interface ChainConfig {
  readonly chainId: number;
  readonly name: string;
  readonly subgraphUrl: string;
  readonly rpcUrl: string;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const CHAINS: readonly ChainConfig[] = [
  {
    chainId: 84532,
    name: "base-sepolia",
    subgraphUrl: env(
      "ZENTIS_SUBGRAPH_BASE_SEPOLIA",
      "https://api.studio.thegraph.com/query/1760015/zentis-fills-base-sepolia/v0.2.0"
    ),
    rpcUrl: env("ZENTIS_RPC_BASE_SEPOLIA", "https://sepolia.base.org")
  },
  {
    chainId: 421614,
    name: "arbitrum-sepolia",
    subgraphUrl: env(
      "ZENTIS_SUBGRAPH_ARBITRUM_SEPOLIA",
      "https://api.studio.thegraph.com/query/1760015/zentis-fills-arbitrum-sepolia/v0.3.0"
    ),
    rpcUrl: env("ZENTIS_RPC_ARBITRUM_SEPOLIA", "https://sepolia-rollup.arbitrum.io/rpc")
  },
  {
    chainId: 11155111,
    name: "sepolia",
    // v0.2.0, not v0.2.1: Studio meters each version label separately and v0.2.1 spent its whole
    // 3000-query allowance on 2026-09-11, returning 429 for twelve hours. v0.2.0 is the previous
    // deployment of the same subgraph, still indexing at head, with its own untouched allowance.
    // The only difference is that its mapping reports `chainId` as 0, a field nothing reads: the
    // data layer takes the chain from its own config and this service selects but never uses it.
    subgraphUrl: env(
      "ZENTIS_SUBGRAPH_SEPOLIA",
      "https://api.studio.thegraph.com/query/1760015/zentis-fills-sepolia/v0.2.0"
    ),
    rpcUrl: env("ZENTIS_RPC_SEPOLIA", "https://ethereum-sepolia-rpc.publicnode.com")
  }
] as const;

/** How far behind the reference may fall before a quote is worth warning about. */
export const REFERENCE_WARN_AGE_SECONDS = 600;

export const PORT = Number(env("PORT", "8787"));
