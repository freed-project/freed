#!/bin/bash

set -euo pipefail
set +x
umask 077

usage() {
  echo "Usage: scripts/trusted-publisher-host-build.sh --output <absolute-path> --identity <codesign-identity> --identifier <signing-identifier> --team-identifier <team-id>" >&2
  exit 2
}

OUTPUT=""
SIGNING_IDENTITY=""
SIGNING_IDENTIFIER=""
TEAM_IDENTIFIER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || usage
      OUTPUT="$2"
      shift 2
      ;;
    --identity)
      [[ $# -ge 2 ]] || usage
      SIGNING_IDENTITY="$2"
      shift 2
      ;;
    --identifier)
      [[ $# -ge 2 ]] || usage
      SIGNING_IDENTIFIER="$2"
      shift 2
      ;;
    --team-identifier)
      [[ $# -ge 2 ]] || usage
      TEAM_IDENTIFIER="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[
  "${OUTPUT}" != /* ||
  -z "${SIGNING_IDENTITY}" ||
  "${SIGNING_IDENTITY}" == "-" ||
  ! "${SIGNING_IDENTIFIER}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]+$ ||
  ! "${TEAM_IDENTIFIER}" =~ ^[A-Z0-9]{10}$
]]; then
  usage
fi
if [[ "${OUTPUT}" == *$'\n'* || "${OUTPUT}" == *$'\r'* ]]; then
  echo "Error: output path contains control characters." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -P -- "${BASH_SOURCE[0]%/*}" && pwd)"
SOURCE="${SCRIPT_DIR}/trusted-publisher-host.swift"
OUTPUT_PARENT="${OUTPUT%/*}"
OUTPUT_NAME="${OUTPUT##*/}"
if [[ -z "${OUTPUT_NAME}" || ! -d "${OUTPUT_PARENT}" ]]; then
  echo "Error: output parent must already exist." >&2
  exit 1
fi
PHYSICAL_PARENT="$(cd -P -- "${OUTPUT_PARENT}" && pwd)"
if [[ "${PHYSICAL_PARENT}" != "${OUTPUT_PARENT}" ]]; then
  echo "Error: output parent must be a physical canonical path." >&2
  exit 1
fi
if [[ "$(/usr/bin/stat -f '%u' "${PHYSICAL_PARENT}")" != "$(/usr/bin/id -u)" ]]; then
  echo "Error: output parent must be owned by the current user." >&2
  exit 1
fi
PARENT_MODE="$(/usr/bin/stat -f '%Lp' "${PHYSICAL_PARENT}")"
if (( (8#${PARENT_MODE}) & 8#022 )); then
  echo "Error: output parent must not be group or world writable." >&2
  exit 1
fi

if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
  echo "Error: the trusted publisher host can only be built on macOS." >&2
  exit 1
fi
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
if [[ ! -d "${DEVELOPER_DIR}" ]]; then
  echo "Error: Apple Command Line Tools are not installed at ${DEVELOPER_DIR}." >&2
  exit 1
fi
SWIFTC="$(/usr/bin/xcrun --find swiftc)"
if [[ "${SWIFTC}" != /* || ! -x "${SWIFTC}" ]]; then
  echo "Error: xcrun did not resolve an absolute Swift compiler." >&2
  exit 1
fi

TEMP_OUTPUT="$(/usr/bin/mktemp "${PHYSICAL_PARENT}/.trusted-publisher-host.XXXXXX")"
cleanup() {
  /bin/rm -f -- "${TEMP_OUTPUT}"
}
trap cleanup EXIT

"${SWIFTC}" \
  -O \
  -whole-module-optimization \
  "${SOURCE}" \
  -o "${TEMP_OUTPUT}" \
  -framework Security \
  -framework LocalAuthentication \
  -framework CryptoKit
/usr/bin/codesign \
  --force \
  --options runtime \
  --timestamp \
  --identifier "${SIGNING_IDENTIFIER}" \
  --sign "${SIGNING_IDENTITY}" \
  "${TEMP_OUTPUT}"
/usr/bin/codesign --verify --strict --verbose=0 "${TEMP_OUTPUT}"
SIGNING_DETAILS="$(/usr/bin/codesign -dv --verbose=4 "${TEMP_OUTPUT}" 2>&1)"
if [[ "${SIGNING_DETAILS}" != *"Identifier=${SIGNING_IDENTIFIER}"* || "${SIGNING_DETAILS}" != *"TeamIdentifier=${TEAM_IDENTIFIER}"* ]]; then
  echo "Error: signed publisher host does not match the required identifier and team." >&2
  exit 1
fi
if [[ ! "${SIGNING_DETAILS}" =~ flags=.*runtime || "${SIGNING_DETAILS}" =~ flags=.*adhoc ]]; then
  echo "Error: signed publisher host is not a non-adhoc hardened runtime binary." >&2
  exit 1
fi
/bin/chmod 700 "${TEMP_OUTPUT}"
/bin/mv -f -- "${TEMP_OUTPUT}" "${PHYSICAL_PARENT}/${OUTPUT_NAME}"
trap - EXIT

echo "Built hardened trusted publisher host at ${PHYSICAL_PARENT}/${OUTPUT_NAME}"
