// 档案（shows.json）这条路整段真跑一遍：她 14:00 那局 7 句、面板里写着「可塑性记忆」，
// 换新代码以后到底能不能落进档案。把 lib/index.js 里 archiveSegment 那一串真函数抠出来，
// 只把模型调用和磁盘换成桩，其余（番名解析、集数推断、门槛、去重、封顶）都是仓库里的真代码。
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const ROOT = 'D:/小气泡/余光插件git';
// 仓库里是 CRLF，先统一成 LF，逐行抠函数才认得顶格的 `}`
const src = fs.readFileSync(`${ROOT}/lib/index.js`, 'utf8').replace(/\r\n/g, '\n');
const rules = await import(pathToFileURL(`${ROOT}/lib/segment-rules.js`).href);

// 按函数名抠出真函数体：顶格写的 function，找到它下一行顶格的 `}` 为止。
// 不数花括号——函数体里的正则 `{1,3}` 和模板串会让计数跑偏。
const SRC_LINES = src.split('\n');
function extract(name) {
  // archiveSegment 是 async 的，别的不是，两种都认
  const headRe = new RegExp(`^\\s*(?:async\\s+)?function ${name}\\(`);
  const start = SRC_LINES.findIndex((line) => headRe.test(line));
  if (start < 0) throw new Error(`没找到 ${name}`);
  // 这些函数缩在不同层里（顶格的和两格缩进的都有），收口找同缩进的 `}`
  const indent = SRC_LINES[start].match(/^\s*/)[0];
  const end = SRC_LINES.findIndex((line, i) => i > start && line === `${indent}}`);
  if (end < 0) throw new Error(`${name} 没有闭合`);
  return SRC_LINES.slice(start, end + 1).join('\n');
}

// 她 14:00 那局的真话，直接读磁盘上的剧本文件
const playFile = 'C:/Users/yan/.dsh/storages/whale-glance/plays/20261122-135720-(未识别).md';
const herLines = fs.readFileSync(playFile, 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('- '))
  .map((l) => l.replace(/^-\s*\d{2}:\d{2}:\d{2}\s*/, '').trim())
  .filter(Boolean);

const ctx = {
  JSON,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  fs: {
    mkdirSync: () => {},
    writeFileSync: (p, t) => { ctx.written.push([p, t]); ctx.disk = t; },
    appendFileSync: () => {},
    existsSync: () => false,
  },
  path: { join: (...parts) => parts.join('/') },
  STORAGE: 'C:/tmp/whale-glance',
  LOOSE_BUCKET: '随手看',
  config: { showMemory: true, currentShow: '可塑性记忆' },
  store: null,
  written: [],
  disk: '',
  lastPrompt: null,
  summary: '这一段的收束：艾拉答应接手，白花秩与妮娜的关系浮出水面。',
  showsPath: () => 'C:/tmp/whale-glance/shows.json',
  loadShows: () => (ctx.store ? JSON.parse(JSON.stringify(ctx.store)) : null),
  chineseNumberToInt: () => 0,
  normalizeShowName: (s) => String(s || '').trim(),
  buildSegmentPrompt: rules.buildSegmentPrompt,
  segmentWorthArchiving: rules.segmentWorthArchiving,
  askModelDirect: async (opts) => { ctx.lastPrompt = opts; return { said: ctx.summary }; },
};

vm.createContext(ctx);
const code = ['parseShowLabel', 'pickEpisodeForArchive', 'episodeNoFromTitle', 'hhmm', 'dayhhmm', 'archiveSegment']
  .map(extract)
  .join('\n');
vm.runInContext(`${code}\nthis.archiveSegment = archiveSegment;`, ctx);

const ok = [];
const bad = [];
function check(name, cond, extra = '') {
  (cond ? ok : bad).push(`${name}${extra ? ' → ' + extra : ''}`);
}

// ---------- 一、她的真实一局：面板写着「可塑性记忆」 ----------
ctx.store = {};
ctx.written = [];
ctx.config = { showMemory: true, currentShow: '可塑性记忆' };
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })),
  subtitles: ['快点去工作啊', '把回忆销毁就是我们的工作', '艾拉就交给我吧'],
  title: '【4K超清】可塑性记忆 1-13话_哔哩哔哩_bilibili — Mozilla Firefox',
  segStart: new Date('2026-11-22T13:57:20+08:00').getTime(),
  segEnd: new Date('2026-11-22T14:02:27+08:00').getTime(),
});
check('7 句够了门槛，真写了一次盘', ctx.written.length === 1, `written=${ctx.written.length}`);
const saved = JSON.parse(ctx.disk || '{}');
const entry = saved['可塑性记忆']?.剧情 ?? [];
check('档案按番名归到「可塑性记忆」', Array.isArray(entry) && entry.length === 1, JSON.stringify(Object.keys(saved)));
check('条目带时间段标签', /^13:57–14:02：/.test(entry[0] ?? ''), entry[0] ?? '空');
check('条目写的是模型给的收束，不是复述原话', /艾拉答应接手/.test(entry[0] ?? ''), entry[0] ?? '');
check('记了最近写入', (saved['_最近写入'] ?? []).some((x) => x.name === '可塑性记忆'), JSON.stringify(saved['_最近写入']));
check('提示词里带上了她这局的真台词', String(ctx.lastPrompt?.text ?? '').includes('伍堂部长特意推荐') || String(ctx.lastPrompt?.text ?? '').includes('艾拉'), String(ctx.lastPrompt?.text ?? '').slice(0, 60));
// 帧号和「第几帧」这种不许混进提示词（她烦过）
ctx.lastPrompt = null;
ctx.store = saved;
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })),
  subtitles: [],
  title: '【4K超清】可塑性记忆 1-13话_哔哩哔哩_bilibili — Mozilla Firefox',
  segStart: new Date('2026-11-22T13:57:20+08:00').getTime(),
  segEnd: new Date('2026-11-22T14:02:27+08:00').getTime(),
});
const again = JSON.parse(ctx.disk || '{}');
check('同一段写第二遍不会变成两条', (again['可塑性记忆']?.剧情 ?? []).length === 1, JSON.stringify(again['可塑性记忆']?.剧情));

