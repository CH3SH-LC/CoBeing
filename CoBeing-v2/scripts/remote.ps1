# CoBeing 远程互联启动器（方案 v1）
# 用法：
#   LAN 直连：     powershell -ExecutionPolicy Bypass -File scripts\remote.ps1 -Mode lan
#   外网隧道：     powershell -ExecutionPolicy Bypass -File scripts\remote.ps1 -Mode tunnel
#   自定义：       ... -Mode tunnel -Port 7843 -Data D:\agent-codes\CoBeing-v2\data -Root D:\agent-codes
# 说明：
#   - 自动加载同目录 .env 的 DEEPSEEK_API_KEY（系统环境变量优先）
#   - token 首次生成在 <data>\remote.token（或 -Token 显式指定）；手机 App 需要它
#   - cloudflared 缺失时自动下载到 tools\cloudflared.exe（GitHub 直连较慢属正常）
#   - 连接信息（地址 + Token）在启动完成后打印到屏幕底部高亮区块，
#     同时保存到 <data>\remote.info.txt（记事本打开即得）
#   - Ctrl+C 退出时自动清理内核与 cloudflared 子进程
param(
  [ValidateSet('lan', 'tunnel')]
  [string]$Mode = 'lan',
  [int]$Port = 7843,
  [string]$Data = '',
  [string[]]$Root = @(),
  [string]$Token = ''
)

$ErrorActionPreference = 'Stop'
$rootDir = Split-Path -Parent $PSScriptRoot
# 数据目录默认 <工程根>\data（与 start.bat/GUI 一致）；空值会导致 Start-Process ArgumentList 拒绝
if (-not $Data) { $Data = Join-Path $rootDir 'data' }
$kernelPort = $Port
$env:COBEING_DATA_ROOT = $Data

# ---------- .env 加载（DEEPSEEK_API_KEY；系统环境变量优先） ----------
$envFile = Join-Path $rootDir '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$' -and -not [Environment]::GetEnvironmentVariable($matches[1])) {
      Set-Item -Path "Env:$($matches[1])" -Value $matches[2].Trim('"', "'")
    }
  }
}

# ---------- cloudflared 探测/下载 ----------
function Ensure-Cloudflared {
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cf) { return $cf.Source }
  $local = Join-Path $rootDir 'tools\cloudflared.exe'
  if (-not (Test-Path $local)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $local) | Out-Null
    Write-Host "[remote] 下载 cloudflared（GitHub 直连，约 50MB，慢属正常）..."
    curl.exe -L --retry 3 -o $local 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  }
  if (-not (Test-Path $local)) { throw 'cloudflared 下载失败，请手动下载后放入 tools\cloudflared.exe' }
  return $local
}

# ---------- 局域网 IP ----------
# 优先物理网卡（以太网/WiFi），跳过虚拟代理网卡（198.18.x.x fake-ip / TAP / TUN / WireGuard / Wintun）
function Get-LanIp {
  try {
    $adapter = Get-NetAdapter -ErrorAction Stop | Where-Object {
      $_.Status -eq 'Up' -and
      $_.InterfaceDescription -notmatch 'Virtual|TAP|TUN|Loopback|WireGuard|Wintun|VPN'
    } | Select-Object -First 1
    if ($adapter) {
      $ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
      if ($ip) { return $ip }
    }
    # 回退：任意非回环 IPv4
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '198.18.*' } | Select-Object -First 1).IPAddress
    if ($ip) { return $ip }
  } catch { }
  return '127.0.0.1'
}

# ---------- 启动内核（远程 WS 服务器） ----------
# LAN 模式需要手机直连 → 绑定 0.0.0.0（token 鉴权兜底）；隧道模式只绑 127.0.0.1 更安全
$bindHost = '127.0.0.1'
if ($Mode -eq 'lan') { $bindHost = '0.0.0.0' }
$kernelArgs = @('node_modules\tsx\dist\cli.mjs', 'packages\bridge\src\cli.ts', '--data', $Data, '--remote-port', "$kernelPort", '--remote-host', $bindHost)
if ($Token) { $kernelArgs += @('--remote-token', $Token) }
foreach ($r in $Root) { $kernelArgs += @('--remote-root', $r) }
$kernel = Start-Process -FilePath 'node' -ArgumentList $kernelArgs -WorkingDirectory $rootDir -PassThru -NoNewWindow -RedirectStandardError (Join-Path $env:TEMP 'cobeing-kernel-stderr.log')

