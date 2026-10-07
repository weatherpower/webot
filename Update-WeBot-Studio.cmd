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
$gitExe = (Get-Command git.exe -ErrorAction Stop).Source

function Log([string]$Text = '') {
    Write-Host $Text
    try {
        Add-Content -LiteralPath $logFile -Value $Text -Encoding UTF8
    } catch {}
}

function RunGit([string[]]$Args) {
    $output = & $gitExe @Args 2>&1
    $code = $LASTEXITCODE
    foreach ($line in $output) {
        Log ([string]$line)
    }
    if ($code -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $code"
    }
    return @($output)
}

function IsStudioRoot([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }

    $serverFile = Join-Path $Path 'studio\server.js'
    $gitDir = Join-Path $Path '.git'
    return (Test-Path -LiteralPath $serverFile) -and (Test-Path -LiteralPath $gitDir)
}

function FindStudioRoot {
    $scriptDir = Split-Path -Parent $PSCommandPath

    if (IsStudioRoot $scriptDir) {
        Log 'Found Studio beside the updater.'
        return $scriptDir
    }

    Log 'Looking for a running WeBot Studio...'
    try {
        $cfg = Invoke-RestMethod -Uri 'http://127.0.0.1:7777/api/config' -TimeoutSec 3
        if ($cfg.projectRoot) {
            $candidate = [string]$cfg.projectRoot
            if (IsStudioRoot $candidate) {
                Log 'Found Studio from the running app.'
                return $candidate
            }
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
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }

        if (IsStudioRoot $root) {
            return $root
        }

        try {
            $studioDirs = Get-ChildItem -LiteralPath $root -Directory -Filter 'studio' -Recurse -Depth 6 -ErrorAction SilentlyContinue
            foreach ($studioDir in $studioDirs) {
                $candidate = $studioDir.Parent.FullName
                if (IsStudioRoot $candidate) {
                    Log 'Found Studio by folder search.'
                    return $candidate
                }
            }
        } catch {}
    }

    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Select the WeatherPower webot folder (the folder containing studio and .git)'
    $picker.ShowNewFolderButton = $false

    if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        if (IsStudioRoot $picker.SelectedPath) {
            return $picker.SelectedPath
        }
    }

    throw 'Could not find the WeatherPower webot project.'
}

try {
    Set-Content -LiteralPath $logFile -Value "WeBot Studio updater started $(Get-Date -Format s)" -Encoding UTF8

    Log '========================================'
    Log '  WeBot Studio Updater'
    Log '========================================'
    Log ''

    $root = FindStudioRoot
    Log ''
    Log "Studio project: $root"

    Set-Location -LiteralPath $root

    $origin = (& $gitExe remote get-url origin 2>$null | Select-Object -First 1)
    if (-not $origin) {
        throw 'This project has no Git origin remote.'
    }

    if ($origin -notmatch 'weatherpower/webot') {
        throw "This folder is not connected to weatherpower/webot. Origin: $origin"
    }

    $branch = (& $gitExe branch --show-current 2>$null).Trim()
    $before = (& $gitExe rev-parse --short HEAD 2>$null).Trim()

    Log "Current branch: $branch"
    Log "Current commit: $before"

    $statusLines = @(& $gitExe status --porcelain 2>$null)
    $stashMade = $false

    if ($statusLines.Count -gt 0) {
        Log ''
        Log 'Local uncommitted changes found.'
        Log 'Saving them safely in Git stash before updating...'
        RunGit @('stash','push','-u','-m',"WeBot Studio updater backup $stamp") | Out-Null
        $stashMade = $true
        Log 'Local edits saved in Git stash.'
    }

    Log ''
    Log 'Fetching latest origin/master...'
    RunGit @('fetch','origin','master','--prune') | Out-Null

    $headFull = (& $gitExe rev-parse HEAD 2>$null).Trim()
    $remoteFull = (& $gitExe rev-parse origin/master 2>$null).Trim()
    $backupBranch = $null

    if ($headFull -ne $remoteFull) {
        $backupBranch = "studio-local-backup-$stamp"
        RunGit @('branch',$backupBranch,'HEAD') | Out-Null
        Log "Committed local state preserved as branch: $backupBranch"
    }

    $masterExists = $false
    & $gitExe show-ref --verify --quiet refs/heads/master
    if ($LASTEXITCODE -eq 0) {
        $masterExists = $true
    }

    if ($branch -ne 'master') {
        if ($masterExists) {
            RunGit @('checkout','master') | Out-Null
        } else {
            RunGit @('checkout','-b','master','origin/master') | Out-Null
        }
    }

    RunGit @('reset','--hard','origin/master') | Out-Null

    $after = (& $gitExe rev-parse --short HEAD 2>$null).Trim()

    Log ''
    Log "UPDATED: $before -> $after"

    if ($backupBranch) {
        Log "Safety branch: $backupBranch"
    }

    if ($stashMade) {
        Log 'Your uncommitted edits are saved in Git stash and were NOT reapplied automatically.'
    }

    Log ''
    Log 'Close WeBot Studio completely and reopen it.'
    Log 'Then refresh the Studio page.'
    Log 'You should now have Emergency now and Update Studio.'
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
