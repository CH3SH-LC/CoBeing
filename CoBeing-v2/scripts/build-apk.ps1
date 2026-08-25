# CoBeing 手机端 APK 一键打包（方案 v1）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
# 产物：releases\CoBeing-mobile-v2.0.0-debug.apk（拷贝到手机直接安装）
param()

$ErrorActionPreference = 'Stop'
$rootDir = Split-Path -Parent $PSScriptRoot
$mobileDir = Join-Path $rootDir 'mobile'
$outDir = Join-Path $rootDir 'releases'
$apkName = 'CoBeing-mobile-v2.0.0-debug.apk'

# ---------- 1. JDK 探测 ----------
$javaHome = $env:JAVA_HOME
if (-not $javaHome -or -not (Test-Path (Join-Path $javaHome 'bin\java.exe'))) {
  $candidates = @('C:\Program Files\Java\jdk-21.0.11', 'C:\Program Files\Java\latest')
  foreach ($c in $candidates) {
    if (Test-Path (Join-Path $c 'bin\java.exe')) { $javaHome = $c; break }
  }
  if (-not $javaHome) { throw '未找到 JDK（需要 17+），请安装后重试' }
}
$env:JAVA_HOME = $javaHome
Write-Host "[apk] JDK: $javaHome"

# ---------- 2. Android SDK ----------
if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) {
  if (Test-Path 'C:\Android\Sdk') { $env:ANDROID_HOME = 'C:\Android\Sdk' }
  elseif (Test-Path "$env:LOCALAPPDATA\Android\Sdk") { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }
  else { throw '未找到 Android SDK' }
}
Write-Host "[apk] SDK: $env:ANDROID_HOME"

# ---------- 3. Web 构建 + 同步到 Android 工程 ----------
Push-Location $mobileDir
try {
  Write-Host "[apk] 构建 Web 资源（tsc + vite）..."
  & npm.cmd run build | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'npm run build 失败' }
  Write-Host "[apk] 同步到 Android 工程（cap sync）..."
  & npx.cmd cap sync android | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'cap sync 失败' }
} finally {
  Pop-Location
}

# ---------- 4. Gradle 打包 ----------
Push-Location (Join-Path $mobileDir 'android')
try {
  Write-Host "[apk] Gradle assembleDebug（首次较慢，之后增量很快）..."
  & .\gradlew.bat assembleDebug --no-daemon | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'gradle 构建失败' }
} finally {
  Pop-Location
}

# ---------- 5. 复制到 releases（显眼位置，手机直接取用） ----------
$src = Join-Path $mobileDir 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $src)) { throw "未找到 APK: $src" }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$dst = Join-Path $outDir $apkName
Copy-Item $src $dst -Force
$sizeMb = [math]::Round((Get-Item $dst).Length / 1MB, 2)
Write-Host ""
Write-Host "[apk] 完成：$dst（${sizeMb}MB）"
Write-Host "[apk] 拷贝到手机直接安装即可（安装时允许未知来源）"
