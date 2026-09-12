#!/usr/bin/env python3
"""
A taker that keeps the book trading: one small fill per leg per run, alternating direction, so the
demo accumulates real fills with real hashes while nobody is at the keyboard.

It is a taker, not the maker: it signs with TAKER_PRIVATE_KEY, buys and sells against the live
position through the router with the order and taker bytes the deployment records carry (the
same bytes the console fills with; nothing is re-encoded), and logs every transaction to the shared
transaction log (`scripts/txlog.py`, `~/.zentis/txlog.jsonl`) that the console's log page reads.

Per leg and run: pick the direction opposite to the last one taken on that chain (state in
`~/.zentis/taker-state.json`); if the taker cannot fund that side, take the other; if it can fund
neither, or gas is below the floor, log why and skip. Quote, approve only if the allowance is
short, swap, quote again, and log the fill with the amounts the receipt carried.

    python3 scripts/taker.py --dry-run          # quote every leg both ways, sign nothing
    python3 scripts/taker.py                    # one fill per leg
    python3 scripts/taker.py --only sepolia
    ZENTIS_TAKER_ENV=/path/to/private.env       # where TAKER_PRIVATE_KEY lives (default: repo .env)

Sizes are deliberately tiny — 0.15 USDC or 0.00006 WETH, about a hundredth of a leg — so a run
moves the curve by a few bps and the taker's balances last for weeks of alternating fills.
"""
import json, os, subprocess, sys, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rebalance import ROOT, RPCS, call, next_nonce, send  # noqa: E402
import txlog  # noqa: E402

SIZE_A = 150_000                 # 0.15 USDC, raw
SIZE_B = 60_000_000_000_000      # 0.00006 WETH, raw
GAS_FLOOR_WEI = 2 * 10**15       # 0.002 ETH: below this, stop rather than strand a nonce mid-fill
CHAIN_IDS = {"sepolia": 11155111, "arbitrum-sepolia": 421614, "base-sepolia": 84532}
STATE = Path.home() / ".zentis" / "taker-state.json"
LOG_DIR = Path(os.environ.get("ZENTIS_LOG_DIR", Path.home() / ".zentis" / "logs"))


def taker_key() -> tuple[str, str]:
    env = Path(os.environ.get("ZENTIS_TAKER_ENV", ROOT / ".env"))
    mode = env.stat().st_mode & 0o777
    if mode & 0o077:
        sys.exit(f"{env} is mode {mode:o}; a key file must be 600 or stricter")
    key = address = None
    for line in env.read_text().splitlines():
        if line.startswith("TAKER_PRIVATE_KEY="):
            key = line.split("=", 1)[1].strip().strip('"')
        if line.startswith("TAKER_ADDRESS="):
            address = line.split("=", 1)[1].strip().strip('"')
    if not key or not address:
        sys.exit(f"no TAKER_PRIVATE_KEY / TAKER_ADDRESS in {env}")
    return (key if key.startswith("0x") else "0x" + key), address


def load_state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2) + "\n")


def say(line: str) -> None:
    print(line)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with (LOG_DIR / "taker.log").open("a") as f:
        f.write(f"{datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')} {line}\n")


def quote(fill: dict, amount: int, taker_data: str, rpc: str) -> tuple[int, int] | None:
    """(amountIn, amountOut) from the router's view, or None when it refuses (band, staleness)."""
    sig = fill["swapSignature"].replace("swap(", "quote(", 1) + "(uint256,uint256,bytes32)"
    out = subprocess.run(["cast", "call", fill["router"], sig, fill["orderTuple"], str(amount), taker_data, "-r", rpc],
                         capture_output=True, text=True)
    if out.returncode != 0:
        return None
    lines = out.stdout.strip().splitlines()
    return (int(lines[0].split()[0]), int(lines[1].split()[0])) if len(lines) >= 2 else None


