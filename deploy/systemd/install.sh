#!/usr/bin/env bash
# Install the local scheduled publisher as systemd user timers: fast every five minutes, slow
# hourly. Needs ~/.zentis/cre.env (mode 600) with CRE_ETH_PRIVATE_KEY, 1INCH_API_KEY and the
# SECRET_* gains, a `cre login` session on this machine, and bun on the PATH the unit declares.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p ~/.config/systemd/user
cp "$here"/zentis-*.service "$here"/zentis-*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now zentis-fast.timer zentis-slow.timer zentis-quote-api.service
loginctl enable-linger "$USER" || true
systemctl --user list-timers | grep zentis
