#!/usr/bin/env python3
"""Day 2, tasks 2.1-2.3: one keyed query per chain against Zentis's own reference-pool subgraphs,
timestamp-aligned, producing a first `mid` and `x` — a script, not a workflow (that is Day 5).

Block pinning (2.1): target `t = now - BUFFER_SECONDS`, take the highest block on each chain with
`timestamp <= t`, and query each subgraph pinned at that block so both legs describe the same
instant. `updatedAt` is the min across chains, so the combined reference is never fresher than its
laggier leg.

Indexing lag (2.2): the buffer is measured against the *indexer head* (`_meta.block`), not the chain
head. If a subgraph has not yet indexed the target block, we fall back to its indexer head and say
so — pricing off a block the indexer has not reached would silently return an empty result set.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reference_model.onchain import block_timestamp, highest_block_at_or_before
from reference_model.subgraph import endpoint, indexer_head, pool_at_block

BUFFER_SECONDS = 30

CHAINS = {
    "base-sepolia": {
        "rpc_url": "https://sepolia.base.org",
        "subgraph": "zentis-reference-pool-base-sepolia",
    },
    "arbitrum-sepolia": {
        "rpc_url": "https://sepolia-rollup.arbitrum.io/rpc",
        "subgraph": "zentis-reference-pool-arbitrum-sepolia",
    },
}


def fetch_chain(name: str, cfg: dict, now: int) -> dict:
    url = endpoint(cfg["subgraph"])
    head = indexer_head(url)
    head_block = int(head["number"])

    target_block = highest_block_at_or_before(cfg["rpc_url"], now - BUFFER_SECONDS)

    # 2.2's documented fallback: never ask for a block past the indexer head.
    lag_blocks = target_block - head_block
    pinned_block = min(target_block, head_block)

    pool = pool_at_block(url, pinned_block)
    mid = int(pool["mid"])
    reserve_a = int(pool["reserveA"])
    reserve_b = int(pool["reserveB"])

    # x: imbalance signed relative to token A, positive = over-weight A. Still a placeholder proxy
    # off the pool's own composition — there is no Zentis position yet (Day 4). The formula shape is
    # the one real inventory will use: value-weighted difference between actual tokenA holdings and
    # an even split with tokenB at the current mid.
    x = reserve_a - (reserve_b * 10**18) // mid

    return {
        "chain": name,
        "pinnedBlock": pinned_block,
        "indexerHead": head_block,
        "lagBlocks": lag_blocks,
        "fellBackToHead": target_block > head_block,
        "updatedAt": int(pool["updatedAtTimestamp"]),
        "updatedAtBlock": int(pool["updatedAtBlock"]),
        "mid": mid,
        "reserveA": reserve_a,
        "reserveB": reserve_b,
        "x": x,
    }


def main() -> None:
    now = int(time.time())
    results = {name: fetch_chain(name, cfg, now) for name, cfg in CHAINS.items()}

    for r in results.values():
        fallback = " (FELL BACK to indexer head)" if r["fellBackToHead"] else ""
        print(
            f"{r['chain']:>18} | pinned block {r['pinnedBlock']}{fallback}\n"
            f"{'':>18} | indexer head {r['indexerHead']} | lag vs target {r['lagBlocks']} blocks\n"
            f"{'':>18} | mid {r['mid']} | last traded at block {r['updatedAtBlock']} (ts {r['updatedAt']})\n"
            f"{'':>18} | reserveA {r['reserveA']} | reserveB {r['reserveB']} | x {r['x']}"
        )

    combined = min(r["updatedAt"] for r in results.values())
    print(f"\ncombined updatedAt (min across chains): {combined}")


if __name__ == "__main__":
    main()
