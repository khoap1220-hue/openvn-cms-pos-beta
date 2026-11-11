@echo off
chcp 65001 >nul
title OPENVN · Uu Dam Suite — 1-Click Production Launcher (:3010 + :3013 + :51898)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cms.ps1" -Production %*
