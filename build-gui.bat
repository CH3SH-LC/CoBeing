@echo off
chcp 65001 >nul 2>&1
title MyAgents GUI Builder

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ===================================
echo   MyAgents GUI 打包构建
echo ===================================
echo.

:: --- Check prerequisites ---
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] cargo not found. Please install Rust: https://rustup.rs
    pause
    exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] node not found. Please install Node.js ^>=22.
    pause
    exit /b 1
)

:: --- Select format ---
echo Select build format:
echo   1. Both (.exe + .msi)
echo   2. NSIS only (.exe)
echo   3. MSI only (.msi)
echo.
set /p FMT="Enter choice [1/2/3] (default 1): "

if "%FMT%"=="" set FMT=1
if "%FMT%"=="2" set BUNDLE=nsis
if "%FMT%"=="3" set BUNDLE=msi
if "%FMT%"=="1" set BUNDLE=all

:: --- Install GUI deps ---
if not exist "gui-v2\node_modules" (
    echo [INFO] Installing GUI dependencies...
    cd gui-v2
    call npm install --registry https://registry.npmmirror.com
    cd /d "%ROOT%"
)

:: --- Build ---
echo.
echo [INFO] Building MyAgents GUI (format: %BUNDLE%)...
cd gui-v2

if "%BUNDLE%"=="all" (
    npx tauri build
) else (
    npx tauri build --bundles %BUNDLE%
)

if %errorlevel% equ 0 (
    echo.
    echo ===================================
    echo   Build SUCCESS!
    echo ===================================
    echo.
    echo Output: gui-v2\src-tauri\target\release\bundle\
    echo.
    if "%BUNDLE%"=="msi" (
        dir /b "src-tauri\target\release\bundle\msi\*.msi" 2>nul
    ) else if "%BUNDLE%"=="nsis" (
        dir /b "src-tauri\target\release\bundle\nsis\*.exe" 2>nul
    ) else (
        dir /b /s "src-tauri\target\release\bundle\*.exe" 2>nul
        dir /b /s "src-tauri\target\release\bundle\*.msi" 2>nul
    )
) else (
    echo.
    echo [ERROR] Build failed. Check errors above.
)

cd /d "%ROOT%"
pause
