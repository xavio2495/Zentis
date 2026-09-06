"""Minimal raw JSON-RPC helpers for pulling live on-chain state — no web3.py dependency.

Used to compute a first `mid`/`x` off real reserves (cg1/TASK_ORDER.md Day 2, tasks 2.1-2.3) while
no standardized DEX subgraph is servable on either testnet yet (see docs/DECISIONS.md, V4). This
reads Uniswap v3 pools directly by RPC instead of via a Graph query — a documented, disclosed
substitution, not the final shape; Day 6 repoints the same mid/x math at the self-deployed
`aqua-standard`/`zentis-fills` subgraphs once they exist.
"""
import json
import urllib.request

ERC20_BALANCE_OF_SELECTOR = "0x70a08231"  # balanceOf(address)
POOL_SLOT0_SELECTOR = "0x3850c7bd"  # slot0()


def _rpc(rpc_url: str, method: str, params: list):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "zentis-reference-model/0.1"}
    req = urllib.request.Request(rpc_url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read())
    if "error" in payload:
        raise RuntimeError(f"{method} failed: {payload['error']}")
    return payload["result"]


def block_number(rpc_url: str) -> int:
    return int(_rpc(rpc_url, "eth_blockNumber", []), 16)


def block_timestamp(rpc_url: str, block_num: int) -> int:
    block = _rpc(rpc_url, "eth_getBlockByNumber", [hex(block_num), False])
    return int(block["timestamp"], 16)


def highest_block_at_or_before(rpc_url: str, target_timestamp: int) -> int:
    """Binary search for the highest block whose timestamp <= target_timestamp.

    Bounds the search window to a recent range: public RPCs prune old history, and the target is
    always just BUFFER_SECONDS behind "now" anyway, so there is no need to search from genesis.
    """
    hi = block_number(rpc_url)
    if block_timestamp(rpc_url, hi) <= target_timestamp:
        return hi

    lo = max(0, hi - 100_000)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if block_timestamp(rpc_url, mid) <= target_timestamp:
            lo = mid
        else:
            hi = mid - 1
    return lo


def eth_call(rpc_url: str, to: str, data: str, block_num: int) -> str:
    return _rpc(rpc_url, "eth_call", [{"to": to, "data": data}, hex(block_num)])


def erc20_balance_of(rpc_url: str, token: str, holder: str, block_num: int) -> int:
    data = ERC20_BALANCE_OF_SELECTOR + holder[2:].rjust(64, "0")
    return int(eth_call(rpc_url, token, data, block_num), 16)


def pool_sqrt_price_x96(rpc_url: str, pool: str, block_num: int) -> int:
    result = eth_call(rpc_url, pool, POOL_SLOT0_SELECTOR, block_num)
    # slot0() returns (uint160 sqrtPriceX96, int24 tick, ...); the first 32-byte word is sqrtPriceX96.
    return int(result[2:66], 16)


def mid_from_sqrt_price_x96(sqrt_price_x96: int) -> int:
    """mid = raw tokenB per 1e18 raw tokenA, tokenA = token0 (the lower-addressed token).
    Uniswap's sqrtPriceX96 encodes sqrt(token1/token0) in Q64.96 raw-unit terms.
    """
    return (sqrt_price_x96 * sqrt_price_x96 * 10**18) // (2**192)
