#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04 / 24.04 server (x86 or ARM, e.g. Oracle Cloud Always Free).
# Installs Node.js, FFmpeg and Caddy (automatic HTTPS), and runs the app as a background service.
#
#   sudo bash deploy/setup.sh
#
# Run it again any time to change the domain, password or time zone.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Please run with sudo:  sudo bash deploy/setup.sh"; exit 1; fi
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR=/opt/multistream-scheduler
STATE_DIR=/var/lib/multistream
ENV_FILE=/etc/multistream/env

echo
echo "== Multistream Scheduler server setup =="
echo
read -rp "Domain name for the app (e.g. mystreams.duckdns.org): " DOMAIN
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"
if ! [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then echo "That doesn't look like a domain name."; exit 1; fi

read -rp "Your time zone (e.g. Asia/Kuala_Lumpur, Europe/London, America/New_York): " TZNAME
if ! timedatectl list-timezones | grep -qx "$TZNAME"; then echo "Unknown time zone: $TZNAME"; exit 1; fi

while true; do
  read -rsp "Choose a login password (at least 10 characters): " PASS; echo
  read -rsp "Type it again: " PASS2; echo
  [ "$PASS" = "$PASS2" ] || { echo "They don't match. Try again."; continue; }
  [ "${#PASS}" -ge 10 ] || { echo "Too short. Try again."; continue; }
  break
done

echo; echo "Installing packages (this takes a few minutes)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg ffmpeg rsync debian-keyring debian-archive-keyring apt-transport-https

# Node.js 22 (Ubuntu's own version is too old)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y && apt-get install -y nodejs
fi

# Caddy web server: gets and renews the HTTPS certificate by itself
if ! command -v caddy >/dev/null; then
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "Installing the app..."
id multistream >/dev/null 2>&1 || useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin multistream
install -d -o multistream -g multistream -m 750 "$STATE_DIR" "$STATE_DIR/data" "$STATE_DIR/videos"
install -d -m 755 "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude dist --exclude data --exclude videos --exclude .git "$SRC_DIR/" "$APP_DIR/"

HASH="$(printf '%s' "$PASS" | node "$APP_DIR/lib/auth.js")"
unset PASS PASS2
install -d -m 700 /etc/multistream
umask 077
cat > "$ENV_FILE" <<EOF
HOST=127.0.0.1
PORT=3030
PUBLIC_URL=https://$DOMAIN
ADMIN_PASSWORD_HASH=$HASH
TZ=$TZNAME
MS_DATA_DIR=$STATE_DIR/data
MS_VIDEOS_DIR=$STATE_DIR/videos
EOF
umask 022

cat > /etc/systemd/system/multistream.service <<EOF
[Unit]
Description=Multistream Scheduler
After=network-online.target
Wants=network-online.target

[Service]
User=multistream
Group=multistream
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
KillSignal=SIGINT
TimeoutStopSec=15
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3030
}
EOF

echo "Opening ports 80 and 443..."
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp; ufw allow 443/tcp
fi
# Oracle Cloud Ubuntu images block everything except SSH with iptables rules.
if iptables -S INPUT 2>/dev/null | grep -q "REJECT"; then
  for p in 443 80; do
    iptables -C INPUT -p tcp --dport $p -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp --dport $p -m conntrack --ctstate NEW -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
fi

systemctl daemon-reload
systemctl enable multistream caddy >/dev/null
systemctl restart multistream
systemctl restart caddy

sleep 2
if systemctl is-active --quiet multistream; then
  echo
  echo "Done! Open https://$DOMAIN in your browser and sign in."
  echo "(The HTTPS certificate can take a minute the first time.)"
  echo
  echo "Useful commands:"
  echo "  sudo systemctl status multistream     # is it running?"
  echo "  sudo journalctl -u multistream -f     # live log"
  echo "  sudo bash deploy/update.sh            # install a newer version"
else
  echo "The app did not start. Check:  sudo journalctl -u multistream -n 50"
  exit 1
fi
