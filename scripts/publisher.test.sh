#!/usr/bin/env bash
# A failed publish must leave a reason in the log that a person can act on.
#
# The 06:55 UTC run on 2026-09-11 logged `rc=1` and nothing else. The cause was a secret missing from
# the env file, and the message saying so named it -- which is exactly why it was dropped, because the
# publisher filtered out every line containing the word "key". A redaction that removes the sentence
# instead of the secret is worse than none: it costs the operator the diagnosis and protects nothing,
# since the value was never in the message to begin with.
#
# `cre` is stubbed, so this never runs a workflow and never broadcasts.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d /tmp/publisher-test-XXXXXX)
trap 'rm -rf "$work"' EXIT
pass=0; fail=0
check() { # name, haystack, needle, want(present|absent)
	local name=$1 hay=$2 needle=$3 want=$4 got=absent
	case "$hay" in *"$needle"*) got=present ;; esac
	if [ "$got" = "$want" ]; then pass=$((pass + 1)); printf '  ok   %s\n' "$name"
	else fail=$((fail + 1)); printf '  FAIL %s: wanted %s, got %s\n     in: %s\n' "$name" "$want" "$got" "$hay"; fi
}

SECRET_VALUE='s3cr3t-value-that-must-never-be-logged'
cat >"$work/cre.env" <<ENV
CRE_ETH_PRIVATE_KEY=$SECRET_VALUE
SECRET_KAPPA_BPS=10000
ENV
chmod 600 "$work/cre.env"

# A stub standing in for the CLI, reproducing the shape of the run that logged nothing: the reason
# names a key, and the raw output happens to contain a secret value as well.
mkdir -p "$work/bin"
cat >"$work/bin/cre" <<STUB
#!/usr/bin/env bash
echo "Initializing..."
echo "Compiling workflow..."
echo "✗ workflow execution failed: secret \"CRE_GRAPH_API_KEY\" not found for owner, sent $SECRET_VALUE"
exit 1
STUB
chmod +x "$work/bin/cre"

set +e
PATH="$work/bin:$PATH" ZENTIS_CRE_ENV="$work/cre.env" ZENTIS_LOG_DIR="$work/logs" \
	"$here/publisher.sh" slow >/dev/null 2>&1
rc=$?
set -e
line=$(cat "$work/logs/slow.log" 2>/dev/null || true)

echo "logged: $line"
check "the run is recorded as failing"        "$line"  "rc=1"                     present
check "the reason survives the key filter"    "$line"  "workflow execution failed" present
check "the named secret is still readable"    "$line"  "CRE_GRAPH_API_KEY"        present
check "the secret VALUE never reaches disk"   "$line"  "$SECRET_VALUE"            absent
check "the redaction is visible where it hid" "$line"  "redacted"                 present
[ "$rc" -eq 1 ] && { pass=$((pass + 1)); echo "  ok   the exit code is passed through"; } \
	|| { fail=$((fail + 1)); echo "  FAIL exit code: wanted 1, got $rc"; }


# A short secret must NOT be redacted. SECRET_KAPPA_BPS is "10000", which also appears in ordinary
# output (`maxTiltBps 10000`, a mid, a block number); blanking every occurrence of it would corrupt
# the result line to protect a gain that is already published on chain in the tilt it produces.
cat >"$work/bin/cre" <<'STUB'
#!/usr/bin/env bash
echo "✓ Workflow Simulation Result:"
echo '"baseEdgeBps 58 | spreadBps 10+2, maxTiltBps 10000, seq 1789108526"'
exit 0
STUB
chmod +x "$work/bin/cre"
set +e
PATH="$work/bin:$PATH" ZENTIS_CRE_ENV="$work/cre.env" ZENTIS_LOG_DIR="$work/logs" \
	"$here/publisher.sh" slow >/dev/null 2>&1
ok_rc=$?
set -e
good=$(tail -1 "$work/logs/slow.log")
echo "logged: $good"
check "a successful run logs its result"      "$good"  "baseEdgeBps 58"           present
check "a short secret is left alone"          "$good"  "maxTiltBps 10000"         present
check "a successful run is recorded as such"  "$good"  "rc=0"                     present
[ "$ok_rc" -eq 0 ] || { fail=$((fail + 1)); echo "  FAIL success exit code: got $ok_rc"; }


# ── the signing lock ─────────────────────────────────────────────────────────
# fast and slow sign with the SAME key. On 2026-09-11 the 07:55 slow run died with
# `nonce too low: tx: 170 state: 171` because the fast timer fired while slow was signing and took
# the nonce. A per-publisher lock cannot see that: the two publishers held different locks. They
# need one lock between them, and they want opposite things when they cannot get it -- fast runs
# again in five minutes so it should skip, slow runs again in an hour so it should wait.
cat >"$work/bin/cre" <<'STUB'
#!/usr/bin/env bash
echo "✓ Workflow Simulation Result:"
echo '"published"'
exit 0
STUB
chmod +x "$work/bin/cre"
run() { PATH="$work/bin:$PATH" ZENTIS_CRE_ENV="$work/cre.env" ZENTIS_LOG_DIR="$work/logs" "$here/publisher.sh" "$@"; }
hold() { flock "$work/logs/publisher.sign.lock" -c "sleep $1" & holder=$!; sleep 0.5; }

mkdir -p "$work/logs"
: >"$work/logs/publisher.sign.lock"

hold 4
set +e; run fast >/dev/null 2>&1; fast_rc=$?; set -e
fast_line=$(tail -1 "$work/logs/fast.log" 2>/dev/null || echo "")
check "fast skips rather than racing the nonce" "$fast_line" "signing" present
[ "$fast_rc" -eq 0 ] && { pass=$((pass + 1)); echo "  ok   a skip is not a failure for fast"; } \
	|| { fail=$((fail + 1)); echo "  FAIL fast skip exit: wanted 0, got $fast_rc"; }
wait "$holder" 2>/dev/null || true

# slow waits for the key rather than giving up its hourly slot
hold 3
began=$(date +%s)
set +e; ZENTIS_LOCK_WAIT=30 run slow >/dev/null 2>&1; slow_rc=$?; set -e
waited=$(( $(date +%s) - began ))
slow_line=$(tail -1 "$work/logs/slow.log")
check "slow publishes once the key is free" "$slow_line" "published" present
[ "$slow_rc" -eq 0 ] && [ "$waited" -ge 2 ] && { pass=$((pass + 1)); echo "  ok   slow waited ${waited}s for the key"; } \
	|| { fail=$((fail + 1)); echo "  FAIL slow wait: rc=$slow_rc after ${waited}s"; }
wait "$holder" 2>/dev/null || true

# but the wait is bounded, so a hung publisher cannot pin the other one forever
hold 10
set +e; ZENTIS_LOCK_WAIT=1 run slow >/dev/null 2>&1; gave_up=$?; set -e
give_line=$(tail -1 "$work/logs/slow.log")
check "a bounded wait gives up with a reason" "$give_line" "signing" present
[ "$gave_up" -ne 0 ] && { pass=$((pass + 1)); echo "  ok   giving up is reported as a failure"; } \
	|| { fail=$((fail + 1)); echo "  FAIL giving up should not look like success"; }
kill "$holder" 2>/dev/null || true; wait "$holder" 2>/dev/null || true

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
