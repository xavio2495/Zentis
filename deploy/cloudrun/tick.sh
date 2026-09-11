#!/usr/bin/env bash
# One scheduled tick for the Cloud Run job. fast and slow sign with the same key, so they must never
# run at the same time; two jobs on two schedules cannot promise that (separate instances, no shared
# lock, and zentis-d9 measured 4% of fast runs overrunning the two minutes any 5-minute offset can
# buy). So there is one job, run every five minutes: fast always, then slow in the first slot of
# each hour, sequentially in the same instance. `tick.sh fast` and `tick.sh slow` still run one alone.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
publisher="$here/../../scripts/publisher.sh"
case "${1:-tick}" in
  fast|slow) "$publisher" "$1" || rc=$?; cat "${ZENTIS_LOG_DIR:-$HOME/.zentis/logs}"/*.log 2>/dev/null || true; exit "${rc:-0}" ;;
  tick)
    "$publisher" fast || rc=$?
    if [ "$(date -u +%M)" -lt 5 ]; then "$publisher" slow || rc=$?; fi
    # The publisher writes its one-line result to a log file; on Cloud Run that file dies with the
    # instance, so echo it to stdout where Cloud Logging keeps it.
    cat "${ZENTIS_LOG_DIR:-$HOME/.zentis/logs}"/*.log 2>/dev/null || true
    exit "${rc:-0}" ;;
  *) echo "usage: tick.sh [tick|fast|slow]" >&2; exit 2 ;;
esac
