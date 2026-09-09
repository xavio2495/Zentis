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
      "https://api.studio.thegraph.com/query/1760015/zentis-fills-base-sepolia/v0.1.2"
    ),
    rpcUrl: env("ZENTIS_RPC_BASE_SEPOLIA", "https://sepolia.base.org")
  },
  {
    chainId: 421614,
    name: "arbitrum-sepolia",
    subgraphUrl: env(
      "ZENTIS_SUBGRAPH_ARBITRUM_SEPOLIA",
      "https://api.studio.thegraph.com/query/1760015/zentis-fills-arbitrum-sepolia/v0.1.2"
    ),
    rpcUrl: env("ZENTIS_RPC_ARBITRUM_SEPOLIA", "https://sepolia-rollup.arbitrum.io/rpc")
  }
] as const;

/** How far behind the reference may fall before a quote is worth warning about. */
export const REFERENCE_WARN_AGE_SECONDS = 600;

export const PORT = Number(env("PORT", "8787"));
