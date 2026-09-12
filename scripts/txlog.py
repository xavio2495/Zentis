#!/usr/bin/env python3
"""
One transaction log for everything Zentis signs, so the console's log page and the operator read
the same record: `~/.zentis/txlog.jsonl` (override with ZENTIS_TXLOG), one JSON object per line,
newest last. Written by the scripts here and by the console's own signing child; read by the
console's log page and by anyone who wants demo proof with hashes.

Fields: at (ISO-8601 UTC), chain, chainId, kind (fill | approve | push | wrap | republish | ship),
actor (the signing address), tx, status (1 ok, 0 reverted), amountIn, amountOut, tokenIn, tokenOut
(raw units as strings, absent where the kind has none), note (free text, e.g. why a fill was
skipped; a line with no tx is an event, not a transaction).
"""
import json, os, datetime
from pathlib import Path


def path() -> Path:
    return Path(os.environ.get("ZENTIS_TXLOG", Path.home() / ".zentis" / "txlog.jsonl"))


def record(chain: str, chain_id: int, kind: str, actor: str, *, tx: str | None = None, status: int | None = None,
           amount_in: int | None = None, amount_out: int | None = None, token_in: str | None = None,
           token_out: str | None = None, note: str | None = None) -> dict:
    line = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "chain": chain, "chainId": chain_id, "kind": kind, "actor": actor}
    if tx is not None: line["tx"] = tx
    if status is not None: line["status"] = status
    if amount_in is not None: line["amountIn"] = str(amount_in)
    if amount_out is not None: line["amountOut"] = str(amount_out)
    if token_in is not None: line["tokenIn"] = token_in
    if token_out is not None: line["tokenOut"] = token_out
    if note: line["note"] = note
    p = path(); p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a") as f:
        f.write(json.dumps(line) + "\n")
    return line
