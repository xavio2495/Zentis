#!/usr/bin/env bash
# Install the Zentis console:  curl -fsSL https://zentis-eth.vercel.app/install.sh | bash
#
# Downloads the compiled console for this machine from the latest GitHub release, verifies it
# against the release's checksums, and puts it in ~/.local/bin (or $ZENTIS_INSTALL_DIR). It does not
# edit shell rc files, does not need root and refuses to run as root, and installs nothing else: the
# console carries its own signer, so there is no toolchain to fetch (plan 11).
#
#   ZENTIS_VERSION=v0.2.0 bash install.sh   # a specific tag instead of the latest
#   ZENTIS_INSTALL_DIR=/opt/bin bash …       # somewhere else
#   bash install.sh --dry-run                # say what would happen, download nothing
set -euo pipefail

repo=${ZENTIS_REPO_SLUG:-xavio2495/Zentis}
version=${ZENTIS_VERSION:-latest}
dir=${ZENTIS_INSTALL_DIR:-$HOME/.local/bin}
dry_run=false
for arg in "$@"; do case "$arg" in --dry-run) dry_run=true ;; *) echo "unknown argument: $arg" >&2; exit 2 ;; esac; done

say() { printf '%s\n' "$*"; }
die() { printf 'zentis install: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "do not run this as root; it installs into your own home directory"
command -v curl >/dev/null || die "curl is required"
if command -v sha256sum >/dev/null; then sum() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null; then sum() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "sha256sum or shasum is required to verify the download"; fi

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "unsupported OS: $(uname -s) (linux and darwin are built)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) die "unsupported architecture: $(uname -m) (x64 and arm64 are built)" ;;
esac
asset="zentis-$os-$arch"

if [ -n "${ZENTIS_RELEASE_BASE:-}" ]; then base=$ZENTIS_RELEASE_BASE   # a mirror, or a test server
elif [ "$version" = latest ]; then base="https://github.com/$repo/releases/latest/download"
else base="https://github.com/$repo/releases/download/$version"; fi

say "zentis console: $asset from $repo ($version) into $dir"
if $dry_run; then
  say "would download $base/$asset and $base/checksums.txt, verify, and install $dir/zentis"
  exit 0
fi

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/$asset" "$base/$asset" || die "no release asset at $base/$asset"
curl -fsSL --retry 3 -o "$tmp/checksums.txt" "$base/checksums.txt" || die "no checksums.txt in that release"

expected=$(grep " $asset\$" "$tmp/checksums.txt" | cut -d' ' -f1)
[ -n "$expected" ] || die "checksums.txt does not list $asset"
actual=$(sum "$tmp/$asset")
[ "$expected" = "$actual" ] || die "checksum mismatch for $asset: expected $expected, got $actual; nothing installed"

mkdir -p "$dir"
chmod +x "$tmp/$asset"
mv "$tmp/$asset" "$dir/zentis"
say "installed $dir/zentis ($("$dir/zentis" --version 2>/dev/null || echo "$version"))"
case ":$PATH:" in
  *":$dir:"*) say "run zentis to start" ;;
  *) say "$dir is not on your PATH; run $dir/zentis to start, or add the directory to your PATH" ;;
esac
