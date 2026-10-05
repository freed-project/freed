#!/usr/bin/env bash

set -euo pipefail

readonly ubuntu_archive="https://archive.ubuntu.com/ubuntu"

# Optional Azure and Chrome sources on GitHub's Ubuntu images can fail or
# publish inconsistent indexes independently of Freed's dependencies. Playwright
# downloads its pinned browser separately. Remove those unused sources and
# prefer the canonical Ubuntu archive before the first apt update.
sudo rm -f \
  /etc/apt/sources.list.d/azure-cli.list \
  /etc/apt/sources.list.d/azure-cli.sources \
  /etc/apt/sources.list.d/google-chrome.list \
  /etc/apt/sources.list.d/google-chrome.sources

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
