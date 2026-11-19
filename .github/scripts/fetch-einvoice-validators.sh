#!/usr/bin/env bash
# Downloads the official e-invoice validators into $NOVA_TOOLS (CI only):
#   kosit-validator.jar        KoSIT validator (standalone jar)
#   xrechnung-config/          XRechnung validator configuration
#   mustang-cli.jar            Mustang CLI (ZUGFeRD / PDF/A-3)
# Versions: the latest releases, unless KOSIT_TAG / XRECHNUNG_TAG / MUSTANG_TAG are set.
set -euo pipefail
dest="${NOVA_TOOLS:?set NOVA_TOOLS}"
mkdir -p "$dest"
tmp="$(mktemp -d)"

dl() { # repo tag pattern dir
  if [ -n "$2" ]; then gh release download "$2" --repo "$1" --pattern "$3" --dir "$4" --clobber
  else gh release download --repo "$1" --pattern "$3" --dir "$4" --clobber; fi
}

# KoSIT validator: newer releases ship a standalone jar, older ones a zip with it inside.
if ! dl itplr-kosit/validator "${KOSIT_TAG:-}" '*standalone*.jar' "$tmp/kosit" 2>/dev/null; then
  dl itplr-kosit/validator "${KOSIT_TAG:-}" '*.zip' "$tmp/kosit"
  unzip -q -o "$tmp"/kosit/*.zip -d "$tmp/kosit"
fi
cp "$(find "$tmp/kosit" -name '*standalone*.jar' | head -1)" "$dest/kosit-validator.jar"

dl itplr-kosit/validator-configuration-xrechnung "${XRECHNUNG_TAG:-}" '*.zip' "$tmp/xr"
mkdir -p "$dest/xrechnung-config"
unzip -q -o "$(ls "$tmp"/xr/*.zip | head -1)" -d "$dest/xrechnung-config"

dl ZUGFeRD/mustangproject "${MUSTANG_TAG:-}" 'Mustang-CLI-*.jar' "$tmp/mustang"
cp "$(ls "$tmp"/mustang/Mustang-CLI-*.jar | head -1)" "$dest/mustang-cli.jar"

ls -la "$dest"
test -f "$dest/xrechnung-config/scenarios.xml"
