#!/bin/sh
set -e

# Default ports and internal routing
export PORT="${PORT:-3000}"
export HOSTNAME="0.0.0.0"
export CMS_PORT="$PORT"
export REALTIME_PORT="${REALTIME_PORT:-3003}"
export REALTIME_URL="http://localhost:$REALTIME_PORT"
export NEXT_PUBLIC_REALTIME_PORT="$REALTIME_PORT"
export CMS_WEBHOOK_URL="http://127.0.0.1:$PORT/api/webhooks/inbound"
export CMS_API_KEY="${CMS_API_KEY:-191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955}"

echo "=========================================================="
echo " Starting OPENVN CMS & Shopee 24/7 Cloud Container"
echo " Main Port: $PORT | Realtime Port: $REALTIME_PORT"
echo " Internal Webhook Target: $CMS_WEBHOOK_URL"
echo "=========================================================="

# 1. Start Realtime WebSocket Service (port 3003) in background
if [ -d "mini-services/realtime" ]; then
  echo "[1/3] Starting Realtime WebSocket Service on :$REALTIME_PORT..."
  (cd mini-services/realtime && node --experimental-strip-types index.ts) &
fi

# 2. Start Shopee Seller Sync Daemon 24/7 in background
if [ -f "scripts/shopee_seller_sync.py" ]; then
  echo "[2/3] Starting Shopee Seller Sync Daemon 24/7..."
  python3 scripts/shopee_seller_sync.py &
fi

# 3. Start Next.js Production Standalone Server on main $PORT
echo "[3/3] Starting Next.js Production Server on :$PORT..."
exec node server.js
