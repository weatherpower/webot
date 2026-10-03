// WeatherPower desktop programs: WeBot Studio and WeatherPower Stream House as real Windows apps.
// One Electron shell runs both. Which one starts comes from the .exe name ("WeBot Studio.exe",
// "WeatherPower Stream House.exe") or --app=studio|house. The program starts that app's server inside
// itself (no console window) and shows it in its own window.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

/* ---------- which program, and where the project lives ---------- */
const exeName = path.basename(process.execPath).toLowerCase();
const argApp = (process.argv.find((a) => a.startsWith('--app=')) || '').slice(6);
const WHICH = argApp || (exeName.includes('house') ? 'house' : 'studio');
let ROOT = path.resolve(__dirname, '..');
try { ROOT = JSON.parse(fs.readFileSync(path.join(__dirname, 'project.json'), 'utf8')).root || ROOT; } catch {}

const APPS = {
  studio: { name: 'WeBot Studio', id: 'app.weatherpower.webot-studio', port: 7777, server: 'studio/server.js', icon: 'studio/webot-studio.ico', size: [1560, 980], bg: '#06090f', probe: '/' },
  house: { name: 'WeatherPower Stream House', id: 'app.weatherpower.stream-house', port: 7788, server: 'house/server.js', icon: 'house/stream-house.ico', size: [1680, 1000], bg: '#06090f', probe: '/api/map/style' }
};
const A = APPS[WHICH] || APPS.studio;
const ICON = path.join(ROOT, A.icon);
A.port = Number(process.env[WHICH === 'house' ? 'HOUSE_PORT' : 'STUDIO_PORT']) || A.port;
const BASE = `http://localhost:${A.port}`;

app.setName(A.name);
app.setPath('userData', path.join(app.getPath('appData'), 'WeatherPower', WHICH));
app.setAppUserModelId(A.id);

