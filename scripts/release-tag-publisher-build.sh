#!/bin/bash

set -euo pipefail
set +x
umask 077

usage() {
  echo "Usage: scripts/release-tag-publisher-build.sh --host-output <absolute-path>" >&2
  exit 2
}

HOST_OUTPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host-output)
      [[ $# -ge 2 ]] || usage
      HOST_OUTPUT="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

if [[ "${HOST_OUTPUT}" != /* ]]; then
  usage
fi

validate_parent() {
  local output="$1"
  local parent="${output%/*}"
  local name="${output##*/}"
  local canonical
  local mode
  [[ -n "${name}" && -d "${parent}" ]] || {
    echo "Error: output parents must already exist." >&2
    exit 1
  }
  canonical="$(cd -P -- "${parent}" && pwd)"
  [[ "${canonical}" == "${parent}" ]] || {
    echo "Error: output parents must use canonical paths." >&2
    exit 1
  }
  [[ "$(/usr/bin/stat -f '%u' "${parent}")" == "$(/usr/bin/id -u)" ]] || {
    echo "Error: output parents must be owned by the current user." >&2
    exit 1
  }
  mode="$(/usr/bin/stat -f '%Lp' "${parent}")"
  if (( ((8#${mode}) & 8#022) != 0 )); then
    echo "Error: output parents must not be group or world writable." >&2
    exit 1
  fi
}

validate_parent "${HOST_OUTPUT}"

[[ "$(/usr/bin/uname -s)" == "Darwin" ]] || {
  echo "Error: release tag publisher native tools require macOS." >&2
  exit 1
}
DEVELOPER_DIR="$(/usr/bin/xcode-select -p)"
export DEVELOPER_DIR
SWIFTC="$(/usr/bin/xcrun --sdk macosx --find swiftc)"
SDK_PATH="$(/usr/bin/xcrun --sdk macosx --show-sdk-path)"
ARCHITECTURE="$(/usr/bin/uname -m)"
if [[
  "${SWIFTC}" != /* || ! -x "${SWIFTC}" ||
  "${SDK_PATH}" != /* || ! -d "${SDK_PATH}" ||
  ( "${ARCHITECTURE}" != "arm64" && "${ARCHITECTURE}" != "x86_64" )
]]; then
  echo "Error: the pinned macOS Swift toolchain is unavailable." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -P -- "${BASH_SOURCE[0]%/*}" && pwd)"
HOST_SOURCE="${SCRIPT_DIR}/release-tag-publisher-host.swift"
HOST_TEMP="$(/usr/bin/mktemp "${HOST_OUTPUT%/*}/.release-tag-publisher.XXXXXX")"
cleanup() {
  /bin/rm -f -- "${HOST_TEMP}"
}
trap cleanup EXIT

COMMON=(
  -O
  -whole-module-optimization
  -sdk "${SDK_PATH}"
  -target "${ARCHITECTURE}-apple-macosx10.15"
)
"${SWIFTC}" "${COMMON[@]}" "${HOST_SOURCE}" -o "${HOST_TEMP}" \
  -framework Foundation -framework Security -framework CryptoKit

/usr/bin/codesign --force --sign - "${HOST_TEMP}"
/usr/bin/codesign --verify --strict --verbose=0 "${HOST_TEMP}"
/bin/chmod 755 "${HOST_TEMP}"
/bin/mv -f -- "${HOST_TEMP}" "${HOST_OUTPUT}"
trap - EXIT

echo "Built release tag publisher host at ${HOST_OUTPUT}"