# LAN 模式：尝试放行 Windows 防火墙（需管理员；失败仅提示，不阻断）
if ($Mode -eq 'lan') {
  try {
    $existing = Get-NetFirewallRule -DisplayName 'CoBeing Remote' -ErrorAction SilentlyContinue
    if (-not $existing) {
      New-NetFirewallRule -DisplayName 'CoBeing Remote' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $kernelPort -ErrorAction Stop | Out-Null
      Write-Host '[remote] 已自动添加防火墙放行规则（CoBeing Remote）'
    }
  } catch {
    Write-Host '[remote] 防火墙规则添加失败（需要管理员）。若手机连不上，请以管理员运行：'
    Write-Host "        netsh advfirewall firewall add rule name=CoBeingRemote dir=in action=allow protocol=TCP localport=$kernelPort"
  }
}

Write-Host ''
Write-Host '=================================================='
Write-Host '  CoBeing 远程互联（方案 v1）'
Write-Host '=================================================='
Write-Host "  数据目录: $Data"

# token 读取（新生成时从文件读；生成提示在内核 stderr，此处统一展示）
if (-not $Token) {
  $tokenFile = Join-Path $Data 'remote.token'
  if (Test-Path $tokenFile) { $Token = (Get-Content $tokenFile -Raw).Trim() }
}

$cloudflared = $null
$cfProc = $null
$connUrl = $null
$url = $null

try {
  if ($Mode -eq 'tunnel') {
    $cf = Ensure-Cloudflared
    Write-Host '[remote] 启动 cloudflared quick tunnel（获取地址中，首次约 10-30 秒）...'
    $cfOut = Join-Path $env:TEMP 'cobeing-cf-out.log'
    $cfErr = Join-Path $env:TEMP 'cobeing-cf-err.log'
    # 输出重定向到日志（不刷屏），轮询抓取 trycloudflare 地址
    # --protocol http2：QUIC/UDP 在国内网络/本地代理 fake-ip 环境常被丢弃，强制 TCP 更稳
    $cfProc = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$kernelPort", '--no-autoupdate', '--protocol', 'http2') -PassThru -NoNewWindow -RedirectStandardOutput $cfOut -RedirectStandardError $cfErr
    for ($i = 0; $i -lt 60 -and -not $url; $i++) {
      Start-Sleep -Seconds 1
      if ($cfProc.HasExited) { throw 'cloudflared 退出（检查网络或防火墙）' }
      $cfLog = ''
      foreach ($f in @($cfOut, $cfErr)) {
        if (Test-Path $f) { $cfLog += (Get-Content $f -Raw -ErrorAction SilentlyContinue) }
      }
      $m = [regex]::Match($cfLog, 'https://[a-z0-9-]+\.trycloudflare\.com')
      if ($m.Success) { $url = $m.Value }
    }
    if ($url) {
      $connUrl = $url
      Write-Host "[remote] 隧道就绪：$url"
    } else {
      Write-Host '[remote] ⚠ 60 秒内未获取到隧道地址（网络/防火墙问题？）。'
      Write-Host '        可重试，或改用 named tunnel（见方案文档）；内核仍在运行。'
    }
  } else {
    $lan = Get-LanIp
    $connUrl = "ws://${lan}:$kernelPort"
    Write-Host "[remote] 局域网服务就绪：$connUrl"
  }

  # ---------- 连接信息：底部高亮区块 + 落盘 remote.info.txt ----------
  $infoFile = Join-Path $Data 'remote.info.txt'
  if ($connUrl -and $Token) {
    Set-Content -Path $infoFile -Value @(
      '# CoBeing 远程互联连接信息（手机 App 设置 → 添加服务器）',
      "# 生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
      "地址: $connUrl",
      "Token: $Token",
      "数据目录: $Data",
      "# 提示: 隧道地址(https://...) App 会自动转为 wss 连接"
    ) -Encoding UTF8
    Write-Host ''
    Write-Host '============================================================'
    Write-Host '  手机 App 连接信息（设置 → 添加服务器）'
    Write-Host '  地址: ' -NoNewline
    Write-Host $connUrl -ForegroundColor Green
    Write-Host '  Token: ' -NoNewline
    Write-Host $Token -ForegroundColor Green
    Write-Host "  已保存到: $infoFile（记事本打开即可复制）"
    Write-Host '============================================================'
  } else {
    Write-Host '[remote] ⚠ 连接信息不完整（地址或 token 缺失），请检查上方输出'
  }

  Write-Host ''
  Write-Host '  按 Ctrl+C 停止（自动清理内核与 cloudflared）'
  Write-Host '=================================================='

  # 等待内核退出
  Wait-Process -Id $kernel.Id -ErrorAction SilentlyContinue
} finally {
  if ($kernel -and -not $kernel.HasExited) { Stop-Process -Id $kernel.Id -Force -ErrorAction SilentlyContinue }
  if ($cfProc -and -not $cfProc.HasExited) { Stop-Process -Id $cfProc.Id -Force -ErrorAction SilentlyContinue }
  Write-Host ''
  Write-Host '[remote] 已停止'
}
