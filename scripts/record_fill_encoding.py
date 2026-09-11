#!/usr/bin/env python3
"""
Record, beside each deployment, the bytes a standalone console needs to fill the live position.

The compiled console must not depend on this repository, and it must not guess an encoding either.
So the Solidity builders run once here (`contracts/script/EncodeFill.s.sol`, no broadcast) and their
output is written into `contracts/deployments/<chain>.json` under `fill`: the order as the tuple
`swap()` takes, and the taker traits for the recorded taker in both directions. A fill is then

    cast send <router> "swap((address,uint256,bytes),uint256,bytes)" \
        "(<orderMaker>,<orderTraits>,<orderData>)" <amountIn> <takerAToB|takerBToA>

after an approve of the input token to the router, from the taker's key.

The record is only written when the router's own hash of the rebuilt order equals the shipped
strategyHash; anything else means the recipe's config has drifted from what is live, and recording
it would hand the console bytes for a position that does not exist.

    python3 scripts/record_fill_encoding.py            # every chain
    python3 scripts/record_fill_encoding.py --only sepolia
"""
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RPCS = {
    "sepolia": "https://ethereum-sepolia-rpc.publicnode.com",
    "arbitrum-sepolia": "https://sepolia-rollup.arbitrum.io/rpc",
    "base-sepolia": "https://sepolia.base.org",
}
LABELS = ("orderHash", "orderMaker", "orderTraits", "orderData", "takerAToB", "takerBToA", "taker", "swapSignature")


def taker_address() -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("TAKER_ADDRESS="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("no TAKER_ADDRESS in the root .env")


def encode(name: str, record: dict, fast: dict, rpc: str) -> dict:
    position = record["position"]
    legs = [l for l in fast["legs"] if l["strategyHash"].lower() == position["strategyHash"].lower()]
    if not legs:
        sys.exit(f"{name}: the deployment's strategy hash is in no fast-workflow leg")
    leg = legs[0]
    env = {
        **os.environ,
        "ZENTIS_ROUTER": leg["app"],
        "REF_REGISTRY": leg["registry"],
        "MAKER": fast["maker"],
        "TOKEN_A": leg["tokenA"],
        "TOKEN_B": leg["tokenB"],
        "POSITION_ID": fast["positionId"],
        "POSITION_DEADLINE": str(position["deadline"]),
        "TAKER_ADDRESS": taker_address(),
    }
    out = subprocess.run(
        ["forge", "script", "script/EncodeFill.s.sol", "--rpc-url", rpc],
        cwd=ROOT / "contracts", env=env, capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"{name}: forge failed\n{out.stderr[-800:]}")
    values = {}
    for line in out.stdout.splitlines():
        parts = line.strip().split(" ", 1)
        if len(parts) == 2 and parts[0] in LABELS:
            values[parts[0]] = parts[1].strip()
    missing = [l for l in LABELS if l not in values]
    if missing:
        sys.exit(f"{name}: the script did not print {missing}")
    return values


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    fast = json.loads((ROOT / "cre/fast/config.staging.json").read_text())
    for name, rpc in RPCS.items():
        if only and name != only:
            continue
        path = ROOT / "contracts" / "deployments" / f"{name}.json"
        record = json.loads(path.read_text())
        values = encode(name, record, fast, rpc)
        shipped = record["position"]["strategyHash"].lower()
        if values["orderHash"].lower() != shipped:
            sys.exit(f"{name}: the rebuilt order hashes to {values['orderHash']} but the shipped strategy is "
                     f"{shipped}; the recipe's config has drifted from what is live, nothing written")
        record["fill"] = {
            "note": "Bytes for a standalone fill, produced by contracts/script/EncodeFill.s.sol from the "
                    "Solidity builders; the order hash was checked against position.strategyHash by the "
                    "router before this was written. swap(order, amountIn, takerData) after approving the "
                    "input token to the router; amountIn is exact-in in the input token's raw units.",
            "router": fast["legs"][[l["strategyHash"].lower() for l in fast["legs"]].index(shipped)]["app"],
            "swapSignature": values["swapSignature"],
            "order": {"maker": values["orderMaker"], "traits": values["orderTraits"], "data": values["orderData"]},
            "orderTuple": f"({values['orderMaker']},{values['orderTraits']},{values['orderData']})",
            "taker": values["taker"],
            "takerDataAToB": values["takerAToB"],
            "takerDataBToA": values["takerBToA"],
            "orderHash": values["orderHash"],
        }
        path.write_text(json.dumps(record, indent=2) + "\n")
        print(f"{name}: recorded; order hash {values['orderHash'][:10]}… matches the shipped strategy, "
              f"taker {values['taker'][:10]}…, data {len(values['orderData']) // 2 - 1} bytes")


if __name__ == "__main__":
    main()
