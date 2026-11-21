#!/usr/bin/env node
/**
 * 发版门禁：一条命令把「能不能发」在这台机器上全部验一遍。
 *
 *   node scripts/release-gate.mjs           # 全查
 *   node scripts/release-gate.mjs --quick   # 跳过冷装（省时间，只看得出版本/清单/语法/git）
 *
 * 检查项（任一硬项失败 → 退出码 1）：
 *   1 语法      node --check lib/*.js + 每个 helper/*.py 过 ast.parse
 *   2 自检      tests/preflight.mjs
 *   3 单测      hud-stage / segment-rules / sense-window
 *   4 打包清单  npm pack --dry-run：该在的都在，不该发的别发
 *   5 冷装      真 pack 一次、装进临时目录、从 node_modules 里 import 一遍
 *   6 版本一致  package.json / README / 市场说明 三处对得上，且比 registry 上的新
 *   7 运行时哈希 仓库文件 vs 正在跑的插件目录（不一致只报警，不拦）
 *   8 git       工作区干净、在 master、提交里没有漏掉的东西
 *
 * 只读仓库与系统状态：不 push、不改版本号、不动正在跑的插件目录。
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUICK = process.argv.includes('--quick');
const LIVE = 'C:\\Users\\yan\\.dsh\\plugins\\dsh-whale-glance';

const rows = [];
const add = (level, name, detail) => rows.push({ level, name, detail });
const pass = (name, detail = '') => add('PASS', name, detail);
const warn = (name, detail = '') => add('WARN', name, detail);
const fail = (name, detail = '') => add('FAIL', name, detail);

function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: opts.cwd || ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout ?? 180000,
      shell: process.platform === 'win32' && !path.isAbsolute(cmd),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    return { ok: true, out: String(out || '').trim() };
  } catch (err) {
    return {
      ok: false,
      out: String((err.stdout || '') + (err.stderr || '')).trim(),
      code: err.status ?? -1,
    };
  }
}

function findPython() {
  const candidates = [
    process.env.YG_PYTHON,
    'C:\\Users\\yan\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'python';
}
const PY = findPython();

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = String(pkg.version || '');

// ---- 1 语法 ----
for (const rel of ['lib/index.js', 'lib/client.js', 'lib/segment-rules.js']) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { fail('语法', `缺文件 ${rel}`); continue; }
  const r = run(process.execPath, ['--check', abs]);
  r.ok ? pass('语法', rel) : fail('语法', `${rel}：${r.out.split('\n')[0]}`);
}
const helperDir = path.join(ROOT, 'helper');
const pyFiles = fs.readdirSync(helperDir).filter((f) => f.endsWith('.py'));
for (const f of pyFiles) {
  const r = run(PY, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1],encoding="utf-8").read())', path.join(helperDir, f)]);
  r.ok ? pass('语法', `helper/${f}`) : fail('语法', `helper/${f}：${r.out.split('\n').slice(-1)[0]}`);
}

// ---- 2 自检 ----
{
  const r = run(process.execPath, ['tests/preflight.mjs']);
  r.ok ? pass('自检', r.out.split('\n').slice(-1)[0] || 'preflight 通过') : fail('自检', r.out.split('\n').slice(-3).join(' | '));
}

// ---- 3 单测 ----
for (const [label, args] of [
  ['hud-stage-test', ['tests/hud-stage-test.mjs']],
  ['segment-rules-test', ['tests/segment-rules-test.mjs']],
]) {
  const r = run(process.execPath, args);
  const line = r.out.split('\n').find((l) => l.includes('通过')) || r.out.split('\n').slice(-1)[0];
  r.ok ? pass('单测', `${label}：${line}`) : fail('单测', `${label}：${line}`);
}
{
  const r = run(PY, ['tests/sense-window-test.py']);
  const line = r.out.split('\n').find((l) => l.includes('通过')) || r.out.split('\n').slice(-1)[0];
  r.ok ? pass('单测', `sense-window-test：${line}`) : fail('单测', `sense-window-test：${line}`);
}

// ---- 4 打包清单 ----
let packInfo = null;
{
  const r = run('npm', ['pack', '--dry-run', '--json', '--silent']);
  if (!r.ok) {
    fail('打包清单', r.out.split('\n').slice(-2).join(' | '));
  } else {
    try {
      const data = JSON.parse(r.out.slice(r.out.indexOf('[')));
      packInfo = data[0];
      const files = (packInfo.files || []).map((f) => f.path);
      const must = ['lib/index.js', 'lib/client.js', 'lib/segment-rules.js', 'helper/sense.py', 'helper/hud_window.py',
        'helper/danmaku.py', 'helper/play_mci.ps1', 'helper/games-all.json', 'cordis.patch.yml',
        'README.md', 'LICENSE', 'LICENSE-APACHE', 'NOTICE', 'CREDITS.md'];
      const missing = must.filter((m) => !files.includes(m));
      const forbidden = files.filter((f) => /^(tests|submission|docs|scripts|\.tmp)\//.test(f)
        || /LOCAL-NOTES|\.log$|\.tgz$|\.env/.test(f));
      if (missing.length) fail('打包清单', `缺 ${missing.join(', ')}`);
      else if (forbidden.length) fail('打包清单', `不该发：${forbidden.join(', ')}`);
      else pass('打包清单', `${files.length} 个文件，${(packInfo.size / 1024).toFixed(0)} KB`);
      if (packInfo.entryCount !== files.length) warn('打包清单', 'entryCount 与 files 数量不一致');
    } catch (err) {
      fail('打包清单', `解析 npm pack --json 失败：${String(err.message).slice(0, 80)}`);
    }
  }
}

// ---- 5 冷装 ----
if (QUICK) {
  warn('冷装', '--quick 跳过');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yg-gate-'));
  try {
    const pr = run('npm', ['pack', '--json', '--silent', '--pack-destination', tmp]);
    if (!pr.ok) {
      fail('冷装', `pack 失败：${pr.out.split('\n').slice(-2).join(' | ')}`);
    } else {
      const tgzName = JSON.parse(pr.out.slice(pr.out.indexOf('[')))[0].filename;
      const tgz = path.join(tmp, tgzName);
      const proj = path.join(tmp, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'yg-gate-probe', private: true, type: 'module' }));
      const ir = run('npm', ['install', tgz, '--no-audit', '--no-fund', '--no-save', '--offline', '--silent'], { cwd: proj });
      const installed = path.join(proj, 'node_modules', pkg.name);
      if (!ir.ok) fail('冷装', `install 失败：${ir.out.split('\n').slice(-2).join(' | ')}`);
      else if (!fs.existsSync(installed)) fail('冷装', `装完找不到 ${pkg.name}`);
      else {
        const checks = ['package.json', 'lib/index.js', 'lib/segment-rules.js', 'helper/sense.py',
          'LICENSE', 'LICENSE-APACHE', 'NOTICE', 'CREDITS.md', 'cordis.patch.yml'];
        const missing = checks.filter((f) => !fs.existsSync(path.join(installed, f)));
        const installedPkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
        const entryUrl = pathToFileURL(path.join(installed, 'lib/index.js')).href;
        const probe = run(process.execPath, ['-e',
          `import(${JSON.stringify(entryUrl)}).then(m=>{` +
          'if(typeof m.apply!=="function")throw new Error("导出里没有 apply");console.log("apply ok")})' +
          `.catch(e=>{console.error(String(e).slice(0,200));process.exit(1)})`]);
        if (missing.length) fail('冷装', `包里缺 ${missing.join(', ')}`);
        else if (installedPkg.version !== version) fail('冷装', `装出来是 ${installedPkg.version}，仓库是 ${version}`);
        else if (!probe.ok) fail('冷装', `import 失败：${probe.out.split('\n').slice(-1)[0]}`);
        else pass('冷装', `${tgzName} 装好，版本与导出都对（${probe.out}）`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- 6 版本一致 + registry ----
{
  const problems = [];
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const m = readme.match(/当前版本\s*v?([\d.]+)/);
  if (!m) problems.push('README 找不到「当前版本 vX.Y.Z」');
  else if (m[1] !== version) problems.push(`README 写 ${m[1]}，package.json 是 ${version}`);
  const sub = path.join(ROOT, 'submission');
  if (fs.existsSync(sub)) {
    const notes = fs.readdirSync(sub).filter((f) => f.startsWith('市场说明'));
    if (notes.length) {
      const newest = notes.sort().slice(-1)[0];
      const nm = newest.match(/(\d+\.\d+\.\d+)/);
      if (nm && nm[1] !== version) problems.push(`submission/${newest} 是 ${nm[1]}，与 package.json 不符`);
    }
  }
  problems.length ? fail('版本一致', problems.join('；')) : pass('版本一致', `package.json / README / 市场说明 都是 ${version}`);

  for (const registry of ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/']) {
    const r = run('npm', ['view', pkg.name, 'version', '--registry', registry]);
    const latest = (r.out || '').split('\n').filter(Boolean).slice(-1)[0] || '';
    if (!r.ok) { warn('registry', `${registry} 查不到：${r.out.split('\n')[0].slice(0, 60)}`); continue; }
    const cmp = compareVersion(version, latest);
    if (cmp > 0) pass('registry', `${registry.replace('https://', '')} 线上 ${latest}，本地 ${version}（可发）`);
    else fail('registry', `${registry.replace('https://', '')} 线上已是 ${latest}，本地 ${version} 没升版本`);
  }
}

function compareVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// ---- 7 运行时哈希（不一致只报警：仓库改完本来就要手动拷过去重启才生效）----
{
  if (!fs.existsSync(LIVE)) warn('运行时哈希', `没找到运行目录 ${LIVE}`);
  else {
    const tracked = (pkg.files || []).filter((f) => fs.existsSync(path.join(ROOT, f)));
    const diff = [];
    for (const rel of tracked) {
      const a = fs.readFileSync(path.join(ROOT, rel));
      const livePath = path.join(LIVE, rel);
      if (!fs.existsSync(livePath)) { diff.push(`${rel}（运行目录没有）`); continue; }
      const b = fs.readFileSync(livePath);
      if (sha(a) !== sha(b)) diff.push(rel);
    }
    if (diff.length) warn('运行时哈希', `仓库与正在跑的版本不同：${diff.join(', ')}（同步要拷过去 + 重启 DSH）`);
    else pass('运行时哈希', `${tracked.length} 个文件与运行目录一致`);
  }
}

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---- 8 git ----
{
  const st = run('git', ['status', '--porcelain']);
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = run('git', ['log', '-1', '--oneline']);
  const ahead = run('git', ['rev-list', '--count', 'origin/main..HEAD']);
  if (!st.ok) fail('git', st.out.split('\n')[0]);
  else if (st.out !== '') fail('git', `工作区不干净：\n${st.out.split('\n').slice(0, 6).join('\n')}`);
  else pass('git', `干净（${branch.out || '?'} @ ${head.out || '?'}）`);
  if (ahead.ok && Number(ahead.out) > 0) warn('git', `本地比 origin/main 多 ${ahead.out} 个提交（还没 push）`);
}

// ---- 输出 ----
const width = Math.max(...rows.map((r) => r.name.length), 6);
for (const r of rows) {
  const tag = r.level === 'PASS' ? 'OK  ' : r.level === 'WARN' ? 'WARN' : 'FAIL';
  console.log(`${tag} ${r.name.padEnd(width)}  ${r.detail}`);
}
const fails = rows.filter((r) => r.level === 'FAIL').length;
const warns = rows.filter((r) => r.level === 'WARN').length;
console.log(`\n${fails === 0 ? '门禁过了' : '门禁没过'}：${rows.length - fails - warns} 项通过，${warns} 项提醒，${fails} 项失败  ·  ${version}`);
if (fails > 0) process.exit(1);
