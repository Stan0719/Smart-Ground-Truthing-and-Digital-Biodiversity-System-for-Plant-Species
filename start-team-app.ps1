$ErrorActionPreference = "Stop"
$project = $PSScriptRoot

Set-Location $project

Write-Host "=== Smart Ground Truthing: Team Startup ===" -ForegroundColor Cyan

# 1. Check required folders
if (!(Test-Path "$project\web\package.json") -or
    !(Test-Path "$project\mobileapp\package.json")) {
    throw "Save this script in the project root containing web and mobileapp."
}

# 2. Start authentication backend if needed
Write-Host "`n[1/5] Checking authentication backend..."

$authRunning = $false

try {
    $health = Invoke-RestMethod "http://127.0.0.1:3001/auth-health" -TimeoutSec 5
    $authRunning = ($health.ready -eq $true)
} catch {}

if (-not $authRunning) {
    Write-Host "Starting website and authentication backend..."

    Start-Process powershell.exe -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location '$project\web'; npm.cmd run dev"
    )

    Start-Sleep -Seconds 5
}

try {
    $health = Invoke-RestMethod "http://127.0.0.1:3001/auth-health" -TimeoutSec 5
    Write-Host "Authentication API ready: $($health.ready)"
    Write-Host "Account adapter: $($health.accountAdapter)"
} catch {
    throw "Authentication backend did not start. Check its terminal."
}

if ($health.accountAdapter -ne $true) {
    Write-Warning "Account adapter is unavailable. Real Botanist login may fail."
}

# 3. Check API gateway
Write-Host "`n[2/5] Checking API gateway..."

$gateway = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue

if (-not $gateway) {
    Write-Warning "API gateway is not running on port 8080."
    Write-Warning "Its startup command must be identified from the project."
    Write-Warning "Start the gateway, then rerun this script."
    exit 1
}

Write-Host "Gateway port 8080 is listening."

# 4. Check or start Cloudflare Tunnel
Write-Host "`n[3/5] Checking Cloudflare Tunnel..."

$ready = $null

try {
    $ready = Invoke-RestMethod "http://127.0.0.1:20242/ready" -TimeoutSec 5
} catch {}

if (-not $ready -or $ready.readyConnections -lt 1) {

    $metricsPort = Get-NetTCPConnection -LocalPort 20242 -State Listen -ErrorAction SilentlyContinue

    if ($metricsPort) {
        throw "Port 20242 is occupied by a disconnected tunnel. Stop the old cloudflared process first."
    }

    $cloudflared = Join-Path $project ".local-tools\cloudflared\cloudflared.exe"

    if (!(Test-Path $cloudflared)) {
        throw "cloudflared.exe not found. Check the project's .local-tools folder."
    }

    Write-Host "Starting a new Cloudflare Tunnel..."

    Start-Process powershell.exe -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location '$project'; & '$cloudflared' tunnel --url http://127.0.0.1:8080 --metrics 127.0.0.1:20242"
    )
}

# Wait for tunnel to connect
$connected = $false

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2

    try {
        $ready = Invoke-RestMethod "http://127.0.0.1:20242/ready" -TimeoutSec 3

        if ($ready.readyConnections -gt 0) {
            $connected = $true
            break
        }
    } catch {}
}

if (-not $connected) {
    throw "Cloudflare Tunnel did not connect. Check its terminal."
}

$hostname = (Invoke-RestMethod "http://127.0.0.1:20242/quicktunnel").hostname
$baseUrl = "https://$hostname"

Write-Host "Cloudflare URL: $baseUrl" -ForegroundColor Green

# 5. Verify public authentication endpoint
Write-Host "`n[4/5] Checking public authentication API..."

try {
    $publicHealth = Invoke-RestMethod "$baseUrl/auth-health" -TimeoutSec 15

    if ($publicHealth.ready -ne $true) {
        throw "Public authentication API is not ready."
    }

    Write-Host "Public authentication API is reachable."
    Write-Host "Account adapter: $($publicHealth.accountAdapter)"
} catch {
    throw "Public authentication health check failed. Check the gateway routing and Cloudflare terminal."
}

# 6. Update mobile environment
Write-Host "`n[5/5] Configuring mobile Expo..."

$envFile = Join-Path $project "mobileapp\.env.local"

if (!(Test-Path $envFile)) {
    throw "mobileapp/.env.local is missing. Create it from the project's environment example first."
}

$content = Get-Content $envFile -Raw

$settings = [ordered]@{
    EXPO_PUBLIC_API_ENV = "development"
    EXPO_PUBLIC_AUTH_API_URL = "$baseUrl/api/mobile"
    EXPO_PUBLIC_AUTH_API_URL_DEVELOPMENT = "$baseUrl/api/mobile"
    EXPO_PUBLIC_FACE_API_URL = "$baseUrl/face"
    EXPO_PUBLIC_FACE_API_URL_DEVELOPMENT = "$baseUrl/face"
}

foreach ($key in $settings.Keys) {
    $line = "$key=$($settings[$key])"
    $pattern = "(?m)^" + [regex]::Escape($key) + "=.*$"

    if ([regex]::IsMatch($content, $pattern)) {
        $content = [regex]::Replace($content, $pattern, $line)
    } else {
        $content = $content.TrimEnd() + "`r`n" + $line + "`r`n"
    }
}

Set-Content -Path $envFile -Value $content

Write-Host "Mobile environment updated."
Write-Host "Authentication: $baseUrl/api/mobile"
Write-Host "Face API: $baseUrl/face"

# 7. Start Expo
Write-Host "`nStarting Expo..." -ForegroundColor Green

Set-Location (Join-Path $project "mobileapp")

npm.cmd start -- --clear