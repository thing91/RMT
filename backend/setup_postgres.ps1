# One-time setup: creates the 'rmt' database user/database for this project.
# Run this from an elevated (Administrator) PowerShell window.
#
# Root cause of earlier failures: PowerShell's `-Encoding utf8` always writes
# a UTF-8 BOM in Windows PowerShell 5.1, and Postgres's config parser does
# NOT skip a BOM — it corrupts pg_hba.conf's first token and the server
# refuses to start at all ("could not load pg_hba.conf"). Fix: write with
# -Encoding ascii (the file is pure ASCII anyway), never utf8.

Start-Transcript -Path "$PSScriptRoot\setup_postgres.log" -Force | Out-Null

$pgData = "C:\Program Files\PostgreSQL\16\data"
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
$hbaPath = Join-Path $pgData "pg_hba.conf"
$serviceName = "postgresql-x64-16"
$psql = Join-Path $pgBin "psql.exe"

function Wait-ServiceState {
    param([string]$TargetState, [int]$TimeoutSeconds = 60)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $q = (sc.exe queryex $serviceName | Select-String "STATE").ToString()
        if ($q -match $TargetState) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

# Start from a known-clean baseline: write pg_hba.conf fresh with ASCII
# encoding instead of trusting whatever BOM state earlier runs left behind.
$cleanSecure = @"
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
local   replication     all                                     scram-sha-256
host    replication     all             127.0.0.1/32            scram-sha-256
host    replication     all             ::1/128                 scram-sha-256
"@
$cleanTrust = $cleanSecure -replace 'scram-sha-256', 'trust'

Write-Host "Stopping service (if running)..."
sc.exe stop $serviceName | Out-Null
Wait-ServiceState -TargetState "STOPPED" -TimeoutSeconds 30 | Out-Null

Write-Host "Writing pg_hba.conf (trust, ASCII, no BOM)..."
[System.IO.File]::WriteAllText($hbaPath, $cleanTrust, [System.Text.Encoding]::ASCII)

Write-Host "Starting PostgreSQL..."
sc.exe start $serviceName | Out-Null
if (-not (Wait-ServiceState -TargetState "RUNNING" -TimeoutSeconds 60)) {
    Write-Host "Service did not reach RUNNING state." -ForegroundColor Red
    Stop-Transcript | Out-Null
    exit 1
}
Start-Sleep -Seconds 2

Write-Host "Setting postgres superuser password..."
& $psql -U postgres -h localhost -c "ALTER USER postgres PASSWORD 'postgres';"

Write-Host "Creating app user 'rmt'..."
& $psql -U postgres -h localhost -c "CREATE USER rmt WITH PASSWORD 'rmt';"

Write-Host "Creating database 'rmt_kna'..."
& $psql -U postgres -h localhost -c "CREATE DATABASE rmt_kna OWNER rmt;"

Write-Host "Restoring secure authentication (scram-sha-256, ASCII, no BOM)..."
sc.exe stop $serviceName | Out-Null
Wait-ServiceState -TargetState "STOPPED" -TimeoutSeconds 30 | Out-Null
[System.IO.File]::WriteAllText($hbaPath, $cleanSecure, [System.Text.Encoding]::ASCII)

Write-Host "Starting PostgreSQL (secure mode)..."
sc.exe start $serviceName | Out-Null
Wait-ServiceState -TargetState "RUNNING" -TimeoutSeconds 60 | Out-Null

Write-Host ""
Write-Host "Done. Database 'rmt_kna' and user 'rmt' (password 'rmt') are ready." -ForegroundColor Green

Stop-Transcript | Out-Null
