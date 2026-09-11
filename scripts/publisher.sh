#!/usr/bin/env bash
# Publish the reference on a schedule: `publisher.sh fast` every few minutes, `publisher.sh slow`
# hourly. The workflows only run when something runs them, and a reference older than an hour makes
# the router refuse every quote, so an unattended position needs this or an equivalent.
#
# Secrets come from one private env file, never from the repository: CRE_ETH_PRIVATE_KEY (the
# broadcasting key, which must own the registries), 1INCH_API_KEY, and the SECRET_* gains the
# workflows read. Default ~/.zentis/cre.env, mode 600; override with ZENTIS_CRE_ENV.
set -euo pipefail
which=${1:?usage: publisher.sh fast|slow}
env_file=${ZENTIS_CRE_ENV:-$HOME/.zentis/cre.env}
[ -r "$env_file" ] || { echo "no env file at $env_file" >&2; exit 2; }
repo=$(cd "$(dirname "$0")/.." && pwd)
log_dir=${ZENTIS_LOG_DIR:-$HOME/.zentis/logs}; mkdir -p "$log_dir"
# The gains are secrets to the workflow runtime, which reads them from the process environment.
set -a; . <(grep -E '^SECRET_' "$env_file"); set +a
note() { echo "$(date -u +%FT%TZ) $which $*" >>"$log_dir/$which.log"; }

# Two locks, because there are two different things to prevent and they want different answers.
#
# The publisher's own lock stops a run overlapping the previous run of the SAME publisher; a run
# that is still going does not want a second copy of itself, so this one never waits.
exec 8>"$log_dir/$which.lock"; flock -n 8 || { note "previous run still going"; exit 0; }

# The signing lock is shared by fast and slow, because they sign with the SAME key. Without it the
# two race the account nonce: on 2026-09-11 the 07:55 slow run died with `nonce too low, tx: 170
# state: 171` when the fast timer fired mid-signature, and the hourly reference was lost for an
# hour. No cron offset can fix that -- fast is on a five-minute grid, so every minute is within
# five minutes of a fast run, and the measured fast run time has a tail (p50 29s, p95 57s, but 4%
# of runs longer). Only a lock between the two signers actually excludes them.
#
# They want opposite things when the key is busy: fast runs again in five minutes, so it skips;
# slow runs again in an hour, so it waits. The wait is bounded, and the default is longer than the
# fast publisher's own timeout so that a hung fast run is killed by its timeout before slow gives
# up on it -- but bounded all the same, so a wedged run cannot pin the other publisher forever.
exec 9>"$log_dir/publisher.sign.lock"
if [ "$which" = slow ]; then
	wait_for=${ZENTIS_LOCK_WAIT:-600}
	flock -w "$wait_for" 9 || { note "gave up after ${wait_for}s waiting for the signing key; another publisher still holds it"; exit 1; }
else
	flock -n 9 || { note "skipped: another publisher holds the signing key"; exit 0; }
fi
cd "$repo/cre"
out=$(timeout "${ZENTIS_PUBLISH_TIMEOUT:-540}" cre -e "$env_file" workflow simulate "$which" --target "${ZENTIS_CRE_TARGET:-staging-settings}" --broadcast 2>&1) && rc=0 || rc=$?
# Redact secret VALUES, never whole lines. An earlier version dropped any line containing the word
# "key", which on 2026-09-11 threw away the one sentence that said a secret was missing and logged
# `rc=1` with a blank reason. The values are what must not reach the log; the messages naming them
# are the entire diagnostic. Longest value first, so a short value that is a substring of a longer
# one cannot leave half the longer one behind.
redact() {
	local expr='' name value
	while IFS='=' read -r name value; do
		[ ${#value} -ge 8 ] || continue
		expr+="s|$(printf '%s' "$value" | sed -e 's/[\\&|]/\\&/g')|<redacted:$name>|g;"
	done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=.' "$env_file" | awk -F= '{print length($0), $0}' | sort -rn | cut -d' ' -f2-)
	if [ -n "$expr" ]; then sed -e "$expr"; else cat; fi
}

# The greps may match nothing on a failed run; that must not abort the script before it logs.
result=$(printf '%s\n' "$out" | grep -A1 'Simulation Result' | tail -1 | cut -c1-400 || true)
err=$(printf '%s\n' "$out" | grep -i -E 'error|failed|✗' | grep -v '^[[:space:]]*$' | head -3 | tr '\n' ' ' || true)
# A failure with no line matching those words is still a failure, and still needs a reason: fall back
# to the last thing the run said rather than logging an empty one.
[ -n "$err" ] || err=$(printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -1 || true)
reason=$(printf '%s' "${result:-$err}" | redact | cut -c1-400)
echo "$(date -u +%FT%TZ) $which rc=$rc ${reason:-no output}" >>"$log_dir/$which.log"
exit $rc
