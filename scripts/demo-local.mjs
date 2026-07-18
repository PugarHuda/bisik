// One-command local demo: boot a Canton sandbox, seed, and serve the desk.
//   node scripts/demo-local.mjs [--full]
// --full seeds an RFQ + two quotes; default seeds holdings only (drive live in UI).
// Ctrl+C tears everything down. Node stdlib only.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FULL = process.argv.includes('--full');
const CASES = process.argv.includes('--cases'); // rich seed: many settled trades + open RFQ/basket

// Locate the daml CLI and a JDK, tolerating a bare environment.
const damlCmd = process.env.DAML_CMD
  ?? (process.platform === 'win32' ? join(process.env.APPDATA ?? '', 'daml', 'bin', 'daml.cmd') : 'daml');
function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const bases = [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'temurin21'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Eclipse Adoptium'),
    join(process.env.ProgramFiles ?? '', 'Eclipse Adoptium'),
    join(process.env.ProgramFiles ?? '', 'Java'),
    join(process.env.ProgramFiles ?? '', 'Microsoft'),
    '/usr/lib/jvm', '/Library/Java/JavaVirtualMachines',
  ];
  for (const base of bases) {
    try {
      const jdk = readdirSync(base).find((d) => d.toLowerCase().includes('jdk') || d.startsWith('temurin'));
      if (jdk) return join(base, jdk);
    } catch {}
  }
  return undefined;
}
const javaHome = findJavaHome();
const env = { ...process.env };
if (javaHome) { env.JAVA_HOME = javaHome; env.PATH = join(javaHome, 'bin') + (process.platform === 'win32' ? ';' : ':') + env.PATH; }
// Fail fast if there is no JVM at all — the sandbox would otherwise die cryptically 1-2 min in.
if (!javaHome && spawnSync('java', ['-version']).error) {
  console.error('No JDK found. Install Java 21 (Eclipse Temurin) and set JAVA_HOME, then retry.');
  process.exit(1);
}

const kids = [];
const spawnKid = (label, cmd, args, opts = {}) => {
  const k = spawn(cmd, args, { env, cwd: ROOT, shell: process.platform === 'win32', ...opts });
  k.stdout?.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  k.stderr?.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  kids.push(k);
  return k;
};
const sh = (cmd, args) => new Promise((res, rej) => {
  const k = spawn(cmd, args, { env, cwd: ROOT, shell: process.platform === 'win32', stdio: 'inherit' });
  k.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
});
const shRetry = async (cmd, args, tries = 6) => {
  for (let i = 0; i < tries; i++) {
    try { return await sh(cmd, args); }
    catch (e) { if (i === tries - 1) throw e; console.log(`  retry (${i + 1}/${tries})…`); await sleep(4000); }
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('timeout');
};

// On Windows, k.kill() only signals the cmd.exe wrapper, leaving the JVM and web
// server orphaned on their ports. Kill the whole process tree.
function cleanup() {
  for (const k of kids) {
    try {
      if (process.platform === 'win32' && k.pid) spawnSync('taskkill', ['/PID', String(k.pid), '/T', '/F']);
      else k.kill();
    } catch {}
  }
}
process.on('SIGINT', () => { console.log('\nshutting down…'); cleanup(); process.exit(0); });
process.on('exit', cleanup);

(async () => {
  const portFile = join(tmpdir(), 'bisik-demo-json.port');
  try { rmSync(portFile, { force: true }); } catch {}

  console.log('· building…');
  await sh(damlCmd, ['build', '--all', '--no-legacy-assistant-warning']);

  console.log('· starting Canton sandbox (this takes ~1–2 min)…');
  spawnKid('sandbox', damlCmd, ['sandbox', '--port', '6865', '--json-api-port', '7575',
    '--dar', '.daml/dist/bisik-0.5.0.dar', '--json-api-port-file', portFile,
    '--no-legacy-assistant-warning']);
  await waitFor(() => existsSync(portFile));
  // JSON API port opens before the participant connects to the synchronizer;
  // wait until the ledger actually answers before seeding.
  await waitFor(async () => {
    try { return (await fetch('http://localhost:7575/v2/state/ledger-end')).ok; } catch { return false; }
  });
  console.log('· sandbox up (JSON API :7575)');

  const scriptName = CASES ? 'Init:richSeed' : FULL ? 'Init:initialize' : 'Init:holdingsOnly';
  console.log(`· seeding (${CASES ? 'rich: many settled trades + open RFQ/basket' : FULL ? 'full RFQ + quotes' : 'holdings only'})…`);
  await shRetry(damlCmd, ['script', '--dar', 'test/.daml/dist/bisik-test-0.1.0.dar',
    '--script-name', scriptName,
    '--ledger-host', 'localhost', '--ledger-port', '6865', '--no-legacy-assistant-warning']);

  console.log('· starting desk on http://localhost:8080');
  // shell:false — process.execPath can contain spaces (C:\Program Files\nodejs),
  // which a Windows shell would split; spawn the node binary directly.
  spawnKid('web', process.execPath, [join('web', 'server.mjs')],
    { shell: false, env: { ...env, PORT: '8080', LEDGER_JSON_URL: 'http://localhost:7575', LEDGER_USER_ID: 'participant_admin' } });

  console.log('\n✓ open http://localhost:8080   (Ctrl+C to stop)\n');
})().catch((e) => { console.error('demo failed:', e.message); cleanup(); process.exit(1); });
