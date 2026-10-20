#!/usr/bin/env bash
# Fetches a notarized build's Alternative Distribution Package from AltStore PAL and
# describes it for the PAL source.
#
# AltStore PAL processes each notarized build App Store Connect notifies it of, then
# serves the result as an ADP (https://faq.altstore.io/developers/rest-api). This checks
# once that processing is done, rather than holding a runner while Apple and AltStore
# work, downloads and unpacks the package, and writes adp.json next to it:
#
#   { root, version, build, size, files: [paths relative to root] }
#
# version and build are the manifest's shortVersionString and bundleVersion, the build's
# CFBundleShortVersionString and CFBundleVersion, which AltStore checks the source entry
# against, so they come from the package itself rather than from whatever the release or
# App Store Connect calls it. The variants are encrypted, so the manifest is the only
# place to read them. size is the first variant's, as AltStore's docs ask.
#
# Usage: fetch-altstore-adp.sh <ADP ID> <output directory>
# The ADP ID is under Distribution > History in App Store Connect, next to the version.
set -euo pipefail

adp_id=$1
out=$2
api=${ALTSTORE_API:-https://api.altstore.io}/adps/$adp_id
mkdir -p "$out"

response=$(curl -fsS "$api")
url=$(jq -r '.downloadURL // empty' <<<"$response")
if [ -z "$url" ]; then
  echo "::error::AltStore PAL has not finished processing ADP $adp_id ($(jq -c '.status // .' <<<"$response")). Run this again once it has; if it never does, check that notifications are on for AltStore in App Store Connect, or start processing with POST ${api%/*}." >&2
  exit 1
fi

curl -fsSL "$url" -o "$out/adp.zip"
if ! unzip -tq "$out/adp.zip" >/dev/null 2>&1; then
  echo "::error::The ADP download is not a zip archive ($(file -b "$out/adp.zip")); its layout needs handling here." >&2
  exit 1
fi
unzip -q "$out/adp.zip" -d "$out/package"
rm "$out/adp.zip"

# The package root is wherever manifest.json sits; the archive may wrap it in a folder.
manifest=$(find "$out/package" -name manifest.json -print -quit)
if [ -z "$manifest" ]; then
  echo "::error::No manifest.json in the ADP" >&2
  exit 1
fi
root=$(dirname "$manifest")

version=$(jq -r '.shortVersionString // empty' "$manifest")
build=$(jq -r '.bundleVersion // empty' "$manifest")
variant=$root/$(jq -r '.variants[0].assetPath // empty' "$manifest")
if [ -z "$version" ] || [ -z "$build" ] || [ ! -f "$variant" ]; then
  echo "::error::The ADP's manifest.json lacks shortVersionString, bundleVersion or a variant on disk" >&2
  exit 1
fi

(cd "$root" && find . -type f | sed 's|^\./||' | sort) | jq -R . | jq -s \
  --arg root "$root" --arg version "$version" --arg build "$build" \
  --argjson size "$(wc -c < "$variant" | tr -d ' ')" \
  '{root: $root, version: $version, build: $build, size: $size, files: .}' \
  > "$out/adp.json"
cat "$out/adp.json"
