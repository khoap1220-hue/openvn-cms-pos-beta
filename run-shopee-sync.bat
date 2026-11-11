@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title Shopee Seller Center - Realtime Order Sync Daemon

set BRIDGE_PORT=51898
set CMS_WEBHOOK_URL=http://127.0.0.1:3010/api/webhooks/inbound
set CMS_API_KEY=191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955

if "%1"=="stop" goto do_stop
if "%1"=="status" goto do_status
if "%1"=="test" goto do_test
if "%1"=="restart" goto do_restart
if "%1"=="start" goto do_start
goto do_start

:do_status
echo [STATUS] Kiem tra trang thai Shopee Sync Daemon tai port %BRIDGE_PORT%...
curl.exe -s -m 3 http://127.0.0.1:%BRIDGE_PORT%/shopee/status
if errorlevel 1 (
    echo.
    echo [STATUS] Daemon KHONG chay hoac khong phan hoi tren port %BRIDGE_PORT%.
) else (
    echo.
)
if "%NO_PAUSE%"=="" pause
exit /b 0

:do_stop
echo [STOP] Dang tim va tat tien trinh Shopee Sync Daemon tren port %BRIDGE_PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%BRIDGE_PORT% ^| findstr LISTENING') do (
    set TARGET_PID=%%a
    if defined TARGET_PID (
        echo [STOP] Tim thay PID !TARGET_PID! tren port %BRIDGE_PORT%, dang dong tien trinh...
        taskkill /F /PID !TARGET_PID! > nul 2>&1
        echo [STOP] Da dong thanh cong PID !TARGET_PID!.
    )
)
if "%NO_PAUSE%"=="" pause
exit /b 0

:do_restart
set NO_PAUSE=1
call :do_stop
set NO_PAUSE=
timeout /t 1 /nobreak > nul
goto do_start

:do_test
echo ==============================================================
echo   SHOPEE SYNC DAEMON - CHE DO TEST CO LAP AN TOAN (DRY-RUN)
echo   Shop ID: 197195817 (thaimy1605) ^| Port: %BRIDGE_PORT%
echo ==============================================================
set NO_PAUSE=1
call :do_stop
set NO_PAUSE=
set SHOPEE_OUTBOX_DRY_RUN=1
set SHOPEE_INBOUND_DISABLE=1
python scripts\shopee_seller_sync.py --dry-run %2 %3 %4
if "%NO_PAUSE%"=="" pause
exit /b 0

:do_start
echo ==============================================================
echo   OPENVN CMS/POS ^<^=^> SHOPEE SELLER CENTER SYNC DAEMON
echo   Phuong an: Direct cURL / Seller Center Internal RPC API
echo   Shop ID: 197195817 (thaimy1605) ^| Port: %BRIDGE_PORT%
echo ==============================================================
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%BRIDGE_PORT% ^| findstr LISTENING') do (
    echo [WARN] Daemon da dang chay ngam voi PID %%a tren port %BRIDGE_PORT%!
    echo [TIP]  Chay 'run-shopee-sync.bat restart' neu ban muon khoi dong lai.
    if "%NO_PAUSE%"=="" pause
    exit /b 0
)

python scripts\shopee_seller_sync.py %*
if "%NO_PAUSE%"=="" pause
exit /b 0
