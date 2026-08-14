# Geriye dönük sarmalayıcı — asıl launcher scripts/start-chrome-debug.mjs
param(
  [Alias("Profile")]
  [string]$ProfileId = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$launcher = Join-Path $ProjectRoot "scripts\start-chrome-debug.mjs"

$argList = @()
if ($ProfileId) {
  $argList += @("--profile", $ProfileId)
}
$argList += $args

& node $launcher @argList
exit $LASTEXITCODE
