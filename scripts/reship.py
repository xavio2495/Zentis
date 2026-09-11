#!/usr/bin/env python3
"""
Dock every leg's shipped position and ship a new one sized to the reference mid of this moment.

The maker signs, so this runs where the maker's key is: it reads CRE_ETH_PRIVATE_KEY from the
private env file (ZENTIS_CRE_ENV, default ~/.zentis/cre.env) and never prints it. Each leg's
addresses come from cre/fast/config.staging.json and contracts/deployments/<chain>.json, never
typed. After a successful ship the deployment record is rewritten: the outgoing position moves
under supersededPositions with its dock tx, and every workflow config that named the old
strategyHash is pointed at the new one. Commit is manual.

    python3 scripts/reship.py            # dock + ship on all three chains, then update the records
    python3 scripts/reship.py --dry-run  # simulate the ship (no dock, nothing broadcast), print sizes
    python3 scripts/reship.py --only sepolia

ShipPosition refuses a reference older than an hour, and updatedAt is a finalized timestamp, so run
this within ~40 minutes of a fast publish. Until the ship block is finalized (~20 min) the fast
workflow reverts on the new strategy's balance read; that is expected.
"""
import json, os, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RPCS = {
    11155111: ("sepolia", "https://ethereum-sepolia-rpc.publicnode.com"),
    421614: ("arbitrum-sepolia", "https://sepolia-rollup.arbitrum.io/rpc"),
    84532: ("base-sepolia", "https://sepolia.base.org"),
}
CONFIGS = [ROOT / p for p in ("cre/fast/config.staging.json", "cre/fast/config.production.json",
                              "cre/slow/config.staging.json", "cre/slow/config.production.json")]
QUOTE_API = os.environ.get("ZENTIS_QUOTE_API", "http://localhost:8787")


def mark_at_ship(chain_id):
    """The mainnet mark for this leg right now, to be recorded with the ship.

    Hold profit is a price change over time and needs one price source at both ends. The ship is
    sized to the leg's own pool mid, which on a testnet is nowhere near the market, so without the
    market's price *at this moment* the hold effect can never be separated from the trading later.
    None if the quote service is not up: a missing mark is recorded as missing, never guessed.
    """
    try:
        with urllib.request.urlopen(f"{QUOTE_API}/mark", timeout=10) as response:
            for mark in json.load(response)["marks"]:
                if mark["chainId"] == chain_id and mark["mid"] is not None:
                    return mark["mid"]
    except Exception as cause:
        print(f"  no mark recorded ({cause}); hold profit will be unknown for this generation")
    return None


def key() -> str:
    env = Path(os.environ.get("ZENTIS_CRE_ENV", Path.home() / ".zentis" / "cre.env"))
    for line in env.read_text().splitlines():
        if line.startswith("CRE_ETH_PRIVATE_KEY="):
            k = line.split("=", 1)[1].strip().strip('"')
            return k if k.startswith("0x") else "0x" + k
    sys.exit(f"no CRE_ETH_PRIVATE_KEY in {env}")


def sh(cmd, env=None, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=cwd)
    return r.returncode, r.stdout, r.stderr


def leg_for(fast, strategy_hash):
    legs = [l for l in fast["legs"] if l["strategyHash"].lower() == strategy_hash.lower()]
    if len(legs) != 1:
        sys.exit(f"{strategy_hash} names {len(legs)} legs in the fast config")
    return legs[0]


def parse_logs(stdout):
    logs = {}
    for line in stdout.splitlines():
        t = line.strip().split()
        if len(t) >= 2 and t[0] in ("strategyHash", "orderHash", "reference", "balanceA", "balanceB"):
            logs[" ".join(t[:-1])] = t[-1]
    return logs


