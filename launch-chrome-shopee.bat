@echo off
chcp 65001 > nul
setlocal
title OPENVN - Trinh duyet Dang nhap 1 lan Shopee Seller (Persistent Profile + CDP 9222)

if /I "%~1"=="--silent" set NO_PAUSE=1

set "REPO_DIR=%~dp0"
if "%REPO_DIR:~-1%"=="\" set "REPO_DIR=%REPO_DIR:~0,-1%"
set "STAGED_EXT_DIR=%LOCALAPPDATA%\OPENVN\ShopeeSellerExtension-197195817"
set "EXT_DIR=%REPO_DIR%\extensions\shopee-sync-extension"
if exist "%STAGED_EXT_DIR%\manifest.json" set "EXT_DIR=%STAGED_EXT_DIR%"
set "PROFILE_DIR=%LOCALAPPDATA%\OPENVN\ShopeeSellerProfile-197195817"

if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%" > nul 2>&1

echo ======================================================================
echo   OPENVN - DANG NHAP 1 LAN KENH NGUOI BAN SHOPEE (KHONG CAN PARTNER ID)
echo   - Ho so luu phien ben vung : %PROFILE_DIR%
echo   - Tien ich tu dong nap     : extensions\shopee-sync-extension
echo   - Cong CDP Auto-Recovery   : 127.0.0.1:9222
echo ======================================================================
echo.

set "BROWSER_EXE="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if "%BROWSER_EXE%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if "%BROWSER_EXE%"=="" if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if "%BROWSER_EXE%"=="" if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "BROWSER_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if "%BROWSER_EXE%"=="" if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "BROWSER_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if not "%BROWSER_EXE%"=="" goto :LAUNCH_BROWSER
echo [ERROR] Khong tim thay Google Chrome hoac Microsoft Edge tren may!
if "%NO_PAUSE%"=="" pause
exit /b 1

:LAUNCH_BROWSER
if exist "%EXT_DIR%\manifest.json" goto :LAUNCH_WITH_EXT
start "" "%BROWSER_EXE%" --user-data-dir="%PROFILE_DIR%" --remote-debugging-port=9222 --remote-allow-origins=* --restore-last-session --no-first-run --no-default-browser-check "https://banhang.shopee.vn"
goto :AFTER_LAUNCH

:LAUNCH_WITH_EXT
start "" "%BROWSER_EXE%" --user-data-dir="%PROFILE_DIR%" --remote-debugging-port=9222 --remote-allow-origins=* --restore-last-session --no-first-run --no-default-browser-check --disable-features=DisableLoadExtensionCommandLineSwitch --load-extension="%EXT_DIR%" "https://banhang.shopee.vn"

:AFTER_LAUNCH

echo [OK] Da mo Trinh duyet Ho so Ben vung Shopee (thaimy1605 - #197195817).
echo      Ban chi can dang nhap 1 lan duy nhat; Cookie va Extension se tu dong giu phien!
if "%NO_PAUSE%"=="" (
    timeout /t 3 > nul
    pause
)
exit /b 0
