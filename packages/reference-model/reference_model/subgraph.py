"""Keyed queries against Zentis's own reference-pool subgraphs.

These are self-deployed (subgraphs/reference-pools/) because no standardized DEX subgraph is
actually servable on either testnet — the third-party Uniswap v3 deployments exist at the right
IDs but have zero indexer allocations. See docs/DECISIONS.md, V4.
"""
import json
import os
import urllib.request

# Studio allows three subgraphs per account, so the deployments are split across three of them.
# The account id is part of the query URL, which means it is per-subgraph, not global.
STUDIO_ID = "1758742"
VERSION = "v0.0.1"


def endpoint(subgraph_name: str, studio_id: str = STUDIO_ID) -> str:
    return f"https://api.studio.thegraph.com/query/{studio_id}/{subgraph_name}/{VERSION}"


def query(url: str, document: str, variables: dict | None = None) -> dict:
    body = json.dumps({"query": document, "variables": variables or {}}).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "zentis-reference-model/0.1"}
    api_key = os.environ.get("GRAPH_API_KEY")
    if api_key and "gateway" in url:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read())

    if "errors" in payload:
        raise RuntimeError(f"subgraph query failed: {payload['errors']}")
    return payload["data"]


# `_meta.block` is the indexer head — how far this subgraph has actually indexed, which is what
# task 2.2's lag buffer has to be measured against.
POOL_AT_BLOCK = """
query PoolAtBlock($block: Int!) {
  _meta { block { number timestamp } hasIndexingErrors }
  pools(block: { number: $block }) {
    id
    mid
    reserveA
    reserveB
    updatedAtBlock
    updatedAtTimestamp
  }
}
"""

INDEXER_HEAD = """
query IndexerHead {
  _meta { block { number timestamp } hasIndexingErrors }
}
"""


def indexer_head(url: str) -> dict:
    meta = query(url, INDEXER_HEAD)["_meta"]
    if meta["hasIndexingErrors"]:
        raise RuntimeError(f"{url} reports indexing errors; refusing to price off it")
    return meta["block"]


def pool_at_block(url: str, block_number: int) -> dict:
    data = query(url, POOL_AT_BLOCK, {"block": block_number})
    pools = data["pools"]
    if not pools:
        raise RuntimeError(f"{url} has no indexed pool at block {block_number}")
    return pools[0]
