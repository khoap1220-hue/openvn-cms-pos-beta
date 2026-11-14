param(
    [switch]$Production,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$CmsPort = if ($env:PORT) { [int]$env:PORT } else { 3010 }
$RealtimePort = if ($env:REALTIME_PORT) { [int]$env:REALTIME_PORT } else { 3013 }
$ShopeePort = if ($env:SHOPEE_SYNC_PORT) { [int]$env:SHOPEE_SYNC_PORT } else { 51898 }
$DbFilePath = (Join-Path $PSScriptRoot "db/custom.db") -replace '\\', '/'

$env:HOSTNAME = "0.0.0.0"
$env:PORT = "$CmsPort"
$env:OPENVN_PROJECT_ROOT = "$PSScriptRoot"
$env:NODE_PATH = (Join-Path $PSScriptRoot "node_modules")
$env:REALTIME_PORT = "$RealtimePort"
$env:REALTIME_URL = "http://localhost:$RealtimePort"
$env:NEXT_PUBLIC_REALTIME_PORT = "$RealtimePort"
$EnvFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $EnvFile) {
    $DbUrlLine = Get-Content $EnvFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if ($DbUrlLine) {
        $env:DATABASE_URL = ($DbUrlLine -replace '^DATABASE_URL=', '').Trim('"').Trim("'")
    }
}
if (-not $env:DATABASE_URL) {
    $env:DATABASE_URL = "file:$DbFilePath"
}

$ModeLabel = if ($Production) { "PRODUCTION STANDALONE" } else { "DEVELOPMENT" }

Write-Host "=====================================================" -ForegroundColor Green
Write-Host "   OMNISALES · UU DAM SUITE - HE THONG VAN HANH      " -ForegroundColor Green
Write-Host "   Che do: $ModeLabel | CMS :$CmsPort | Realtime :$RealtimePort | Shopee :$ShopeePort" -ForegroundColor Cyan
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
    Write-Host "[3/5] Dang khoi dong Realtime WebSocket Service (Port $RealtimePort)..." -ForegroundColor Cyan
    Start-Process -FilePath "node" -ArgumentList "--experimental-strip-types", "index.ts" -WorkingDirectory (Join-Path $PSScriptRoot "mini-services/realtime") -WindowStyle Hidden
    Start-Sleep -Seconds 1
} else {
    Write-Host "[3/5] Realtime WebSocket Service (Port $RealtimePort) da san sang." -ForegroundColor Green
}

# 4. Khoi dong Shopee Seller Sync Daemon (port 51898) neu chua chay
$spListen = Get-NetTCPConnection -LocalPort $ShopeePort -State Listen -ErrorAction SilentlyContinue
if (-not $spListen) {
    Write-Host "[4/5] Dang khoi dong Shopee Seller Sync Daemon (Port $ShopeePort)..." -ForegroundColor Cyan
    Start-Process -FilePath "python" -ArgumentList "scripts/shopee_seller_sync.py" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    Start-Sleep -Seconds 1
} else {
    Write-Host "[4/5] Shopee Seller Sync Daemon (Port $ShopeePort) da san sang." -ForegroundColor Green
}

# 5. Don dep tien trinh cu chiem cong CMS (chong xung dot split-brain IPv4/IPv6) va khoi dong Next.js CMS (port 3010)
$existingCmsPids = Get-NetTCPConnection -LocalPort $CmsPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
if ($existingCmsPids) {
    foreach ($oldPid in $existingCmsPids) {
        if ($oldPid -and $oldPid -ne $PID) {
            Write-Host "   • Giai phong tien trinh cu tren cong $CmsPort (PID $oldPid)..." -ForegroundColor Yellow
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 800
}

Write-Host "[5/5] Dang khoi dong OmniSales CMS tai http://localhost:$CmsPort ..." -ForegroundColor Green
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
    Write-Host "Dang dong bo Blue-Green Runtime (.runtime/standalone)..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path ".runtime/standalone" -Force | Out-Null
    & robocopy ".next/standalone" ".runtime/standalone" /MIR /XD db /MT:16 /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "Dong bo .runtime/standalone that bai (robocopy code $LASTEXITCODE)"
    }
    $global:LASTEXITCODE = 0
    $env:NODE_ENV = "production"
    node .runtime/standalone/server.js
} else {
    npm run dev
}
