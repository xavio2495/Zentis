#!/usr/bin/env bash
# Point every reader at a freshly deployed fills-subgraph version label.
#
# Subgraph Studio meters queries per version label, so an exhausted label is cleared by deploying a
# new one rather than only by waiting for the window to roll. The deploy publishes under the account
# that owns the subgraph and is the user's to run; this script does the part after it: prove the new
# label answers the complete reader query, rewrite the URL everywhere a reader holds it, and report
# the quota the new label starts with.
#
#   rotate-fills-label.sh <chain> <label> [--dry-run]
#   rotate-fills-label.sh base-sepolia v0.3.0
#
# It verifies BEFORE it rewrites, which is the opposite of the obvious order and is the point: a
# commit under cre/ is live at the next timer tick, so a label that does not answer must never reach
# cre/slow/config.*.json at all, not even for the time it takes to notice and revert.
#
# No key is read, printed or needed. Studio query URLs carry their own access in the path and are
# rate-limited rather than authenticated; the deploy key is a different credential entirely and this
# script never touches it.
set -euo pipefail

chain=${1:-}
label=${2:-}
dry_run=${3:-}
case "$chain" in
	base-sepolia | arbitrum-sepolia | sepolia) ;;
	*) echo "usage: rotate-fills-label.sh <base-sepolia|arbitrum-sepolia|sepolia> <label> [--dry-run]" >&2; exit 2 ;;
esac
[ -n "$label" ] || { echo "a version label is required, e.g. v0.3.0" >&2; exit 2; }

repo=$(cd "$(dirname "$0")/.." && pwd)
staging="$repo/cre/slow/config.staging.json"

# The staging config is the one place that certainly names every leg, and it is also what
# packages/console-data imports, so it is the right source for "what is the URL today".
old_url=$(grep -o "https://api.studio.thegraph.com/query/[0-9]*/zentis-fills-$chain/[^\"]*" "$staging" | head -1)
[ -n "$old_url" ] || { echo "no fills URL for $chain in $staging" >&2; exit 1; }
new_url="${old_url%/*}/$label"

if [ "$old_url" = "$new_url" ]; then
	echo "already on $label; nothing to rotate" >&2
	exit 0
fi

position_id=$(grep -o '"positionId": *"[^"]*"' "$repo/cre/fast/config.staging.json" | head -1 | cut -d'"' -f4)

# Everything a reader asks this subgraph for, in one request: the console's history query (position,
# fills, references, rejections) plus the indexer head. A label that answers a bare `_meta` but
# rejects `references(where: {positionId: ...})` is exactly the trap that makes v0.1.2 unusable as a
# spare, so probing the whole surface is the only probe worth running.
read -r -d '' query <<QUERY || true
{
  _meta { block { number } hasIndexingErrors }
  position(id: "$position_id") {
    strategyHash active balanceA balanceB fillCount
    hasReference refMid refTiltBps refSeq refUpdatedAt
  }
  fills(where: { position: "$position_id" }, orderBy: timestamp, orderDirection: desc, first: 5) {
    timestamp transaction amountIn amountOut isAToB hasReference refMid refSeq refAgeSeconds
  }
  references(where: { positionId: "$position_id" }, orderBy: timestamp, orderDirection: desc, first: 5) {
    timestamp transaction mid tiltBps seq updatedAt
  }
  rejections: rejectedReferences(where: { positionId: "$position_id" }, orderBy: timestamp, orderDirection: desc, first: 5) {
    timestamp transaction reason
  }
}
QUERY

probe() { # $1 = url; prints "status|remaining|body-path"
	local url=$1 headers body status remaining
	headers=$(mktemp); body=$(mktemp)
	status=$(curl -s -m 30 -o "$body" -D "$headers" -w '%{http_code}' \
		-H 'content-type: application/json' \
		--data "$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<<"$query")" \
		"$url" || echo 000)
	remaining=$(grep -i '^x-ratelimit-remaining:' "$headers" | tr -d '\r' | awk '{print $2}')
	rm -f "$headers"
	printf '%s|%s|%s' "$status" "${remaining:-unknown}" "$body"
}

