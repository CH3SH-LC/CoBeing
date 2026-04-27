@echo off
chcp 65001 >nul 2>&1
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
    pnpm install
    if %errorlevel% neq 0 (
        echo [ERROR] pnpm install failed.
        pause
        exit /b 1
    )
    echo.
)

:: --- Build packages if needed ---
if not exist "packages\core\dist\index.js" (
    echo [INFO] Building packages...
    pnpm build
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
    echo.
)

:: --- Choose mode ---
echo Select launch mode:
echo   1. CLI  (Terminal interactive mode)
echo   2. GUI  (React + Tauri desktop app)
echo   3. Both (CLI + GUI)
echo.
set /p MODE="Enter choice [1/2/3] (default 1): "

if "%MODE%"=="" set MODE=1

if "%MODE%"=="2" goto :gui
if "%MODE%"=="3" goto :both

:: --- CLI mode ---
:cli
echo.
echo [INFO] Starting CoBeing CLI...
pnpm dev
goto :end

:: --- GUI mode ---
:gui
echo.
echo [INFO] Starting CoBeing Core + GUI (Tauri)...

:: Start Core backend first (WS server on port 18765)
echo [INFO] Starting Core backend...
start "CoBeing Core" cmd /k "cd /d "%ROOT%" && pnpm dev"
echo [INFO] Core started. Waiting 3s for WS server...

:: Wait for WS server to be ready
timeout /t 3 /nobreak >nul

:: Install gui-v2 deps if needed
if not exist "gui-v2\node_modules" (
    echo [INFO] Installing GUI dependencies...
    cd gui-v2
    npm install --registry https://registry.npmmirror.com
    cd /d "%ROOT%"
)

:: Check if Tauri CLI is available
where cargo >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Starting Tauri desktop app...
    cd gui-v2
    npx tauri dev
    cd /d "%ROOT%"
) else (
    echo [WARN] cargo not found. Starting browser mode instead.
    echo [INFO] Open http://localhost:1420 in your browser.
    cd gui-v2
    npm run dev
    cd /d "%ROOT%"
)
goto :end

:: --- Both mode ---
:both
echo.
echo [INFO] Starting CoBeing CLI + GUI...

:: Start CLI in background
start "CoBeing CLI" cmd /k "cd /d "%ROOT%" && pnpm dev"
echo [INFO] CLI started in a new window.

:: Wait for WS server
timeout /t 3 /nobreak >nul

:: Install gui-v2 deps if needed
if not exist "gui-v2\node_modules" (
    echo [INFO] Installing GUI dependencies...
    cd gui-v2
    npm install --registry https://registry.npmmirror.com
    cd /d "%ROOT%"
)

where cargo >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Starting Tauri desktop app...
    cd gui-v2
    npx tauri dev
    cd /d "%ROOT%"
) else (
    echo [WARN] cargo not found. Starting browser mode instead.
    echo [INFO] Open http://localhost:1420 in your browser.
    cd gui-v2
    npm run dev
    cd /d "%ROOT%"
)
goto :end

:end
echo.
echo [INFO] CoBeing stopped.
pause
