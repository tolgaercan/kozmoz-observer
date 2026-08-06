# Kozmoz API Observer — tek giriş noktası (panel)
# Kullanım: npm start   veya   .\scripts\start-panel.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "Kozmoz API Observer paneli hazirlaniyor..." -ForegroundColor Cyan

if (-not (Test-Path "node_modules")) {
  Write-Host "npm install..." -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "npm run build..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$port = if ($env:CONTROL_PANEL_PORT) { $env:CONTROL_PANEL_PORT } else { "8787" }
$url = "http://127.0.0.1:$port"

if ($env:CONTROL_PANEL_OPEN_BROWSER -ne "false") {
  Write-Host "Panel aciliyor: $url" -ForegroundColor Green
  Start-Process $url
}

$env:CONTROL_PANEL_OPEN_BROWSER = "false"

Write-Host "Panel sunucusu baslatiliyor (Ctrl+C ile durdurun)..." -ForegroundColor Green
npm run panel