// Server and console output go to a log file (there's no console window).
const LOG = path.join(app.getPath('userData'), 'program.log');
try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2e6) fs.renameSync(LOG, LOG + '.old'); } catch {}
const logLine = (kind, args) => { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${kind} ${args.map((a) => (typeof a === 'string' ? a : a?.stack || JSON.stringify(a))).join(' ')}\n`); } catch {} };
for (const k of ['log', 'warn', 'error']) { const orig = console[k].bind(console); console[k] = (...a) => { logLine(k, a); orig(...a); }; }
process.on('uncaughtException', (e) => logLine('crash', [e]));
process.on('unhandledRejection', (e) => logLine('reject', [e]));

// "--install": put this program on the desktop and in the Start menu (the installer runs it), then quit.
// The shortcut carries the same app ID as the windows, so a pinned taskbar icon and the open program match.
if (process.argv.includes('--install')) {
  app.whenReady().then(() => {
    const link = { target: process.execPath, icon: process.execPath, iconIndex: 0, appUserModelId: A.id, description: A.name, cwd: path.dirname(process.execPath) };
    const menuDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'WeatherPower');
    fs.mkdirSync(menuDir, { recursive: true });
    const made = [path.join(app.getPath('desktop'), A.name + '.lnk'), path.join(menuDir, A.name + '.lnk')]
      .map((p) => (shell.writeShortcutLink(p, 'create', link) ? p : 'FAILED ' + p));
    fs.writeFileSync(path.join(app.getPath('userData'), 'install.txt'), made.join('\n'));
    app.exit(0);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  run();
}
function run() {

/* ---------- start the app's server inside this program ---------- */
const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
  s.setTimeout(800, () => { s.destroy(); resolve(false); });
});
const probe = async () => { try { return (await fetch(BASE + A.probe, { signal: AbortSignal.timeout(4000) })).ok; } catch { return false; } };
const startServer = async () => {
  if (await portOpen(A.port)) {
    // Something already has the port: an older copy started from the black-window launcher, most likely.
    if (await probe()) return 'attached';
    return 'busy';
  }
  process.chdir(ROOT);
  await import(pathToFileURL(path.join(ROOT, A.server)).href);
  for (let i = 0; i < 60; i++) { if (await portOpen(A.port)) return 'started'; await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('The server didn’t start on port ' + A.port);
};

/* ---------- windows ---------- */
let main = null;
const outputs = new Map();   // the stream map / overlay / program windows, one each
const isLocal = (u) => { try { const x = new URL(u); return ['localhost', '127.0.0.1'].includes(x.hostname) && Number(x.port) === A.port; } catch { return false; } };
const windowOptions = (extra = {}) => ({
  icon: ICON, backgroundColor: A.bg, autoHideMenuBar: true, show: false,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  ...extra
});
const OUTPUT_TITLES = { 'wp-stream-map': 'Stream Map', 'wp-overlay': 'Overlay', 'wp-program': 'Program' };
const wireWindow = (win) => {
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (!isLocal(url)) { shell.openExternal(url); return { action: 'deny' }; }
    const open = frameName && outputs.get(frameName);
    if (open && !open.isDestroyed()) { open.show(); open.focus(); return { action: 'deny' }; }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: windowOptions({ width: 1280, height: 742, backgroundColor: '#000000', title: (OUTPUT_TITLES[frameName] || A.name) + ' · ' + A.name })
    };
  });
  win.webContents.on('did-create-window', (child, { frameName }) => {
    if (frameName) outputs.set(frameName, child);
    child.setMenuBarVisibility(false);
    child.once('ready-to-show', () => child.show());
    child.webContents.setWindowOpenHandler(({ url }) => { if (!isLocal(url)) shell.openExternal(url); return { action: 'deny' }; });
    // Keep the title the program gave it (the page's own title is generic).
    child.on('page-title-updated', (e) => e.preventDefault());
    child.on('closed', () => { if (outputs.get(frameName) === child) outputs.delete(frameName); });
  });
  // Links to other websites open in your normal browser.
  win.webContents.on('will-navigate', (e, url) => { if (!isLocal(url)) { e.preventDefault(); shell.openExternal(url); } });
};

const menu = () => Menu.buildFromTemplate([
  { label: 'File', submenu: [{ label: 'Open program folder', click: () => shell.openPath(ROOT) }, { label: 'Open log', click: () => shell.openPath(LOG) }, { type: 'separator' }, { role: 'quit', label: 'Exit' }] },
  ...(WHICH === 'house' ? [{
    label: 'Outputs', submenu: [
      { label: 'Stream map', accelerator: 'F2', click: () => main?.webContents.executeJavaScript("openOut('map')") },
      { label: 'Overlay', accelerator: 'F3', click: () => main?.webContents.executeJavaScript("openOut('overlay')") },
      { label: 'Program (map + overlay)', accelerator: 'F4', click: () => main?.webContents.executeJavaScript("openOut('program')") }
    ]
  }] : []),
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] }
]);

const createMain = () => {
  main = new BrowserWindow(windowOptions({ width: A.size[0], height: A.size[1], minWidth: 1100, minHeight: 680, title: A.name }));
  wireWindow(main);
  main.on('page-title-updated', (e) => e.preventDefault());
  main.loadURL(BASE + '/');
  // Closing the main window closes the whole program (and its outputs).
  main.on('closed', () => { main = null; for (const w of outputs.values()) if (!w.isDestroyed()) w.destroy(); app.quit(); });
};

app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.show(); main.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  Menu.setApplicationMenu(menu());
  let how;
  try { how = await startServer(); } catch (e) {
    logLine('error', [e]);
    dialog.showErrorBox(A.name, 'It couldn’t start:\n\n' + (e?.message || e) + '\n\nDetails are in ' + LOG);
    app.quit();
    return;
  }
  if (how === 'busy') {
    dialog.showErrorBox(A.name, `Something else is using port ${A.port}: most likely an older ${A.name} still running in a black command window. Close that window, then start ${A.name} again.`);
    app.quit();
    return;
  }
  logLine('log', [A.name + ' ' + how + ' (' + BASE + ')']);
  createMain();
});
}
