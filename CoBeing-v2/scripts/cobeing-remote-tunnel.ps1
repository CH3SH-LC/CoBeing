# CoBeing 远程回连一键脚本（v2.0.15）
# 用途：在「局域网被隔离/无法配对」的环境下，为**正在运行**的 CoBeing App 内核
#       开一条 cloudflared quick tunnel，并输出手机可用的连接地址 + token。
# 用法：
#   - 先启动 CoBeing 桌面 App；
#   - 双击仓库根目录 CoBeing-remote-tunnel.bat（或本脚本）；
#   - 手机 App「连接」里填入脚本输出的 https://…trycloudflare.com（自动转 wss）+ Token。
# 说明：电脑重启/换网后重跑一次即可；Token 持久不变，隧道 URL 每次运行变化。
#       关闭本窗口不影响隧道；停止隧道 = 结束 cloudflared.exe 进程。

$ErrorActionPreference = 'Stop'
function Say($t) { Write-Host $t -ForegroundColor Cyan }

# ---- 1. cloudflared 定位（可移植：%LOCALAPPDATA% 为准 → 仓库 tools 回退 → 在线下载）----
$cfLocal = Join-Path $env:LOCALAPPDATA 'CoBeing\cloudflared.exe'
if (-not (Test-Path -LiteralPath $cfLocal)) {
  $src = Join-Path $PSScriptRoot '..\tools\cloudflared.exe'   # 相对路径，任意检出可用
  if (Test-Path -LiteralPath $src) {
    New-Item -ItemType Directory -Force (Split-Path $cfLocal) | Out-Null
    Copy-Item -LiteralPath $src $cfLocal -Force
  } else {
    Write-Host 'cloudflared 缺失，正在从 GitHub 下载...'
    New-Item -ItemType Directory -Force (Split-Path $cfLocal) | Out-Null
    curl.exe -L --retry 3 -o $cfLocal 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  }
}
if (-not (Test-Path -LiteralPath $cfLocal)) { Write-Host '[X] 无 cloudflared，中止'; exit 1 }

# ---- 2. 找到正在运行的 CoBeing 内核（node ...kernel.mjs）----
$k = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
     Where-Object { $_.CommandLine -match 'kernel\.mjs' } | Select-Object -First 1
if (-not $k) { Write-Host '[X] 未检测到 CoBeing 内核进程，请先启动 CoBeing 桌面应用再运行本脚本'; exit 1 }

# ---- 3. data 目录（--data 参数）→ token ----
$dm = [regex]::Match($k.CommandLine, '--data[= ]["'']?([^"'']+?)["'']?\s')
$data = if ($dm.Success) { $dm.Groups[1].Value.Trim() } else { Join-Path $env:APPDATA 'com.cobeing.v2' }
$tokFile = Join-Path $data 'remote.token'
$token = if (Test-Path -LiteralPath $tokFile) { (Get-Content -LiteralPath $tokFile -Raw).Trim() } else { '' }

# ---- 4. 内核 WS 监听端口 ----
$conn = Get-NetTCPConnection -OwningProcess $k.ProcessId -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq '0.0.0.0' -and $_.RemoteAddress -eq '0.0.0.0' } | Select-Object -First 1
if (-not $conn) { $conn = Get-NetTCPConnection -OwningProcess $k.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $conn) { Write-Host '[X] 找不到内核监听端口'; exit 1 }
$port = $conn.LocalPort

Say ('[OK] 内核 PID={0}  数据={1}  端口={2}' -f $k.ProcessId, $data, $port)

# ---- 5. 重启一个干净的 cloudflared 隧道 ----
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600
$log = Join-Path $env:TEMP 'cobeing-tunnel.log'
if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath ($log + '.err')) { Remove-Item -LiteralPath ($log + '.err') -Force -ErrorAction SilentlyContinue }
Start-Process -FilePath $cfLocal `
     -ArgumentList @('tunnel','--url',('http://127.0.0.1:{0}' -f $port),'--no-autoupdate','--protocol','http2') `
     -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError ($log + '.err') | Out-Null

# ---- 6. 轮询抓取 trycloudflare 地址（stdout + stderr 都看）----
$url = ''
for ($i = 0; $i -lt 45 -and -not $url; $i++) {
  Start-Sleep -Milliseconds 700
  foreach ($f in @($log, ($log + '.err'))) {
    if (Test-Path -LiteralPath $f) {
      $c = Get-Content -LiteralPath $f -Raw
      if ($c) {
        $mm = [regex]::Match($c, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($mm.Success) { $url = $mm.Value; break }
      }
    }
  }
}
if (-not $url) {
  Write-Host '[X] 未能获取隧道地址，日志如下：'
  if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 10 }
  if (Test-Path -LiteralPath ($log + '.err')) { Get-Content -LiteralPath ($log + '.err') -Tail 10 }
  exit 2
}

Write-Host ''
Write-Host '============  手机连接信息（App 里添加/改地址）  ============' -ForegroundColor Yellow
Write-Host ('地址(https，App 自动转 wss)： {0}' -f $url) -ForegroundColor Green
Write-Host ('Token：                      {0}' -f $token) -ForegroundColor Green
Write-Host '=============================================================' -ForegroundColor Yellow
$out = Join-Path $data 'remote-tunnel.txt'
try {
  Set-Content -LiteralPath $out -Encoding UTF8 -Value @('', ("地址: {0}" -f $url), ("Token: {0}" -f $token), ('端口: {0}' -f $port), ("时间: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'))) | Out-Null
  Write-Host ('（已写入 {0}）' -f $out)
} catch { Write-Host '（提示：未能写入地址文件，仅以上输出可用）' }
