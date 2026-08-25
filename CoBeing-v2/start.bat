@echo off
setlocal
title CoBeing v2 - 一键启动
cd /d "%~dp0"

echo ============================================
echo    CoBeing v2  (Tauri GUI + 内核一键启动)
echo ============================================
echo.

REM ---------- 1. 环境检查 ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node，请先安装 Node.js 24+ 并确保加入 PATH
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 pnpm，请先安装：npm install -g pnpm
  pause
  exit /b 1
)

REM ---------- 2. 依赖安装（首次或缺失时） ----------
if not exist "node_modules\" (
  echo [安装] 首次运行，安装工作区依赖...
  call pnpm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试
    pause
    exit /b 1
  )
)

REM ---------- 3. 端口检查（vite 1420，被占用则提示） ----------
netstat -ano | findstr ":1420" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [提示] 端口 1420 已被其他程序占用（如 v1 GUI），GUI 可能启动失败，请先关闭占用程序
)

REM ---------- 4. 读取同目录 .env（DEEPSEEK_API_KEY 以系统环境变量优先） ----------
if exist ".env" (
  echo [配置] 已读取同目录 .env
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="DEEPSEEK_API_KEY" (
      if "%DEEPSEEK_API_KEY%"=="" set "DEEPSEEK_API_KEY=%%b"
    ) else (
      if not "%%a"=="" set "%%a=%%b"
    )
  )
)

REM ---------- 5. DeepSeek key 提示 ----------
if "%DEEPSEEK_API_KEY%"=="" (
  echo [提示] 未检测到 DEEPSEEK_API_KEY：智能体走 mock 模式，无需 key 即可使用
  echo         需要真实对话：在 .env 中配置 DEEPSEEK_API_KEY，或 set DEEPSEEK_API_KEY=sk-xxx
)

REM ---------- 6. 启动 GUI（自动拉起内核子进程） ----------
echo.
echo [启动] pnpm tauri dev ...
cd gui
call pnpm tauri dev
echo.
echo [退出] GUI 已关闭
pause