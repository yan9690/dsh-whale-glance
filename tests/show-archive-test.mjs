// 档案（shows.json）这条路整段真跑一遍：她 14:37–14:50 把一集看完，16 句说完，
// 换新代码以后到底能不能落进档案。把 lib/index.js 里 archiveSegment 那一串真函数抠出来，
// 只把模型调用和磁盘换成桩，其余（番名解析、集数推断、门槛、去重、排队补写、封顶）都是仓库里的真代码。
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const ROOT = 'D:/小气泡/余光插件git';
// 仓库里是 CRLF，先统一成 LF，逐行抠函数才认得顶格的 `}`
const src = fs.readFileSync(`${ROOT}/lib/index.js`, 'utf8').replace(/\r\n/g, '\n');
const rules = await import(pathToFileURL(`${ROOT}/lib/segment-rules.js`).href);

// 按函数名抠出真函数体：找到它那一行，再找同缩进的 `}` 收口。
// 不数花括号——函数体里的正则 `{1,3}` 和模板串会让计数跑偏。
const SRC_LINES = src.split('\n');
function extract(name) {
  // archiveSegment / hhmm 这些是 async 或缩在两格里的，两种都认
  const headRe = new RegExp(`^\\s*(?:async\\s+)?function ${name}\\(`);
  const start = SRC_LINES.findIndex((line) => headRe.test(line));
  if (start < 0) throw new Error(`没找到 ${name}`);
  const indent = SRC_LINES[start].match(/^\s*/)[0];
  const end = SRC_LINES.findIndex((line, i) => i > start && line === `${indent}}`);
  if (end < 0) throw new Error(`${name} 没有闭合`);
  return SRC_LINES.slice(start, end + 1).join('\n');
}

// 她 14:37–14:50 那集的真话，直接读磁盘上的剧本文件
const playFile = 'C:/Users/yan/.dsh/storages/whale-glance/plays/20261122-143725-(在看).md';
const herLines = fs.readFileSync(playFile, 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('- '))
  .map((l) => l.replace(/^-\s*\d{2}:\d{2}:\d{2}\s*/, '').trim())
  .filter(Boolean);

const QUEUE = 'C:/tmp/whale-glance/show-archive-queue.json';
const ctx = {
  JSON,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  fs: {
    files: new Map(),
    mkdirSync: () => {},
    readFileSync: (p) => {
      if (!ctx.fs.files.has(p)) throw new Error(`no such file: ${p}`);
      return ctx.fs.files.get(p);
    },
    writeFileSync: (p, t) => {
      ctx.written.push([p, t]);
      ctx.fs.files.set(p, t);
      if (String(p).endsWith('shows.json')) ctx.disk = t;
    },
    appendFileSync: (p, t) => { ctx.logs.push([p, t]); },
    existsSync: () => false,
  },
  path: { join: (...parts) => parts.join('/') },
  STORAGE: 'C:/tmp/whale-glance',
  LOOSE_BUCKET: '随手看',
  ARCHIVE_QUEUE: QUEUE,
  config: { showMemory: true, currentShow: '可塑性记忆' },
  store: {},
  written: [],
  logs: [],
  calls: [],
  answers: [],
  defaultAnswer: '这一段的收束：艾拉答应接手，白花秩与妮娜的关系浮出水面。',
  disk: '',
  lastPrompt: null,
  showsPath: () => 'C:/tmp/whale-glance/shows.json',
  loadShows: () => (ctx.store ? JSON.parse(JSON.stringify(ctx.store)) : null),
  chineseNumberToInt: () => 0,
  normalizeShowName: (s) => String(s || '').trim(),
  buildSegmentPrompt: rules.buildSegmentPrompt,
  segmentWorthArchiving: rules.segmentWorthArchiving,
  askModelDirect: async (opts) => {
    ctx.calls.push(opts);
    ctx.lastPrompt = opts;
    if (ctx.answers.length > 0) {
      const next = ctx.answers.shift();
      if (next instanceof Error) throw next;
      return { said: next };
    }
    return { said: ctx.defaultAnswer };
  },
};

