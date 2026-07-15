param([int]$Port = 18765)

# Use -p TCP to limit output (much faster on systems with many connections)
$netstatArgs = @('-ano', '-p', 'TCP')

Write-Host "[INFO] Checking port $Port..."

# Run netstat with a 15-second timeout via a background job
$job = Start-Job -ScriptBlock {
    param($args, $Port)
    netstat @args 2>&1 | Select-String ":$Port\b"
} -ArgumentList $netstatArgs, $Port

$completed = Wait-Job $job -Timeout 15
if (-not $completed) {
    Write-Host "[WARN] netstat timed out after 15s, skipping port check"
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -ErrorAction SilentlyContinue
    exit 0
}

$connections = Receive-Job $job -ErrorAction SilentlyContinue
Remove-Job $job -ErrorAction SilentlyContinue

if (-not $connections) {
    Write-Host "[INFO] No process found on port $Port"
    exit 0
}

foreach ($line in $connections) {
    $parts = $line -split '\s+'
    $procId = $parts[-1]
    if ($procId -and $procId -ne '0') {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host "[INFO] Killed process PID $procId on port $Port"
        } catch {
            Write-Host "[WARN] Failed to kill PID $procId : $_"
        }
    }
}

Start-Sleep -Seconds 2

# Double-check
$remaining = netstat @netstatArgs 2>&1 | Select-String ":$Port\b"
if ($remaining) {
    foreach ($line in $remaining) {
        $parts = $line -split '\s+'
        $procId = $parts[-1]
        if ($procId -and $procId -ne '0') {
            try {
                Stop-Process -Id $procId -Force -ErrorAction Stop
                Write-Host "[WARN] Force-killed remaining PID $procId on port $Port"
            } catch {
                Write-Host "[WARN] Force-kill failed for PID $procId : $_"
            }
        }
    }
    Start-Sleep -Seconds 1
}

# Final check
$finalCheck = netstat @netstatArgs 2>&1 | Select-String ":$Port\b"
if ($finalCheck) {
    Write-Host "[WARN] Port $Port is still occupied after cleanup attempts"
} else {
    Write-Host "[INFO] Port $Port is now free"
}
