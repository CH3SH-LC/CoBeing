param([int]$Port = 18765)

# 杀掉占用指定端口的进程（旧版用 Start-Job 包裹 netstat，子进程启动慢导致 15s 超时后跳过，旧进程残留）。
# 修复：改用 Get-NetTCPConnection 同步查询（毫秒级），失败时 netstat 同步兜底。

Write-Host "[INFO] Checking port $Port..."

$pids = @()
try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
        Where-Object { $_.OwningProcess -and $_.OwningProcess -ne 0 }
    $pids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
} catch {
    # 兜底：同步 netstat（不再用 Start-Job）
    $lines = & netstat -ano -p TCP 2>$null | Select-String ":$Port\s"
    foreach ($line in $lines) {
        $parts = $line.ToString() -split '\s+'
        $procId = $parts[-1]
        if ($procId -and $procId -ne '0') { $pids += [int]$procId }
    }
    $pids = @($pids | Select-Object -Unique)
}

if ($pids.Count -eq 0) {
    Write-Host "[INFO] No process found on port $Port"
    exit 0
}

foreach ($procId in $pids) {
    try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Host "[INFO] Killed process PID $procId on port $Port"
    } catch {
        Write-Host "[WARN] Failed to kill PID $procId : $_"
    }
}

Start-Sleep -Seconds 2

# 验证端口是否释放
$remaining = @()
try {
    $remaining = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
        Where-Object { $_.OwningProcess -and $_.OwningProcess -ne 0 })
} catch {
    $lines = & netstat -ano -p TCP 2>$null | Select-String ":$Port\s"
    foreach ($line in $lines) {
        $parts = $line.ToString() -split '\s+'
        $procId = $parts[-1]
        if ($procId -and $procId -ne '0') { $remaining += $procId }
    }
}

if ($remaining.Count -gt 0) {
    Write-Host "[WARN] Port $Port is still occupied after cleanup attempts"
    exit 1
}
Write-Host "[INFO] Port $Port is now free"
exit 0
