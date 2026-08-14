# Geriye dönük sarmalayıcı — asıl giriş: npm start → scripts/bootstrap.mjs --start
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
& node (Join-Path $ProjectRoot "scripts\bootstrap.mjs") --start @args
exit $LASTEXITCODE
