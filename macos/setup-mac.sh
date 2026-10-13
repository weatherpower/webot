#!/bin/bash
# WeatherPower on macOS: run once after installing macOS (Terminal):
#     bash setup-mac.sh "/Volumes/Railfan Cam/Mac-Move/<date>"
# (the folder Backup-For-Mac.ps1 made on the recordings drive; left out, the newest one is found by itself).
#
# Sets up everything the Claude side of WeatherPower runs on this computer:
#   - Homebrew + node, python 3.12 (with Tk), ffmpeg, git
#   - your ssh key (the Contabo server login) and the project folders, copied back from the backup
#   - the webot repo (git pull + npm install)
#   - apps in ~/Applications: WeBot Studio, WeatherPower Stream House, WeBot (Jarvis), Phone Keyboard
#   - the Level 2 radar worker as a background service (launchd), like the Windows startup shortcut
# Codex's own services (recorders, Discord bot, dashboards, Jarvis LAN...) are Codex's import: see README-MAC.md.
set -euo pipefail

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }

# ---------- 0. find the backup ----------
BACKUP="${1:-}"
if [ -z "$BACKUP" ]; then
  BACKUP="$(ls -d /Volumes/*/Mac-Move/*/ 2>/dev/null | sort | tail -1 || true)"
  BACKUP="${BACKUP%/}"
fi
if [ -n "$BACKUP" ] && [ -d "$BACKUP" ]; then say "Using backup: $BACKUP"; else warn "No backup folder found: skipping the restore steps (ssh key, projects)."; BACKUP=""; fi

# ---------- 1. Homebrew and tools ----------
if ! command -v brew >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/brew ] && [ ! -x /usr/local/bin/brew ]; then
  say "Installing Homebrew (it asks for your Mac password)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
say "Installing node, python 3.12, ffmpeg, git"
brew install node python@3.12 python-tk@3.12 ffmpeg git
PY="$(brew --prefix python@3.12)/bin/python3.12"

# ---------- 2. restore the ssh key and the projects ----------
if [ -n "$BACKUP" ]; then
  if [ -f "$BACKUP/ssh/id_ed25519" ] && [ ! -f "$HOME/.ssh/id_ed25519" ]; then
    say "Restoring your ssh key (Contabo server login)"
    mkdir -p "$HOME/.ssh"
    cp "$BACKUP/ssh/id_ed25519" "$BACKUP/ssh/id_ed25519.pub" "$HOME/.ssh/"
    [ -f "$BACKUP/ssh/known_hosts" ] && cp "$BACKUP/ssh/known_hosts" "$HOME/.ssh/"
    chmod 700 "$HOME/.ssh"; chmod 600 "$HOME/.ssh/id_ed25519"; chmod 644 "$HOME/.ssh/id_ed25519.pub"
  fi
  say "Copying project folders back (this can take a while)"
  mkdir -p "$HOME/Documents"
  for pair in "Documents/Codex:Documents/Codex" "Documents/PhoneKeyboard:Documents/PhoneKeyboard" \
              "Documents/WeatherPower-Stream:Documents/WeatherPower-Stream" "my-agent:my-agent"; do
    src="$BACKUP/${pair%%:*}"; dst="$HOME/${pair##*:}"
    [ -d "$src" ] && rsync -a "$src/" "$dst/"
  done
  # Phone Keyboard's secret code, so the phone's old bookmark keeps working.
  if [ -f "$BACKUP/AppData-PhoneKeyboard/code.txt" ]; then
    mkdir -p "$HOME/Library/Application Support/PhoneKeyboard"
    cp "$BACKUP/AppData-PhoneKeyboard/code.txt" "$HOME/Library/Application Support/PhoneKeyboard/code.txt"
  fi
fi

say "Checking the server login"
if ssh -p 22022 -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new root@207.244.248.128 'echo ok' 2>/dev/null | grep -q ok; then
  echo "Contabo server: connected"
else
  warn "Couldn't reach the Contabo server with your key yet. WeBot Studio and the radar need it."
