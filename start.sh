#!/usr/bin/env sh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${PORT:-3010}"
export REALTIME_PORT="${REALTIME_PORT:-3013}"
export SHOPEE_SYNC_PORT="${SHOPEE_SYNC_PORT:-51898}"
export REALTIME_URL="${REALTIME_URL:-http://localhost:$REALTIME_PORT}"
export NEXT_PUBLIC_REALTIME_PORT="$REALTIME_PORT"
export NODE_ENV="production"

if [ -f ".env" ] && [ -z "$DATABASE_URL" ]; then
  DB_LINE="$(grep '^DATABASE_URL=' .env | head -n 1 | sed 's/^DATABASE_URL=//;s/^"//;s/"$//;s/^'\''//;s/'\''$//')"
  if [ -n "$DB_LINE" ]; then
    export DATABASE_URL="$DB_LINE"
  fi
fi
export DATABASE_URL="${DATABASE_URL:-file:$SCRIPT_DIR/db/custom.db}"

echo "=========================================================="
echo " OPENVN · UU DAM SUITE — PRODUCTION STANDALONE LAUNCHER"
echo " CMS :$PORT | Realtime :$REALTIME_PORT | Shopee :$SHOPEE_SYNC_PORT"
echo "=========================================================="

if [ ! -d "node_modules" ]; then
  npm install --legacy-peer-deps
fi

if [ ! -d "mini-services/realtime/node_modules" ]; then
  (cd mini-services/realtime && npm install)
fi

if [ ! -d "node_modules/.prisma/client" ]; then
  npx prisma generate
fi

if [ ! -f ".next/standalone/server.js" ]; then
  echo "Building Production Standalone bundle..."
  npm run build
fi

(cd mini-services/realtime && node --experimental-strip-types index.ts) >/dev/null 2>&1 &
RT_PID=$!

if command -v python3 >/dev/null 2>&1; then
  python3 scripts/shopee_seller_sync.py >/dev/null 2>&1 &
  SP_PID=$!
elif command -v python >/dev/null 2>&1; then
  python scripts/shopee_seller_sync.py >/dev/null 2>&1 &
  SP_PID=$!
fi

cleanup() {
  [ -n "$RT_PID" ] && kill "$RT_PID" 2>/dev/null || true
  [ -n "$SP_PID" ] && kill "$SP_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec node .next/standalone/server.js
