# The Graph, in this repository

### The standardized schema — every Aqua maker position, normalised into one entity shape
[`subgraphs/aqua-standard/schema.graphql`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/schema.graphql) ·
[`subgraphs/aqua-standard/src/mapping.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/src/mapping.ts)

### The decoder that refuses to guess — an app is read only against a table known from verified source
[`subgraphs/aqua-standard/src/dialect.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/src/dialect.ts) ·
[`subgraphs/aqua-standard/src/program.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/src/program.ts) ·
[`subgraphs/aqua-standard/src/classify.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/src/classify.ts)

### Venue-level positioning, so a maker can see how the rest of the venue leans
[`subgraphs/aqua-standard/src/venue.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/src/venue.ts) ·
[`services/quote-api/src/crowding.ts`](https://github.com/xavio2495/Zentis/blob/main/services/quote-api/src/crowding.ts)

### One pipeline, three chains — the join is read out of the shipped program, not configured
[`subgraphs/zentis-fills/schema.graphql`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/zentis-fills/schema.graphql) ·
[`subgraphs/zentis-fills/src/strategy.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/zentis-fills/src/strategy.ts) ·
[`subgraphs/zentis-fills/src/mapping.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/zentis-fills/src/mapping.ts)

### Three manifests, one identical document
[`subgraphs/zentis-fills/subgraph.base-sepolia.yaml`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/zentis-fills/subgraph.base-sepolia.yaml) ·
[`subgraphs/zentis-fills/subgraph.arbitrum-sepolia.yaml`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/zentis-fills/subgraph.arbitrum-sepolia.yaml) ·
[`subgraphs/zentis-fills/subgraph.sepolia.yaml`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/zentis-fills/subgraph.sepolia.yaml)

### The indexed series the enclave prices volatility from, read through the decentralised gateway
[`cre/slow/workflow.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/workflow.ts) ·
[`cre/slow/config.staging.json`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/config.staging.json) ·
[`packages/strategy-sdk/src/volatility.ts`](https://github.com/xavio2495/Zentis/blob/main/packages/strategy-sdk/src/volatility.ts)

### Adverse selection, measured from indexed fills and priced back into the spread
[`cre/slow/policy.ts`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/policy.ts) ·
[`cre/slow/markout_vectors.json`](https://github.com/xavio2495/Zentis/blob/main/cre/slow/markout_vectors.json)

### The mark and its history, from the one series the whole book is measured against
[`services/quote-api/src/mark.ts`](https://github.com/xavio2495/Zentis/blob/main/services/quote-api/src/mark.ts) ·
[`services/quote-api/src/history.ts`](https://github.com/xavio2495/Zentis/blob/main/services/quote-api/src/history.ts)

### Honest responses — `_meta`, a reason for every missing source, and last-good on failure
[`services/quote-api/src/legs.ts`](https://github.com/xavio2495/Zentis/blob/main/services/quote-api/src/legs.ts) ·
[`packages/console-data/src/cache.ts`](https://github.com/xavio2495/Zentis/blob/main/packages/console-data/src/cache.ts)

### Rotating a spent version label without pointing a reader at a dead URL
[`scripts/rotate-fills-label.sh`](https://github.com/xavio2495/Zentis/blob/main/scripts/rotate-fills-label.sh)

### The tests that carry the standardization claim
[`subgraphs/aqua-standard/tests/handlers.test.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/tests/handlers.test.ts) ·
[`subgraphs/aqua-standard/tests/decoder.test.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/aqua-standard/tests/decoder.test.ts) ·
[`subgraphs/zentis-fills/tests/strategy.test.ts`](https://github.com/xavio2495/Zentis/blob/main/subgraphs/zentis-fills/tests/strategy.test.ts)

---

**Why the schema exists.** `Shipped`, `Docked`, `Pulled`, `Pushed` and `SwapVM.Swapped` carry **zero
indexed parameters**, so no consumer can filter Aqua activity by maker, app or token through
`eth_getLogs` topics — everyone must ingest and decode the whole venue. `aqua-standard` does it once,
for every app, and identifies a position by the triple `(maker, app, strategyHash)` because Aqua keys
balances that way and any contract can be an app.

**Two claims, deliberately kept apart.**

| Deployment | Proves |
|---|---|
| `aqua-standard` on **Arbitrum One** and **Ethereum mainnet** | one query pattern spans many **apps** |
| `zentis-fills` on **three testnets** | one pipeline reused across **chains** |

**Live endpoints.**

| Subgraph | Endpoint |
|---|---|
| `aqua-standard` (Arbitrum One) | `https://api.studio.thegraph.com/query/1758742/aqua-standard/v0.2.0` |
| `aqua-standard-ethereum` (mainnet) | `https://api.studio.thegraph.com/query/1760020/aqua-standard-ethereum/v0.2.0` |
| `zentis-fills` (Base Sepolia) | `https://api.studio.thegraph.com/query/1760015/zentis-fills-base-sepolia/v0.3.0` |
| `zentis-fills` (Arbitrum Sepolia) | `https://api.studio.thegraph.com/query/1760015/zentis-fills-arbitrum-sepolia/v0.3.0` |
| `zentis-fills` (Sepolia) | `https://api.studio.thegraph.com/query/1760015/zentis-fills-sepolia/v0.2.0` |
| Uniswap v3 mainnet, through the gateway | `https://gateway.thegraph.com/api/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV` |

**Live data is the whole point.** Nothing in the pricing path is mocked, local or static. The
confidential workflow's spread is measured on the mainnet series above, on every hourly run, through
the decentralised gateway. The three `reference-pools` subgraphs are retired from the pricing path and
kept only as the record of what each leg used to quote from.
