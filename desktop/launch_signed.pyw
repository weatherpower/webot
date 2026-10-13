"""Starts WeBot Studio (or Stream House) using only Windows-trusted, signed programs.

Smart App Control blocks the unsigned "WeBot Studio.exe" / Electron build, so this launcher (run by the
signed pythonw.exe, no console window) starts the app's server with the signed node.exe, opens it in its
own Microsoft Edge app window (no tabs or address bar), and stops the server when that window closes.
Usage: pythonw launch_signed.pyw studio|house|jarvis
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPS = {
    'studio': {'name': 'WeBot Studio', 'port': 7777, 'server': os.path.join('studio', 'server.js'), 'size': '1560,980'},
    'house': {'name': 'WeatherPower Stream House', 'port': 7788, 'server': os.path.join('house', 'server.js'), 'size': '1680,1000'},
    # WeBot as your Jarvis: one small window, listens to you, thinks with your Claude Code, talks with Puter.
    'jarvis': {'name': 'WeBot', 'port': 7790, 'server': os.path.join('jarvis', 'server.cjs'), 'size': '470,720'},
}
WHICH = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in APPS else 'studio'
A = APPS[WHICH]
URL = f"http://127.0.0.1:{A['port']}/"
DATA = os.path.join(os.environ.get('LOCALAPPDATA', ROOT), 'WeatherPower', 'signed-launcher')
os.makedirs(DATA, exist_ok=True)
LOG = os.path.join(DATA, f'{WHICH}.log')
NO_WINDOW = 0x08000000


def port_open():
    with socket.socket() as s:
        s.settimeout(0.8)
        return s.connect_ex(('127.0.0.1', A['port'])) == 0


def answering():
    try:
        return urllib.request.urlopen(URL, timeout=4).status < 500
    except Exception:
        return False


def find(names):
    for n in names:
        p = shutil.which(n) if not os.path.isabs(n) else (n if os.path.exists(n) else None)
        if p:
            return p
    return None


node = find(['node', r'C:\Program Files\nodejs\node.exe'])
edge = find([r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe', 'msedge'])

server = None
if not port_open():
    log = open(LOG, 'a', encoding='utf-8')
    log.write(f'\n--- {time.ctime()} starting {A["server"]}\n')
    log.flush()
    server = subprocess.Popen([node, A['server']], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, creationflags=NO_WINDOW)
    for _ in range(60):
        if port_open() and answering():
            break
        if server.poll() is not None:
            break
        time.sleep(0.5)

# Its own Edge profile: a separate taskbar window that behaves like a program, and closing it ends this launcher.
profile = os.path.join(DATA, f'edge-{WHICH}')
w, h = A['size'].split(',')
win = subprocess.Popen([edge, f'--app={URL}', f'--user-data-dir={profile}', f'--window-size={w},{h}', '--no-first-run',
                        '--no-default-browser-check', '--disable-features=Translate'])
# Edge may hand the window to a process that was already running for this profile and exit at once, so watch for
# ANY Edge process using this app's profile, and stop the server only after none are left for ~10 seconds.
def window_alive():
    r = subprocess.run(['powershell', '-NoProfile', '-Command',
                        f"(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object {{ $_.CommandLine -like '*{profile}*' }}).Count"],
                       stdout=subprocess.PIPE, text=True, creationflags=NO_WINDOW)
    return (r.stdout.strip() or '0') != '0'


win.wait()
gone = 0
while gone < 3:
    time.sleep(3)
    gone = 0 if window_alive() else gone + 1
if server and server.poll() is None:
    server.terminate()
