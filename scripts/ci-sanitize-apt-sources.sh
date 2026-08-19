#!/usr/bin/env bash

set -euo pipefail

readonly ubuntu_archive="https://archive.ubuntu.com/ubuntu"

# GitHub's Ubuntu images can retain optional Azure package sources and can
# prefer the Azure Ubuntu mirror through apt-mirrors.txt. Either endpoint may
# stall independently of the repositories needed by Freed. Keep CI package
# installation on the canonical Ubuntu archive before the first apt update.
sudo rm -f \
  /etc/apt/sources.list.d/azure-cli.list \
  /etc/apt/sources.list.d/azure-cli.sources

for source_file in \
  /etc/apt/apt-mirrors.txt \
  /etc/apt/sources.list \
  /etc/apt/sources.list.d/ubuntu.sources
do
  if sudo test -f "$source_file"; then
    sudo sed -i \
      -e "s|http://azure.archive.ubuntu.com/ubuntu|${ubuntu_archive}|g" \
      -e "s|https://azure.archive.ubuntu.com/ubuntu|${ubuntu_archive}|g" \
      "$source_file"
  fi
done
