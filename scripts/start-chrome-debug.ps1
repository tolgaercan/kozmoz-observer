# Chrome'u CDP debug modunda baslatir - manifest'teki izole profil klasorunu kullanir
param(
  [Alias("Profile")]
  [string]$ProfileId = $(if ($env:DEFAULT_PROFILE_ID) { $env:DEFAULT_PROFILE_ID.Trim() } else { "profile-1" })
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent

# .env oku (varsa)
$envFile = Join-Path $ProjectRoot ".env"
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

$manifestPath = Join-Path $ProjectRoot "data\profiles\manifest.json"
if (-not (Test-Path $manifestPath)) {
  Write-Error "Manifest bulunamadi: $manifestPath"
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$profileDef = $manifest.profiles | Where-Object { $_.id -eq $ProfileId } | Select-Object -First 1

if (-not $profileDef) {
  Write-Error "Profil bulunamadi: $ProfileId"
}

$userDataRelative = if ($profileDef.browser.userDataDir) { $profileDef.browser.userDataDir } else { $profileDef.userDataDir }
$userDataDir = Join-Path $ProjectRoot ($userDataRelative -replace '/', '\')
$port = if ($profileDef.browser.cdpPort) { $profileDef.browser.cdpPort } else { if ($env:CDP_PORT) { $env:CDP_PORT.Trim() } else { "9222" } }

$chromeExe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromeExe)) {
  Write-Error "Chrome bulunamadi: $chromeExe"
}

if (-not (Test-Path $userDataDir)) {
  New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null
  Write-Host "Yeni izole profil klasoru olusturuldu: $userDataDir"
}

function Set-ChromeCleanExitState {
  param([string]$UserDataDir)

  $defaultDir = Join-Path $UserDataDir "Default"
  $prefsPath = Join-Path $defaultDir "Preferences"
  if (-not (Test-Path $prefsPath)) {
    return
  }

  $content = [System.IO.File]::ReadAllText($prefsPath)
  $content = $content -replace '"exit_type"\s*:\s*"Crashed"', '"exit_type":"Normal"'
  $content = $content -replace '"exited_cleanly"\s*:\s*false', '"exited_cleanly":true'
  [System.IO.File]::WriteAllText($prefsPath, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Chrome cikis durumu temizlendi."
}

Write-Host "Mevcut Chrome surecleri kapatiliyor..."
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$freshProfile = $true
if ($env:CHROME_FRESH_PROFILE -eq "false") {
  $freshProfile = $false
}

if ($freshProfile) {
  if (Test-Path $userDataDir) {
    Remove-Item -Recurse -Force $userDataDir
    Write-Host "Temiz Chrome profili: eski klasor silindi."
  }
  New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null
  Write-Host "Yeni bos Chrome profil klasoru olusturuldu."
} else {
  Set-ChromeCleanExitState -UserDataDir $userDataDir
}

Start-Sleep -Seconds 1

Write-Host "Chrome CDP (izole profil) baslatiliyor..."
Write-Host "  Profil ID : $ProfileId"
Write-Host "  Port      : $port"
Write-Host "  UserData  : $userDataDir"
Write-Host ""
Write-Host "NOT: Izole Chrome profili - Google girisi observer ile yapilacak."

$chromeArgs = @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$port",
  "--user-data-dir=$userDataDir",
  "--disable-infobars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-session-crashed-bubble",
  "--auto-accept-browser-signin-for-tests",
  "https://www.google.com/"
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
  exit 1
}

Write-Host ""
Write-Host "CDP hazir!" -ForegroundColor Green
Write-Host "Sonraki terminal:"
Write-Host ('  npm run observer -- --profile {0} --pause' -f $ProfileId)
Write-Host "  (sadece Google girisi: --phase chrome-profile --pause)"
Write-Host ""
