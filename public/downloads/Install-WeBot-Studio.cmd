@echo off
setlocal
title WeBot Studio Installer
set "WBSTUDIO_INSTALLER=%~f0"
echo.
echo  WeatherPower - WeBot Studio Installer
echo  -----------------------------------
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$lines=Get-Content -LiteralPath $env:WBSTUDIO_INSTALLER;$i=[Array]::IndexOf([string[]]$lines,'::POWERSHELL');if($i -lt 0){throw 'Installer payload missing'};$payload=($lines[($i+1)..($lines.Length-1)] -join [Environment]::NewLine);& ([ScriptBlock]::Create($payload))"
set "EC=%ERRORLEVEL%"
echo.
if not "%EC%"=="0" (
  echo Installation stopped with an error.
  echo Nothing in an existing WeBot Studio folder was force-deleted.
  pause
  exit /b %EC%
)
echo WeBot Studio is ready.
timeout /t 3 /nobreak >nul
exit /b 0

::POWERSHELL
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = @($machine, $user) -join ';'
}

function Ensure-Command([string]$Command, [string]$WingetId, [string]$Label) {
  if (Get-Command $Command -ErrorAction SilentlyContinue) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "$Label is required, but Windows Package Manager (winget) is not available. Install App Installer from Microsoft Store, then run this installer again."
  }
  Write-Host ""
  Write-Host "Installing $Label..." -ForegroundColor Cyan
  & winget install --id $WingetId --exact --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE -ne 0) { throw "$Label installation failed with code $LASTEXITCODE." }
  Refresh-Path
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "$Label installed, but Windows has not added it to PATH yet. Restart Windows and run this installer again."
  }
}

Write-Host "Checking Windows tools..." -ForegroundColor Cyan
Ensure-Command 'git' 'Git.Git' 'Git'
Ensure-Command 'gh' 'GitHub.cli' 'GitHub CLI'
Ensure-Command 'node' 'OpenJS.NodeJS.LTS' 'Node.js LTS'
Refresh-Path

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm was not found after installing Node.js. Restart Windows and run this installer again.'
}

Write-Host ""
Write-Host "Checking GitHub access..." -ForegroundColor Cyan
& gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "A browser will open so you can sign in to the WeatherPower GitHub account." -ForegroundColor Yellow
  & gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { throw 'GitHub sign-in was not completed.' }
}
& gh repo view weatherpower/webot --json name *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'This GitHub account cannot access the private weatherpower/webot repository.'
}

$root = Join-Path $env:LOCALAPPDATA 'WeatherPower'
$installDir = Join-Path $root 'WeBot Studio'
$studioDir = Join-Path $installDir 'studio'
New-Item -ItemType Directory -Force -Path $root | Out-Null

if (Test-Path (Join-Path $installDir '.git')) {
  Write-Host ""
  Write-Host "Existing WeBot Studio install found. Updating it safely..." -ForegroundColor Cyan
  Push-Location $installDir
  try {
    $origin = (& git remote get-url origin 2>$null).Trim()
    if ($origin -notmatch 'weatherpower/webot') {
      throw "The existing folder is a different Git repository: $origin"
    }
    & git status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the existing Git checkout.' }
    & git fetch origin master
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the latest Studio build.' }
    & git checkout master
    if ($LASTEXITCODE -ne 0) { throw 'Could not switch the Studio checkout to master.' }
    & git pull --ff-only origin master
    if ($LASTEXITCODE -ne 0) {
      throw 'The existing Studio checkout has local/diverged changes. It was left untouched; update it manually instead of overwriting those changes.'
    }
  } finally {
    Pop-Location
  }
} else {
  if (Test-Path $installDir) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$installDir-backup-$stamp"
    Write-Host "Moving the existing non-Git folder to $backup" -ForegroundColor Yellow
    Move-Item -LiteralPath $installDir -Destination $backup
  }
  Write-Host ""
  Write-Host "Downloading the private WeBot Studio build..." -ForegroundColor Cyan
  & gh repo clone weatherpower/webot "$installDir" -- --branch master --single-branch
  if ($LASTEXITCODE -ne 0) { throw 'Could not clone weatherpower/webot.' }
}

Write-Host ""
Write-Host "Installing the lightweight Studio runtime..." -ForegroundColor Cyan
& npm --prefix "$studioDir" install --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Studio runtime installation failed.' }

$launcher = Join-Path $studioDir 'WeBot Studio.cmd'
if (-not (Test-Path $launcher)) { throw 'The WeBot Studio launcher is missing from the downloaded build.' }

Write-Host ""
Write-Host "Creating shortcuts..." -ForegroundColor Cyan
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$desktopLink = Join-Path $desktop 'WeBot Studio.lnk'
$shortcut = $shell.CreateShortcut($desktopLink)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $studioDir
$shortcut.Description = 'WeatherPower WeBot Studio'
$shortcut.Save()

$startDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\WeatherPower'
New-Item -ItemType Directory -Force -Path $startDir | Out-Null
$startLink = Join-Path $startDir 'WeBot Studio.lnk'
$shortcut2 = $shell.CreateShortcut($startLink)
$shortcut2.TargetPath = $launcher
$shortcut2.WorkingDirectory = $studioDir
$shortcut2.Description = 'WeatherPower WeBot Studio'
$shortcut2.Save()

Write-Host ""
Write-Host "Installed to:" -ForegroundColor Green
Write-Host "  $installDir"
Write-Host ""
Write-Host "Launching WeBot Studio..." -ForegroundColor Green
Start-Process -FilePath $launcher -WorkingDirectory $studioDir
