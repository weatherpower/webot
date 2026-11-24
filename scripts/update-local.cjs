const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const run = (cmd, args, capture = false) => {
  const result = spawnSync(cmd, args, {
    cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || (capture && result.stderr?.trim()) || cmd + ' failed (' + result.status + ')');
  }
  return capture ? result.stdout.trim() : '';
};
const git = (...args) => run('git', args, true);
const npm = (command) => process.platform === 'win32'
  ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command])
  : run('sh', ['-c', command.replaceAll('.cmd', '')]);
try {
  if (git('rev-parse', '--is-inside-work-tree') !== 'true') throw new Error('Not a Git checkout.');
  const origin = git('remote', 'get-url', 'origin');
  if (!['https://github.com/weatherpower/webot.git', 'https://github.com/weatherpower/webot', 'git@github.com:weatherpower/webot.git'].includes(origin)) {
    throw new Error('Unexpected origin. No changes made.');
  }
  const branch = git('branch', '--show-current');
  if (!branch) throw new Error('Detached HEAD. Switch to your tracked branch first.');
  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
  if (upstream !== 'origin/' + branch) throw new Error('Expected this branch to track origin/' + branch);
  if (git('status', '--porcelain')) throw new Error('Local changes or untracked files exist. Commit or back them up before updating. No files reset.');
  const before = git('rev-parse', 'HEAD');
  console.log('Current: ' + before.slice(0, 12) + ' (' + branch + ')');
  run('git', ['fetch', 'origin']);
  const remote = git('rev-parse', upstream);
  run('git', ['merge-base', '--is-ancestor', before, remote]);
  run('git', ['merge', '--ff-only', upstream]);
  const after = git('rev-parse', 'HEAD');
  const stamp = path.join(root, 'node_modules', '.webot-dependencies');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).update(process.version).digest('hex');
  let installed = '';
  try { installed = fs.readFileSync(stamp, 'utf8'); } catch {}
  if (installed !== hash || !fs.existsSync(path.join(root, 'node_modules', 'playwright'))) {
    npm('npm.cmd ci');
    npm('npx.cmd playwright install chromium');
    fs.writeFileSync(stamp, hash);
  } else {
    npm('npx.cmd playwright install chromium');
  }
  console.log('Ready: ' + after.slice(0, 12) + (before === after ? ' (already current)' : ' (updated)'));
  console.log('Local .env, data and cards were not deliberately changed. Start the server manually when ready.');
} catch (error) {
  console.error('Update stopped: ' + error.message);
  console.error('No hard reset or automatic stash was used. If dependency setup failed, rerun this updater after resolving the error.');
  process.exitCode = 1;
}
