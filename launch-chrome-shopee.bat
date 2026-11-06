@echo off
chcp 65001 > nul
title Khoi chay Chrome Shopee voi CDP Remote Debugging Port 9222
echo ==============================================================
echo   KHOI CHAY GOOGLE CHROME HO TRO TU DONG DONG BO COOKIE SHOPEE
echo   Port: 9222 (Chrome DevTools Protocol)
echo ==============================================================
echo.
echo Dang mo Google Chrome tai Kenh Nguoi Ban Shopee...
echo Ban chi can dang nhap va giu Chrome mo de ban hang binh thuong.
echo.

set CHROME_EXE="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME_EXE% (
    set CHROME_EXE="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

start "" %CHROME_EXE% --remote-debugging-port=9222 --remote-allow-origins=* "https://banhang.shopee.vn"

echo Da kich hoat Chrome. He thong OPENVN Sync se tu dong bat Cookie lien tuc.
timeout /t 3 > nul
exit
