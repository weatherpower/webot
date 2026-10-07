$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$desktop = [Environment]::GetFolderPath('Desktop')
$logFile = Join-Path $desktop 'WeBot-Studio-Update.log'

function Log([string]$Text = '') {
    $line = $Text
    Write-Host $line
    try { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 } catch {}
}

function Run-Git {
    param(
        [Parameter(Mandatory=$true)][string[]]$Args,
        [switch]$AllowFailure
    )
    $output = & git @Args 2>&1
    $code = $LASTEXITCODE
    foreach ($line in $output) { Log ([string]$line) }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "git $($Args -join ' ') failed with exit code $code"
    }
    return @{ Code = $code; Output = @($output) }
}

function Is-StudioRoot([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return (Test-Path -LiteralPath (Join-Path $Path 'studio\server.js')) -and
           (Test-Path -LiteralPath (Join-Path $Path '.git'))
}

function Find-StudioRoot {
    $scriptDir = Split-Path -Parent $PSCommandPath
    if (Is-StudioRoot $scriptDir) {
        Log "Found by updater folder."
        return $scriptDir
    }

    Log 'Looking for a running WeBot Studio at http://127.0.0.1:7777 ...'
    try {
        $cfg = Invoke-RestMethod -Uri 'http://127.0.0.1:7777/api/config' -TimeoutSec 3
        if ($cfg.projectRoot -and (Is-StudioRoot ([string]$cfg.projectRoot))) {
            Log 'Found by running WeBot Studio.'
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
            $candidates = Get-ChildItem -LiteralPath $root -Directory -Filter 'studio' -Recurse -Depth 6 -ErrorAction SilentlyContinue
            foreach ($studioDir in $candidates) {
                $candidate = $studioDir.Parent.FullName
                if (Is-StudioRoot $candidate) {
                    Log "Found by folder search."
                    return $candidate
                }
            }
        } catch {}
    }

    Log 'Automatic search did not find the project. Opening a folder picker...'
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Select the WeatherPower webot folder (the folder containing studio and .git)'
    $picker.ShowNewFolderButton = $false
    if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        if (Is-StudioRoot $picker.SelectedPath) { return $picker.SelectedPath }
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

    $dirty = (& git status --porcelain --untracked-files=no 2>$null)
    if ($dirty) {
        Log ''
        Log 'STOPPED: local tracked files have uncommitted changes.'
        Log 'Nothing was overwritten.'
        Log 'Use Studio -> Save version, or undo those edits, then run the updater again.'
        exit 2
    }

    $branch = (& git branch --show-current 2>$null).Trim()
    $before = (& git rev-parse --short HEAD 2>$null).Trim()
    Log "Current branch: $branch"
    Log "Current commit: $before"
    Log ''
    Log 'Fetching origin/master...'
    Run-Git @('fetch','origin','master','--prune') | Out-Null

    $remote = (& git rev-parse --short origin/master 2>$null).Trim()
    Log "GitHub master: $remote"

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

    if ($branch -ne 'master') {
        $backup = "studio-local-backup-$stamp"
        Log "You are on '$branch'. Preserving HEAD as '$backup' before switching to master."
        Run-Git @('branch',$backup,'HEAD') | Out-Null
        $masterExists = (& git show-ref --verify --quiet refs/heads/master; $LASTEXITCODE) -eq 0
        if ($masterExists) {
            Run-Git @('checkout','master') | Out-Null
        } else {
            Run-Git @('checkout','-b','master','origin/master') | Out-Null
        }
    }

    $counts = (& git rev-list --left-right --count HEAD...origin/master 2>$null).Trim() -split '\s+'
    $ahead = if ($counts.Count -ge 1) { [int]$counts[0] } else { 0 }
    $behind = if ($counts.Count -ge 2) { [int]$counts[1] } else { 0 }

    if ($ahead -gt 0) {
        $backup = "studio-master-backup-$stamp"
        Log ''
        Log "Local master has $ahead commit(s) not on GitHub."
        Log "Creating safety branch: $backup"
        Run-Git @('branch',$backup,'HEAD') | Out-Null
        Log 'Safety copy created. Updating local master to origin/master...'
        Run-Git @('reset','--hard','origin/master') | Out-Null
    } elseif ($behind -gt 0) {
        Log "Fast-forwarding by $behind commit(s)..."
        Run-Git @('merge','--ff-only','origin/master') | Out-Null
    } else {
        Log 'Studio is already at the latest GitHub master.'
    }

    $after = (& git rev-parse --short HEAD 2>$null).Trim()
    Log ''
    Log "UPDATED: $before -> $after"
    Log ''
    Log 'Close WeBot Studio completely, reopen it, then refresh the Studio page.'
    Log 'You should then see the new Studio controls, including Emergency now and Update Studio.'
    Log ''
    Log "A full log was saved to: $logFile"
    exit 0
}
catch {
    Log ''
    Log "ERROR: $($_.Exception.Message)"
    Log 'Nothing else will be changed.'
    Log "Log file: $logFile"
    exit 1
}
