@echo off
chcp 65001 >nul
title [AUTONOMOUS AGENT 24/7] Tu Kiem Tra Tung Man Hinh - Tu Review - Tu Chinh Sua CSS An Toan
cd /d "%~dp0"
echo ===============================================================================
echo   AGENT DOC LAP 24/7: TU KIEM TRA TUNG MAN HINH - GUI BAO CAO - TU SUA AN TOAN
echo   Du an: OPENVN CMS/POS Beta
echo   Bao cao cap nhat truc tiep tai: .\beta-feedback\AGENT_STATUS.md
echo ===============================================================================
python -u agent_autonomous_worker.py --interval 45
pause
