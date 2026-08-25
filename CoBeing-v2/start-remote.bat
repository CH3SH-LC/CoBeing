@echo off
setlocal
title CoBeing 远程互联 - 一键启动
cd /d "%~dp0"

echo ============================================
echo    CoBeing 远程互联（方案 v1）
echo    启动后记下「地址」和「Token」，
echo    在手机 App 设置中添加服务器即可连接
echo ============================================
echo.

REM ---------- 1. 环境检查 ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node，请先安装 Node.js 24+
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo [错误] 依赖未安装，请先双击 start.bat 完成首次安装
  pause
  exit /b 1
)

REM ---------- 2. 模式选择 ----------
echo 请选择连接模式：
echo   1. 局域网直连（手机与电脑同一 WiFi，推荐先测这个）
echo   2. 外网隧道（cloudflared，手机在任意网络都能连）
echo   3. 退出
echo.
set /p MODE=输入 1 或 2 后回车：

if "%MODE%"=="1" goto lan
if "%MODE%"=="2" goto tunnel
goto end

:lan
echo.
echo [启动] 局域网模式（手机直连电脑）...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\remote.ps1" -Mode lan
goto end

:tunnel
echo.
echo [启动] 外网隧道模式（cloudflared quick tunnel）...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\remote.ps1" -Mode tunnel
goto end

:end
echo.
echo [退出] 远程互联已停止
pause