echo "chain        $chain"
echo "from         $old_url"
echo "to           $new_url"
echo

IFS='|' read -r status remaining body <<<"$(probe "$new_url")"

# The one failure this script exists to clear, so it gets its own sentence rather than arriving as a
# JSON parse error: Studio answers an exhausted label with a plain-text 429, not with GraphQL.
if [ "$status" = "429" ]; then
	echo "the new label is already rate-limited (HTTP 429, remaining $remaining)." >&2
	echo "deploy a fresh label rather than rotating onto a spent one; nothing has been rewritten" >&2
	rm -f "$body"; exit 1
fi

# A label that does not exist answers HTTP 200 with {"message":"Not found"} -- no `errors` key and no
# `data` key. Checking the status alone would rewrite every reader to a dead URL and look successful
# doing it, so the body is what decides, and one place decides it.
verdict=$(python3 - "$body" 2>&1 <<'CHECK'
import json, sys
try:
	payload = json.load(open(sys.argv[1]))
except Exception as exc:
	sys.exit(f'the reply was not JSON: {exc}')
if 'errors' in payload:
	sys.exit('it rejected the reader query: '
		+ '; '.join(e.get('message', '?') for e in payload['errors']))
data = payload.get('data')
if data is None:
	sys.exit('it returned no data: ' + json.dumps(payload)[:200]
		+ '  (a label that was never deployed answers exactly this way)')
meta = data['_meta']['block']['number']
position = data['position']
lines = [f'reader query  OK   head block {meta}  indexing errors {data["_meta"]["hasIndexingErrors"]}']
lines.append('  position    ' + (f'present, {position["fillCount"]} fills' if position
	else 'ABSENT -- still indexing, or the start block is wrong'))
for key in ('fills', 'references', 'rejections'):
	lines.append(f'  {key:<11} {len(data[key])} returned')
print(*lines, sep=chr(10))
CHECK
) || { echo "the new label answered HTTP $status, and $verdict" >&2; echo "nothing has been rewritten" >&2; rm -f "$body"; exit 1; }
rm -f "$body"
echo "$verdict"
echo "quota        x-ratelimit-remaining: $remaining"
echo

if [ "$dry_run" = "--dry-run" ]; then
	echo "dry run: verified only, nothing rewritten"
	exit 0
fi

# Every file that holds the URL literally. packages/console-data/src/config.ts is deliberately NOT
# in this list and does not need to be: it imports cre/slow/config.staging.json and derives the leg's
# URL from it, so rewriting the staging config moves the console too. contracts/deployments records a
# `subgraphs.fills` entry only where one was written — today that is sepolia.json alone — so a count
# of zero for a file is reported rather than treated as a failure.
files=(
	"$repo/cre/slow/config.staging.json"
	"$repo/cre/slow/config.production.json"
	"$repo/contracts/deployments/$chain.json"
	"$repo/services/quote-api/src/config.ts"
)
for f in "${files[@]}"; do
	rel=${f#"$repo"/}
	[ -f "$f" ] || { printf '  %-44s missing\n' "$rel"; continue; }
	n=$(grep -c -F "$old_url" "$f" || true)
	if [ "$n" -gt 0 ]; then sed -i "s|$old_url|$new_url|g" "$f"; fi
	printf '  %-44s %s\n' "$rel" "$n rewritten"
done
echo

left=$(grep -rl -F "$old_url" "$repo" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=build --exclude-dir=generated 2>/dev/null || true)
if [ -n "$left" ]; then
	echo "still naming the old label:" >&2
	printf '  %s\n' $left >&2
	exit 1
fi
echo "no file still names $old_url"

# Read it back through the rewritten config rather than through the variable, which is what proves
# the console and the workflow will resolve the same endpoint.
check=$(grep -o "https://api.studio.thegraph.com/query/[0-9]*/zentis-fills-$chain/[^\"]*" "$staging" | head -1)
[ "$check" = "$new_url" ] || { echo "the staging config resolves to $check, not $new_url" >&2; exit 1; }
echo "cre/slow/config.staging.json resolves to $new_url"
echo
echo "next: run the console-data and quote-api suites, then commit cre/, contracts/ and services/ together."