vm.createContext(ctx);
const code = [
  'loadArchiveQueue', 'saveArchiveQueue', 'enqueueArchive', 'drainArchiveQueue',
  'parseShowLabel', 'pickEpisodeForArchive', 'episodeNoFromTitle', 'hhmm', 'dayhhmm',
  'archiveSegment',
].map(extract).join('\n');
// 模块级的那几个 let 也带上，不然抠出来的函数引用不到
const PRELUDE = 'let archiveDraining = false;\nlet showMemSkipLogged = false;\n';
vm.runInContext(`${PRELUDE}${code}\nObject.assign(this, { loadArchiveQueue, saveArchiveQueue, enqueueArchive, drainArchiveQueue, archiveSegment, parseShowLabel });`, ctx);

const ok = [];
const bad = [];
function check(name, cond, extra = '') {
  (cond ? ok : bad).push(`${name}${extra ? ' → ' + extra : ''}`);
}
function reset() {
  ctx.store = {};
  ctx.written = [];
  ctx.logs = [];
  ctx.calls = [];
  ctx.answers = [];
  ctx.disk = '';
  ctx.fs.files = new Map();
}
const title = '【4K超清】可塑性记忆 1-13话_哔哩哔哩_bilibili — Mozilla Firefox';
const seg = (a, b) => ({ segStart: new Date(a).getTime(), segEnd: new Date(b).getTime() });

// ---------- 一、她这一集：16 句，面板写着「可塑性记忆」 ----------
reset();
check('这一局的剧本读得到 16 句', herLines.length === 16, `lines=${herLines.length}`);
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })),
  subtitles: ['把回忆销毁就是我们的工作', '艾拉就交给我吧', '你们只是把妮娜当消耗品看待'],
  title,
  ...seg('2026-11-22T14:37:25+08:00', '2026-11-22T14:50:30+08:00'),
});
check('16 句够了门槛，真写了一次盘', ctx.written.length === 1, `written=${ctx.written.length}`);
const s1 = JSON.parse(ctx.disk || '{}');
const e1 = s1['可塑性记忆']?.剧情 ?? [];
check('档案按番名归到「可塑性记忆」', Array.isArray(e1) && e1.length === 1, JSON.stringify(Object.keys(s1)));
check('条目带时间段标签', /^14:37–14:50：/.test(e1[0] ?? ''), e1[0] ?? '空');
check('条目写的是模型给的收束，不是复述原话', /艾拉答应接手/.test(e1[0] ?? ''), e1[0] ?? '');
check('记了最近写入', (s1['_最近写入'] ?? []).some((x) => x.name === '可塑性记忆'), JSON.stringify(s1['_最近写入']));
check('提示词里带上了台词和它说过的话', /把回忆销毁就是我们的工作/.test(String(ctx.lastPrompt?.text ?? '')) && /捧着/.test(String(ctx.lastPrompt?.text ?? '')), String(ctx.lastPrompt?.text ?? '').slice(0, 40));
// 同一段再收一次，不允许变成两条
ctx.store = s1;
await ctx.archiveSegment({ lines: herLines.map((text) => ({ text })), subtitles: [], title, ...seg('2026-11-22T14:37:25+08:00', '2026-11-22T14:50:30+08:00') });
const s1b = JSON.parse(ctx.disk || '{}');
check('同一段写第二遍不会变成两条', (s1b['可塑性记忆']?.剧情 ?? []).length === 1, JSON.stringify(s1b['可塑性记忆']?.剧情));

// ---------- 二、门槛 ----------
reset();
await ctx.archiveSegment({ lines: [{ text: '第一句' }, { text: '第二句' }], subtitles: [], title: 'x', segStart: 0, segEnd: 1 });
check('2 句就收（门槛从 3 降到 2）', ctx.written.length === 1, `written=${ctx.written.length}`);

reset();
await ctx.archiveSegment({ lines: [{ text: '就这一句' }], subtitles: [], title: 'x', segStart: 0, segEnd: 1 });
check('1 句不收', ctx.written.length === 0, `written=${ctx.written.length}`);