fi

# ---------- 3. the webot repo ----------
REPO="$HOME/Documents/Codex/2026-06-24/mka/outputs/warning-card-service-v3"
if [ ! -d "$REPO/.git" ]; then
  say "Cloning the webot repo"
  mkdir -p "$(dirname "$REPO")"
  git clone https://github.com/weatherpower/webot.git "$REPO"
fi
say "Updating the webot repo and installing its packages"
git -C "$REPO" pull --rebase || warn "git pull failed (local changes?). Continuing with what's there."
(cd "$REPO" && npm ci --no-audit --no-fund)

# ---------- 4. Python for the radar and Phone Keyboard ----------
VENV="$HOME/WeatherPower/venv"
if [ ! -x "$VENV/bin/python" ]; then
  say "Making the Python environment"
  mkdir -p "$HOME/WeatherPower"
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet metpy pillow numpy pynput qrcode

# ---------- 5. Level 2 radar worker (background service) ----------
say "Installing the Level 2 radar worker"
AGENTS="$HOME/Library/LaunchAgents"; mkdir -p "$AGENTS" "$REPO/radar-l2/out"
PLIST="$AGENTS/com.weatherpower.radar-l2.plist"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.weatherpower.radar-l2</string>
  <key>ProgramArguments</key><array>
    <string>$VENV/bin/python</string><string>radar_l2.py</string><string>--loop</string><string>--every</string><string>30</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO/radar-l2</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$REPO/radar-l2/out/launchd.log</string>
  <key>StandardErrorPath</key><string>$REPO/radar-l2/out/launchd.log</string>
</dict></plist>
PLISTEOF
launchctl bootout "gui/$(id -u)/com.weatherpower.radar-l2" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# ---------- 6. apps in ~/Applications ----------
say "Making the apps"
APPS="$HOME/Applications"; mkdir -p "$APPS"
ICON_PNG="$REPO/public/assets/webot.png"
make_app() { # name, shell command, icon png
  local name="$1" cmd="$2" png="$3" app="$APPS/$1.app"
  rm -rf "$app"
  osacompile -o "$app" -e "do shell script \"$cmd > /dev/null 2>&1 &\""
  if [ -f "$png" ]; then
    local tmp; tmp="$(mktemp -d)"
    sips -z 512 512 "$png" --out "$tmp/i.png" >/dev/null 2>&1 && sips -s format icns "$tmp/i.png" --out "$app/Contents/Resources/applet.icns" >/dev/null 2>&1 || true
    rm -rf "$tmp"
    touch "$app"
  fi
}
q() { printf "'%s'" "$1"; }
make_app "WeBot Studio" "bash $(q "$REPO/macos/launch.sh") studio" "$ICON_PNG"
make_app "WeatherPower Stream House" "bash $(q "$REPO/macos/launch.sh") house" "$REPO/public/assets/wp-logo.png"
make_app "WeBot" "bash $(q "$REPO/macos/launch.sh") jarvis" "$ICON_PNG"
if [ -f "$HOME/Documents/PhoneKeyboard/phone_keyboard_mac.py" ]; then
  make_app "Phone Keyboard" "$(q "$VENV/bin/python") $(q "$HOME/Documents/PhoneKeyboard/phone_keyboard_mac.py")" ""
fi

say "Done!"
cat <<'DONE'
In ~/Applications (drag them to the Dock): WeBot Studio, WeatherPower Stream House, WeBot, Phone Keyboard.
The Level 2 radar is running in the background and starts with the Mac.

Still to do by hand (one time each):
  1. Install Google Chrome (the app windows and WeBot's ears use it).
  2. Install the Claude app, open it once, then open WeBot and click the yellow bar to sign Claude Code in.
  3. Phone Keyboard: System Settings > Privacy & Security > Accessibility: allow Python
     (and Input Monitoring), then open Phone Keyboard again.
  4. WeBot's voice: click "sign in to Puter" in the WeBot window.
  5. Let Codex import its own services: see macos/README-MAC.md.
DONE
