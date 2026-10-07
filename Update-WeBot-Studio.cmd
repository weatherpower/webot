@echo off
setlocal EnableExtensions
title WeatherPower - WeBot Studio Updater
echo.
echo ========================================
echo   WeBot Studio Updater
echo ========================================
echo.
echo Self-contained updater - no extra download required.
echo This window will stay open when it finishes.
echo.

set "TMPPS=%TEMP%\WeBot-Studio-Updater-%RANDOM%%RANDOM%.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%~f0'; $x=Get-Content -LiteralPath $p; $m=[Array]::IndexOf($x,'__WEBOT_POWERSHELL__'); if($m -lt 0){exit 9}; $x[($m+1)..($x.Length-1)] | Set-Content -LiteralPath '%TMPPS%' -Encoding UTF8"
if errorlevel 1 (
  echo ERROR: Could not unpack the built-in updater.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%TMPPS%"
set "CODE=%ERRORLEVEL%"
del /q "%TMPPS%" >nul 2>nul

echo.
echo ----------------------------------------
if "%CODE%"=="0" (
  echo Updater finished successfully.
) else (
  echo Updater stopped with code %CODE%.
  echo Check your Desktop for WeBot-Studio-Update.log.
)
echo ----------------------------------------
echo.
pause
exit /b %CODE%

__WEBOT_POWERSHELL__
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$desktop = [Environment]::GetFolderPath('Desktop')
$logFile = Join-Path $desktop 'WeBot-Studio-Update.log'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Log([string]$Text = '') {
    Write-Host $Text
    try { Add-Content -LiteralPath $logFile -Value $Text -Encoding UTF8 } catch {}
}

function Git {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
    $output = & git @Args 2>&1
    $code = $LASTEXITCODE
    foreach ($line in $output) { Log ([string]$line) }
    if ($code -ne 0) { throw "git $($Args -join ' ') failed with exit code $code" }
    return @($output)
}

function Is-StudioRoot([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return (Test-Path -LiteralPath (Join-Path $Path 'studio\server.js')) -and
           (Test-Path -LiteralPath (Join-Path $Path '.git'))
}

function Find-StudioRoot {
    $scriptDir = Split-Path -Parent $PSCommandPath
    if (Is-StudioRoot $scriptDir) { Log 'Found Studio beside the updater.'; return $scriptDir }

    Log 'Looking for a running WeBot Studio...'
    try {
        $cfg = Invoke-RestMethod -Uri 'http://127.0.0.1:7777/api/config' -TimeoutSec 3
        if ($cfg.projectRoot -and (Is-StudioRoot ([string]$cfg.projectRoot))) {
            Log 'Found Studio from the running app.'
            return [string]$cfg.projectRoot
        }
    } catch {
        Log "Running Studio did not answer: $($_.Exception.Message)"
    }

    Log 'Searching common folders...'
    $roots = @(
        (Join-Path $env:USERPROFILE 'Documents'),
        (Join-Path $env:USERPROFILE 'Desktop'),
        (Join-Path $env:USERPROFILE 'Downloads'),
        (Join-Path $env:USERPROFILE 'source\repos'),
        (Join-Path $env:USERPROFILE 'Documents\GitHub'),
        'C:\WeatherPower',
        'D:\WeatherPower'
    ) | Select-Object -Unique

    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        if (Is-StudioRoot $root) { return $root }
        try {
            Get-ChildItem -LiteralPath $root -Directory -Filter studio -Recurse -Depth 6 -ErrorAction SilentlyContinue | ForEach-Object {
                $candidate = $_.Parent.FullName
                if (Is-StudioRoot $candidate) { throw [System.Management.Automation.StopUpstreamCommandsException]::new($candidate) }
            }
        } catch [System.Management.Automation.StopUpstreamCommandsException] {
            return $_.Exception.Message
        } catch {}
    }

    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Select the WeatherPower webot folder (contains studio and .git)'
    $picker.ShowNewFolderButton = $false
    if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK -and (Is-StudioRoot $picker.SelectedPath)) {
        return $picker.SelectedPath
    }
    throw 'Could not find the WeatherPower webot project.'
}

try {
    Set-Content -LiteralPath $logFile -Value "WeBot Studio updater started $(Get-Date -Format s)" -Encoding UTF8
    Log '========================================'
    Log '  WeBot Studio Updater'
    Log '========================================'
    Log ''

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Git is not installed or is not available on PATH.'
    }

    $root = Find-StudioRoot
    Log ''
    Log "Studio project: $root"
    Set-Location -LiteralPath $root

    $origin = (& git remote get-url origin 2>$null | Select-Object -First 1)
    if (-not $origin -or $origin -notmatch 'weatherpower/webot') {
        throw "This folder is not connected to weatherpower/webot. Origin: $origin"
    }

    $branch = (& git branch --show-current 2>$null).Trim()
    $before = (& git rev-parse --short HEAD 2>$null).Trim()
    Log "Current branch: $branch"
    Log "Current commit: $before"

    # Preserve any uncommitted work instead of refusing to update.
    $dirty = @(& git status --porcelain 2>$null)
    $stashMade = $false
    if ($dirty.Count -gt 0) {
        Log ''
        Log 'Local uncommitted changes found.'
        Log 'Saving them safely in a Git stash before updating...'
        Git stash push -u -m "WeBot Studio updater backup $stamp" | Out-Null
        $stashMade = $true
        Log 'Local edits saved in Git stash.'
    }

    Log ''
    Log 'Fetching the latest WeatherPower webot master...'
    Git fetch origin master --prune | Out-Null

    # Preserve the current committed state whenever it is not exactly origin/master.
    $headFull = (& git rev-parse HEAD 2>$null).Trim()
    $remoteFull = (& git rev-parse origin/master 2>$null).Trim()
    $backupBranch = $null
    if ($headFull -ne $remoteFull) {
        $backupBranch = "studio-local-backup-$stamp"
        Git branch $backupBranch HEAD | Out-Null
        Log "Committed local state preserved as branch: $backupBranch"
    }

    # Put the working checkout on master, then make master exactly match GitHub.
    $masterExists = (& git show-ref --verify --quiet refs/heads/master; $LASTEXITCODE) -eq 0
    if ($branch -ne 'master') {
        if ($masterExists) { Git checkout master | Out-Null }
        else { Git checkout -b master origin/master | Out-Null }
    }

    Git reset --hard origin/master | Out-Null

    $after = (& git rev-parse --short HEAD 2>$null).Trim()
    Log ''
    Log "UPDATED: $before -> $after"
    if ($backupBranch) { Log "Safety branch: $backupBranch" }
    if ($stashMade) {
        Log 'Your uncommitted edits are saved in Git stash and were NOT reapplied automatically.'
        Log 'They can be recovered later from the backup/stash if needed.'
    }
    Log ''
    Log 'Close WeBot Studio completely and reopen it.'
    Log 'Then refresh the Studio page.'
    Log 'The new Emergency now and Update Studio controls should be available.'
    Log ''
    Log "Full log: $logFile"
    exit 0
}
catch {
    Log ''
    Log "ERROR: $($_.Exception.Message)"
    Log 'The updater stopped.'
    Log "Full log: $logFile"
    exit 1
}
