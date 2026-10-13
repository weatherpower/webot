# Copies everything WeatherPower needs off the Windows drive (C:) before it's wiped for macOS, onto the
# recordings drive (D:, which macOS can read). Run it on Windows, right before installing macOS:
#     pwsh -ExecutionPolicy Bypass -File Backup-For-Mac.ps1            (or right-click > Run with PowerShell)
# It only copies; it never deletes or moves anything. Then on the Mac: bash setup-mac.sh
param([string]$Dest = 'D:\Mac-Move')

$ErrorActionPreference = 'Stop'
$u = $env:USERPROFILE
$root = Join-Path $Dest (Get-Date -Format 'yyyy-MM-dd')
New-Item -ItemType Directory -Force $root | Out-Null
$log = Join-Path $root 'backup-log.txt'

# What to copy (source -> folder inside the backup). Rebuildable stuff (node_modules, Python venvs, caches,
# browser profiles) is skipped: setup-mac.sh reinstalls it.
$items = @(
  @{ Src = "$u\.ssh";                       Dst = 'ssh' },                       # the Contabo server login: most important
  @{ Src = "$u\Documents\Codex";            Dst = 'Documents\Codex' },           # every project (incl. the Gilham overpass one, not in git!)
  @{ Src = "$u\my-agent";                   Dst = 'my-agent' },                  # Jarvis LAN / backtalk
  @{ Src = "$u\Documents\PhoneKeyboard";    Dst = 'Documents\PhoneKeyboard' },
  @{ Src = "$u\Documents\WeatherPower-Stream"; Dst = 'Documents\WeatherPower-Stream' },  # thumbnails + YouTube client file
  @{ Src = "$env:APPDATA\PhoneKeyboard";    Dst = 'AppData-PhoneKeyboard' },     # the phone's secret code
  @{ Src = "$env:LOCALAPPDATA\WeatherPower"; Dst = 'LocalAppData-WeatherPower' }, # Codex service configs (WeatherPowerWindows.json)
  @{ Src = "$u\.claude";                    Dst = 'claude' },                    # Claude Code memory + settings
  @{ Src = "$u\.codex";                     Dst = 'codex' },                     # Codex config + sessions
  @{ Src = "$u\Desktop";                    Dst = 'Desktop' },
  @{ Src = "$u\Downloads";                  Dst = 'Downloads' },
  @{ Src = "$u\Pictures";                   Dst = 'Pictures' }
)
$skipDirs = @('node_modules', '.venv', '.venv-windows', 'venv', '__pycache__', '.pytest_cache', 'edge-studio', 'edge-house', 'edge-jarvis', 'Cache', 'Code Cache', 'GPUCache')
# Sign-in files stay behind: you sign in to Codex and Claude again on the Mac (same rule as Codex's own migration).
$skipFiles = @('auth.json', '.credentials.json')

# Room check first.
$need = 0
foreach ($i in $items) { if (Test-Path $i.Src) { $need += (Get-ChildItem $i.Src -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum } }
$free = (Get-PSDrive ($Dest.Substring(0, 1))).Free
'Need about {0:N1} GB, {1} has {2:N1} GB free.' -f ($need / 1GB), $Dest.Substring(0, 2), ($free / 1GB) | Tee-Object -FilePath $log
if ($need -gt $free * 0.95) { throw 'Not enough room on the backup drive. Free some space or pass -Dest E:\Somewhere.' }

$failed = @()
foreach ($i in $items) {
  if (-not (Test-Path $i.Src)) { "skip (missing): $($i.Src)" | Tee-Object -FilePath $log -Append; continue }
  $to = Join-Path $root $i.Dst
  "copying $($i.Src) -> $to" | Tee-Object -FilePath $log -Append
  robocopy $i.Src $to /E /COPY:DT /DCOPY:T /R:1 /W:1 /MT:8 /XJ /NFL /NDL /NP /XD @skipDirs /XF @skipFiles /LOG+:$log | Out-Null
  if ($LASTEXITCODE -ge 8) { $failed += $i.Src; "  !! some files failed (robocopy $LASTEXITCODE): see the log" | Tee-Object -FilePath $log -Append }
}

# The WeatherPower scheduled tasks (what ran in the background), for Codex's import on the Mac.
$tasks = Join-Path $root 'scheduled-tasks'
New-Item -ItemType Directory -Force $tasks | Out-Null
Get-ScheduledTask -TaskPath '\WeatherPower\' -ErrorAction SilentlyContinue | ForEach-Object {
  Export-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath | Out-File (Join-Path $tasks ($_.TaskName + '.xml')) -Encoding utf8
}
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -ErrorAction SilentlyContinue | Select-Object Name | Out-File (Join-Path $tasks 'startup-folder.txt')

# Check the one thing that can't be replaced: the server login key.
$keyOk = Test-Path (Join-Path $root 'ssh\id_ed25519')
''
'Backup folder: ' + $root
if ($keyOk) { 'Server login key: copied ✓' } else { '!! The server login key (id_ed25519) is NOT in the backup. Do not wipe Windows yet.' }
if ($failed.Count) { '!! Some folders had files that could not be copied (often open recordings). Check backup-log.txt, close those programs and run this again.' } else { 'Everything copied ✓' }
'Tip: copy this backup to a second place too (USB drive or cloud): the recordings drive is now the only copy.'