// ---------- 三、开关关着 ----------
reset();
ctx.config = { showMemory: false, currentShow: '可塑性记忆' };
await ctx.archiveSegment({ lines: herLines.map((text) => ({ text })), subtitles: [], title, segStart: 0, segEnd: 1 });
check('showMemory=false 时不写档案', ctx.written.length === 0 && ctx.disk === '', `written=${ctx.written.length}`);
ctx.config = { showMemory: true, currentShow: '可塑性记忆' };

// ---------- 四、番名带集数 ----------
reset();
ctx.config = { showMemory: true, currentShow: '咒术回战 第3集' };
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })), subtitles: [], title: '第3集 咒术回战 — Mozilla Firefox',
  ...seg('2026-11-22T19:00:00+08:00', '2026-11-22T19:20:00+08:00'),
});
const s2 = JSON.parse(ctx.disk || '{}');
check('番名不带集数，归到「咒术回战」', !!s2['咒术回战'], JSON.stringify(Object.keys(s2)));
check('标签是「第3集 19:00–19:20」', /^第3集 19:00–19:20：/.test(s2['咒术回战']?.剧情?.[0] ?? ''), s2['咒术回战']?.剧情?.[0] ?? '');
check('档案里记了集数', s2['咒术回战']?.episode === 3, String(s2['咒术回战']?.episode));
// 下一段没写集数：沿用档案里的第 3 集
ctx.store = s2;
ctx.config = { showMemory: true, currentShow: '咒术回战' };
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })), subtitles: [], title: '咒术回战 — Mozilla Firefox',
  ...seg('2026-11-22T19:20:00+08:00', '2026-11-22T19:40:00+08:00'),
});
const s2c = JSON.parse(ctx.disk || '{}');
check('没写集数时沿用上次那一集', (s2c['咒术回战']?.剧情 ?? []).length === 2 && /^第3集 19:20–19:40：/.test(s2c['咒术回战']?.剧情?.[1] ?? ''), JSON.stringify(s2c['咒术回战']?.剧情));
check('前一段没被后面覆盖', (s2c['咒术回战']?.剧情 ?? [])[0] === (s2['咒术回战']?.剧情 ?? [])[0], '');

// ---------- 五、面板空着 ----------
reset();
ctx.config = { showMemory: true, currentShow: '' };
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })), subtitles: [], title: '随手刷到的视频 — Mozilla Firefox',
  ...seg('2026-11-22T20:00:00+08:00', '2026-11-22T20:05:00+08:00'),
});
const s3 = JSON.parse(ctx.disk || '{}');
check('没番名进「随手看」', !!s3['随手看'], JSON.stringify(Object.keys(s3)));
check('随手看的标签带日期', /^11-22 20:00–20:05：/.test(s3['随手看']?.剧情?.[0] ?? ''), s3['随手看']?.剧情?.[0] ?? '');
ctx.config = { showMemory: true, currentShow: '可塑性记忆' };

// ---------- 六、写盘失败不往外抛 ----------
reset();
const realWrite = ctx.fs.writeFileSync;
ctx.fs.writeFileSync = (p, t) => {
  if (String(p).endsWith('shows.json')) throw new Error('磁盘满');
  realWrite(p, t);
};
let threw = false;
try {
  await ctx.archiveSegment({ lines: herLines.map((text) => ({ text })), subtitles: [], title, segStart: 0, segEnd: 1 });
} catch { threw = true; }
ctx.fs.writeFileSync = realWrite;
check('写盘失败不往外抛（不打断看番）', !threw, '');

