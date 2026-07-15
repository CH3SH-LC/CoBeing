param(
    [Parameter(Mandatory=$true)]
    [string]$DataRoot
)

$ErrorActionPreference = "Continue"

if (-not (Test-Path $DataRoot)) {
    Write-Host "  Data root not found: $DataRoot — nothing to clean"
    exit 0
}

foreach ($sub in @("agents", "groups", "coreagents")) {
    $dir = Join-Path $DataRoot $sub
    if (-not (Test-Path $dir)) { continue }

    # 清理标记的目录: *.deleted.* / *.orphan.* / *.pending-delete.*
    Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '\.(deleted|orphan|pending-delete)\.' } |
        ForEach-Object {
            Write-Host "  Removing: $($_.FullName)"
            try {
                Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop
                Write-Host "    -> OK"
            } catch {
                Write-Host "    -> WARN: Failed ($($_.Exception.Message)) — will retry in runtime"
            }
        }

    # 清理标记的单个文件: *.deleted.* / *.orphan.*
    Get-ChildItem $dir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '\.(deleted|orphan)\.' } |
        ForEach-Object {
            try {
                Remove-Item $_.FullName -Force -ErrorAction Stop
                Write-Host "  Removed file: $($_.FullName)"
            } catch {}
        }
}

Write-Host "  Cleanup complete."
