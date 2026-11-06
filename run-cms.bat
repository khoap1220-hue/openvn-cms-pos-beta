@echo off
chcp 65001 >nul
title OmniSales Suite — He thong Van hanh
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cms.ps1" %*
pause
