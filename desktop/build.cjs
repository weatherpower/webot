// Installs WeBot Studio and WeatherPower Stream House as Windows programs:
//   %LOCALAPPDATA%\Programs\WeatherPower\WeBot Studio.exe
//   %LOCALAPPDATA%\Programs\WeatherPower\WeatherPower Stream House.exe
// plus desktop and Start menu shortcuts. Run it again after updating Electron (npm run build).
// The programs load their code from this project folder, so code changes don't need a rebuild.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(__dirname, 'node_modules', 'electron', 'dist');
const OUT = process.env.WP_INSTALL_DIR || path.join(process.env.LOCALAPPDATA, 'Programs', 'WeatherPower');
const VERSION = require('./package.json').version;
const PROGRAMS = [
  { exe: 'WeBot Studio.exe', icon: path.join(ROOT, 'studio', 'webot-studio.ico'), desc: 'WeBot Studio' },
  { exe: 'WeatherPower Stream House.exe', icon: path.join(ROOT, 'house', 'stream-house.ico'), desc: 'WeatherPower Stream House' }
];

(async () => {
  if (!fs.existsSync(path.join(DIST, 'electron.exe'))) throw new Error('Electron is missing: run "npm install" in ' + __dirname);
  const { rcedit } = await import('rcedit');
  console.log('Installing to', OUT);
  fs.mkdirSync(OUT, { recursive: true });
  // The Electron runtime (skip the stock exe and the demo app).
  fs.cpSync(DIST, OUT, { recursive: true, force: true, filter: (src) => !/[\\/](electron\.exe|default_app\.asar)$/i.test(src) });
  // resources/app just points at this project (desktop/main.cjs does the real work).
  const appDir = path.join(OUT, 'resources', 'app');
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'weatherpower-desktop', version: VERSION, main: 'main.cjs' }, null, 2));
  fs.writeFileSync(path.join(appDir, 'main.cjs'), `// Loads the WeatherPower desktop programs from the project folder.\nrequire(${JSON.stringify(path.join(__dirname, 'main.cjs'))});\n`);
  for (const p of PROGRAMS) {
    const exe = path.join(OUT, p.exe);
    fs.copyFileSync(path.join(DIST, 'electron.exe'), exe);
    await rcedit(exe, {
      icon: p.icon,
      'file-version': VERSION, 'product-version': VERSION,
      'version-string': { FileDescription: p.desc, ProductName: p.desc, CompanyName: 'WeatherPower', OriginalFilename: p.exe, InternalName: p.desc, LegalCopyright: 'WeatherPower' }
    });
    // Each program adds its own desktop + Start menu shortcut.
    execFileSync(exe, ['--install'], { stdio: 'inherit', timeout: 60000 });
    console.log('  ✓', p.exe);
  }
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
