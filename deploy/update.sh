#!/usr/bin/env bash
# Install a newer version: run from the repository folder on the server.
#   git pull && sudo bash deploy/update.sh
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Please run with sudo:  sudo bash deploy/update.sh"; exit 1; fi
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if systemctl is-active --quiet multistream && grep -q '"status": "live"' /var/lib/multistream/data/jobs.json 2>/dev/null; then
  read -rp "A stream is live right now. Updating will stop it. Continue? [y/N] " ok
  [ "${ok,,}" = "y" ] || exit 1
fi
rsync -a --delete --exclude node_modules --exclude dist --exclude data --exclude videos --exclude .git "$SRC_DIR/" /opt/multistream-scheduler/
systemctl restart multistream
echo "Updated and restarted."
