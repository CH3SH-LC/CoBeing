@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cobeing-remote-tunnel.ps1"
echo.
pause
