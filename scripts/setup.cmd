@echo off
setlocal
cd /d "%~dp0\.."

where node >nul 2>&1
if %ERRORLEVEL%==0 goto run_bootstrap

echo [setup] Node.js bulunamadi.
where winget >nul 2>&1
if %ERRORLEVEL%==0 (
  echo [setup] winget ile Node.js LTS kuruluyor...
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
) else (
  echo [setup] Node.js 18+ kurun: https://nodejs.org
  exit /b 1
)

where node >nul 2>&1
if not %ERRORLEVEL%==0 (
  echo [setup] Node hâlâ yok. Kuruluysa yeni bir terminal açın.
  exit /b 1
)

:run_bootstrap
echo [setup] Node:
node -v
node scripts\bootstrap.mjs %*
exit /b %ERRORLEVEL%
