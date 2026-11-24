#!/bin/sh
set -e

# Default ports and internal routing
export PORT="${PORT:-3000}"
export HOSTNAME="0.0.0.0"
export CMS_PORT="$PORT"
export REALTIME_PORT="${REALTIME_PORT:-3003}"
export REALTIME_URL="http://localhost:$REALTIME_PORT"
export NEXT_PUBLIC_REALTIME_PORT="$REALTIME_PORT"
export SHOPEE_NODE_ROLE="${SHOPEE_NODE_ROLE:-CLOUD_RENDER}"
export PYTHONUNBUFFERED="1"
export PYTHONDONTWRITEBYTECODE="1"
export CMS_WEBHOOK_URL="http://127.0.0.1:$PORT/api/webhooks/inbound"

# Zero-Secret Leak: Generate an ephemeral 256-bit cryptographic loopback secret per container boot
if [ -z "${CMS_INTERNAL_BRIDGE_SECRET:-}" ]; then
  CMS_INTERNAL_BRIDGE_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
fi
export CMS_INTERNAL_BRIDGE_SECRET

echo "=========================================================="
echo " Starting OPENVN CMS & Shopee 24/7 Cloud Container (SG)"
echo " Main Port: $PORT | Realtime Port: $REALTIME_PORT | Role: $SHOPEE_NODE_ROLE"
echo " Internal Webhook Target: $CMS_WEBHOOK_URL (Zero-Secret Ephemeral Auth)"
echo "=========================================================="

# 1. Start Realtime WebSocket Service (port 3003) in background
if [ -d "mini-services/realtime" ]; then
  echo "[1/3] Starting Realtime WebSocket Service on :$REALTIME_PORT..."
  (cd mini-services/realtime && node --experimental-strip-types index.ts) &
fi

# 2. Start Shopee Seller Sync & AES-256-GCM Vault Daemon 24/7 in background
if [ -f "scripts/shopee_seller_sync.py" ]; then
  echo "[2/3] Starting Shopee 24/7 Vault & Leader-Lease Daemon..."
  python3 -B scripts/shopee_seller_sync.py &
fi

# 3. Start Next.js Production Standalone Server on main $PORT
echo "[3/3] Starting Next.js Production Server on :$PORT..."
exec node server.js