def reship(chain_id, name, rpc, dry_run, private_key):
    record_path = ROOT / "contracts" / "deployments" / f"{name}.json"
    record = json.loads(record_path.read_text())
    fast = json.loads((ROOT / "cre/fast/config.staging.json").read_text())
    old = record["position"]
    leg = leg_for(fast, old["strategyHash"])
    print(f"== {name}: old strategy {old['strategyHash'][:10]}…")

    env = dict(os.environ, AQUA=leg["aqua"], ZENTIS_ROUTER=leg["app"], REF_REGISTRY=leg["registry"],
               TOKEN_A=leg["tokenA"], TOKEN_B=leg["tokenB"], BALANCE_A=str(old["shippedBalanceA"]),
               POSITION_ID=fast["positionId"], POSITION_DEADLINE=str(old["deadline"]),
               WALLET_PRIVATE_KEY=private_key)
    if dry_run:
        rc, so, se = sh(["forge", "script", "script/ShipPosition.s.sol", "--rpc-url", rpc, "-vv"], env=env, cwd=ROOT / "contracts")
        print("simulated ship:", "ok" if rc == 0 else "FAILED", json.dumps(parse_logs(so)))
        if rc != 0:
            print((so + se)[-800:])
        return None

    rc, so, se = sh(["cast", "send", leg["aqua"], "dock(address,bytes32,address[])", leg["app"], old["strategyHash"],
                     f'[{leg["tokenA"]},{leg["tokenB"]}]', "--private-key", private_key, "-r", rpc, "--json"])
    if rc != 0:
        print("dock FAILED:", se[-600:])
        return None
    dock = json.loads(so)
    print("docked:", dock["transactionHash"], "status", dock["status"])

    rc, so, se = sh(["forge", "script", "script/ShipPosition.s.sol", "--rpc-url", rpc, "--broadcast", "-vv"], env=env, cwd=ROOT / "contracts")
    logs = parse_logs(so)
    if rc != 0:
        print("ship FAILED (the old position is docked; re-run --only", name, "after fixing):", (so + se)[-800:])
        return None
    run = json.loads((ROOT / "contracts" / "broadcast" / "ShipPosition.s.sol" / str(chain_id) / "run-latest.json").read_text())
    ships = [t for t in run["transactions"] if (t.get("contractAddress") or "").lower() == leg["aqua"].lower()]
    ship_tx = ships[-1]["hash"] if ships else None
    block = None
    if ship_tx:
        rc, so, _ = sh(["cast", "receipt", ship_tx, "-r", rpc, "--json"])
        if rc == 0:
            block = int(json.loads(so)["blockNumber"], 16)
    new_hash = logs.get("strategyHash")
    if new_hash is None or ship_tx is None:
        print("shipped but could not resolve the strategy hash or tx; fix the record by hand", logs)
        return None

    superseded = {**old, "dockTx": dock["transactionHash"],
                  "supersededReason": "re-shipped sized to the reference mid with the testnet shift cap raised to 5000 bps"}
    record.setdefault("supersededPositions", []).append(superseded)
    mark = mark_at_ship(chain_id)
    record["position"] = {
        "positionId": old["positionId"], "strategyHash": new_hash, "maker": old["maker"], "deadline": old["deadline"],
        "shipTx": ship_tx, "shipBlock": block, "shippedBalanceA": logs.get("balanceA (raw)", str(old["shippedBalanceA"])),
        "shippedBalanceB": logs.get("balanceB (raw)"),
        "shippedAgainstRef": {"mid": logs.get("reference mid"), "seq": int(logs["reference seq"]) if "reference seq" in logs else None},
        "markAtShip": mark,
        "widenBpsPerMinute": old.get("widenBpsPerMinute", 2), "maxTiltBps": 5000,
        "note": old.get("note", "Balances here are the shipped amounts; live balances come from the fills subgraph."),
    }
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    for path in CONFIGS:
        text = path.read_text()
        if old["strategyHash"] in text:
            path.write_text(text.replace(old["strategyHash"], new_hash))
    print("shipped:", ship_tx, "block", block, "strategy", new_hash, "balanceB", logs.get("balanceB (raw)"))
    return new_hash


def main():
    dry_run = "--dry-run" in sys.argv
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    private_key = key()
    for chain_id, (name, rpc) in RPCS.items():
        if only and name != only:
            continue
        reship(chain_id, name, rpc, dry_run, private_key)


if __name__ == "__main__":
    main()
