# Moving WeatherPower from Windows to macOS

Two halves: the Claude side (this folder does it) and the Codex side (Codex imports its own services).

## 1. On Windows, before wiping anything

```powershell
pwsh -ExecutionPolicy Bypass -File macos\Backup-For-Mac.ps1
```

Copies everything to `D:\Mac-Move\<date>` on the recordings drive (exFAT, macOS reads it). Install macOS
on the **M.2 only**; the recordings drive stays as it is. Wait for "Server login key: copied ✓" and
"Everything copied ✓" first. Then put a second copy somewhere else (USB stick or cloud) too.

Important: the Gilham overpass project (`Documents\Codex\2026-06-06-build-me-a-ardot-gilham-overpass`)
has **no git commits**. The backup is its only copy.

Sign-in files (`.codex/auth.json`, `.claude/.credentials.json`) are left behind on purpose. You sign in
to Codex and Claude again on the Mac.

## 2. On the Mac (Claude side)

```bash
bash "/Volumes/Railfan Cam/Mac-Move/<date>/Documents/Codex/2026-06-24/mka/outputs/warning-card-service-v3/macos/setup-mac.sh"
```

What it does:

- installs Homebrew, node, python 3.12, ffmpeg and git
- restores the ssh key (the Contabo server login) and the project folders
- updates the webot repo and installs its packages
- installs the Level 2 radar worker as a launchd agent, `com.weatherpower.radar-l2`, which starts with the Mac
- makes the apps in `~/Applications`: WeBot Studio, WeatherPower Stream House, WeBot (Jarvis) and Phone Keyboard

| Windows | macOS |
|---|---|
| `desktop/launch_signed.pyw studio\|house\|jarvis` | `macos/launch.sh studio\|house\|jarvis` (Chrome/Edge app window) |
| Startup shortcut "WeatherPower Level 2 radar" (`radar-l2/run.cmd`) | launchd `com.weatherpower.radar-l2` |
| WeBot Studio radar Start/Stop (PowerShell) | the same buttons, using `launchctl` |
| `PhoneKeyboard.exe` / `phone_keyboard.py` (SendInput) | `phone_keyboard_mac.py` (pynput). Needs Accessibility permission. Ctrl+C on the phone becomes Cmd+C. |
| Jarvis Claude Code `%APPDATA%\Claude\claude-code\...\claude.exe` | `~/Library/Application Support/Claude/claude-code/.../claude` or `~/.local/bin/claude` |
| `scripts/youtube-auth.mjs` opens the browser with rundll32 | `open` |

Not needed on the Mac: the stream, the Shorts, WeBot's chat and the daily title/thumbnail all run on the
Contabo server.

## 3. Codex side (for Codex to import)

These ran as Windows Task Scheduler jobs under `\WeatherPower\`. Their XML is in `<backup>/scheduled-tasks/`,
and their config is `<backup>/LocalAppData-WeatherPower/WeatherPowerWindows.json`:

Camera Wall, Dev Center, Discord Bot, Duskline, Health Monitor, Jarvis LAN, Jarvis Stack, Local Directory
(port 80), Newsletter, Railfan Access, Recorder - Gilham, Recorder - I30 MM12, School Brief Manager,
Traffic Dashboard, Warning Card Service, WeAlerts Dashboard, WeAlerts Runner, WeBot Briefing (Morning,
Evening, Midnight), WeBot Controller, WeBot Local. Plus Ollama at login.

The original macOS LaunchAgents from before the Windows move are in the Gilham project's `launchd/` folder,
and Codex's earlier migration notes are in its `tools/windows-migration/`. On macOS, port 80 needs root.
Run the Local Directory on 8080, or put it behind `pf`.
