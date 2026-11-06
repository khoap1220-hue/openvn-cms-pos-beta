param(
    [switch]$Production,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$CmsPort = if ($env:PORT) { [int]$env:PORT } else { 3010 }
$RealtimePort = if ($env:REALTIME_PORT) { [int]$env:REALTIME_PORT } else { 3013 }
$DbFilePath = (Join-Path $PSScriptRoot "db/custom.db") -replace '\\', '/'

$env:HOSTNAME = "0.0.0.0"
$env:PORT = "$CmsPort"
$env:REALTIME_PORT = "$RealtimePort"
$env:REALTIME_URL = "http://localhost:$RealtimePort"
$env:NEXT_PUBLIC_REALTIME_PORT = "$RealtimePort"
$env:DATABASE_URL = "file:$DbFilePath"

$ModeLabel = if ($Production) { "PRODUCTION STANDALONE" } else { "DEVELOPMENT" }

Write-Host "=====================================================" -ForegroundColor Green
Write-Host "   OMNISALES · UU DAM SUITE - HE THONG VAN HANH      " -ForegroundColor Green
Write-Host "   Che do: $ModeLabel | CMS :$CmsPort | Realtime :$RealtimePort" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Green

# 1. Kiem tra & cai dat dependencies neu chua co
if (-not (Test-Path "node_modules")) {
    Write-Host "[1/4] Dang cai dat thu vien chinh (npm install)..." -ForegroundColor Cyan
    npm install --legacy-peer-deps
}

if (-not (Test-Path "mini-services/realtime/node_modules")) {
    Write-Host "[2/4] Dang cai dat thu vien Realtime Service..." -ForegroundColor Cyan
    Push-Location "mini-services/realtime"
    npm install
    Pop-Location
}

# 2. Dam bao Prisma Client da duoc sinh
if (-not (Test-Path "node_modules/.prisma/client")) {
    Write-Host "[2/4] Dang sinh Prisma Client..." -ForegroundColor Cyan
    npx prisma generate
}

# 3. Khoi dong Realtime Socket.io Service (port 3013) neu chua chay
$rtListen = Get-NetTCPConnection -LocalPort $RealtimePort -State Listen -ErrorAction SilentlyContinue
if (-not $rtListen) {
    Write-Host "[3/4] Dang khoi dong Realtime WebSocket Service (Port $RealtimePort)..." -ForegroundColor Cyan
    Start-Process -FilePath "node" -ArgumentList "--experimental-strip-types", "index.ts" -WorkingDirectory (Join-Path $PSScriptRoot "mini-services/realtime") -WindowStyle Hidden
    Start-Sleep -Seconds 1
} else {
    Write-Host "[3/4] Realtime WebSocket Service (Port $RealtimePort) da san sang." -ForegroundColor Green
}

# 4. Khoi dong Next.js CMS (port 3010)
Write-Host "[4/4] Dang khoi dong OmniSales CMS tai http://localhost:$CmsPort ..." -ForegroundColor Green
if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
        param($p)
        Start-Sleep -Seconds 4
        Start-Process "http://localhost:$p"
    } -ArgumentList $CmsPort | Out-Null
}

if ($Production) {
    if (-not (Test-Path ".next/standalone/server.js")) {
        Write-Host "Dang dong goi ban Production Standalone (npm run build)..." -ForegroundColor Cyan
        npm run build
    }
    $env:NODE_ENV = "production"
    node .next/standalone/server.js
} else {
    npm run dev
}
