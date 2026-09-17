#!/usr/bin/env bash
#
# Deployt den aktuellen Stand von origin/main auf den ioBroker-Pi.
#
#   ./scripts/deploy-pi.sh            -> deployt origin/main
#   ./scripts/deploy-pi.sh <commit>   -> deployt einen bestimmten Commit/Branch
#
# Es wird NICHT auf dem Pi gebaut: adapter/www liegt fertig gebaut im Repo.
# Vor dem Kopieren wird das bisherige www nach
# /opt/iobroker/backups/smarthome-dashboard-v2-www-before-<sha> gesichert.
#
set -euo pipefail

PI_HOST="${PI_HOST:-sebastian@192.168.44.31}"
PI_KEY="${PI_KEY:-$HOME/.ssh/id_ed25519_iobroker}"
REPO_URL="${REPO_URL:-https://github.com/ebonyandivory84/SmarthomeDashboardV2.git}"
INSTANCE="${INSTANCE:-smarthome-dashboard-v2.0}"
TARGET_DIR="${TARGET_DIR:-/opt/iobroker/node_modules/iobroker.smarthome-dashboard-v2/adapter/www}"
PORT="${PORT:-8111}"
REF="${1:-main}"

echo "==> Deploy '$REF' -> $PI_HOST ($INSTANCE)"

ssh -i "$PI_KEY" -o IdentitiesOnly=yes "$PI_HOST" \
  REF="$REF" REPO_URL="$REPO_URL" INSTANCE="$INSTANCE" TARGET_DIR="$TARGET_DIR" PORT="$PORT" \
  'bash -euo pipefail -s' <<'REMOTE'
DEPLOY_DIR=$(mktemp -d /tmp/smarthome-dashboard-v2-deploy.XXXXXX)
trap 'rm -rf "$DEPLOY_DIR"' EXIT

echo "--> clone $REF"
git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$DEPLOY_DIR/repo"
cd "$DEPLOY_DIR/repo"

SHA_SHORT=$(git rev-parse --short HEAD)
echo "--> Commit: $SHA_SHORT  $(git log -1 --pretty=%s)"

if [ ! -d adapter/www/_expo ]; then
  echo "FEHLER: adapter/www fehlt oder ist unvollstaendig im Commit $SHA_SHORT." >&2
  exit 1
fi

BACKUP_DIR="/opt/iobroker/backups/smarthome-dashboard-v2-www-before-${SHA_SHORT}"
echo "--> Backup: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -a "$TARGET_DIR/." "$BACKUP_DIR/"

echo "--> kopiere adapter/www"
cp -R adapter/www/. "$TARGET_DIR/"

echo "--> restart $INSTANCE"
iobroker restart "$INSTANCE"
sleep 6
iobroker status "$INSTANCE"
curl -fsS -o /dev/null -w '--> HTTP=%{http_code}\n' "http://127.0.0.1:${PORT}/smarthome-dashboard-v2/"

echo
echo "Fertig. Rollback bei Bedarf:"
echo "  cp -R $BACKUP_DIR/. $TARGET_DIR/ && iobroker restart $INSTANCE"
REMOTE

echo "==> Deploy abgeschlossen. Im Browser einmal hart neu laden (Cmd+Shift+R)."