// ---------- 七、11-22 14:48 那个真 bug：模型只给思考不给正文 ----------
// 现在应该：先 low 档，空手再关思考（off）重来一次，第二次拿到字就照常写。
reset();
ctx.answers = ['', '关思考以后写出来的收束：白花秩与妮娜交接，艾拉全程在场。'];
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })), subtitles: [], title,
  ...seg('2026-11-22T14:37:25+08:00', '2026-11-22T14:50:30+08:00'),
});
const s7 = JSON.parse(ctx.disk || '{}');
check('空正文会换档重试一次再落盘', ctx.calls.length === 2 && ctx.written.length === 1, `calls=${ctx.calls.length} written=${ctx.written.length}`);
check('第一档先走 off（看画面那条路天天在用的），属于稳的那一档', ctx.calls[0]?.effort === 'off', String(ctx.calls[0]?.effort));
check('off 空手才上 low 要更细的收束', ctx.calls[1]?.effort === 'low', String(ctx.calls[1]?.effort));
check('第二档拿到的收束进了档案', /关思考以后写出来的收束/.test(s7['可塑性记忆']?.剧情?.[0] ?? ''), s7['可塑性记忆']?.剧情?.[0] ?? '');

// ---------- 八、两档都空：不丢，排队 ----------
reset();
ctx.answers = ['', ''];
ctx.defaultAnswer = '';
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })), subtitles: [], title,
  ...seg('2026-11-22T14:37:25+08:00', '2026-11-22T14:50:30+08:00'),
});
const queue = ctx.loadArchiveQueue();
check('两档都空时不写档案', ctx.disk === '', '');
check('但整段进了排队，没被扔掉', queue.length === 1 && queue[0].lines.length === 16, `queue=${queue.length}`);
check('排队的条目带着原时间段', queue[0]?.segStart === new Date('2026-11-22T14:37:25+08:00').getTime(), String(queue[0]?.segStart));
check('日志记了 show-archive-empty', ctx.logs.some(([, t]) => /show-archive-empty/.test(t)), ctx.logs.map(([, t]) => t.slice(0, 60)).join(' | ') || '没日志');

// ---------- 九、下次启动/空闲补写排队的段 ----------
ctx.defaultAnswer = '补写出来的收束：白花秩与妮娜的交接，艾拉全程在场，最后一句是道别。';
ctx.store = {};
await ctx.drainArchiveQueue(2);
const s9 = JSON.parse(ctx.disk || '{}');
check('补写把排队的段写进档案了', (s9['可塑性记忆']?.剧情 ?? []).length === 1, JSON.stringify(s9['可塑性记忆'] ?? null));
check('补写成功后队列清空', ctx.loadArchiveQueue().length === 0, `queue=${ctx.loadArchiveQueue().length}`);
check('补写沿用原时间段当标签', /^14:37–14:50：/.test(s9['可塑性记忆']?.剧情?.[0] ?? ''), s9['可塑性记忆']?.剧情?.[0] ?? '');

// ---------- 十、模型抛异常也排队，不会白丢 ----------
reset();
ctx.answers = [new Error('模型连不上'), new Error('模型连不上')];
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })), subtitles: [], title,
  ...seg('2026-11-22T15:00:00+08:00', '2026-11-22T15:20:00+08:00'),
});
check('抛异常时这一段也进了排队', ctx.loadArchiveQueue().length === 1, `queue=${ctx.loadArchiveQueue().length}`);
check('日志记下了这次没成（带模型报错原文）', ctx.logs.some(([, t]) => /show-archive-empty/.test(t) && /模型连不上/.test(t)), ctx.logs.map(([, t]) => t.slice(0, 50)).join(' | ') || '没日志');
check('抛异常时不写档案', ctx.disk === '', '');

// ---------- 十一、番名解析的底子没坏 ----------
check('「可塑性记忆」解析成不带集数', JSON.stringify(ctx.parseShowLabel('可塑性记忆')) === JSON.stringify({ series: '可塑性记忆', episode: null, season: null }), JSON.stringify(ctx.parseShowLabel('可塑性记忆')));
check('「咒术回战 第3集」解析出集数 3', ctx.parseShowLabel('咒术回战 第3集')?.episode === 3, JSON.stringify(ctx.parseShowLabel('咒术回战 第3集')));

console.log(`通过 ${ok.length} 项`);
for (const line of ok) console.log('  PASS  ' + line);
if (bad.length) {
  console.log(`\n失败 ${bad.length} 项`);
  for (const line of bad) console.log('  FAIL  ' + line);
  process.exit(1);
}
