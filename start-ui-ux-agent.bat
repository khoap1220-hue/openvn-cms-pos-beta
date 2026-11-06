@echo off
chcp 65001 >nul
title Independent UI/UX Pro Max Agent 24/7 - openvn-cms-pos-beta
cd /d "%~dp0"
echo ============================================================================
echo   AGENT UI/UX DOC LAP 24/7 (UIUX-AGENT-PRO : ui-ux-pro-max + MATRIX UX/UI)
echo ============================================================================
python -u ui_ux_agent_worker.py %*
if "%1"=="" (
  echo.
  echo Nhan phim bat ky de dong cua so...
  pause >nul
)