def plan_leg(name: str, rpc: str, taker: str, state: dict) -> dict:
    record = json.loads((ROOT / "contracts" / "deployments" / f"{name}.json").read_text())
    fill = record.get("fill")
    if not fill:
        return {"name": name, "skip": "no fill bytes recorded for this leg"}
    if fill["taker"].lower() != taker.lower():
        return {"name": name, "skip": f"the recorded taker bytes are for {fill['taker'][:10]}…, not this key"}
    token_a, token_b = record["tokens"]["tokenA"]["address"], record["tokens"]["tokenB"]["address"]
    gas = int(subprocess.run(["cast", "balance", taker, "-r", rpc], capture_output=True, text=True).stdout.split()[0])
    if gas < GAS_FLOOR_WEI:
        return {"name": name, "skip": f"gas {gas / 1e18:.4f} ETH is under the {GAS_FLOOR_WEI / 1e18} floor"}
    bal_a = call(token_a, "balanceOf(address)(uint256)", taker, rpc=rpc)[0]
    bal_b = call(token_b, "balanceOf(address)(uint256)", taker, rpc=rpc)[0]
    last = state.get(name, {}).get("lastDirection")
    order = ["BToA", "AToB"] if last == "AToB" else ["AToB", "BToA"]
    for direction in order:
        amount = SIZE_A if direction == "AToB" else SIZE_B
        have = bal_a if direction == "AToB" else bal_b
        if have >= amount:
            token_in, token_out = (token_a, token_b) if direction == "AToB" else (token_b, token_a)
            taker_data = fill["takerDataAToB"] if direction == "AToB" else fill["takerDataBToA"]
            allowance = call(token_in, "allowance(address,address)(uint256)", taker, fill["router"], rpc=rpc)[0]
            q = quote(fill, amount, taker_data, rpc)
            return {"name": name, "rpc": rpc, "fill": fill, "direction": direction, "amount": amount,
                    "tokenIn": token_in, "tokenOut": token_out, "takerData": taker_data,
                    "approve": allowance < amount, "quote": q,
                    "balances": (bal_a, bal_b), "gas": gas}
    return {"name": name, "skip": f"taker holds {bal_a / 1e6:.2f} USDC and {bal_b / 1e18:.6f} WETH, short for either side"}


def main() -> None:
    dry = "--dry-run" in sys.argv
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    key, taker = taker_key()
    state = load_state()
    for name, rpc in RPCS.items():
        if only and name != only:
            continue
        plan = plan_leg(name, rpc, taker, state)
        if "skip" in plan:
            say(f"{name}: skipped, {plan['skip']}")
            txlog.record(name, CHAIN_IDS[name], "fill", taker, note=f"skipped: {plan['skip']}")
            continue
        label = "USDC → WETH" if plan["direction"] == "AToB" else "WETH → USDC"
        q = plan["quote"]
        if q is None:
            say(f"{name}: {label} quote reverted; the band or the reference refused it, skipping")
            txlog.record(name, CHAIN_IDS[name], "fill", taker, note=f"{label} quote refused")
            continue
        say(f"{name}: {label} in {q[0]} quoted out {q[1]}" + (" (approving first)" if plan["approve"] else ""))
        if dry:
            continue
        nonce = next_nonce(taker, rpc)
        fill = plan["fill"]
        if plan["approve"]:
            receipt, error = send(plan["tokenIn"], "approve(address,uint256)", fill["router"], plan["amount"],
                                  rpc=rpc, private_key=key, nonce=nonce)
            if error:
                say(f"{name}: approve FAILED: {error}")
                txlog.record(name, CHAIN_IDS[name], "approve", taker, status=0, note=error[-200:])
                continue
            txlog.record(name, CHAIN_IDS[name], "approve", taker, tx=receipt["transactionHash"],
                         status=int(receipt["status"], 16), amount_in=plan["amount"], token_in=plan["tokenIn"])
            nonce += 1
        receipt, error = send(fill["router"], fill["swapSignature"], fill["orderTuple"], plan["amount"], plan["takerData"],
                              rpc=rpc, private_key=key, nonce=nonce)
        if error:
            say(f"{name}: swap FAILED: {error}")
            txlog.record(name, CHAIN_IDS[name], "fill", taker, status=0, amount_in=plan["amount"],
                         token_in=plan["tokenIn"], token_out=plan["tokenOut"], note=error[-200:])
            continue
        status = int(receipt["status"], 16)
        after = quote(fill, plan["amount"], plan["takerData"], rpc)
        say(f"{name}: {label} filled {receipt['transactionHash']} status {status}; next quote out "
            f"{after[1] if after else 'refused'} (was {q[1]})")
        txlog.record(name, CHAIN_IDS[name], "fill", taker, tx=receipt["transactionHash"], status=status,
                     amount_in=q[0], amount_out=q[1], token_in=plan["tokenIn"], token_out=plan["tokenOut"],
                     note=f"quoted before {q[1]}, after {after[1] if after else 'refused'}")
        if status == 1:
            state[name] = {"lastDirection": plan["direction"], "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
            save_state(state)


if __name__ == "__main__":
    main()
