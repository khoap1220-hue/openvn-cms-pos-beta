@echo off
chcp 65001 >nul
title Auto Deploy Free Beta 24/7 - openvn-cms-pos-beta
cd /d "%~dp0"
echo ============================================================
echo   AUTO DEPLOY FREE BETA 24/7 ^& DONG BO FEEDBACK (openvn-cms-pos-beta)
echo ============================================================
python deploy_beta.py %*
if "%1"=="" (
  echo.
  echo Nhan phim bat ky de dong cua so...
  pause >nul
)
