@echo off
chcp 65001 >nul
title OPENVN POS - Che Do In Tu Dong Ngam (Kiosk Printing)

set "POS_URL=http://localhost:3010/pos"
set "CHROME_PATH="

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  set "CHROME_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  set "CHROME_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)

if "%CHROME_PATH%"=="" (
  echo [!] Khong tim thay Chrome hoac Edge. Dang mo trinh duyet mac dinh...
  start "" "%POS_URL%"
  exit /b 0
)

echo [OPENVN POS] Dang khoi dong Quay POS voi che do In Tu Dong Ngam (--kiosk-printing)...
start "" "%CHROME_PATH%" --kiosk-printing --app="%POS_URL%"
exit /b 0
