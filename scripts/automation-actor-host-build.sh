#!/bin/bash

set -euo pipefail
set +x
umask 077

usage() {
  echo "Usage: scripts/automation-actor-host-build.sh --host-output <absolute-path>" >&2
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
    *)
      usage
      ;;
  esac
done

if [[ "${HOST_OUTPUT}" != /* || "${HOST_OUTPUT}" == *$'\n'* || "${HOST_OUTPUT}" == *$'\r'* ]]; then
  usage
fi

SCRIPT_DIR="$(cd -P -- "${BASH_SOURCE[0]%/*}" && pwd)"
HOST_SOURCE="${SCRIPT_DIR}/automation-actor-host.swift"
HOST_PARENT="${HOST_OUTPUT%/*}"
HOST_NAME="${HOST_OUTPUT##*/}"
if [[ -z "${HOST_NAME}" || ! -d "${HOST_PARENT}" ]]; then
  echo "Error: the output parent must already exist." >&2
  exit 1
fi
PHYSICAL_PARENT="$(cd -P -- "${HOST_PARENT}" && pwd)"
if [[ "${PHYSICAL_PARENT}" != "${HOST_PARENT}" ]]; then
  echo "Error: the output parent must be a physical canonical path." >&2
  exit 1
fi
if [[ "$(/usr/bin/stat -f '%u' "${PHYSICAL_PARENT}")" != "$(/usr/bin/id -u)" ]]; then
  echo "Error: the output parent must be owned by the current user." >&2
  exit 1
fi
PARENT_MODE="$(/usr/bin/stat -f '%Lp' "${PHYSICAL_PARENT}")"
if (( (8#${PARENT_MODE}) & 8#022 )); then
  echo "Error: the output parent must not be group or world writable." >&2
  exit 1
fi

if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
  echo "Error: the native automation actor host can only be built on macOS." >&2
  exit 1
fi
DEVELOPER_DIR="$(/usr/bin/xcode-select -p)"
if [[ "${DEVELOPER_DIR}" != /* || ! -d "${DEVELOPER_DIR}" ]]; then
  echo "Error: xcode-select did not resolve an active developer directory." >&2
  exit 1
fi
export DEVELOPER_DIR
SWIFTC="$(/usr/bin/xcrun --sdk macosx --find swiftc)"
SDK_PATH="$(/usr/bin/xcrun --sdk macosx --show-sdk-path)"
if [[ "${SWIFTC}" != /* || ! -x "${SWIFTC}" || "${SDK_PATH}" != /* || ! -d "${SDK_PATH}" ]]; then
  echo "Error: xcrun did not resolve the Swift compiler and macOS SDK." >&2
  exit 1
fi
ARCHITECTURE="$(/usr/bin/uname -m)"
if [[ "${ARCHITECTURE}" != "arm64" && "${ARCHITECTURE}" != "x86_64" ]]; then
  echo "Error: the current architecture is unsupported." >&2
  exit 1
fi

BUILD_DIRECTORY="$(/usr/bin/mktemp -d "${HOST_PARENT}/.automation-actor-host-build.XXXXXX")"
/bin/chmod 700 "${BUILD_DIRECTORY}"
HOST_TEMP="${BUILD_DIRECTORY}/automation-actor-host"
cleanup() {
  /bin/rm -rf -- "${BUILD_DIRECTORY}"
}
trap cleanup EXIT

"${SWIFTC}" \
  -O \
  -whole-module-optimization \
  -sdk "${SDK_PATH}" \
  -target "${ARCHITECTURE}-apple-macosx10.15" \
  "${HOST_SOURCE}" \
  -o "${HOST_TEMP}" \
  -framework CryptoKit

if [[ ! -x "${HOST_TEMP}" ]]; then
  echo "Error: Swift did not produce the native actor host." >&2
  exit 1
fi
/bin/chmod 755 "${HOST_TEMP}"
/bin/mv -f -- "${HOST_TEMP}" "${HOST_PARENT}/${HOST_NAME}"
/bin/rmdir -- "${BUILD_DIRECTORY}"
trap - EXIT

echo "Built native automation actor host at ${HOST_PARENT}/${HOST_NAME}"
