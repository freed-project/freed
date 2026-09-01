#!/bin/bash

set -euo pipefail
set +x
umask 077

usage() {
  echo "Usage: scripts/automation-actor-host-build.sh --host-output <absolute-path> --provisioner-output <absolute-path>" >&2
  exit 2
}

HOST_OUTPUT=""
PROVISIONER_OUTPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host-output)
      [[ $# -ge 2 ]] || usage
      HOST_OUTPUT="$2"
      shift 2
      ;;
    --provisioner-output)
      [[ $# -ge 2 ]] || usage
      PROVISIONER_OUTPUT="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[
  "${HOST_OUTPUT}" != /* ||
  "${PROVISIONER_OUTPUT}" != /* ||
  "${HOST_OUTPUT}" == "${PROVISIONER_OUTPUT}"
]]; then
  usage
fi
for output in "${HOST_OUTPUT}" "${PROVISIONER_OUTPUT}"; do
  if [[ "${output}" == *$'\n'* || "${output}" == *$'\r'* ]]; then
    echo "Error: an output path contains control characters." >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd -P -- "${BASH_SOURCE[0]%/*}" && pwd)"
HOST_SOURCE="${SCRIPT_DIR}/automation-actor-host.swift"
PROVISIONER_SOURCE="${SCRIPT_DIR}/automation-actor-provision.swift"
LINUX_SOURCE="${SCRIPT_DIR}/automation-actor-host-linux.go"
KERNEL_NAME="$(/usr/bin/uname -s)"

validate_output_parent() {
  local output="$1"
  local parent="${output%/*}"
  local name="${output##*/}"
  local physical_parent
  local parent_mode

  if [[ -z "${name}" || ! -d "${parent}" ]]; then
    echo "Error: each output parent must already exist." >&2
    exit 1
  fi
  physical_parent="$(cd -P -- "${parent}" && pwd)"
  if [[ "${physical_parent}" != "${parent}" ]]; then
    echo "Error: each output parent must be a physical canonical path." >&2
    exit 1
  fi
  local parent_owner
  local parent_mode
  if [[ "${KERNEL_NAME}" == "Darwin" ]]; then
    parent_owner="$(/usr/bin/stat -f '%u' "${physical_parent}")"
    parent_mode="$(/usr/bin/stat -f '%Lp' "${physical_parent}")"
  elif [[ "${KERNEL_NAME}" == "Linux" ]]; then
    parent_owner="$(/usr/bin/stat -c '%u' "${physical_parent}")"
    parent_mode="$(/usr/bin/stat -c '%a' "${physical_parent}")"
  else
    echo "Error: native automation actor tools support only macOS and Linux." >&2
    exit 1
  fi
  if [[ "${parent_owner}" != "$(/usr/bin/id -u)" ]]; then
    echo "Error: each output parent must be owned by the current user." >&2
    exit 1
  fi
  if (( (8#${parent_mode}) & 8#022 )); then
    echo "Error: each output parent must not be group or world writable." >&2
    exit 1
  fi
}

validate_output_parent "${HOST_OUTPUT}"
validate_output_parent "${PROVISIONER_OUTPUT}"

ARCHITECTURE="$(/usr/bin/uname -m)"
if [[ "${ARCHITECTURE}" != "arm64" && "${ARCHITECTURE}" != "aarch64" && "${ARCHITECTURE}" != "x86_64" ]]; then
  echo "Error: the current architecture is unsupported." >&2
  exit 1
fi

HOST_PARENT="${HOST_OUTPUT%/*}"
HOST_NAME="${HOST_OUTPUT##*/}"
PROVISIONER_PARENT="${PROVISIONER_OUTPUT%/*}"
PROVISIONER_NAME="${PROVISIONER_OUTPUT##*/}"
HOST_BUILD_DIRECTORY="$(/usr/bin/mktemp -d "${HOST_PARENT}/.automation-actor-host-build.XXXXXX")"
PROVISIONER_BUILD_DIRECTORY="$(/usr/bin/mktemp -d "${PROVISIONER_PARENT}/.automation-actor-provision-build.XXXXXX")"
/bin/chmod 700 "${HOST_BUILD_DIRECTORY}" "${PROVISIONER_BUILD_DIRECTORY}"
HOST_TEMP="${HOST_BUILD_DIRECTORY}/automation-actor-host"
PROVISIONER_TEMP="${PROVISIONER_BUILD_DIRECTORY}/automation-actor-provision"
cleanup() {
  /bin/rm -rf -- "${HOST_BUILD_DIRECTORY}" "${PROVISIONER_BUILD_DIRECTORY}"
}
trap cleanup EXIT

if [[ "${KERNEL_NAME}" == "Darwin" ]]; then
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
  DEPLOYMENT_TARGET="${ARCHITECTURE}-apple-macosx10.15"
  "${SWIFTC}" -O -whole-module-optimization -sdk "${SDK_PATH}" \
    -target "${DEPLOYMENT_TARGET}" "${HOST_SOURCE}" -o "${HOST_TEMP}" \
    -framework CryptoKit
  "${SWIFTC}" -O -whole-module-optimization -sdk "${SDK_PATH}" \
    -target "${DEPLOYMENT_TARGET}" "${PROVISIONER_SOURCE}" \
    -o "${PROVISIONER_TEMP}" -framework Security -framework CryptoKit
elif [[ "${KERNEL_NAME}" == "Linux" ]]; then
  GO_EXECUTABLE="${FREED_GO_EXECUTABLE:-}"
  if [[ "${GO_EXECUTABLE}" != /* || ! -x "${GO_EXECUTABLE}" || ! -f "${LINUX_SOURCE}" ]]; then
    echo "Error: Linux actor builds require an absolute FREED_GO_EXECUTABLE and the reviewed Go source." >&2
    exit 1
  fi
  GO_EXECUTABLE="$(/usr/bin/readlink -f "${GO_EXECUTABLE}")"
  GO111MODULE=off CGO_ENABLED=0 "${GO_EXECUTABLE}" build -trimpath \
    -ldflags "-s -w -X main.buildMode=host" -o "${HOST_TEMP}" "${LINUX_SOURCE}"
  GO111MODULE=off CGO_ENABLED=0 "${GO_EXECUTABLE}" build -trimpath \
    -ldflags "-s -w -X main.buildMode=provisioner" \
    -o "${PROVISIONER_TEMP}" "${LINUX_SOURCE}"
else
  echo "Error: native automation actor tools support only macOS and Linux." >&2
  exit 1
fi

if [[ ! -x "${HOST_TEMP}" || ! -x "${PROVISIONER_TEMP}" ]]; then
  echo "Error: the native build did not produce both actor tools." >&2
  exit 1
fi
/bin/chmod 755 "${HOST_TEMP}" "${PROVISIONER_TEMP}"
/bin/mv -f -- "${HOST_TEMP}" "${HOST_PARENT}/${HOST_NAME}"
/bin/mv -f -- "${PROVISIONER_TEMP}" "${PROVISIONER_PARENT}/${PROVISIONER_NAME}"
/bin/rmdir -- "${HOST_BUILD_DIRECTORY}" "${PROVISIONER_BUILD_DIRECTORY}"
trap - EXIT

echo "Built native automation actor host at ${HOST_PARENT}/${HOST_NAME}"
echo "Built native automation actor provisioner at ${PROVISIONER_PARENT}/${PROVISIONER_NAME}"