// ---------- 二、只有 2 句：新门槛该收 ----------
ctx.store = {};
ctx.written = [];
await ctx.archiveSegment({
  lines: [{ text: '第一句' }, { text: '第二句' }],
  subtitles: [],
  title: 'x',
  segStart: 0,
  segEnd: 1,
});
check('2 句就收（门槛从 3 降到 2）', ctx.written.length === 1, `written=${ctx.written.length}`);

// ---------- 三、只有 1 句、也没台词：不该收 ----------
ctx.store = {};
ctx.written = [];
await ctx.archiveSegment({ lines: [{ text: '就这一句' }], subtitles: [], title: 'x', segStart: 0, segEnd: 1 });
check('1 句不收', ctx.written.length === 0, `written=${ctx.written.length}`);

// ---------- 四、开关关着：一个字都不写 ----------
ctx.store = {};
ctx.written = [];
ctx.disk = '';
ctx.config = { showMemory: false, currentShow: '可塑性记忆' };
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })),
  subtitles: [],
  title: 'x',
  segStart: 0,
  segEnd: 1,
});
check('showMemory=false 时不写档案', ctx.written.length === 0 && ctx.disk === '', `written=${ctx.written.length}`);

// ---------- 五、面板写「咒术回战 第3集」：按番归集、集数单独记 ----------
ctx.store = {};
ctx.written = [];
ctx.config = { showMemory: true, currentShow: '咒术回战 第3集' };
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })),
  subtitles: [],
  title: '第3集 咒术回战 — Mozilla Firefox',
  segStart: new Date('2026-11-22T19:00:00+08:00').getTime(),
  segEnd: new Date('2026-11-22T19:20:00+08:00').getTime(),
});
const s2 = JSON.parse(ctx.disk || '{}');
check('番名不带集数，归到「咒术回战」', !!s2['咒术回战'], JSON.stringify(Object.keys(s2)));
check('标签是「第3集 19:00–19:20」', /^第3集 19:00–19:20：/.test(s2['咒术回战']?.剧情?.[0] ?? ''), s2['咒术回战']?.剧情?.[0] ?? '');
check('档案里记了集数', s2['咒术回战']?.episode === 3, String(s2['咒术回战']?.episode));
// 下一段没写集数：沿用档案里的第 3 集
const s2b = JSON.parse(ctx.disk || '{}');
ctx.store = s2b;
ctx.config = { showMemory: true, currentShow: '咒术回战' };
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })),
  subtitles: [],
  title: '咒术回战 — Mozilla Firefox',
  segStart: new Date('2026-11-22T19:20:00+08:00').getTime(),
  segEnd: new Date('2026-11-22T19:40:00+08:00').getTime(),
});
const s2c = JSON.parse(ctx.disk || '{}');
check('没写集数时沿用上次那一集', (s2c['咒术回战']?.剧情 ?? []).length === 2 && /^第3集 19:20–19:40：/.test(s2c['咒术回战']?.剧情?.[1] ?? ''), JSON.stringify(s2c['咒术回战']?.剧情));
check('前一段没被后面覆盖', (s2c['咒术回战']?.剧情 ?? [])[0] === (s2b['咒术回战']?.剧情 ?? [])[0], '');

// ---------- 六、面板空着：进「随手看」，不硬塞给某部番 ----------
ctx.store = {};
ctx.written = [];
ctx.config = { showMemory: true, currentShow: '' };
await ctx.archiveSegment({
  lines: herLines.map((text) => ({ text })),
  subtitles: [],
  title: '随手刷到的视频 — Mozilla Firefox',
  segStart: new Date('2026-11-22T20:00:00+08:00').getTime(),
  segEnd: new Date('2026-11-22T20:05:00+08:00').getTime(),
});
const s3 = JSON.parse(ctx.disk || '{}');
check('没番名进「随手看」', !!s3['随手看'], JSON.stringify(Object.keys(s3)));
check('随手看的标签带日期', /^11-22 20:00–20:05：/.test(s3['随手看']?.剧情?.[0] ?? ''), s3['随手看']?.剧情?.[0] ?? '');

// ---------- 七、写盘失败：只记日志，不抛出 ----------
ctx.written = [];
ctx.store = {};
ctx.config = { showMemory: true, currentShow: '可塑性记忆' };
const realWrite = ctx.fs.writeFileSync;
ctx.fs.writeFileSync = (p, t) => { if (String(p).endsWith('shows.json')) throw new Error('磁盘满'); ctx.written.push([p, t]); };
let threw = false;
try {
  await ctx.archiveSegment({ lines: herLines.map((text) => ({ text })), subtitles: [], title: 'x', segStart: 0, segEnd: 1 });
} catch { threw = true; }
ctx.fs.writeFileSync = realWrite;
check('写盘失败不往外抛（不打断看番）', !threw, '');

console.log(`通过 ${ok.length} 项`);
for (const line of ok) console.log('  PASS  ' + line);
if (bad.length) {
  console.log(`\n失败 ${bad.length} 项`);
  for (const line of bad) console.log('  FAIL  ' + line);
  process.exit(1);
}
