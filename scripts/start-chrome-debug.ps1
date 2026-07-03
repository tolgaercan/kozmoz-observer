# Chrome'u CDP debug modunda başlatır (Observer bağlanmadan önce çalıştırın)
$ErrorActionPreference = "Stop"

# .env oku (varsa)
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $key = $matches[1].Trim()
      $val = $matches[2].Trim()
      if (-not [string]::IsNullOrWhiteSpace($key) -and -not (Get-Item "Env:$key" -ErrorAction SilentlyContinue)) {
        Set-Item -Path "Env:$key" -Value $val
      }
    }
  }
}

$chromeExe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$userDataDir = if ($env:FIXED_BROWSER_USER_DATA_DIR) { $env:FIXED_BROWSER_USER_DATA_DIR.Trim() } else { "$env:LOCALAPPDATA\Google\Chrome\User Data" }
$profileDir = if ($env:CHROME_PROFILE_DIRECTORY) { $env:CHROME_PROFILE_DIRECTORY.Trim() } else { "Default" }
$port = if ($env:CDP_PORT) { $env:CDP_PORT.Trim() } else { "9222" }

if (-not (Test-Path $chromeExe)) {
  Write-Error "Chrome bulunamadi: $chromeExe"
}

Write-Host "Mevcut Chrome surecleri kapatiliyor..."
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

Write-Host "Chrome CDP modunda baslatiliyor..."
Write-Host "  Port   : $port"
Write-Host "  Profil : $profileDir"
Write-Host "  UserData: $userDataDir"

$chromeArgs = @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$port",
  "--user-data-dir=$userDataDir",
  "--profile-directory=$profileDir",
  "about:blank"
)

Start-Process -FilePath $chromeExe -ArgumentList $chromeArgs | Out-Null

$endpoint = "http://127.0.0.1:$port/json/version"
Write-Host "CDP endpoint bekleniyor: $endpoint"

$ready = $false
for ($i = 1; $i -le 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    Write-Host "  Deneme $i/15..."
  }
}

if (-not $ready) {
  Write-Host ""
  Write-Host "HATA: CDP portu acilmadi ($port)." -ForegroundColor Red
  Write-Host "Chrome'u elle su komutla dene:" -ForegroundColor Yellow
  Write-Host "  `"$chromeExe`" --remote-debugging-port=$port --user-data-dir=`"$userDataDir`" --profile-directory=$profileDir"
  exit 1
}

Write-Host ""
Write-Host "CDP hazir!" -ForegroundColor Green
Write-Host "Simdi siteye manuel gir, sonra baska terminalde:"
Write-Host "  npm run observer -- --profile profile-1 --pause"
Write-Host ""
