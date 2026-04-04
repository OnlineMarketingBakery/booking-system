#!/usr/bin/env bash
# Call plugnpay-provision-accounts (cron auth via X-Plugnpay-Cron-Secret).
# Requires PLUGNPAY_CRON_SECRET + Supabase anon key (see .env.example).
# Ploi: run hourly e.g. /home/ploi/YOUR-SITE/scripts/plugnpay-cron-sync.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

: "${PLUGNPAY_CRON_SECRET:?Missing PLUGNPAY_CRON_SECRET (set in .env on server or export before cron)}"
ANON="${SUPABASE_ANON_KEY:-${VITE_SUPABASE_PUBLISHABLE_KEY:-}}"
if [[ -z "$ANON" ]]; then
  echo "Missing anon key: set SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY in .env" >&2
  exit 1
fi

PROJECT="${VITE_SUPABASE_PROJECT_ID:-pgcvqaexvnwwskdhooly}"
URL="https://${PROJECT}.supabase.co/functions/v1/plugnpay-provision-accounts"

curl -sS -X POST "$URL" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -H "X-Plugnpay-Cron-Secret: $PLUGNPAY_CRON_SECRET" \
  -d '{}'

echo
