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
exec 9>"$log_dir/$which.lock"; flock -n 9 || { echo "$(date -u +%FT%TZ) $which: previous run still going" >>"$log_dir/$which.log"; exit 0; }
cd "$repo/cre"
out=$(timeout "${ZENTIS_PUBLISH_TIMEOUT:-540}" cre -e "$env_file" workflow simulate "$which" --target "${ZENTIS_CRE_TARGET:-staging-settings}" --broadcast 2>&1) && rc=0 || rc=$?
# The greps may match nothing on a failed run; that must not abort the script before it logs.
result=$(printf '%s\n' "$out" | grep -A1 'Simulation Result' | tail -1 | cut -c1-400 || true)
err=$(printf '%s\n' "$out" | grep -i -E 'error|failed|✗' | grep -v -i key | head -3 | tr '\n' ' ' || true)
echo "$(date -u +%FT%TZ) $which rc=$rc ${result:-$err}" >>"$log_dir/$which.log"
exit $rc
