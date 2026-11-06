@echo off
chcp 65001 >nul
title OmniSales · Uu Dam Suite — Production Standalone (:3010 + :3013)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cms.ps1" -Production %*
pause
