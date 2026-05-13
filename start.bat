@echo off
title CoBeing v2

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ===================================
echo   CoBeing v2 Launcher
echo ===================================
echo.

:: --- Check prerequisites ---
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pnpm not found. Please install pnpm first.
    echo         run: npm install -g pnpm
    pause
    exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] node not found. Please install Node.js ^>=22.
    pause
    exit /b 1
)

:: --- Install dependencies if needed ---
if not exist "node_modules\ws" (
    echo [INFO] Installing dependencies...
    call pnpm install
    if %errorlevel% neq 0 (
        echo [ERROR] pnpm install failed.
        pause
        exit /b 1
    )
    echo.
)

:: --- Kill any existing CoBeing process on port 18765 ---
echo [INFO] Checking for existing CoBeing process on port 18765...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":18765.*LISTENING" 2^>nul') do (
    echo [INFO] Killing existing process PID %%a ...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 2 /nobreak >nul
)

:: --- Build if needed (skip if pre-built dist exists) ---
if not exist "packages\core\dist\index.js" (
    echo [INFO] Building packages...
    call pnpm build
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
    echo.
) else (
    echo [INFO] Using pre-built packages (dist/ found, skipping build).
    echo.
)

:: --- Choose mode ---
echo Select launch mode:
echo   1. CLI  (Terminal interactive mode)
echo   2. GUI  (React + Tauri desktop app)  [recommended]
echo   3. Both (CLI + GUI)
echo.
set /p MODE="Enter choice [1/2/3] (default 2): "

if "%MODE%"=="" set MODE=2

if "%MODE%"=="2" goto :gui
if "%MODE%"=="3" goto :both

:: --- CLI mode ---
:cli
echo.
echo [INFO] Starting CoBeing CLI...
call pnpm dev
goto :end

:: --- GUI mode ---
:gui
echo.
echo [INFO] Starting CoBeing Core + GUI (Tauri)...

:: Start Core backend first
echo [INFO] Starting Core backend...
start "CoBeing Core" cmd /k "cd /d "%ROOT%" && call pnpm dev"
echo [INFO] Core started. Waiting for WS server on port 18765...

:: Wait for WS server
set WAIT_COUNT=0
:wait_ws
powershell -Command "try { $tcp = New-Object System.Net.Sockets.TcpClient; $tcp.Connect('127.0.0.1', 18765); $tcp.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto :ws_ready
set /a WAIT_COUNT+=1
if %WAIT_COUNT% geq 60 (
    echo [WARN] WS server not ready after 60s, continuing anyway...
    goto :ws_ready
)
timeout /t 1 /nobreak >nul
goto :wait_ws
:ws_ready
echo [INFO] WS server is ready.

:: Install gui-v2 deps if needed
if not exist "gui-v2\node_modules" (
    echo [INFO] Installing GUI dependencies...
    cd gui-v2
    call npm install --registry https://registry.npmmirror.com
    cd /d "%ROOT%"
)

where cargo >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Starting Tauri desktop app...
    cd gui-v2
    call npx tauri dev
    cd /d "%ROOT%"
) else (
    echo [WARN] cargo not found. Starting browser mode instead.
    echo [INFO] Open http://localhost:1420 in your browser.
    cd gui-v2
    call npm run dev
    cd /d "%ROOT%"
)
goto :end

:: --- Both mode ---
:both
echo.
echo [INFO] Starting CoBeing CLI + GUI...

:: Start CLI in background
start "CoBeing CLI" cmd /k "cd /d "%ROOT%" && call pnpm dev"
echo [INFO] CLI started in a new window.

:: Wait for WS server
echo [INFO] Waiting for WS server on port 18765...
set WAIT_COUNT2=0
:wait_ws2
powershell -Command "try { $tcp = New-Object System.Net.Sockets.TcpClient; $tcp.Connect('127.0.0.1', 18765); $tcp.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto :ws_ready2
set /a WAIT_COUNT2+=1
if %WAIT_COUNT2% geq 60 (
    echo [WARN] WS server not ready after 60s, continuing anyway...
    goto :ws_ready2
)
timeout /t 1 /nobreak >nul
goto :wait_ws2
:ws_ready2
echo [INFO] WS server is ready.

if not exist "gui-v2\node_modules" (
    echo [INFO] Installing GUI dependencies...
    cd gui-v2
    call npm install --registry https://registry.npmmirror.com
    cd /d "%ROOT%"
)

where cargo >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Starting Tauri desktop app...
    cd gui-v2
    call npx tauri dev
    cd /d "%ROOT%"
) else (
    echo [WARN] cargo not found. Starting browser mode instead.
    echo [INFO] Open http://localhost:1420 in your browser.
    cd gui-v2
    call npm run dev
    cd /d "%ROOT%"
)
goto :end

:end
echo.
echo [INFO] CoBeing stopped.
pause
