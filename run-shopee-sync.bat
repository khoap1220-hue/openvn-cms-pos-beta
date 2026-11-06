@echo off
chcp 65001 > nul
title Shopee Seller Center - Realtime Order Sync Daemon
echo ==============================================================
echo   OPENVN CMS/POS ^<^=^> SHOPEE SELLER CENTER SYNC DAEMON
echo   Phuong an: Direct cURL / Seller Center Internal RPC API
echo   Shop ID: 3812687 (mystique.parfum.store)
echo ==============================================================
echo.

set CMS_WEBHOOK_URL=http://127.0.0.1:3010/api/webhooks/inbound
set CMS_API_KEY=191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955

python scripts\shopee_seller_sync.py

pause
