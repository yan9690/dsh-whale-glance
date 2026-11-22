// 字幕条规矩（2026-11-22 下午她定的）：窗里只显示**最新那一句**，旧句不许留在里面。
// 把 lib/index.js 里 writeHud 和 recentSaidLines 两段真抠出来跑，不 mock 整个插件。
import fs from 'node:fs';

const src = fs.readFileSync('D:/小气泡/余光插件git/lib/index.js', 'utf8');

// 按函数名抠出一个函数体（花括号配平），不用正则猜行号。
function extract(name) {
  const head = src.indexOf(`function ${name}(`);
  if (head < 0) throw new Error(`没找到 ${name}`);
  const open = src.indexOf('{', head);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(head, i + 1);
    }
  }
  throw new Error(`${name} 没有闭合`);
}

const ctx = {
  HUD: 'C:/tmp/subtitle.txt',
  STORAGE: 'C:/tmp/storage',
  HUD_NOTES: new Set(['还在，先不吵。']),
  path: { join: (...parts) => parts.join('/') },
  fs: {
    writeFileSync: (p, t) => { ctx.writes.push([p, t]); },
    readFileSync: () => ctx.history,
  },
  writes: [],
  history: '',
};
import vm from 'node:vm';
vm.createContext(ctx);
vm.runInContext(
  `${extract('writeHud')}\n${extract('recentSaidLines')}\nthis.writeHud = writeHud; this.recentSaidLines = recentSaidLines;`,
  ctx,
);

const ok = [];
const bad = [];
function check(name, cond, extra = '') {
  (cond ? ok : bad).push(`${name}${extra ? ' → ' + extra : ''}`);
}

// 一、写一句就是一句，而且窗里只有它
ctx.writes = [];
ctx.writeHud('第一句');
check('只写一次', ctx.writes.length === 1, JSON.stringify(ctx.writes));
check('内容就是这句', ctx.writes[0][1] === '第一句', JSON.stringify(ctx.writes));

// 二、下一句直接顶掉，不补旧的不排计时器
ctx.writes = [];
ctx.writeHud('第一句');
ctx.writeHud('第二句');
check('两次调用只写两次', ctx.writes.length === 2, JSON.stringify(ctx.writes));
check('窗里最后只剩第二句', ctx.writes[1][1] === '第二句', JSON.stringify(ctx.writes));
check('没有「补旧句」这条路径', !src.includes('hudStageTimers') && !src.includes('writeHudStaged'));

// 三、旧句不会被拼进来（以前是「甲\n\n乙\n\n丙」这种快照）
ctx.writes = [];
ctx.writeHud('甲');
ctx.writeHud('乙');
check('写进去的内容里没有换行拼接的旧句', ctx.writes.every(([, t]) => !t.includes('\n\n')), JSON.stringify(ctx.writes));

// 四、空的不写、不把旧内容清掉
ctx.writes = [];
ctx.writeHud('');
ctx.writeHud('   ');
ctx.writeHud(null);
ctx.writeHud(undefined);
check('空内容一个字节都不写', ctx.writes.length === 0, JSON.stringify(ctx.writes));

// 五、读回最近五句走聊天记录，剥掉时间戳、排掉宿主提示语
ctx.history = [
  '[13:57:20] 第一句',
  '[13:58:10] 还在，先不吵。',
  '[13:59:01] 第二句',
  '[13:59:50] 第三句',
  '[14:00:47] 第四句',
  '[14:01:36] 第五句',
  '[14:02:27] 第六句',
  '',
].join('\n');
const recent = ctx.recentSaidLines(5);
check('取最后五句', recent.length === 5, JSON.stringify(recent));
check('最后一句是第六句', recent[4] === '第六句', JSON.stringify(recent));
check('时间戳被剥掉', recent.every((l) => !/^\[\d/.test(l)), JSON.stringify(recent));
check('宿主提示语被排掉', !recent.includes('还在，先不吵。'), JSON.stringify(recent));
check('读不到就返回空数组', (() => { ctx.history = ''; return ctx.recentSaidLines(5).length === 0; })());

// 六、调用处确实只用这个函数，没留旧分支
check('调用处是 writeHud(said)', src.includes('writeHud(said);'), '');
check('没留「看一眼/自动看」两套写法', !src.includes('writeHudStaged'));

console.log(`通过 ${ok.length} 项`);
for (const line of ok) console.log('  PASS  ' + line);
if (bad.length) {
  console.log(`\n失败 ${bad.length} 项`);
  for (const line of bad) console.log('  FAIL  ' + line);
  process.exit(1);
}
