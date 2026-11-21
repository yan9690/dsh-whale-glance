// 直接把 lib/index.js 里那段逐条上屏的代码抠出来真跑一遍：
// 1) 三条只先写最新一句；2) 计时器按顺序补齐；3) 下一句来得快时旧快照不许盖回去。
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync('D:/小气泡/余光插件git/lib/index.js', 'utf8');
const start = src.indexOf('const HUD_STAGE_MS');
const fnStart = src.indexOf('function writeHudStaged');
// 文件可能是 LF 也可能是 CRLF，两种都认
const endLf = src.indexOf('\n}\n', fnStart);
const endCrlf = src.indexOf('\n}\r\n', fnStart);
const fnEnd = endLf >= 0 ? endLf : endCrlf;
if (start < 0 || fnStart < 0 || fnEnd < 0) throw new Error('没找到要测的代码段');
const code = src.slice(start, fnEnd + 2);

let writes = [];
let timers = new Map();
let timerId = 0;
const ctx = {
  fs: { writeFileSync: (p, t) => writes.push([p, t]) },
  HUD: 'C:/tmp/subtitle.txt',
  setTimeout: (fn, ms) => { timerId += 1; timers.set(timerId, { fn, ms }); return timerId; },
  clearTimeout: (id) => { timers.delete(id); },
};
vm.createContext(ctx);
vm.runInContext(`${code}\nthis.writeHudStaged = writeHudStaged;`, ctx);

const ok = [];
const bad = [];
function check(name, cond, extra = '') {
  (cond ? ok : bad).push(`${name}${extra ? ' → ' + extra : ''}`);
}

// 一、三条：先只写最新那句
writes = []; timers = new Map();
ctx.writeHudStaged(['甲', '乙', '丙']);
check('立刻写的是最新一句', writes.length === 1 && writes[0][1] === '丙', JSON.stringify(writes));
check('还剩两拍没执行', timers.size === 2, `timers=${timers.size}`);
const order = [...timers.values()].map((t) => t.ms).sort((a, b) => a - b);
check('间隔 800/1600', order[0] === 800 && order[1] === 1600, JSON.stringify(order));

// 二、按顺序执行完毕，内容是三条
for (const [, t] of [...timers.entries()].sort((a, b) => a[1].ms - b[1].ms)) { timers.delete(1); t.fn(); }
const final = writes[writes.length - 1][1];
check('最后一份是三条', final === '甲\n\n乙\n\n丙', JSON.stringify(final));

// 三、补到一半又来一句：旧的补齐必须被取消
writes = []; timers = new Map();
ctx.writeHudStaged(['甲', '乙', '丙']);
const beforeSecond = writes.length;
ctx.writeHudStaged(['乙', '丙', '丁']);
const left = [...timers.values()].map((t) => t.ms).sort((a, b) => a - b);
check('新句进来后只剩新的一批计时器', left.length === 2, JSON.stringify(left));
check('第二句立刻顶掉了上一批的显示', writes[writes.length - 1][1] === '丁' && writes.length === beforeSecond + 1, JSON.stringify(writes));
for (const [, t] of [...timers.entries()].sort((a, b) => a[1].ms - b[1].ms)) t.fn();
check('旧快照没盖回来', !writes.some(([, t]) => t.includes('甲')), JSON.stringify(writes.map(([, t]) => t)));

// 四、只有一句的时候不该排计时器
writes = []; timers = new Map();
ctx.writeHudStaged(['就一句']);
check('单句不排计时器', timers.size === 0 && writes.length === 1 && writes[0][1] === '就一句');

// 五、空 list / 空串不写
writes = []; timers = new Map();
ctx.writeHudStaged([]);
ctx.writeHudStaged(['', '  ']);
check('空的不写文件', writes.length === 0 && timers.size === 0);

console.log(`通过 ${ok.length} 项`);
for (const line of ok) console.log('  PASS  ' + line);
if (bad.length) {
  console.log(`\n失败 ${bad.length} 项`);
  for (const line of bad) console.log('  FAIL  ' + line);
  process.exit(1);
}
