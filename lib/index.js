/**
 * `dsh-whale-glance` — Host half.
 *
 * 陪看的眼睛：常驻 Python 帮工定期截屏、比较差异，画面变化够大时把整图存下来，
 * 并通过 `agent.followup()` 把「画面有变化」这条消息塞回会话，让我自己看一眼、
 * 说一句（字幕走 dsh-whale-voice 的 voice_say，平时只出字、不出声）。
 *
 * 有三道刹车：默认不自动（enabled=false）、按 cooldownMs 冷却、每小时最多 maxPerHour 次。
 *
 * @module dsh-whale-glance
 */

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = path.join(PACKAGE_ROOT, 'helper', 'sense.py');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const STORAGE = path.join(DSH_HOME, 'storages', 'whale-glance');
// 改名迁移（whale-sense → whale-glance）：只搬用户养出来的三样东西，frames 不动。
(() => {
  const legacy = path.join(DSH_HOME, 'storages', 'whale-sense');
  if (legacy === STORAGE) return;
  try {
    for (const f of ['config.json', 'games-notes.json', 'shows.json']) {
      const from = path.join(legacy, f);
      const to = path.join(STORAGE, f);
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.mkdirSync(STORAGE, { recursive: true });
        fs.copyFileSync(from, to);
      }
    }
  } catch { /* 迁不了就重新养，别让启动挂掉 */ }
})();
// 黑话库放用户数据目录：插件升级/重装不会把用户养出来的词冲掉。
// 旧版本在插件目录 helper/ 下，首次读到新位置时自动迁移。
function notesPath() {
  const fresh = path.join(STORAGE, 'games-notes.json');
  const legacy = path.join(PACKAGE_ROOT, 'helper', 'games-notes.json');
  try {
    if (!fs.existsSync(fresh) && fs.existsSync(legacy)) {
      fs.mkdirSync(STORAGE, { recursive: true });
      fs.copyFileSync(legacy, fresh);
    }
  } catch { /* 迁不了就读旧位置 */ }
  return fs.existsSync(fresh) ? fresh : legacy;
}
/** 番剧档案：按番名存舞台/人物/剧情，跨集、跨天续上。跟黑话库一样放用户数据目录。 */
function showsPath() {
  return path.join(STORAGE, 'shows.json');
}
function loadShows() {
  try {
    const d = JSON.parse(fs.readFileSync(showsPath(), 'utf8'));
    return d && typeof d === 'object' ? d : {};
  } catch { return {}; }
}
/** 番名归一化：去掉集数、话数、书名号、多余空格，好让「咒术回战 第2集」能对上档案里的「咒术回战」。 */
function normalizeShowName(name) {
  return String(name || '')
    .replace(/[《》【】「」]/g, '')
    // 「第3集」和「第三集」都算集数标记；季的单列（第2季），中文数字的「第二季」故意不剥——
    // 季不是集，剥了会让第二季的档案读回第一季的记录。
    .replace(/第\s*(?:\d+|[一二两三四五六七八九十]+)\s*[话集話期]/g, '')
    .replace(/第\s*\d+\s*季/g, '')
    // 带点的写法（EP.7 / E03 / S2.E3）也要认：老档案里万一存过这种 key，读的时候得能对回来。
    // S…E… 必须排在 E… 前面——「S2.E3」里的 E 前面是点，单看 E 那条也会命中，先吃掉整段才对。
    .replace(/\bS\s*\d+\s*[.\-·]?\s*E\s*[.\-·]?\s*\d+\b/gi, '')
    .replace(/\bEP?\s*[.\-·]?\s*\d+/gi, '')
    .replace(/\s+/g, '')
    .trim();
}

/** 中文数字（一到九十九）转阿拉伯数字；只认这一档，认不出返回 null，别硬凑。 */
function chineseNumberToInt(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  if (/^\d{1,3}$/.test(s)) return Number(s);
  const digit = { 零: 0, 〇: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  // 十 / 十一 / 二十 / 二十三 / 九十九
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? digit[m[1]] : 1) * 10 + (m[2] ? digit[m[2]] : 0);
  if (/^[零〇一二两三四五六七八九]$/.test(s)) return digit[s];
  return null;
}

/**
 * 面板「正在看哪部」那格允许写成「咒术回战 第3集」：把集数摘出来，番名留给档案当 key。
 * 同一部番换集不改 key（只把 episode 往前推），换番才换 key——这样档案不会串成两份。
 *
 * 认得的写法：第3集 / 第3話 / 第3话 / 第 3 集 / EP3 / EP.3 / E03 / S2E3，中文数字认到九十九。
 * 季（第3季 / 第二季 / Season 2）不认成集，但同样摘掉：同一部番的第二季还是同一份档案，
 * 季留在 key 里就会分家。摘出来的季单独存进 season，标签上再写回去（「第2季 第3集」）。
 * 认不出的中文数字（一百零三、两集半）不硬转，episode 给 null。
 *
 * 返回 { series, episode, season }：
 *   series  = 摘掉集数、季标记之后的样子；摘完剩空（她只写了「第3集」）就回落成原串。
 *   episode = 数字，认不出是 null。
 *   season  = 数字，没写季是 null。
 * 匹配不到任何标记时 series 就是原串 trim 后的样子。
 */
function parseShowLabel(raw) {
  const original = String(raw ?? '').trim();
  if (original === '') return { series: '', episode: null, season: null };
  // 摘掉一段标记，顺带收干净多出来的空格和分隔符
  const cut = (s, index, len) => `${s.slice(0, index)} ${s.slice(index + len)}`
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—_·、,，:：|/]+|[\s\-–—_·、,，:：|/]+$/g, '')
    .trim();
  // 候选写法先都收集起来：一段里乱写两种（「某番 S2E3 第4集」）时按位置取最靠前的。
  const hits = [];
  const take = (m, episode, season) => {
    const n = Number(episode);
    if (m && typeof m.index === 'number' && Number.isFinite(n) && n > 0) {
      hits.push({ index: m.index, len: m[0].length, episode: n, season: season ?? null });
    }
  };
  // S2E3：整段摘掉，季单独留着（集数取 E 后面那个）
  let m = original.match(/\bS\s*(\d{1,2})\s*[.\-·]?\s*E\s*[.\-·]?\s*(\d{1,3})\b/i);
  if (m) take(m, m[2], Number(m[1]));
  // EP3 / EP.3 / E03（S2E3 不会被这条抢走：2 和 E 都是 \w，中间没有词边界）
  m = original.match(/\bEP?\s*[.\-·]?\s*(\d{1,3})\b/i);
  if (m) take(m, m[1]);
  // 第3集 / 第3話 / 第3话 / 第 3 集
  m = original.match(/第\s*(\d{1,3})\s*[集话話]/);
  if (m) take(m, m[1]);
  // 第三集 …… 第九十九集
  m = original.match(/第\s*([零〇一二两三四五六七八九十]{1,4})\s*[集话話]/);
  if (m) take(m, chineseNumberToInt(m[1]));
  let episode = null;
  let season = null;
  let series = original;
  if (hits.length > 0) {
    hits.sort((a, b) => (a.index - b.index) || (b.len - a.len));
    const hit = hits[0];
    episode = hit.episode;
    season = hit.season ?? null;
    series = cut(original, hit.index, hit.len);
    // 一段里写了两种标记（「某番 S2E3 第4集」）：剩下的也摘掉，key 里不该留着集数。
    for (let guard = 0; guard < 4; guard += 1) {
      const m2 = series.match(/第\s*(?:\d{1,3}|[零〇一二两三四五六七八九十]{1,4})\s*[集话話]/)
        || series.match(/\bEP?\s*[.\-·]?\s*\d{1,3}\b/i)
        || series.match(/\bS\s*\d{1,2}\s*[.\-·]?\s*E\s*[.\-·]?\s*\d{1,3}\b/i);
      if (!m2) break;
      series = cut(series, m2.index, m2[0].length);
    }
  }
  // 季标记：第二季 / 第2季 / 第2部 / Season 2。季不影响档案归集，摘出来单独存。
  if (season === null) {
    const sm = series.match(/第\s*(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*[季部]/);
    if (sm) {
      const n = chineseNumberToInt(sm[1]) ?? Number(sm[1]);
      if (Number.isFinite(n) && n > 0) { season = n; series = cut(series, sm.index, sm[0].length); }
    }
  }
  if (season === null) {
    const sm = series.match(/\bSeason\s*(\d{1,2})\b/i);
    if (sm) {
      const n = Number(sm[1]);
      if (Number.isFinite(n) && n > 0) { season = n; series = cut(series, sm.index, sm[0].length); }
    }
  }
  return { series: series !== '' ? series : original, episode, season };
}

/**
 * 档案该记第几集。三处来，优先级：面板手写的集数 > 窗口标题里认的 > 沿用档案里上次那一集。
 * 沿用这条有个前提：季要对得上——第二季没写集数时不能沿用第一集的第7集，
 * 不然第二季开头就被标成「第7集」。季没写（都 null）时照旧沿用。
 */
function pickEpisodeForArchive({ parsedEpisode, titleEpisode, prevEpisode, parsedSeason, prevSeason }) {
  const valid = (n) => Number.isFinite(Number(n)) && Number(n) > 0;
  if (valid(parsedEpisode)) return Number(parsedEpisode);
  if (valid(titleEpisode)) return Number(titleEpisode);
  if (!valid(prevEpisode)) return null;
  const a = parsedSeason === null || parsedSeason === undefined ? null : Number(parsedSeason);
  const b = valid(prevSeason) ? Number(prevSeason) : null;
  if (a !== null && b !== null && a !== b) return null;
  return Number(prevEpisode);
}

/** 窗口标题里有没有这部番的名字：两边都归一化后看包含，别的一概不算。 */
function titleHasShow(title, showName) {
  const t = normalizeShowName(title);
  const n = normalizeShowName(showName);
  return n !== '' && t.includes(n);
}

function loadShow(name) {
  const n = normalizeShowName(name);
  if (n === '') return null;
  const all = loadShows();
  // 先精确对 key，再退回归一化比较——对不上就返回 null，
  // 绝不拿「最像的那部」顶上：读错番比不读更糟（会把别部的剧情喂进去）。
  if (all[name] && typeof all[name] === 'object') return all[name];
  for (const key of Object.keys(all)) {
    if (normalizeShowName(key) === n) {
      const hit = all[key];
      return hit && typeof hit === 'object' ? hit : null;
    }
  }
  return null;
}
const CONFIG_PATH = path.join(STORAGE, 'config.json');
// 这一进程启动时配置早就存在吗：只有真第一次装才自动探测语音。
// 老用户哪怕没打过 voicePicked 标记（比如早就选了「静音」），也一律照文件里的来，
// 不能被开机探测顶回 say.mjs——2026-11-22 凌晨就是这么把她选的静音换成晓伊的。
const CONFIG_EXISTED_AT_BOOT = fs.existsSync(CONFIG_PATH);
const FRAMES = path.join(STORAGE, 'frames');
// 字幕窗读的那个文件。⚠ 这份是公共的：dsh-voice-say 的 voice_say 往同一个地方写，
// 所以不能塞在 whale-glance 自己的 storages 子目录里，得放平。
const HUD = path.join(DSH_HOME, 'storages', 'subtitle.txt');
// 宿主自己写进字幕条的提示语，不是陪看说过的话。
// 读回「上次说了什么」时要排掉，否则它会把提示当成自己的上一句接着复述。
const HUD_NOTES = new Set(['还在，先不吵。']);
const HUD_WINDOW = path.join(PACKAGE_ROOT, 'helper', 'hud_window.py');
const DANMAKU = path.join(PACKAGE_ROOT, 'helper', 'danmaku.py');
const ERROR_LOG = path.join(STORAGE, 'apply-error.txt');
// 每次陪看的完整账：提示词全文、截图路径、回复、token。
// wake-usage.log 只有数字，看不出它当时收到了什么；子代理那条路原本能在会话里翻，
// 改成直调以后就没有会话可翻了，这里是补回来的那份可回溯。
const LOOKS_DIR = path.join(STORAGE, 'looks');
// 一次陪看动辄四五十条，200 条只装得住三四局 —— 一晚上就把上一局挤掉了。
// 留 1000 条（约一整天），面板另按 LOOKS_SHOW 截，读取量和落盘量分开管。
const LOOKS_KEEP = 1000;
const LOOKS_SHOW = 400;
const ROUTE_PREFIX = '/whale-glance';
const SOURCE = { kind: 'plugin:dsh-whale-glance' };

/** 每句换个角度，免得翻来覆去一个腔调。 */
const ANGLES = [
  '随口说点什么，像坐在旁边看，不解释、不点评',
  '盯住画面里一样具体的东西说，说它像什么、在干什么',
  '看不懂就直接说看不懂，但你看见的那一下要说出来',
  '关心一句，但别说教，也别像在安排她',
  '一句没什么用的话，你自己看见那个想到的',
  '可以说一到两句，第二句才是重点',
];

// 番/剧这一档单独的角度：画面她自己看得见，别再把镜头和表情复述一遍。
const ANGLES_VIDEO = [
  '接剧情：这句话、这个动作意味着什么，说一句你的判断',
  '说说这人为什么这么干，拿不准就按「像是」说',
  '跟前面哪一段接上了、哪句台词跟之前呼应上了，就点出来',
  '这条线接下来会怎么走——只能猜，说清是猜的',
  '看懂的地方不多，就把看懂的那一点说清楚，剩下的直接说看不懂',
  '一句没什么用的话，你自己看见那个想到的',
];

// 三场景 × 三档的真实默认值。档位只管「多久采一次 / 多久说一句」，
// 出图形态是写死的（视频线字幕条+拼图、读字单张、动着拼图），档位不管它了。
// 切档不是换个标签——这几个数要真的落到 config 上，否则面板显示「平衡」，
// 底下还是上次手拖的 20 秒，谁也看不出哪里不对。
const PRESETS = {
  video: {
    save: { intervalMs: 2500, floorSec: 90 },
    balance: { intervalMs: 2500, floorSec: 60 },
    extreme: { intervalMs: 2000, floorSec: 45 },
  },
  game: {
    save: { intervalMs: 1500, floorSec: 90 },
    balance: { intervalMs: 1000, floorSec: 60 },
    extreme: { intervalMs: 1000, floorSec: 45 },
  },
};

const DEFAULTS = {
  auto: false,
  mode: 'game',   // 默认游戏；只有 video（追剧看片）和 game（打游戏）两个模式
  tier: { video: 'balance', game: 'balance', any: 'balance' },
  targetSession: '',                                // '' = 自动挑最活跃的那个
  sayCheck: '',                                     // 开口前过闸的命令，'' = 不过闸（别人的机器上没有这个脚本）
  intervalMs: 2500,
  floorSec: 60,
  silentMax: 300,                                    // 画面一直没变时，最多沉默这么久也看一眼
  singleEverySec: 180,                              // 全屏图多久才给一张；拼图不受它管
  cooldownMs: 45000,
  maxPerHour: 60,
  quietUntil: 0,
  hudOn: false,                                     // 字幕条开关；默认关，面板打开才起，不随 DSH 自动弹
  gameAutoFetch: true,                              // 认不出的游戏自动联网抓百科补库（关掉就不往外联网）
  autoLearn: false,                                 // 自动补黑话：识别到黑话少于阈值的游戏，自动搜攻略补到基础（默认关）
  windowMatch: '',
  currentShow: '',                                 // 视频模式手动指定的番名：比标题识别优先级高，只记进度不查剧情
  showMemory: false,                               // 看番建档开关：关=只看最近几句不建库；开=读 shows.json 续前情/人物/舞台
  windowOnly: false,
  personaHint: '',                                 // 陪看时的语气/口癖（比如「短句、直接、会吐槽」），空 = 通用腔
  speak: false,                                    // 陪看时是否出声朗读；默认静音，只出字
  ttsCommand: '',                                  // 朗读命令模板，{text} = 要念的话；空 = 不朗读。例：node ".../say.mjs" --text "{text}" --speak
  ttsBackend: 'none',                              // 语音后端：none / sapi / say.mjs（面板选，映射到 ttsCommand）
  ttsVoice: '',                                    // say.mjs 用的音色 id（如 zh-CN-XiaoyiNeural），空 = say.mjs 默认
  voicePicked: false,                              // 面板选过语音（含「静音」）就置 true：开机不再自动探测覆盖
  reactModel: 'deepseek-flash',                    // 陪看子代理模型：deepseek-account 下的 flash 就叫 deepseek-flash（之前能跑的那个）
  reactProvider: 'deepseek-account',               // 陪看子代理账号：官方账号登录，人人有
  directLlm: true,                                 // 陪看直接调模型（不走子代理）。true=先直调，失败自动退回子代理；false=一律走子代理
  credChannel: { bili: '', heybox: '' },           // 登录渠道：'' 还没选 / own 余光自己扫码 / borrow 借用隔壁插件
  firstRun: true,                                  // 第一次装：面板显示三步引导，点过任意交互后置 false
  intervalManual: false,                           // 用户手调过抓屏间隔：切档时不再覆盖
  floorManual: false,                              // 用户手调过最短开口：切档时不再覆盖
  danmakuOn: false,                                // 弹幕层开关（台词从右往左飘）
  hudStyle: 'dark',                                // 字幕窗配色：dark / light / glass（半透明玻璃）
  hudFontSize: 16,                                 // 字幕窗字号
  hudFontFamily: 'Microsoft YaHei',                // 字幕窗字体
  hudTextColor: '',                                 // 字幕文字颜色，空 = 跟随配色自带
  hudOpacity: 0.9,                                 // 字幕窗透明度 0.35-1.0
  hudFade: true,                                   // 字幕窗淡出总开关：关掉就一直亮着不自己躲
  hudHoldSec: 6,                                   // 字幕出来之后保持清楚多久（秒），然后开始淡
  hudFadeSec: 1.2,                                 // 淡出本身持续多久（秒）
  hudCapturable: false,                            // 字幕窗出不出现在「人自己」的截图/录屏里（陪看抓的是窗口自己渲染的画面，跟这条无关）
  danmakuCapturable: false,                        // 弹幕同上：管人自己的截图/录屏，不影响陪看
  danmakuFontSize: 16,                             // 弹幕字号
  danmakuFontFamily: 'Microsoft YaHei',            // 弹幕字体
  danmakuTextColor: '#eaf2ff',                        // 弹幕文字颜色
  danmakuZone: 'upper',                            // 弹幕区域：top/upper/middle/lower/bottom/full
  danmakuSpeedLevel: 'normal',
  danmakuSpeed: 220,                                // 弹幕速度（像素/秒），拉条用；老配置只有档位时按档位映射
  danmakuY: 0.15,                                  // 旧字段，留着兼容
};

function helperConfigPatch(config) {
  const mode = ['video', 'game'].includes(config.mode) ? config.mode : 'game';
  return {
    op: 'config',
    auto: config.auto === true,
    mode,
    tier: config.tier?.[mode] ?? 'balance',
    intervalMs: config.intervalMs,
    floorSec: config.floorSec,
    silentMax: config.silentMax,
    singleEverySec: config.singleEverySec,
    cooldownMs: config.cooldownMs,
    danmakuTextColor: config.danmakuTextColor,
    windowMatch: config.windowMatch ?? '',
    windowOnly: config.windowOnly === true,
    hudCapturable: config.hudCapturable === true,
    autoFetch: config.gameAutoFetch !== false,
  };
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const value = JSON.parse(raw);
    if (value !== null && typeof value === 'object') return { ...DEFAULTS, ...value };
  } catch {
    /* 首次运行 */
  }
  return { ...DEFAULTS };
}

function saveConfig(config) {
  try {
    fs.mkdirSync(STORAGE, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch {
    /* 写不进去也能看 */
  }
}

// 选中的解释器记在这里。选一次要真的 spawn 一下试，别每次起窗口都试一遍。
let pythonCache = null;

// 这个 python 到底能不能跑。DSH 更新运行时的时候会留下半成品目录
// （dsh-primary-runtime.previous 这种），python.exe 还在、stdlib 已经搬空，
// 一 spawn 就是「No module named encodings」当场退出——字幕条和弹幕都起不来，
// 面板上看着像点了没反应。所以光 existsSync 不够，得真问一句。
function pythonWorks(exe) {
  try {
    const r = spawnSync(exe, ['-c', 'import encodings, sys; sys.stdout.write("ok")'], {
      timeout: 8000,
      windowsHide: true,
      stdio: 'ignore',
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function pickPython() {
  const candidates = [];
  if (process.env.TENTACLE_PYTHON) candidates.push(process.env.TENTACLE_PYTHON);
  // DSH 自带的运行时装在 node/bin 旁边：dependencies/python/python.exe
  try {
    candidates.push(path.join(path.dirname(process.execPath), '..', '..', 'python', 'python.exe'));
  } catch {
    /* ignore */
  }
  try {
    const runtimes = path.join(DSH_HOME, 'dsh-runtimes');
    // 名字里带点的（.previous / .bak）是更新留下的残渣，排在正经运行时的后面，
    // 别让它的出现顺序决定用哪个。正经运行时也优先用新的。
    const names = fs.readdirSync(runtimes).filter((name) => !name.includes('.')).sort().reverse();
    for (const name of names) {
      candidates.push(path.join(runtimes, name, 'dependencies', 'python', 'python.exe'));
    }
  } catch {
    /* 没有运行时目录就退回 PATH */
  }
  candidates.push('python.exe', 'python3', 'python');
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) return candidate;
    if (!fs.existsSync(candidate)) continue;
    if (pythonWorks(candidate)) return candidate;
  }
  // 全都不行也得给个名字，让 spawn 自己报错，别在这儿静默返回一个空字符串
  return 'python';
}

function findPython() {
  if (pythonCache === null) pythonCache = pickPython();
  return pythonCache;
}

function findPythonW() {
  // 字幕窗不想弹黑框，优先用 pythonw；没有就退回 python（会闪一下命令行）
  const plain = findPython();
  if (!path.isAbsolute(plain)) return plain;
  const wide = plain.replace(/python\.exe$/i, 'pythonw.exe');
  return wide !== plain && fs.existsSync(wide) ? wide : plain;
}

// OCR（RapidOCR）装在 helper 用的那个 python 里。没装就退回「模型看图读字」，
// 数字容易读错（388 看成 394 这种）。这里探测装没装，面板据此给提示 + 一键装。
let ocrReady = null;   // null=还没探，true=可用，false=没装
let ocrCheckAt = 0;
function checkOcr() {
  // 一分钟内不重探：spawnSync 会卡一下，别让 /state 每次轮询都卡
  const now = Date.now();
  if (ocrReady !== null && now - ocrCheckAt < 60000) return ocrReady;
  ocrCheckAt = now;
  try {
    const r = spawnSync(findPython(), ['-c', 'import rapidocr_onnxruntime'], {
      timeout: 20000, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    ocrReady = r.status === 0;
  } catch {
    ocrReady = false;
  }
  return ocrReady;
}

/** 探测本机能用的朗读后端，返回 { voice, ttsCommand }。voice 取值 say.mjs / edge / sapi / none。
 *
 *  三档按「装了什么就能用」排：say.mjs（本地插件，有人没有）→ edge-tts（python 装了就能用，
 *  在线合成、音质好）→ Windows SAPI（系统自带，谁都有，音质一般）。都不行才落 none：只出字幕不出声。
 */
function detectVoice(voiceId = '') {
  const say = path.join(DSH_HOME, 'plugins', 'dsh-voice-say', 'say.mjs');
  if (fs.existsSync(say)) {
    const v = String(voiceId || '').trim();
    const extra = v ? ` --voice "${v}"` : '';
    return { voice: 'say.mjs', ttsCommand: `node "${say}" --text "{text}" --speak${extra}` };
  }
  // edge-tts 直连：不依赖 say.mjs，python 装了 edge_tts 就能念（先合成 mp3 再放）
  try {
    const py = findPython();
    if (py) {
      const probe = spawnSync(py, ['-c', 'import edge_tts'], { windowsHide: true, timeout: 8000 });
      if (probe.status === 0) {
        const v = String(voiceId || '').trim() || 'zh-CN-XiaoxiaoNeural';
        return {
          voice: 'edge',
          ttsCommand: `${py} -m edge_tts --voice "${v}" --text "{text}" --write-media "%TEMP%\\yuguang-say.mp3" && start "" "%TEMP%\\yuguang-say.mp3"`,
        };
      }
    }
  } catch { /* 探测失败就走 SAPI */ }
  if (process.platform === 'win32') {
    return {
      voice: 'sapi',
      ttsCommand: 'powershell -NoProfile -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak(\'{text}\')"',
    };
  }
  return { voice: 'none', ttsCommand: '' };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (parsed === null || typeof parsed !== 'object') throw new Error('body must be an object');
  return parsed;
}

export const name = 'dsh-whale-glance';
// llm 必须写进 inject：cordis 的 ctx 是受限的，没声明的服务一访问就抛
// 「cannot get property "llm" without inject」，连 typeof 判断都过不去。
// 2026-11-17 试过不声明、改用 ctx.get('llm') 兜底——同样被拦，三次全挂。
export const inject = ['tools', 'webServer', 'connection', 'agents', 'sessions', 'sessionTitle', 'subagents', 'attachments', 'llm'];

export function apply(ctx) {
  const config = loadConfig();

// ---- 直调模型（不借子代理）----
// 改这个的理由是维护成本，不是省钱。子代理那层的调用形状属于 DSH 内部实现，
// 它一改我们就栽：agentPreset 从 peek 改成 minimal 栽过，startActivation 的
// 参数在 2026-11-16 那次更新后报 undefined(id) 又栽过。ctx.llm 是下面一层，
// 形状照抄 DSH 自己的 dsh-session-title-llm，稳得多。
// 代价照实说：组消息、塞图、收流都得手写（就是下面这些）；
// 所以先直调、失败静默退回子代理，两条都断才记错误。
// 不能让它变成「换了新方案，结果一句话都说不出」——陪看最怕这个。
let llmDirectFails = 0;

async function askModelDirect({ text, imageBlocks, effort, maxTokens = 800, purpose = 'whale-glance', signal }) {
  // 两种拿法都试：ctx.llm（cordis 的成员访问）和 ctx.get('llm')。
  // 不确定这个宿主用哪种，拿不到就抛，上层会退回子代理。
  let llm = ctx.llm;
  if (!llm && typeof ctx.get === 'function') {
    try { llm = ctx.get('llm'); } catch { /* 没有就是没有 */ }
  }
  if (!llm || typeof llm.prepareCall !== 'function') throw new Error('宿主没有 llm 服务');
  const content = [{ type: 'text', text }];
  for (const b of imageBlocks ?? []) content.push(b);
  // message 自己造：createUserMessage 在 @deepseek-ai/dsh-llm 包里，
  // 插件没有这个依赖，node 解析不到。它的实现就是补 id/role 再冻结，照抄形状即可。
  const messages = [{
    id: crypto.randomUUID(),
    role: 'user',
    content,
    source: { kind: 'dsh-whale-glance' },
  }];
  const call = await llm.prepareCall(
    { provider: config.reactProvider, model: config.reactModel, maxTokens },
    signal,
    (controls) => ({ ...controls, ...(effort === undefined ? {} : { reasoningEffort: effort }) }),
  );
  let said = '';
  let usage = null;
  const kinds = new Set();
  let upstreamError = '';
  for await (const chunk of call.stream({ ...call.config, messages, purpose, signal })) {
    if (!chunk) continue;
    kinds.add(String(chunk.type ?? '?'));
    if (chunk.type === 'text-delta') said += chunk.text ?? '';
    else if (chunk.type === 'usage') usage = chunk.usage ?? null;
    else if (chunk.type === 'error') upstreamError = String(chunk.message ?? chunk.error?.message ?? '').slice(0, 200);
  }
  if (said.trim() === '') {
    // 空手回去最坑：上层只会看到「没解析出 JSON」，查不出是模型哑了、思考吃光了，还是流断了。
    // 把这件事本身变成异常，让 catch 记下来。
    throw new Error('模型没给正文：' + (upstreamError || `一个字都没输出（收到的块：${[...kinds].join(',') || '无'}）`));
  }
  return { said: said.trim(), usage };
}

/** 朗读一句话：合成 mp3 再用 MCI 播。后台进程里 SoundPlayer/MediaPlayer 都哑，只有 MCI 出声。
 *  通用化：有 dsh-voice-say 就走它合成 + MCI；没有就退回 ttsCommand（SAPI / edge 直连）。 */
function speakAloud(text) {
  return new Promise((resolve) => {
    const t = String(text || '').trim();
    if (t === '') { resolve(); return; }
    // speak 是总闸：false = 静音，只出字幕不出声。之前这里只看 ttsBackend，
    // 结果面板切了静音（speak=false）它照样读，因为 ttsBackend 启动时被自动探测成 sapi 了。
    if (config.speak !== true) { resolve(); return; }
    const backend = String(config.ttsBackend || 'none').trim();
    // SAPI：直接 powershell Speak，跟面板选的保持一致
    if (backend === 'sapi') {
      try {
        const script = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('" + t.replace(/'/g, "''") + "')";
        spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, stdio: 'ignore' });
      } catch { /* 念不出算了 */ }
      resolve();
      return;
    }
    const say = path.join(DSH_HOME, 'plugins', 'dsh-voice-say', 'say.mjs');
    // say.mjs 后端：合成 mp3 + MCI 播
    if (backend === 'say.mjs' && fs.existsSync(say)) {
      const voice = String(config.ttsVoice || '').trim();
      try {
        const proc = spawn(process.execPath, [say], { windowsHide: true });
        let out = '';
        proc.stdout.on('data', (d) => (out += d.toString()));
        proc.on('error', () => resolve());
        proc.on('close', () => {
          let file = '';
          try {
            const lines = out.split(String.fromCharCode(10)).filter((l) => l.trim());
            file = String(JSON.parse(lines[lines.length - 1]).file || '');
          } catch { /* 合成失败就不播 */ }
          if (file && fs.existsSync(file)) {
            const playScript = path.join(PACKAGE_ROOT, 'helper', 'play_mci.ps1');
            spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', playScript, file], { windowsHide: true, stdio: 'ignore' });
          }
          resolve();
        });
        proc.stdin.end(JSON.stringify({ text: t, speak: false, voice: voice || undefined }));
      } catch {
        resolve();
      }
      return;
    }
    // edge 直连：python edge_tts 合成 mp3，MCI 播
    if (backend === 'edge') {
      try {
        const py = findPython();
        const v = String(config.ttsVoice || '').trim() || 'zh-CN-XiaoxiaoNeural';
        const file = path.join(os.tmpdir(), 'yuguang-say.mp3');
        const proc = spawn(py, ['-m', 'edge_tts', '--voice', v, '--text', t, '--write-media', file], { windowsHide: true });
        proc.on('error', () => resolve());
        proc.on('close', () => {
          if (fs.existsSync(file)) {
            const playScript = path.join(PACKAGE_ROOT, 'helper', 'play_mci.ps1');
            spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', playScript, file], { windowsHide: true, stdio: 'ignore' });
          }
          resolve();
        });
      } catch {
        resolve();
      }
      return;
    }
    // 兜底：ttsCommand（edge 直连等）
    const tts = String(config.ttsCommand || '').trim();
    if (tts !== '') {
      try {
        spawn(tts.replace(/\{text\}/g, t), { shell: true, stdio: 'ignore', windowsHide: true });
      } catch { /* 念不出算了 */ }
    }
    resolve();
  });
}

// ---- 开口前过闸（可选，别人的机器上没有这个脚本就留空）----
// config.sayCheck 填一条命令：真说话之前先跑它，退出码 0 = 放行，非 0 = 这句话不许说。
// 命令里可以用 {text} 占位，没写占位符就把句子拼在末尾（跟 ttsCommand 的写法一致）。
// 起不来 / 超时 / 被信号杀掉一律放行——闸自己坏了不能把嘴焊死，那比多说一句更糟。
// 但「命令写错了」跟「闸说不许」返回的是同一种非零码（cmd 找不到命令也是 1），
// 这种分不出来，会一直拦。所以每次判定都写一行 say-gate.log：它突然不说话了，先看那儿。
function sayGate(text) {
  const tpl = String(config.sayCheck ?? '').trim();
  if (tpl === '') return Promise.resolve(true);
  // 换行会让命令行断成两条；双引号在 cmd 里没法可靠转义，统一换成单引号。
  const line = String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'");
  // 句子必须包在引号里，否则里面的 & | > ^ 会被 cmd 当成分隔符把命令切碎。
  // 模板自己写了 "{text}" 的（跟 ttsCommand 一个写法）就别再套一层引号。
  const at = tpl.indexOf('{text}');
  const quoted = (at > 0 && /["']/.test(tpl[at - 1]) && /["']/.test(tpl[at + 6] ?? '')) ? line : `"${line}"`;
  const cmd = at >= 0 ? tpl.split('{text}').join(quoted) : `${tpl} "${line}"`;
  return new Promise((resolve) => {
    let child = null;
    let settled = false;
    const finish = (ok, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        fs.appendFileSync(path.join(STORAGE, 'say-gate.log'), JSON.stringify({ at: Date.now(), ok, why, cmd: tpl, text: line.slice(0, 160) }) + '\n', 'utf8');
      } catch { /* 日志写不出不影响说话 */ }
      resolve(ok);
    };
    const timer = setTimeout(() => {
      try { child?.kill(); } catch { /* 忽略 */ }
      finish(true, 'timeout');
    }, 5000);
    try {
      child = spawn(cmd, { shell: true, windowsHide: true, stdio: 'ignore' });
    } catch (error) {
      finish(true, 'spawn-error: ' + String(error?.message ?? error));
      return;
    }
    child.on('error', (e) => finish(true, 'error: ' + String(e?.message ?? e)));
    child.on('close', (code, signal) => {
      // code === null：被信号杀掉（不是闸的判词，是环境出了事）→ 放行。
      if (code === null) finish(true, 'killed: ' + String(signal));
      else finish(code === 0, code === 0 ? 'pass' : 'blocked: exit ' + String(code));
    });
  });
}

  // 语音开机自动配一次：只在用户从没选过（voicePicked 不是 true）且是 none / 空时才探测；
  // 选过就一律照上次的来——她选「静音」也是选择，开机不能被探测顶回 say.mjs。
  // 用户已经手动选了 sapi / say.mjs，就尊重，别探测后覆盖（不然选 sapi 也会被顶回 say.mjs）。
  try {
    if (CONFIG_EXISTED_AT_BOOT !== true && config.voicePicked !== true && String(config.ttsCommand ?? '').trim() === '' && (String(config.ttsBackend ?? 'none') === 'none' || String(config.ttsBackend ?? '').trim() === '')) {
      const probe = detectVoice(config.ttsVoice);
      config.ttsCommand = probe.ttsCommand;
      config.ttsBackend = probe.voice;
      config.voicePicked = true;
      saveConfig(config);
    } else if (String(config.ttsBackend ?? 'none') === 'none' && String(config.ttsCommand ?? '').trim() !== '') {
      config.ttsBackend = /say\.mjs/i.test(config.ttsCommand) ? 'say.mjs' : 'sapi';
      saveConfig(config);
    }
  } catch { /* 探测失败不影响别的 */ }
  // 陪看（auto）开机从关开始：上次开着是上次的事，开机不该自动看屏幕、烧钱。
  // 字幕窗和弹幕不烧钱，上次开着就接着开（下面 stopDanmaku 之后真正拉起）。
  if (config.auto === true) {
    config.auto = false;
    saveConfig(config);
  }
  const disposers = [];

  let helper = null;
  let hud = null;
  let danmaku = null;
  let helperReady = false;
  let disposed = false;
  let restarts = 0;
  let restartTimer = null;
  let buffer = '';
  let lastError = '';
  let lastEvent = null;
  let lastReactAt = 0;
  // 失败也要记一笔：找不到会话、在途跳过这些早退分支以前连计时都不留，
  // 于是每一帧都重试一遍，日志刷满、额度空转。
  let lastAttemptAt = 0;
  // 刚打开陪看的时间：开着面板的那一刻前台还是 DSH，立刻抓一帧就会对着自己的界面说话。
  // 留几秒缓冲，让她先切到游戏/视频。
  let autoOnAt = 0;
  // 一次只跑一个陪看子代理：在途时新的事件直接跳过，不排队（旧画面排队更没意义）
  let reactInFlight = false;
  // 在途的那个子代理激活。关停时要主动 dispose 掉它：
  // 它挂在宿主的子代理服务里，留着不让走，宿主就等不到「所有任务都停了」。
  let liveActivation = null;
  // 连续几次「没什么想说的」就拉长冷却：没话说的画面不该反复烧钱。
  let silenceStreak = 0;
  const reactTimes = [];
  let waitingQueue = [];
  // 认不出的游戏，攒起来等面板来问；只存标题和 exe，最多 20 条
  const pendingGames = {};
  // 「看不清就升档」的护栏：上次升档的时间戳，避免越看不清越花钱的死循环
  let lastTierUpAt = 0;
  // 上一次看的是哪个窗口。换窗口/换游戏 = 新的一局，要把上一局的对话记忆清掉，
  // 否则它会把上一款游戏里说过的话拿到这一款来接着讲。
  let lastSeenTitle = '';
  // 最近一次认出的游戏：面板上显示「认出什么、资料哪来的」，省得从台词里反推
  let lastGame = null;
  // 最近一次自动补库学到的游戏：面板显示「刚学到 XXX」，让人看见自动学习的过程
  let lastLearned = null;
  // 「看一眼」去抖：按钮 + 热键 + 连点可能在同一秒连发两次，同一张图喂两遍
  let lastLookAt = 0;

  /** 最近活跃的 agent（只认主会话，不认子代理）。 */
  let liveAgent = null;
  function rememberAgent(agent) {
    try {
      if (agent?.session?.header?.origin === 'subagent') return;
      const id = agent?.session?.header?.id;
      if (typeof id === 'string' && id.length > 0) liveAgent = agent;
    } catch {
      /* 结构变了就算了 */
    }
  }

  function agentList() {
    try {
      const service = ctx.agents ?? (typeof ctx.get === 'function' ? ctx.get('agents') : undefined);
      const list = typeof service?.list === 'function' ? service.list() : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function sessionIdOf(session) {
    if (!session) return '';
    // 各版本字段名不一样，挨个试；header 里通常没有 id，真身在 session 上
    for (const key of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
      try {
        const value = session[key];
        if (typeof value === 'string' && value !== '') return value;
      } catch {
        /* 取不到就试下一个 */
      }
    }
    return '';
  }

  // agent 上有没有 session 这一层，各版本不一样。id 可能挂在 session 上，
  // 也可能直接挂在 agent 上；两处都试，别因为读错了层就把整个下拉框弄成空的。
  function idOfAgent(agent) {
    return sessionIdOf(agent?.session) || sessionIdOf(agent) || '';
  }

  function titleOfSession(agent, id) {
    try {
      const session = ctx.sessions?.get?.(id) ?? agent?.session;
      const snap = ctx.sessionTitle?.get?.(session);
      const title = String(snap?.title ?? '').trim();
      if (title !== '') return title;
    } catch {
      /* 拿不到就用 header 里的 */
    }
    const header = agent?.session?.header ?? agent?.header ?? {};
    return String(header.title ?? '').trim();
  }

  function listSessions() {
    const out = [];
    for (const agent of agentList()) {
      const session = agent?.session ?? agent ?? {};
      const header = session.header ?? {};
      if (header.origin === 'subagent') continue;
      const id = idOfAgent(agent) || String(header.id ?? '');
      if (id === '') continue;
      const raw = titleOfSession(agent, id);
      out.push({
        id,
        title: raw === '' ? '（没有标题的会话）' : raw,
        at: Number(header.updatedAt ?? session.updatedAt ?? 0),
      });
    }
    return out;
  }

  function resolveAgent() {
    const wanted = String(config.targetSession ?? '');
    if (wanted !== '') {
      const hit = agentList().find((agent) => idOfAgent(agent) === wanted || sessionIdOf(agent?.session) === wanted);
      if (hit !== undefined && hit !== null) {
        liveAgent = hit;
        return hit;
      }
    }
    if (liveAgent !== null) return liveAgent;
    try {
      const list = agentList();
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const agent = list[index];
        const header = agent?.session?.header ?? agent?.header ?? {};
        if (header.origin !== 'subagent') {
          liveAgent = agent;
          return agent;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  // 窗口自己退了（人点了×、或者它崩了）：配置里那个开关跟着关掉。
  // 不关的话面板上还亮着「开」，人以为字幕条还在，其实屏幕上什么也没有。
  // 面板每几秒拉一次 /state，那里带着 config，下次轮询就把开关翻过来。
  function forgetWindow(kind) {
    const key = kind === 'hud' ? 'hudOn' : 'danmakuOn';
    try {
      if (config[key] !== false) config[key] = false;
      const fresh = loadConfig();
      if (fresh[key] !== false) {
        fresh[key] = false;
        saveConfig(fresh);
      }
    } catch {
      /* 写不下去就算了，下次开机再关 */
    }
  }

  // 字幕窗：插件起来它就起来，插件停了子进程跟着死（stdio 断开后 tkinter 那边
  // 读不到 stdin 也只是个空窗，索性用 exit 事件清账）
  function startHudWindow() {
    if (hud !== null && hud.exitCode === null) return;
    try {
      fs.mkdirSync(STORAGE, { recursive: true });
      // 每次起来都清空一次。上一次的字留在里面，下次开机就被它读出来当话显示，
      // 人一开 DSH 就看见一句旧话浮在角上，像是它一直在自言自语。
      fs.writeFileSync(HUD, '', 'utf8');
      hud = spawn(findPythonW(), [HUD_WINDOW, HUD, path.join(STORAGE, 'chat-input.txt'), CONFIG_PATH], {
        cwd: PACKAGE_ROOT,
        stdio: 'ignore',
        windowsHide: true,
        // 宿主 pid 传给字幕窗：宿主退了这个子进程才知道自己该走。Windows 不跟着父进程
        // 收子进程，以前 DSH 一重启，屏上那条字幕就留在原地，下次再开就多出一条。
        env: { ...process.env, HUD_PARENT_PID: String(process.pid) },
      });
      hud.on('exit', () => {
        hud = null;
        forgetWindow('hud');
      });
      hud.on('error', (error) => {
        lastError = `字幕窗没起来：${String(error?.message ?? error)}`;
        hud = null;
        forgetWindow('hud');
      });
    } catch (error) {
      lastError = `字幕窗没起来：${String(error?.message ?? error)}`;
    }
  }

  function startDanmaku() {
    if (danmaku !== null && danmaku.exitCode === null) return;
    try {
      danmaku = spawn(findPythonW(), [DANMAKU, HUD, CONFIG_PATH], {
        cwd: PACKAGE_ROOT,
        stdio: 'ignore',
        windowsHide: true,
      });
      danmaku.on('exit', () => {
        danmaku = null;
        forgetWindow('danmaku');
      });
      danmaku.on('error', () => {
        danmaku = null;
        forgetWindow('danmaku');
      });
    } catch {
      /* 弹幕起不来不影响字幕 */
    }
  }

  function stopHudWindow() {
    if (hud === null) return;
    try {
      hud.kill();
    } catch (error) {
      // 已经死了就死了，不用管
    }
    hud = null;
  }

  // 字幕条到底出不出，跟着配置走。默认关，只有面板里明确打开才起。
  function applyHud() {
    if (loadConfig().hudOn === true) startHudWindow();
    else stopHudWindow();
  }

  function applyDanmaku() {
    if (loadConfig().danmakuOn === true) startDanmaku();
    else stopDanmaku();
  }

  function stopDanmaku() {
    if (danmaku === null) return;
    try {
      danmaku.kill();
    } catch {
      /* 已死 */
    }
    danmaku = null;
  }

  // 字幕窗和弹幕开机一律从关着开始：一开 DSH 不用自己冒出两个窗口。
  // 上次开着是上次的事；想看的时候去面板里点开。
  if (config.hudOn === true || config.danmakuOn === true) {
    config.hudOn = false;
    config.danmakuOn = false;
    saveConfig(config);
  }

  function restartHelper() {
    // 杀掉现有 helper，它的 exit 回调会自动重拉（带退避）
    if (helper !== null && helper.exitCode === null) {
      try { helper.kill(); } catch { /* ignore */ }
    }
  }

  function installOcr() {
    // 给 helper 用的 python 装 RapidOCR + 登录二维码用的 qrcode。
    // 约 200MB（onnxruntime + 模型），异步跑，装完重启 helper，让 sense.py 重新 import 就能用。
    const py = findPython();
    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(py, ['-m', 'pip', 'install', 'rapidocr-onnxruntime', 'onnxruntime', 'opencv-python', 'qrcode'], {
          windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
      } catch (error) {
        resolve({ ok: false, message: String(error?.message ?? error) });
        return;
      }
      // stdout 也必须读走：pip 往 stdout 打进度，管道没人读、缓冲区（Windows 上约 64KB）一满，
      // pip 就卡在 write 上，close 永远不来——面板上按「装 OCR」就成了永远转圈。
      let err = '';
      let out = '';
      proc.stdout?.on('data', (d) => { if (out.length < 8000) out += String(d); });
      proc.stderr?.on('data', (d) => { err += String(d); });
      proc.on('error', (e) => resolve({ ok: false, message: String(e?.message ?? e) }));
      proc.on('close', (code) => {
        ocrReady = null;
        ocrCheckAt = 0;
        if (code === 0) {
          restartHelper();
          resolve({ ok: true });
        } else {
          resolve({ ok: false, message: err.slice(-500) });
        }
      });
    });
  }

  function startHelper() {
    if (helper !== null && helper.exitCode === null) return helper;
    const spawnedAt = Date.now();
    // 先确认 python 真能跑：别人机器上可能根本没有，起不来的话面板要看见原因，别静默失败
    const py = findPython();
    try {
      const probe = spawnSync(py, ['-c', 'print(1)'], { windowsHide: true, timeout: 10000 });
      if (probe.error || probe.status !== 0) {
        lastError = `找不到能用的 Python（试过 ${py}）。余光要靠它抓屏认字，先装个 Python 3.10 以上再打开。`;
        return null;
      }
    } catch (error) {
      lastError = `Python 起不来：${String(error?.message ?? error)}`;
      return null;
    }
    // 启动时不自动开字幕窗：想开在面板里点，免得每次开 DSH 都蹦出来
    try {
      helper = spawn(py, [HELPER], {
        cwd: PACKAGE_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
          SENSE_OUT_DIR: FRAMES,
        },
      });
    } catch (error) {
      lastError = String(error?.message ?? error);
      return null;
    }
    helperReady = false;
    buffer = '';
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line === '') continue;
        try {
          handleHelperEvent(JSON.parse(line));
        } catch {
          /* 非协议输出忽略 */
        }
      }
    });
    helper.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text !== '' && /(Error|Traceback|Exception|失败)/.test(text)) lastError = text.slice(-400);
    });
    helper.on('exit', (code) => {
      helper = null;
      helperReady = false;
      if (disposed) return;
      // 刚起来就正常退出：另一个会话已经占着屏幕了，这边别再争着拉一个新的
      if (code === 0 && Date.now() - spawnedAt < 4000) {
        lastError = '另一个会话正在陪看，这边先歇着';
        return;
      }
      {
        // 帮工崩了就歇几秒再拉起来；连崩就慢慢退避，别疯狂重启。
        restarts += 1;
        const delay = Math.min(30000, 2000 * restarts);
        restartTimer = setTimeout(() => {
          restartTimer = null;
          if (!disposed) startHelper();
        }, delay);
        if (typeof restartTimer.unref === 'function') restartTimer.unref();
      }
    });
    return helper;
  }

  function sendHelper(payload) {
    const proc = helper;
    if (proc === null || proc.exitCode !== null) return false;
    try {
      proc.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  function handleHelperEvent(event) {
    if (event?.event === 'ready') {
      helperReady = true;
      restarts = 0;
      sendHelper(helperConfigPatch(config));
      return;
    }
    if (event?.event === 'error') {
      lastError = String(event.message ?? 'unknown');
      return;
    }
    if (event?.event === 'config') {
      // 帮工切档时会把预设参数算好回传，这边跟着记下，免得下次推配置又盖回去
      let dirty = false;
      for (const key of ['intervalMs', 'floorSec', 'cooldownMs']) {
        if (typeof event[key] === 'number' && config[key] !== event[key]) {
          config[key] = event[key];
          dirty = true;
        }
      }
      if (typeof event.mode === 'string' && event.mode !== config.mode) {
        config.mode = event.mode;
        dirty = true;
      }
      if (dirty) saveConfig(config);
      return;
    }
    if (event?.event === 'hotkey') {
      // 全局热键（Ctrl+Alt+G）：不管用户在哪个窗口，按一下都算「看一眼」
      void (async () => {
        try {
          const snapEvent = await snap();
          // 抓拍被跳过（没窗口、去抖、涂黑失败）时，别拿一个空事件让它对着没图说话
          if (!snapEvent || snapEvent.skipped === true) return;
          react({ ...snapEvent, event: 'snap' }, { looked: true });
        } catch {
          /* 抓不到就算了，不值得报错 */
        }
      })();
      return;
    }
    if (event?.event === 'unknown-game') {
      // 帮工认不出的游戏，攒起来给面板挂「这是不是游戏」卡片；不弹窗、不打断
      const title = String(event.title ?? '').trim();
      if (title.length > 0) {
        pendingGames[title] = {
          title,
          exe: String(event.exe ?? ''),
          at: Number(event.at ?? Date.now()),
        };
        // 认不出的窗口会一直来：切窗口、开网页、改标题都算，不封顶就是一整晚的泄漏。
        const keys = Object.keys(pendingGames);
        if (keys.length > 50) {
          keys.sort((a, b) => Number(pendingGames[a].at ?? 0) - Number(pendingGames[b].at ?? 0));
          for (const k of keys.slice(0, keys.length - 50)) delete pendingGames[k];
        }
      }
      return;
    }
    if (event?.event === 'game-detected') {
      // 认出游戏了：记下名字和类型，面板上显示「当前认出什么」。
      // 让人一眼看出它是有资料还是瞎猜，不用从台词里反推。
      lastGame = {
        title: String(event.title ?? ''),
        game: String(event.game ?? ''),
        genres: Array.isArray(event.genres) ? event.genres : [],
        from: String(event.from ?? 'local'),
        at: Number(event.at ?? Date.now()),
      };
      // 自动补黑话：认出游戏了，若开关开着且黑话少，后台静默搜攻略补到基础
      void maybeAutoLearn(String(event.game ?? '')).catch(() => {});
      return;
    }
    if (event?.event === 'game-learned') {
      // 自动补库补到新游戏了：记下来，面板显示「刚学到 XXX」，
      // 让「自动认游戏 + 自己查资料」这个过程能被人看见。
      lastLearned = {
        title: String(event.title ?? ''),
        game: String(event.game ?? ''),
        genres: Array.isArray(event.genres) ? event.genres : [],
        at: Date.now(),
      };
      return;
    }
    if (event?.event === 'windows' || event?.event === 'recent' || event?.event === 'snap') {
      lastEvent = event;
      // 队列里找到对应的等待者再兑现：以前是单槽，采样和「看一眼」同时要图时，
      // 后来的把先来的挤掉，先来的那个就永远等不到、只能超时。
      const idx = waitingQueue.findIndex((w) => w.kind === event.event || w.any === true);
      if (idx >= 0) {
        const entry = waitingQueue[idx];
        waitingQueue.splice(idx, 1);
        clearTimeout(entry.timer);
        entry.resolve(event);
      }
      return;
    }
    if (event?.event === 'change') {
      lastEvent = event;
      const idx = waitingQueue.findIndex((w) => w.any === true);
      if (idx >= 0) {
        const entry = waitingQueue[idx];
        waitingQueue.splice(idx, 1);
        clearTimeout(entry.timer);
        entry.resolve(event);
      }
      maybeReact(event);
    }
  }

  // 软限：撞上限不关机，只放慢。
  // 旁边的人突然没声，没人会想到「额度用完了」——只会觉得网断了，或者他走了。
  // 所以越接近上限，说话间隔越长：×1 → ×2 → ×4 → ×8，人一直在。
  const SLOW_STEPS = [1, 2, 4, 8];

  function throttleFactor(now) {
    if (!config.auto) return 0;                                   // 总开关真的关掉
    if (now < Number(config.quietUntil ?? 0)) return 0;            // 手动静音
    const cutoff = now - 3600000;
    while (reactTimes.length > 0 && reactTimes[0] < cutoff) reactTimes.shift();
    const limit = Math.max(1, Math.round(Number(config.maxPerHour ?? 60)));
    const left = limit - reactTimes.length;
    if (left <= 0) return SLOW_STEPS[3];
    if (left <= Math.max(1, Math.round(limit * 0.08))) return SLOW_STEPS[2];
    if (left <= Math.max(2, Math.round(limit * 0.25))) return SLOW_STEPS[1];
    return SLOW_STEPS[0];
  }

  function leftThisHour() {
    const cutoff = Date.now() - 3600000;
    const used = reactTimes.filter((at) => at >= cutoff).length;
    return Math.max(0, Math.round(Number(config.maxPerHour ?? 60)) - used);
  }

  // ---- 口癖配额：数它自己刚说过的话，重复的开头这一句就禁掉 ----
  // 提示词里那句「口头禅最多三成」其实管不住什么：每次唤醒都是一次独立的调用，
  // 它看不到自己这一局已经用了多少，配额等于没有。这里直接从最近几句里数开头词，
  // 谁重复出现就把谁列给它换掉。不认具体是哪个词——换人设、换口癖也照样成立。
  // 开头词只取行首连续的汉字，最多四个，遇到标点/空格/数字/字母就停。实测 HUD 里
  // 的写法是「嗯，…」「说真的，…」「行吧，…」：聊天记录里 452 句以「嗯」开头的
  // 全都紧跟标点，「说真的」「行吧」也一样，所以标点就是天然的词边界。
  const OPENING_RE = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{1,4}/;

  function openingWord(line) {
    const match = OPENING_RE.exec(String(line ?? '').trim());
    return match ? match[0] : '';
  }

  // 重复出现过（≥2 次）的开头词，最多 max 个。次数多的优先，次数一样按第一次
  // 出现的先后排——同一批输入结果一定一样，不会因为排序抖动换来换去。
  function repeatedOpenings(lines, max = 3) {
    const stats = new Map();
    lines.forEach((line, index) => {
      const word = openingWord(line);
      if (word === '') return;
      const hit = stats.get(word);
      if (hit) hit.count += 1;
      else stats.set(word, { count: 1, first: index });
    });
    return [...stats.entries()]
      .filter(([, hit]) => hit.count >= 2)
      .sort((a, b) => (b[1].count - a[1].count) || (a[1].first - b[1].first))
      .slice(0, max)
      .map(([word]) => word);
  }

  async function react(event, options = {}) {
    const agent = resolveAgent();
    if (agent === null) {
      try {
        fs.appendFileSync(path.join(FRAMES, 'react-debug.log'), JSON.stringify({ at: new Date().toISOString(), step: 'no-agent', event: event?.event ?? '' }) + '\n');
      } catch { /* 日志写不出就算了 */ }
      return false;
    }
    // 一次只跑一个：子代理一次要 30–60 秒，这期间又冒出两三个变化事件，
    // 就会并发起好几个子代理，各自看到不同瞬间的画面、互相打脸（实测出现过
    // 「上一条说错了，是——」）。在途时直接跳过，不排队——排队的旧画面更没意义。
    if (reactInFlight) {
      try {
        fs.appendFileSync(path.join(FRAMES, 'react-debug.log'), JSON.stringify({ at: new Date().toISOString(), step: 'in-flight', event: event?.event ?? '' }) + '\n');
      } catch { /* 日志写不出就算了 */ }
      return false;
    }
    reactInFlight = true;
    try {
      return await reactOnce(event, options);
    } finally {
      reactInFlight = false;
    }
  }

  async function reactOnce(event, options = {}) {
    const agent = resolveAgent();
    if (agent === null) return false;
    // 屏幕变化是自发事件，不在任何 agent 的 driver 链里；requireInitiator() 会抛
    // "no initiating agent is active"，未捕获的 rejection 被 Cordis 判为 fatal load
    // failure，直接带崩整个 Host。改用官方的可选查询，没有就退回目标会话。
    let parent = agent;
    try {
      parent = (typeof ctx.agents?.currentInitiator === 'function' ? ctx.agents.currentInitiator() : undefined) ?? agent;
    } catch {
      /* 服务已释放：直接用目标会话 */
    }
    const pct = Math.round(Number(event.score ?? 0) * 100);
    const title = String(event.title ?? '').trim() || '未知窗口';
    // 换窗口/换游戏 = 新的一局：清掉字幕当前显示的几句，防止上一局的话被当成「刚说过」带过来。
    // 但 chat-history.txt 是留档，**不能清** —— 清了以后在会话里问「刚才陪我看的那局说了什么」
    // 就再也查不到了。子代理省钱靠的是用完就散，不是靠删档案。
    if (lastSeenTitle !== '' && title !== lastSeenTitle) {
      try {
        fs.writeFileSync(HUD, '', 'utf8');
      } catch {
        /* 清不掉就算了，别影响这一轮 */
      }
    }
    lastSeenTitle = title;
    const mode = ['video', 'game'].includes(event.mode) ? event.mode : 'game';
    const game = String(event.game ?? '').trim();
    const gameInfo = event.game_info && typeof event.game_info === 'object' ? event.game_info : null;
    // 视频模式：番名只认手动填的（标题识别不可靠，全屏抓不到）。
    // 只读「最近一集的前情」，不把舞台/人物/整份档案塞进来——那会撑长 prompt、拖慢响应。
    let showInfo = null;
    // 眼前在看第几集：面板那格写明的优先（她换集会改这一格），其次才是档案里上次存下的。
    let watchingEpisode = null;
    if (mode === 'video' && config.showMemory === true) {
      // 那格可能写成「咒术回战 第3集」：读档案和拼前情都只认番名，集数单独带着走。
      const showParsed = parseShowLabel(config.currentShow);
      const showName = showParsed.series;
      // 前情只在「眼前这一部确实是它」时才拼。两条判据任一成立就算：
      //   1) 手动填的番名出现在窗口标题里；
      //   2) 眼前这个窗口就是面板里选定要看的那个（windowMatch 命中）——播放器标题
      //      经常只有播放器名（Ficket / PotPlayer / 浏览器标签），番名永远进不去标题，
      //      只认标题等于这条功能永远不生效（11-20 实测连看三集，一次前情都没拼上）。
      // 但也不能只问「填没填」：11-19 那局看的是《文明与地图》，十五次提示词全带着
      // 「前面演到：虎杖悠仁…」，所以「盯着的不是那个窗口」就不算。
      const watchWindow = String(config.windowMatch ?? '').trim().toLowerCase();
      const onWatchedWindow = watchWindow !== '' && String(title).toLowerCase().includes(watchWindow);
      if (showName !== '' && (titleHasShow(title, showName) || onWatchedWindow)) {
        showInfo = loadShow(showName) || null;
        const stored = Number(showInfo?.episode);
        watchingEpisode = showParsed.episode !== null
          ? showParsed.episode
          : (Number.isFinite(stored) && stored > 0 ? stored : null);
      }
    }
    const ocrText = String(event.ocrText ?? '').trim();
    lastOcrText = ocrText;
    const count = Number(event.count ?? 1);
    const frames = Array.isArray(event.frames) ? event.frames : [];
    const frameCount = frames.length;
    const stamps = frames.length > 0
      ? frames.map((frame) => `${Number(frame.t ?? 0).toFixed(1)}s`).join(' / ')
      : '';
    const images = Array.isArray(event.images) && event.images.length > 0
      ? event.images
      : [{ kind: 'sheet', path: event.path }];
    const kindLine = (img) => {
      if (img.kind === 'sheet') return `- ${img.path}（拼图）`;
      if (img.kind === 'strip') return `- ${img.path}（字幕条）`;
      if (img.kind === 'zoom') return `- ${img.path}（右上角）`;
      return `- ${img.path}（单张）`;
    };
    const shapeTag = images.length > 1
      ? `（${images.map((img) => (img.kind === 'sheet' ? '拼图' : img.kind === 'strip' ? '字幕条' : img.kind === 'zoom' ? '右上角' : '单张')).join(' + ')}）`
      : '';
    // 每种场景只说「往哪儿看」，而且用的是外行眼睛：谁在动、什么颜色、哪儿变了。
    // 这套要能给别人用，不能一开口就问人口和小地图。
    const CHECK = {
      video: '画面里发生了什么、这人什么情绪、字幕这句意味着什么',
      game: '资源够不够、兵多不多、这手值不值、对面强不强、有没有危险',
      any: '屏幕上最要紧的是什么、这个变化意味着什么',
    };
    // 收件会话的短 id：一眼看出这条落到了哪个窗口，发错了能立刻发现
    const toId = String(idOfAgent(agent) || '?').replace(/^session-/, '').slice(0, 8);
    const head = options.recent
      ? `[余光·${toId}]${shapeTag} 主人让你回头看「${title}」刚才那 ${Number(options.seconds ?? 30)} 秒。`
      : options.looked
        ? `[余光·${toId}]${shapeTag} 主人点了你一下，让你看他现在的屏幕（前台窗口「${title}」）。`
        : `[余光·${toId}]${shapeTag} ${game ? `在玩「${game}」` : `前台窗口「${title}」`}，画面变了约 ${pct}%。`;
    const anglePool = mode === 'video' ? ANGLES_VIDEO : ANGLES;
    const angle = anglePool[Math.floor(Math.random() * anglePool.length)];
    // 上次说过什么。质量闸不在次数上——同一屏、同一类说法，第二次就该闭嘴。
    let lastSaid = '';
    try {
      // HUD 里存的是最近五句（一行一句）。带**最近三条**（约三十秒到一分钟的记忆），
      // 它上一段要是把人物关系说对了，下一段才接得上；只带一条就断了。
      const hudLines = String(fs.readFileSync(HUD, 'utf8'))
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '')
        // 字幕条里混着宿主写的提示语（撞上限那句），那是给她看的，不是它说过的。
        .filter((l) => !HUD_NOTES.has(l));
      lastSaid = hudLines.slice(-5).join('\n').slice(0, 400);
    } catch {
      /* 读不到就当没说过 */
    }
    // 口癖配额：最近这几句里同一个开头用了几遍，直接列出来让它这一句换掉。
    // 读不到 HUD 就一条都不加（只有长度约束那一行），绝不在这里编一个禁用词。
    const repeatWords = lastSaid === '' ? [] : repeatedOpenings(lastSaid.split('\n'));
    // 这段话要短。写成检查表，它就会把力气花在「我有没有违规」上，
    // 然后开始写检讨——而它该做的只是抬头看一眼，说一句。
    // 固定的那段放最前。DeepSeek 的前缀缓存是从第一个 token 起逐字比的，
    // 以前人设夹在 OCR 和图片路径后面，前面全是每次都变的东西，缓存命中恒为 0。
    // 把「你是谁、怎么说话」提到开头，这一段就能被复用；变化的部分全挪到后面。
    // 上一局的摘要只提一次。整局每二十秒拼一遍提示词，带上就是同一段话烧几百遍。
    const prevBrief = play && play.prev && !play.prevUsed ? play.prev : '';
    if (prevBrief) play.prevUsed = true;
    const text = [
      // 屏幕字的举例也按场景分开：番剧里没有血条和伤害数字，别让它去找这些。
      // 这一句在最前面（前缀缓存锚点），但 mode 一局内是常量，拼出来的文本照旧稳定。
      `这是陪看。你看着她的屏幕，看到什么就随口说一句你的看法——有意思的地方、可疑的操作、能接的闲话都行，别憋出大道理才开口。只有画面真的空无一物（黑屏、纯菜单、什么动静都没有）才回「没什么想说的」。别回句号或空话。开口就说人话，别催她做动作（她可能正在想、正在看），也别编画面里没有的数字，别把整屏字复述一遍。屏幕上的字（${mode === 'video' ? '字幕、界面文字' : '血条、名字、伤害'}、提示）可以拿来用。图太糊、字和细节看不清，就回一句以「看不清」开头的短话，宿主会放大画面再给你看。`,
      // 阵营标识、并排数字这套是游戏专用的：番剧里没有「敌方」「红蓝名字」这回事，
      // 塞进去只会把它往对战思路上带，还白占 token。只在打游戏时加。
      ...(mode === 'video'
        ? []
        : ['画面上有明确阵营标识（友方、队友、敌方、红蓝名字）就按标识判断谁是谁；没有标识才靠位置猜，拿不准按队友说。并排的数字先认它是什么（等级、血量、资源、击杀、比分都可能），拿不准就别说死。']),
      ...(mode === 'video'
        ? ['字幕里出现的人名只当台词在说，不要拿它给画面里的人点名。画面里谁是谁认不准，就按外观说（白发戴眼罩的那个、黑头发穿校服的那个）；别把发光眼、脸上纹路、异色瞳这类特征挂到上一个镜头出现过的人身上——特写看不出是谁，就只描述这个特写本身。']
        : []),
      ...(mode === 'video'
        ? ['你看的是番/剧：画面她自己看得见——谁什么表情、镜头切到哪、穿什么衣服，这些别复述。要说的是剧情：这句话意味着什么、这人为什么这么干、跟前面哪一段接上了。屏幕上的硬事实（「内1名 死亡」这种字、谁死了、第几集、还剩多久）先照原样摆出来，再给一句判断，别急着解读。真看不懂就说看不懂，别拿画面描述把话填满。']
        : []),
      ...(config.personaHint
        ? [`【你的说话方式】${config.personaHint}。就照这个说，别跑偏。里面的口头禅（「说真的」「行吧」这种）最多三成的话里带——大约三句用一句，其余直接说事；一句只带一个，也别每句都拿同一个口头禅开头，那样听着像在旁边不停清嗓子。`]
        : []),
      ...(mode === 'video'
        ? (showInfo && Array.isArray(showInfo.剧情) && showInfo.剧情.length > 0
          ? [
              // 档案里有集数就报一句「现在第几集」，老记录没这个字段就照旧，不多说。
              `你在陪看${watchingEpisode !== null ? `第${watchingEpisode}集` : ''}，前面演到：${showInfo.剧情.slice(-2).join('；')}`,
              '只照着眼前画面和字幕说话，别去查后面演什么、别剧透。字幕没标谁说的，靠画面里谁在场、谁张嘴、台词的语气和称呼推断；拿不准就别点名。',
            ]
          : ['你在陪看一段视频。别去查它后面是什么、别剧透，只看眼前画面和字幕。字幕没标谁说的，拿不准就别点名。'])
        : (gameInfo
          ? [
              `类型：${(gameInfo.genres || []).join('、')}。就用这个游戏自己的说法，别硬套别的游戏的黑话。`,
              ...(Array.isArray(gameInfo.terms) && gameInfo.terms.length > 0
                ? [`这游戏里常用的说法（能用上就用，用上才像这游戏的玩家）：${gameInfo.terms.join('、')}`]
                : []),
              ...(Array.isArray(gameInfo.rules) && gameInfo.rules.length > 0
                ? [`这游戏的基本规则（判断局势可用，别整段复述）：${gameInfo.rules.slice(0, 8).join('；')}`]
                : []),
              ...(Array.isArray(gameInfo.memes) && gameInfo.memes.length > 0
                ? [`这游戏玩家之间的梗和名场面（能接上就接，别硬塞）：${gameInfo.memes.join('；')}`]
                : []),
            ]
          : [`认不出这是什么游戏。只说你确定看得见的东西，别用任何具体游戏的术语——兵线、开团、放墙、切人、塔、野区、buff、队员、集合这些一个都不许提。`])),
      ...(prevBrief ? [`上一局你也${mode === 'video' ? '在看视频' : '在这个游戏里'}，说过这些（能接就接一句，别原样重复）：${prevBrief}`] : []),
      head,
      `图：${images.map(kindLine).join(' ')}`,
      // 拼图这件事必须讲清楚。模型会把「一张拼图里的四格」当成四张不同的截图，
      // 然后开始描述「有四张图」或者把不同时刻当成同时发生的两件事。
      ...(images.some((img) => img.kind === 'sheet')
        ? [`那张拼图里是同一块屏幕${frameCount > 1 ? `的 ${frameCount} 帧${stamps ? `（第 1 帧起 ${stamps}）` : ''}` : '在不同时刻的连续几帧'}，不是几张不同的画面，也不是同时发生的。这些帧里画面基本没动就别说变化；真动了就说清是什么在动、往哪走。说的时候就当自己在看这一段连续画面，别报帧号。`]
        : []),
      // OCR 读出来的屏幕文字（机器识别，可能有错字/漏字，别整段引用，挑跟判断有关的）。
      ...(ocrText && ocrText.trim() !== ''
        ? [`屏幕上读到的字（机器识别的，可能有错，别整段复述）：${ocrText}`]
        : []),
      ...(lastSaid !== '' ? [`你前面已经说过这几句——别重复这些内容，也别重复这些句子的开头（有新东西就换个角度说）：\n${lastSaid}`] : []),
      `【这一句的角度】${angle}。别用上一句的开头，也别套同一个句式。`,
      // 下面两句是可变区（每句的开头、长度都可能不同）：只能挂在数组末尾。
      // 前面的静态规则要留给 DeepSeek 的前缀缓存，中间插一句就把整块缓存打掉。
      ...(repeatWords.length > 0
        ? [`这几个开头你刚刚连着用过，这一句换一个：${repeatWords.join(' / ')}。`]
        : []),
      `这一句最多两行，只给一个判断${mode === 'video' ? '' : '，别把画面复述一遍'}。`,
    ].join('\n');
    // 图片直塞子代理：读字节 -> 存 attachment -> ImageBlock。子代理不继承父上下文，
    // 只看到「一张图 + 一段提示词」，上下文不再滚，token 大头就这么砍掉。
    const imageBlocks = [];
    let imgBytes = 0;
    for (const img of images) {
      try {
        const bytes = fs.readFileSync(img.path);
        imgBytes += bytes.length;
        const ref = await ctx.attachments.saveImage({
          data: bytes,
          mediaType: 'image/jpeg',
          name: img.path,
        });
        imageBlocks.push({ type: 'image', attachment: ref });
      } catch {
        /* 图读不到或存不了就跳过，文字还能给 */
      }
    }
    // 关键：必须选 inheritsParentContext === false 的 provider，才真正不继承主会话上下文。
    // 光看名字（spawn/fork）不可靠——上一轮 spawn 还是继承了上下文，几十万 token 照跑。
    // 兜底名用 'spawn'：DSH 里那个包的 bundle id 是 subagent-spawn-in-process，
    // 但它注册给子代理服务的名字是 config 里的 providerName，也就是 'spawn'。
    // 2026-11-16 的 DSH 更新之后只认同一个名字，传 bundle id 会报 no provider registered。
    let providerName = 'spawn';
    try {
      const names = ctx.subagents.list ? ctx.subagents.list() : [];
      for (const n of names) {
        const p = ctx.subagents.getProvider ? ctx.subagents.getProvider(n) : null;
        if (p && p.inheritsParentContext === false) {
          providerName = n;
          break;
        }
      }
    } catch {
      /* 拿不到列表就用默认名 */
    }
    const t0 = Date.now();
    let activation;
    let tStarted = 0;
    let tModel = 0;
    let directSaid = null;
    let directUsage = null;
    const reactEffort = config.mode === 'video' ? 'off' : 'low';  // 游戏要认数字，不能关思考；看剧只理解剧情，关了省一半
    // 先直调。连挂三次就认了——这次会话不再试，直接走子代理，别每次都多等一个失败。
    if (config.directLlm !== false && llmDirectFails < 3) {
      try {
        // 模型时间从发出请求起算。以前是等它答完再记 tStarted，结果 modelMs 恒为 0，
        // 面板上只看得到一个总数，分不出时间花在抓屏还是花在它想。
        tStarted = Date.now();
        const r = await askModelDirect({
          text,
          imageBlocks,
          effort: reactEffort,
          // 800 撞 800、1600 撞 1600，两次都一个字没说出来，白等十几秒。
          // 子代理那边 maxTokens 是 256000，从来没被截断过——先把额度抬到 8000，
          // 看它到底是自己会停，还是照样想满。真撞满大约要转一分钟，那本身也是个答案。
          maxTokens: 8000,
          purpose: 'whale-glance-react',
          signal: new AbortController().signal,
        });
        directSaid = r.said;
        directUsage = r.usage;
        llmDirectFails = 0;
        tModel = Date.now();
      } catch (error) {
        llmDirectFails += 1;
        // 直调挂了要留证据，不然只看得到「又慢了」看不出为什么
        try {
          fs.appendFileSync(path.join(FRAMES, 'react-debug.log'), JSON.stringify({ at: new Date().toISOString(), step: 'direct-fail', n: llmDirectFails, message: String(error?.message ?? error), stack: String(error?.stack ?? '').split('\n').slice(0, 8) }) + '\n');
        } catch { /* 日志写不出就算了 */ }
      }
    }
    if (directSaid === null) {
      // 直调没成（或者被关掉），退回子代理——这条路是保底的，不能删
      try {
        tStarted = Date.now();
        activation = await ctx.subagents.startActivation({
          provider: providerName,
          label: '余光',
          prompt: [{ type: 'text', text }, ...imageBlocks],
          parent,
          agentPreset: 'minimal',
          agentOptions: { provider: config.reactProvider, model: config.reactModel, reasoningEffort: reactEffort },
          signal: new AbortController().signal,
          delivery: 'caller',
        });
        liveActivation = activation;
      } catch (error) {
        lastError = String(error?.message ?? error);
        // 起不来子代理也要留证据：这条以前只写进 lastError，面板不一定看得到
        try {
          fs.appendFileSync(path.join(FRAMES, 'react-debug.log'), JSON.stringify({ at: new Date().toISOString(), step: 'start-fail', provider: providerName, message: lastError, stack: String(error?.stack ?? '').split('\n').slice(0, 12) }) + '\n');
        } catch { /* 日志写不出就算了 */ }
        return false;
      }
    }
    try {
      let result = null;
      let said;
      if (directSaid !== null) {
        said = directSaid;
        // tModel 在直调返回时就记了（上面那个 try），这里不再覆盖
      } else {
        // 子代理可能永远不返回（模型那边卡住、子代理崩在启动里）：不设上限的话，
        // reactOnce 永远不返回 → finally 不执行 → reactInFlight 一直是 true →
        // 之后每个 change 都被丢掉，表现就是「陪看还开着，但一句话不说了」。
        // 定时器拿到结果就清掉，别让它挂到 90 秒后才释放。
        result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('陪看子代理超时（90 秒没返回）')), 90000);
          activation.result.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
          );
        });
        tModel = Date.now();
        said = (result.output ?? [])
          .filter((b) => b && b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
      }
      // 模型说看不清，就升一档让下次抓图更清晰。有护栏：30 秒内只升一次，最高到 extreme。
      if (/^看不清|^没看清|^看不清了|^看不清图/.test(said)) {
        const now = Date.now();
        if (now - lastTierUpAt >= 30000) {
          const order = ['save', 'balance', 'extreme'];
          const cur = config.tier?.[config.mode] ?? 'balance';
          const idx = order.indexOf(cur);
          if (idx >= 0 && idx < order.length - 1) {
            lastTierUpAt = now;
            applyPatches({ tier: order[idx + 1] });
            if (helper !== null) sendHelper(helperConfigPatch(config));
          }
        }
      }
      // 记账：每次唤醒写一行（含这次说的话），供核算成本和做演示用。
      // 延迟拆两段：waitSec = 攒帧+等冷却（sense 侧），ms = 叫模型到出字（这边）。
      try {
        const meta = {
          at: new Date(t0).toISOString(),
          ms: Date.now() - t0,
          // 拆开记：启动子代理多久、模型多久、收尾多久。列表里子代理自己只报 5-10 秒，
          // 总耗时却有 45-65 秒——多出来的必须能定位到哪一段。
          startMs: tStarted > 0 ? tStarted - t0 : -1,
          modelMs: tModel > 0 ? tModel - tStarted : -1,
          tailMs: Date.now() - (tModel || t0),
          waitSec: Number(event.waitSec ?? 0),
          totalSec: Math.round((Number(event.waitSec ?? 0) + (Date.now() - t0) / 1000) * 10) / 10,
          provider: providerName,
          route: directSaid !== null ? 'direct' : 'subagent',
          imgs: imageBlocks.length,
          imgBytes,
          promptChars: text.length,
          resultKeys: Object.keys(result ?? {}),
          usage: directUsage ?? result?.usage ?? null,
          tokens: result?.tokens ?? null,
          cost: result?.cost ?? null,
          said,
        };
        fs.appendFileSync(path.join(FRAMES, 'wake-usage.log'), JSON.stringify(meta) + '\n', 'utf8');
        // 同一份也落成一次一份，带上提示词全文和截图路径。
        // 参数收紧以后这边是唯一能看到「它当时到底收到了什么」的地方。
        try {
          fs.mkdirSync(LOOKS_DIR, { recursive: true });
          const stamp = new Date(t0).toISOString().replace(/[:.]/g, '-');
          fs.writeFileSync(
            path.join(LOOKS_DIR, `${stamp}.json`),
            JSON.stringify({ ...meta, run: autoOnAt || 0, prompt: text, imagePath: event.path ?? '' }, null, 1),
            'utf8',
          );
          const names = fs.readdirSync(LOOKS_DIR).filter((n) => n.endsWith('.json')).sort();
          for (const old of names.slice(0, Math.max(0, names.length - LOOKS_KEEP))) {
            try { fs.unlinkSync(path.join(LOOKS_DIR, old)); } catch { /* 删不掉就算了 */ }
          }
        } catch { /* 账写不进不影响说话 */ }
      } catch {
        /* 记不下就算了 */
      }
      // 「不说话」的判据要宽容：模型常回「。」「。」」「（不说话）」「没有任何可说的」这类。
      // 只按标点算——去掉标点/空白后什么都不剩，就是没话说，别写进字幕。
      const silent = (t) => {
        const s = String(t || '').trim();
        if (s === '' || s === '(不说话)') return true;
        // 去掉常见标点、引号、括号后没剩下文字，就算沉默
        const bare = s.replace(/[。．.、，,~～!！?？\s"'“”‘’()（）【】\[\]]/g, '');
        return bare === '' || /^[（(]?\s*不说话\s*[）)]?$/.test(s);
      };
      // 沉默就 +1（下次冷却翻倍），真开口就清零。这是「没话说别烧钱」的节流，不是不让它说。
      if (silent(said)) {
        silenceStreak = Math.min(silenceStreak + 1, 3);
      } else {
        silenceStreak = 0;
      }
      // 开口前过闸：配了 sayCheck 才有这一步。退出码非零就把这句整条丢掉——
      // 字幕、聊天记录、声音、局的记录都不写，只在 say-gate.log 里留一条。
      // 上面那份账单（wake-usage / looks）不拦：钱已经花了，记录照写，只是这句话不说。
      // 闸口必须在写字幕之前，拦在朗读那儿没用：屏幕上那句话照样冒出来。
      const willSpeak = !silent(said);
      const gateOpen = willSpeak ? await sayGate(said) : true;
      if (willSpeak && gateOpen) {
        // 每局一份记录：换游戏、或者停了二十分钟没开口，就结一局。
        // 主会话那边回头问「刚才那局怎样」，翻 plays/ 就有东西可讲。
        // 判「同一局」是 game 或窗口标题任一对上——game 有时认得出有时认不出，
        // 只看 game 会把同一局切成好几份。
        try {
          const pnow = Date.now();
          // 认不出游戏时别再拿窗口标题顶上——「战网」「登录 Steam」「XXX - Mozilla Firefox」
          // 就是这么被当成游戏名记进 plays/ 的。记成「(未识别)」，标题另外留着区分同局。
          const pgame = game || '(未识别)';
          const samePlay = play.file !== ''
            && (play.game === pgame || (play.title !== '' && play.title === title))
            && !(play.lastAt > 0 && pnow - play.lastAt > PLAY_GAP_MS);
          if (!samePlay) {
            if (play.file !== '') closePlay();
            openPlay(pgame, title, pnow);
          }
          appendPlay(said, pnow);
        } catch { /* 记账失败别影响说话 */ }
        try {
          const hist = path.join(STORAGE, 'chat-history.txt');
          // 留档不能清（清了就问不出「刚才那局说了什么」），但也不能一直涨：
          // 过 2MB 就整份挪成 chat-history.1.txt，只留上一份，够回溯又不吃盘。
          try {
            if (fs.statSync(hist).size > 2 * 1024 * 1024) {
              fs.renameSync(hist, path.join(STORAGE, 'chat-history.1.txt'));
            }
          } catch { /* 第一次写或者挪不动，都照常往下走 */ }
          const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          fs.appendFileSync(hist, `[${stamp}] ${said}\n`, 'utf8');
          // 字幕显示最近几条（聊天窗），不只盖最后一句
          const lines = fs.readFileSync(hist, 'utf8').split('\n').filter((l) => l.trim() !== '');
          // 时间戳只留在文件里，别写到屏幕上——会被自己当成画面内容读回去
          const texts = lines.map((l) => l.replace(/^\[\d{1,2}:\d{2}:\d{2}\]\s*/, ''));
          // 看一眼只显示这一句；自动看的留最近三条（不是五条——五条挤成一整块，看着臃肿）。
          // 三条之间空一行，让每句独立成块，不糊成一片。
          fs.writeFileSync(HUD, options.looked ? said : texts.slice(-3).join('\n\n'), 'utf8');
          // 埋点：写进字幕文件的时间，跟字幕窗渲染的时间一对比就知道中间差多少
          try {
            const dbg = path.join(STORAGE, 'hud-debug.log');
            // 埋点只是用来对时间差的，涨到 1MB 就清一次，别让它变成常驻垃圾。
            try { if (fs.statSync(dbg).size > 1024 * 1024) fs.writeFileSync(dbg, '', 'utf8'); } catch { /* 没有就第一次写 */ }
            fs.appendFileSync(dbg, JSON.stringify({ at: Date.now(), src: 'host-write', event: options.looked ? 'looked' : 'auto', chars: said.length }) + '\n', 'utf8');
          } catch { /* 埋点写不出不影响说话 */ }
        } catch {
          /* 写不进就算了 */
        }
        // 记一笔「这次喂了什么词、它说了什么」，面板上点一下就能对照，
        // 验证存下来的黑话/规则/梗是不是真的用上了。
        try {
          fs.writeFileSync(
            path.join(STORAGE, 'last-react.json'),
            JSON.stringify({
              at: Date.now(),
              title,
              game,
              used: {
                terms: Array.isArray(gameInfo?.terms) ? gameInfo.terms : [],
                rules: Array.isArray(gameInfo?.rules) ? gameInfo.rules : [],
                memes: Array.isArray(gameInfo?.memes) ? gameInfo.memes : [],
              },
              said,
            }, null, 1),
            'utf8',
          );
        } catch {
          /* 记不下就算了 */
        }
        // 朗读：合成 mp3 + MCI 播（后台进程里只有这条出声），没有 say.mjs 退回 ttsCommand
        // 不 await：say.mjs 合成 mp3 要好几秒，等它就等于让整轮收尾（以及下一轮唤醒）一起等，
        // 字幕会看起来「晚十几秒才出来」。字幕已经写完了，声音让它自己在后台合成、后台播。
        void speakAloud(said).catch(() => {});
        // 不 followup 回会话了：那会把主会话整个叫醒、滚一轮，省的钱又吐回去。
        // 结论只进 chat-history.txt；主会话需要时读文件接上。
      }
    } catch (error) {
      lastError = String(error?.message ?? error);
      try {
        fs.appendFileSync(
          path.join(FRAMES, 'wake-usage.log'),
          JSON.stringify({ at: new Date(t0).toISOString(), ms: Date.now() - t0, provider: providerName, failed: lastError }) + '\n',
          'utf8',
        );
      } catch {
        /* 记不下就算了 */
      }
    } finally {
      // 直调那条路没有 activation，别对着 undefined 调 dispose
      if (activation) {
        try { await activation.dispose(); } catch { /* 忽略 */ }
        if (liveActivation === activation) liveActivation = null;
        // 用完把这个子代理从列表里释放掉，别一天堆几十个（dispose 只停不删）
        try {
          if (activation.childId) await ctx.subagents.drainChildren(parent, [activation.childId]);
        } catch { /* 宿主不支持就算了 */ }
      }
    }
    lastReactAt = Date.now();
    reactTimes.push(lastReactAt);
    return true;
  }

  // ---- 每一局的记录：给主会话留一份能接上话的东西 ----
  // 陪看说完就完了，回头换个会话问「刚才那局怎样」会一脸空白。
  // 这里按「局」归档：换游戏、或者停了二十分钟没开口，就结一局，写一份 md 到
  // storages/whale-glance/plays/。新会话列一下就能翻到。
  const PLAYS_DIR = path.join(STORAGE, 'plays');
  const PLAY_GAP_MS = 20 * 60 * 1000;
  // 分段记忆：连着看不换片时，一局能挂两三个小时，只在收局时写一次等于什么都没记。
  // 每满十分钟、或者一换集，就把这一段发生过的事收一条，长片、连刷短剧都能一段一段留下。
  // 十分钟不是死线：换集是更准的段落边界（一集一条），钟只是兜底——长视频没有集数可分时用。
  const SEG_MS = 10 * 60 * 1000;
  const SEG_MIN_LINES = 3;
  // 关停/重载时没来得及归档的尾段先落盘，下次启动补写。
  const PENDING_TAIL = path.join(STORAGE, 'pending-tail.json');
  const LOOSE_BUCKET = '随手看';
  let play = { game: '', title: '', start: 0, lastAt: 0, lines: [], pending: [], segStart: 0, file: '', ocrLines: [], epKey: '' };
  // 最近一次读到的字幕原文。拼图的画面它常认不准（这是哪儿、那个绿东西是什么），
  // 但台词是字，认字可靠——写档案时拿它校正画面里猜出来的东西。
  let lastOcrText = '';

  function playStamp(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function openPlay(gameName, title, now) {
    const safe = String(gameName || '未知').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    play = {
      game: gameName || '未知',
      title: title || '',
      start: now,
      lastAt: now,
      lines: [],
      pending: [],
      segStart: now,
      ocrLines: [],
      // 开新局之前先把上一局的摘要读出来（这时候新文件还没写，不会读到自己）
      prev: lastPlayBrief(gameName),
      prevUsed: false,
      file: path.join(PLAYS_DIR, `${playStamp(now)}-${safe}.md`),
      // 开这一局时是看番还是打游戏。mode 是全局开关，收局时可能已经切走了，
      // 得按开局时的那个来定「要不要写番剧档案」。
      modeAtOpen: String(config.mode ?? ''),
      // 开局时看的是哪一集：换集就当一段结束，不用等钟。
      epKey: currentEpisodeKey(title || ''),
    };
    try {
      fs.mkdirSync(PLAYS_DIR, { recursive: true });
      fs.writeFileSync(play.file, [
        `# ${play.game} · ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`,
        '',
        `窗口：${play.title}`,
        '',
        '## 它说过的话',
        '',
      ].join('\n'), 'utf8');
    } catch { /* 写不进就算了，别影响陪看 */ }
  }

  function appendPlay(said, now) {
    if (!play.file) return;
    play.lastAt = now;
    const hm = new Date(now).toLocaleTimeString('zh-CN', { hour12: false });
    play.lines.push({ at: now, text: said });
    // 同一句话也进「还没归档的这一段」，攒满二十分钟就收一条
    if (Array.isArray(play.pending)) play.pending.push({ at: now, text: said });
    // 这一段读到的台词也留着（去掉重复再放）：写档案时拿它校正画面里猜错的场景和物件。
    // 画面看的是色块，台词是字——字比色块可靠，这是她 11-20 提的那点。
    if (lastOcrText !== '' && Array.isArray(play.ocrLines)) {
      for (const raw of lastOcrText.split('\n')) {
        const t = raw.trim();
        if (t === '' || play.ocrLines.includes(t)) continue;
        play.ocrLines.push(t);
      }
      if (play.ocrLines.length > 400) play.ocrLines = play.ocrLines.slice(-400);
    }
    try {
      fs.appendFileSync(play.file, `- ${hm} ${String(said).replace(/\r?\n/g, ' ')}\n`, 'utf8');
    } catch { /* 忽略 */ }
    void flushSegmentIfDue(now);
  }

  // 现在在看哪一集。面板那格「正在看哪部」优先（她换集就改这一格），其次窗口标题里认出来的。
  // 认不出返回空串——认不出的时候不拿它当边界，免得一直误判成「换集」。
  function currentEpisodeKey(titleText) {
    try {
      const parsed = parseShowLabel(config.currentShow);
      const title = String(titleText === undefined ? play.title : titleText);
      const ep = parsed.episode !== null ? parsed.episode : episodeNoFromTitle(title);
      const series = String(parsed.series || '');
      if (series === '' && ep === null) return '';
      return `${series}|${ep === null ? '' : ep}`;
    } catch { return ''; }
  }

  // 这一段攒够时间了没：够、或者换集了，就把这一段的台词切出来交给档案，然后把「这一段」清空。
  // 先清空再异步写——写失败不该导致下一句把同一段又写一遍。
  function flushSegmentIfDue(now) {
    if (!play.file) return;
    if (String(play.modeAtOpen ?? '') !== 'video') return;
    const epNow = currentEpisodeKey();
    const epChanged = epNow !== '' && String(play.epKey ?? '') !== '' && epNow !== play.epKey;
    if (epChanged) play.epKey = epNow;
    const segStart = Number(play.segStart ?? 0);
    if (!epChanged && (segStart <= 0 || now - segStart < SEG_MS)) return;
    const lines = Array.isArray(play.pending) ? play.pending.slice() : [];
    const subtitles = Array.isArray(play.ocrLines) ? play.ocrLines.slice() : [];
    play.pending = [];
    play.ocrLines = [];
    play.segStart = now;
    if (lines.length < SEG_MIN_LINES) return;
    void archiveSegment({ lines, subtitles, title: play.title, segStart, segEnd: now });
  }

  function closePlay() {
    if (!play.file) return;
    const finished = { ...play, lines: play.lines.slice() };
    play = { game: '', title: '', start: 0, lastAt: 0, lines: [], pending: [], segStart: 0, file: '', prev: '', prevUsed: false, modeAtOpen: '', ocrLines: [], epKey: '' };
    // 收局时把没攒满二十分钟的那一小段也收掉，不然最后十几分钟就丢了。
    // 异步做，别拖住下一局。
    const tail = Array.isArray(finished.pending) ? finished.pending.slice() : [];
    const tailSubs = Array.isArray(finished.ocrLines) ? finished.ocrLines.slice() : [];
    if (String(finished.modeAtOpen ?? '') === 'video' && tail.length >= SEG_MIN_LINES) {
      void archiveSegment({
        lines: tail,
        subtitles: tailSubs,
        title: finished.title,
        segStart: Number(finished.segStart ?? finished.start) || finished.start,
        segEnd: Date.now(),
      });
    }
  }

  // 关停时把没归档的那一段落盘。异步的模型调用等不到在关停里跑完，所以这里只存不写；
  // 下次启动再补写（十分钟一段以后，最坏也就丢这一段）。
  function stashPendingTail() {
    if (!play.file) return;
    if (String(play.modeAtOpen ?? '') !== 'video') return;
    const lines = Array.isArray(play.pending) ? play.pending.slice() : [];
    if (lines.length < SEG_MIN_LINES) return;
    const payload = {
      lines,
      subtitles: Array.isArray(play.ocrLines) ? play.ocrLines.slice() : [],
      title: play.title,
      segStart: Number(play.segStart ?? play.start) || play.start,
      segEnd: Date.now(),
    };
    try {
      fs.mkdirSync(STORAGE, { recursive: true });
      fs.writeFileSync(PENDING_TAIL, JSON.stringify(payload), 'utf8');
    } catch { /* 存不下就算了，别在关停里抛 */ }
  }

  async function drainPendingTail() {
    try {
      if (!fs.existsSync(PENDING_TAIL)) return;
      const payload = JSON.parse(fs.readFileSync(PENDING_TAIL, 'utf8'));
      try { fs.unlinkSync(PENDING_TAIL); } catch { /* ignore */ }
      if (payload && Array.isArray(payload.lines) && payload.lines.length >= SEG_MIN_LINES) {
        await archiveSegment(payload);
      }
    } catch { /* 补写失败就丢掉，别在启动时反复重试 */ }
  }

  // 上一局说过什么。每局都写了 md，但从来没人读回来——进同一个游戏时带上几句，
  // 免得每次都像第一次见。只取开头两条和结尾两条：开头能看出这局干了什么，结尾能看出打到哪。
  function lastPlayBrief(gameName) {
    try {
      const safe = String(gameName || '未知').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
      const names = fs.readdirSync(PLAYS_DIR).filter((f) => f.endsWith(`-${safe}.md`)).sort();
      if (!names.length) return '';
      const txt = fs.readFileSync(path.join(PLAYS_DIR, names[names.length - 1]), 'utf8');
      const said = txt.split('\n').filter((l) => l.startsWith('- '))
        .map((l) => l.replace(/^-\s*\d{2}:\d{2}:\d{2}\s*/, '').trim())
        .filter(Boolean);
      if (said.length < 3) return '';
      return [...said.slice(0, 2), ...said.slice(-2)].join(' / ').slice(0, 420);
    } catch { return ''; }
  }

  // ---- 分段记忆：每二十分钟把「这一段看了什么」收成一条 ----
  // 她连着看不会来提醒，所以不能靠「说一声」。视频模式下每满二十分钟（收局时剩下的那一小段也算），
  // 拿这一段它说过的话，让模型收成两三句事实：
  //   有番名的进 shows.json 的「剧情」，按番归集，标签是「第2集 19:00–19:20」；
  //   没番名的（沙雕短剧、随手刷到的视频）进「随手看」，标签是「11-20 19:00–19:20」。
  // 一段就是一段：长片不会只剩最后一句，一部剧也不会只留一条。同一段用标签去重，写重了不会重复。
  // 失败只记一条日志：档案是后台的事，坏了不该打断看番，也不该弹到面板上。
  // 窗口标题里认集数（播放器标题常带「第3集」「EP03」「[03]」）。认不出返回 null。
  // 注意：这只认标题；面板那格「正在看哪部」里写的集数走 parseShowLabel，那边优先级更高。
  function episodeNoFromTitle(title) {
    const t = String(title || '');
    const m = t.match(/第\s*(\d+)\s*[集话話期]/) || t.match(/\bEP?\s*(\d+)\b/i) || t.match(/[\[【]\s*(\d{1,3})\s*[\]】]/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function hhmm(ts) {
    const d = new Date(Number(ts) || Date.now());
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function dayhhmm(ts) {
    const d = new Date(Number(ts) || Date.now());
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hhmm(ts)}`;
  }

  let showMemSkipLogged = false;

  async function archiveSegment({ lines, subtitles, title, segStart, segEnd }) {
    try {
      if (config.showMemory !== true) {
        // 原来这里是静默 return：开关关着的时候，翻日志也看不出为什么没写档案。
        if (!showMemSkipLogged) {
          showMemSkipLogged = true;
          try {
            fs.appendFileSync(path.join(STORAGE, 'auto-learn.log'), JSON.stringify({
              at: new Date().toISOString(), step: 'show-archive-skip', reason: 'showMemory=false',
            }) + '\n');
          } catch { /* ignore */ }
        }
        return;
      }
      const said = (lines || [])
        .map((l) => String(l?.text ?? '').trim())
        .filter((s) => s !== '');
      // 少于三句说明这一段几乎没开口，拿它总结出来的只会是噪声。
      if (said.length < SEG_MIN_LINES) return;
      // 面板那格允许写成「咒术回战 第3集」：归档按番名（series）归集，集数单独记。
      // 换集只把 episode 往前推，不改 key，所以同一部番永远只有一条档案。
      const parsed = parseShowLabel(config.currentShow);
      const show = parsed.series;
      // 有番名就归到番上；没有番名也不丢——短剧、随手刷的视频记进「随手看」，
      // 用日期+时段分条，别硬塞给某一部番。
      const name = show !== '' ? show : LOOSE_BUCKET;
      const all = loadShows();
      const prev = all?.[name] && typeof all[name] === 'object' ? all[name] : null;
      const prevEpisode = Number.isFinite(Number(prev?.episode)) && Number(prev.episode) > 0
        ? Number(prev.episode)
        : null;
      const prevSeason = Number.isFinite(Number(prev?.season)) && Number(prev.season) > 0
        ? Number(prev.season)
        : null;
      // 集数从三处来：面板里手写的最准（她换集就改这一格），面板没写才去窗口标题里认，
      // 标题也认不出来就沿用档案里上次那一集——但季对不上时不沿用（第二季开头别标成第7集）。
      const episodeNo = show !== ''
        ? pickEpisodeForArchive({
          parsedEpisode: parsed.episode,
          titleEpisode: episodeNoFromTitle(title),
          prevEpisode,
          parsedSeason: parsed.season,
          prevSeason,
        })
        : null;
      // 季跟着档案走：这一格写了季就以这一格为准，没写就沿用档案里的。
      const seasonNo = parsed.season !== null ? parsed.season : prevSeason;
      const span = `${hhmm(segStart)}–${hhmm(segEnd)}`;
      const seasonLabel = seasonNo !== null ? `第${seasonNo}季` : '';
      const episodeLabel = episodeNo !== null ? `第${episodeNo}集` : '';
      const dateLabel = `${seasonLabel}${episodeLabel}`.trim();
      const label = dateLabel !== '' ? `${dateLabel} ${span}` : (show !== '' ? span : `${dayhhmm(segStart)}–${hhmm(segEnd)}`);
      const entry = all?.[name] && Array.isArray(all[name].剧情) ? all[name].剧情 : [];
      // 同一段不重复写（按标签认）：收局和定时收段撞在一起时不会写成两条。
      if (entry.some((l) => String(l).startsWith(`${label}：`))) return;
      const subs = (subtitles || [])
        .map((s) => String(s).trim())
        .filter((s) => s !== '')
        .slice(-80)
        .join('\n')
        .slice(0, 1200);
      const text = [
        '下面是它陪看一段视频时陆续说过的几句话，还有同一段屏幕上读到的台词。',
        '用这两样，把这一段里能确定的东西写成两三句中文：发生了什么、谁和谁、留下了什么关键设定或包袱。',
        '它的话是当场对着画面猜的，可能有认错的地方：台词能对上的按台词写，对不上的宁可不写。',
        '不要观后感，不要评价画面，不要补没看到的情节。只输出那几句话本身，不要序号和标题。',
        '',
        ...(subs !== '' ? [`台词（机器识别，可能有错字）：\n${subs}`, ''] : []),
        said.slice(-40).join('\n'),
      ].join('\n');
      // 240 是拿「两三句中文」估的，但直调这条路的思考也占 maxTokens：模型把额度
      // 全花在 reasoning 上，正文一个字没出来（11-21 02:52 那条 show-archive-fail，
      // 收到的块只有 reasoning-delta）。收段二十分钟才一次，这点额度省不着，给足。
      const r = await askModelDirect({ text, effort: 'low', maxTokens: 2000, purpose: 'whale-glance-archive' });
      const summary = String(r?.said ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (summary === '') return;
      const line = `${label}：${summary}`;
      if (!all[name] || typeof all[name] !== 'object') all[name] = { 剧情: [] };
      if (!Array.isArray(all[name].剧情)) all[name].剧情 = [];
      if (all[name].剧情.includes(line)) return;
      all[name].剧情.push(line);
      // 换集只动这一格：episode 推到新的（老档案没这个字段，读的时候也照常），
      // 剧情数组往后长，前面几集的记录一条都不删——前情要的就是它们。
      if (episodeNo !== null) all[name].episode = episodeNo;
      if (show !== '' && seasonNo !== null) all[name].season = seasonNo;
      // 一部番、一份随手看都得封顶：看久了不会长成一本删不动的账。
      const cap = name === LOOSE_BUCKET ? 80 : 120;
      if (all[name].剧情.length > cap) all[name].剧情 = all[name].剧情.slice(-cap);
      if (!Array.isArray(all['_最近写入'])) all['_最近写入'] = [];
      all['_最近写入'].push({
        at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        name,
        episode: label,
      });
      if (all['_最近写入'].length > 20) all['_最近写入'] = all['_最近写入'].slice(-20);
      fs.mkdirSync(STORAGE, { recursive: true });
      fs.writeFileSync(showsPath(), JSON.stringify(all, null, 1), 'utf8');
    } catch (error) {
      try {
        fs.appendFileSync(path.join(STORAGE, 'auto-learn.log'), JSON.stringify({
          at: new Date().toISOString(), step: 'show-archive-fail',
          message: String(error?.message ?? error).slice(0, 300),
        }) + '\n');
      } catch { /* 日志写不出就算了 */ }
    }
  }

  // ---- 学黑话：从攻略文本里提取术语 + 规则 ----
  function parseTermsJson(raw) {
    // 模型常输出带 ```json 标记、或前后有废话，这里剥到第一个 { 到最后一个 }
    let s = String(raw ?? '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  // 口癖不再由插件起子代理生成——由主会话的 AI 自己写一句，sense_init 带 text 落盘。
  // 起子代理要么丢 persona（peek 精简预设），要么背整个历史（继承上下文，77M token 一次），都不行。

  async function fetchUrlText(url) {
    // 粘链接就自己去抓，别让人复制正文。
    // 小黑盒接口要签名，裸 curl 会回「请升级版本」——借 heybox 插件自带的 requestHeybox 和登录态。
    // 其它网页直接 fetch 回 HTML，交给清洗脚本。
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) return '';
    const linkId = (target.match(/link_id=([0-9a-zA-Z]+)/i) || target.match(/\/bbs\/link\/([0-9a-zA-Z]+)/i) || [])[1];
    if (linkId && /xiaoheihe\.cn/i.test(target)) {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'heybox', 'state.json'), 'utf8'));
        const profilesDir = path.join(DSH_HOME, 'profiles');
        const mods = fs.readdirSync(profilesDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => path.join(profilesDir, e.name, 'node_modules', 'heybox', 'lib', 'index.js'))
          .filter((p) => fs.existsSync(p));
        if (mods.length > 0) {
          const mod = await import(pathToFileURL(mods[0]).href);
          if (typeof mod.requestHeybox === 'function') {
            const data = await mod.requestHeybox(state, '/bbs/app/link/tree', { link_id: linkId, offset: '0', limit: '30' });
            const link = data?.result?.link || {};
            const body = String(link.text || link.content || '');
            const comments = (data?.result?.comments || [])
              .map((c) => String(c?.text || ''))
              .filter(Boolean)
              .join('\n');
            const merged = [String(link.title || ''), body, comments].filter((s) => s.trim() !== '').join('\n');
            if (merged.trim() !== '') return merged;
          }
        }
      } catch { /* 借不到就退回直接抓 */ }
    }
    try {
      const res = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (!res.ok) return '';
      return await res.text();
    } catch {
      return '';
    }
  }

  function cleanLearnText(raw, budgetSec = 90) {
    // 用户粘进来的东西什么样都有：纯文本、网页 HTML、带转义符的接口正文。
    // 交给 helper 的 python 脚本洗：剥标签、把帖子里的图下载下来用本地 OCR 读字、压空白。
    // 用 spawn 不用 spawnSync——OCR 可能跑一分钟，别把 host 卡住。
    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(findPython(), [path.join(PACKAGE_ROOT, 'helper', 'learn_text.py'), String(budgetSec)], {
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        });
      } catch {
        resolve(String(raw));
        return;
      }
      let out = '';
      const timer = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } }, (budgetSec + 40) * 1000);
      // 不拖住宿主退出：升级时宿主等的是「没有活句柄」，这种兜底定时器不该算进去
      if (typeof timer.unref === 'function') timer.unref();
      proc.stdout?.on('data', (d) => { out += d.toString('utf8'); });
      proc.on('error', () => { clearTimeout(timer); resolve(String(raw)); });
      proc.on('close', () => {
        clearTimeout(timer);
        const cleaned = out.trim();
        resolve(cleaned !== '' ? cleaned : String(raw));
      });
      try {
        proc.stdin.write(raw);
        proc.stdin.end();
      } catch {
        clearTimeout(timer);
        resolve(String(raw));
      }
    });
  }

  async function extractTerms(gameName, text) {
    // 粘链接就自己抓（小黑盒借 heybox 签名，其它网页直接 fetch），粘正文就原样洗。
    let raw = String(text);
    const link = raw.trim();
    if (/^https?:\/\/\S+$/i.test(link)) {
      const page = await fetchUrlText(link);
      if (page.trim() !== '') raw = page;
    }
    // 再把原料洗干净：剥 HTML、把帖子里的图读成字。用户粘什么格式都不用管。
    const source = await cleanLearnText(raw);
    // 和 react 一样选 inheritsParentContext===false 的 provider，不继承主会话
    // 兜底名是 'spawn'，不是 bundle id：见上面 react 那段注释
    let providerName = 'spawn';
    try {
      const names = ctx.subagents.list ? ctx.subagents.list() : [];
      for (const n of names) {
        const p = ctx.subagents.getProvider ? ctx.subagents.getProvider(n) : null;
        if (p && p.inheritsParentContext === false) { providerName = n; break; }
      }
    } catch { /* 拿不到就用默认名 */ }
    const parent = resolveAgent();
    if (parent === null) return { ok: false, message: '没找到活跃会话' };
    const prompt = `你是游戏术语专家。下面是一段游戏《${gameName}》的攻略或介绍文本。请提取三样东西：

1. 这个游戏里玩家常用的术语/黑话——机制名、道具名、简称、数值概念。去重，最多 25 个，只要词本身，不要解释。
   **不要摘视频清单里的字样**：「全收集」「白金全成就」「全任务」「全盟友」「全宝箱」「装备核对」这类是 UP 主的系列目录，不是游戏黑话。也不要摘章节名、UP 主自封的名字。
2. 这个游戏的机制规则——最多 5 条，每条一句话。**只写「某个数字或状态意味着什么」**：资源从哪来、有什么上限、什么条件解锁什么、什么数值卡着做什么。比如「人口有上限，满了要补建筑」「气矿是造高级兵的关键」这种。**绝对不要写玩法建议**——「先做什么再做什么」「怎么赢」「该怎么打」「别贪经济」这类一条都不许出。没有机制可写就返回空数组。
3. 这个游戏的社区梗 / 名场面 / 玩家爱说的调侃——最多 5 条，每条一句话。必须是**跟这个游戏强绑定的**梗（玩家群体内部的黑话式调侃、经典名台词、名场面外号），不是通用段子，也不是对游戏的普通评价。文本里没有就返回空数组，不许编。
4. 这个游戏你本来就熟悉、但上面这段文本里**没提到**的常用术语——最多 20 个，只要词本身。这一项不会被文本核对，所以要自己把关：
   **规则体系的术语也算这款游戏的词。** 改编自桌游、卡牌、战棋的游戏，玩家嘴里的「检定」「豁免」「优势」「大成功」这类规则术语就是这游戏的日常词汇。别因为「这是桌游通用规则」或者「别的游戏也有骰子」就不写——玩家不看规则书，只看这款游戏。
   真正要排除的是放到任何游戏都成立的废话（「通关」「装备」「血条」「存档」「BOSS」），以及你没把握的词。

注意：原料来自 B 站的攻略字幕和简介，可能混着视频标题清单、甚至跟这游戏无关的片段。只挑真正属于这款游戏玩法本身的词，宁可少给也不要凑数。

只输出一个 JSON，格式 {"terms": ["词1"], "extra": ["补充词1"], "rules": ["规则1"], "memes": ["梗1"]}。不要任何解释、不要 markdown 代码块标记、不要 JSON 以外的东西。

攻略文本：
${source.slice(0, 12000)}`;
    // 和 react 一样：先直调，挂了再起子代理
    let activation = null;
    let directRaw = null;
    if (config.directLlm !== false && llmDirectFails < 3) {
      try {
        const r = await askModelDirect({
          text: prompt,
          imageBlocks: null,
          effort: 'low',  // 学黑话要理解攻略，保持 low
          maxTokens: 3000,  // 15 词 + 5 规则 + 5 梗，1200 撞顶会被截断，JSON 就不闭合了
          purpose: 'whale-glance-learn',
          signal: new AbortController().signal,
        });
        directRaw = r.said;
        llmDirectFails = 0;
      } catch (error) {
        llmDirectFails += 1;
        try {
          fs.appendFileSync(path.join(FRAMES, 'react-debug.log'), JSON.stringify({ at: new Date().toISOString(), step: 'direct-fail-learn', n: llmDirectFails, message: String(error?.message ?? error), stack: String(error?.stack ?? '').split('\n').slice(0, 8) }) + '\n');
        } catch { /* 日志写不出就算了 */ }
      }
    }
    if (directRaw === null) {
      try {
        activation = await ctx.subagents.startActivation({
          provider: providerName,
          label: '余光学黑话',
          prompt: [{ type: 'text', text: prompt }],
          parent,
          agentPreset: 'minimal',
          agentOptions: { provider: config.reactProvider, model: config.reactModel, reasoningEffort: 'low' },  // 学黑话要理解攻略，保持 low
          signal: new AbortController().signal,
          delivery: 'caller',
        });
        liveActivation = activation;
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) };
      }
    }
    try {
      let raw;
      if (directRaw !== null) {
        raw = directRaw;
      } else {
        // 两分钟没回来才报超时：原料是一两万字攻略，flash 摘词实测 60 秒不够（自动补黑话就是这里超时挂掉的）
        const result = await Promise.race([
          activation.result,
          new Promise((_, reject) => setTimeout(() => reject(new Error('提取超时（两分钟没返回），换短一点的文本试试')), 120000)),
        ]);
        raw = (result.output ?? [])
          .filter((b) => b && b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
      }
      const parsed = parseTermsJson(raw);
      if (parsed === null) {
        // 解析失败最常见的原因是输出被截断，JSON 没闭合——把原文留下来，不然只能盲猜
        try {
          fs.appendFileSync(path.join(STORAGE, 'auto-learn.log'), JSON.stringify({
            at: new Date().toISOString(), game: gameName, step: 'parse-fail',
            rawLen: String(raw ?? '').length, raw: String(raw ?? '').slice(0, 1500),
          }) + '\n');
        } catch { /* 日志写不出就跳过 */ }
        return { ok: false, message: '没解析出 JSON', raw };
      }
      return {
        ok: true,
        terms: Array.isArray(parsed.terms) ? parsed.terms.filter((t) => typeof t === 'string' && t.trim() !== '') : [],
        // 模型自己补的（原料里没有），面板单独列一块，让它自己判断要不要
        extra: Array.isArray(parsed.extra) ? parsed.extra.filter((t) => typeof t === 'string' && t.trim() !== '') : [],
        rules: Array.isArray(parsed.rules) ? parsed.rules.filter((r) => typeof r === 'string' && r.trim() !== '') : [],
        memes: Array.isArray(parsed.memes) ? parsed.memes.filter((m) => typeof m === 'string' && m.trim() !== '') : [],
        raw,
      };
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error) };
    } finally {
      if (activation !== null) {
        try { await activation.dispose(); } catch { /* 忽略 */ }
        if (liveActivation === activation) liveActivation = null;
      }
    }
  }

  // 只问词的第二次调用：不看攻略原文，直接问模型「这游戏玩家都说什么」。
  // 和 extractTerms 分开的理由见 autoLearn 里那段注释——一次干四件事它会漏掉这件。
  async function modelTerms(gameName) {
    const prompt = `列出《${gameName}》玩家日常会用到的术语，最多 30 个。

要求：
- 一个词一行，只写词本身，不要编号、不要解释、不要 JSON。
- 覆盖：机制名、属性名、职业和道具分类、简称、规则或数值术语、社区叫法。
- 改编自桌游、卡牌、战棋的游戏，它的规则体系术语也算这款游戏的词（比如骰子、检定、豁免、大成功、属性调整值）。玩家不读规则书，只在游戏里看到这些字，那它就是这游戏的词。
- 不要放到任何游戏都成立的废话：通关、装备、血条、存档、BOSS、剧情、任务。
- 没把握的一个都别写。

直接输出词汇列表。`;
    if (config.directLlm === false) return [];
    // 偶发空返回（实测见过），空手就再来一次——这条路最容易静默失败
    let said = '';
    for (let attempt = 0; attempt < 2 && said === ''; attempt++) {
      try {
        const r = await askModelDirect({
          text: prompt,
          imageBlocks: null,
          effort: 'low',
          maxTokens: 2000,
          purpose: 'whale-glance-terms',
          signal: new AbortController().signal,
        });
        said = String(r.said || '').trim();
      } catch { /* 这次空了，循环再试一次 */ }
    }
    return said
      .split(/[\n,，、|]+/)
      .map((s) => s.replace(/^[\s\-*·•\d.、)）]+/, '').replace(/[：:].*$/, '').trim())
      .filter((s) => s.length >= 1 && s.length <= 20)
      .slice(0, 30);
  }

  // ---- 借登录态：读别的插件的凭证（只读，不写）----
  function biliPluginCredential() {
    // 纯借用：bili 插件存的凭证（dshHomePath('bili-duty')/bili_credential.json）
    const f = path.join(DSH_HOME, 'bili-duty', 'bili_credential.json');
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (d.sessdata && d.buvid3) return d;
    } catch { /* 没有就当没登录 */ }
    return null;
  }

  function ignoreBorrowed(kind) {
    // 用户把「借用隔壁插件」登出了：记一个标记，之后就不再用那家的凭证
    try { return fs.existsSync(path.join(STORAGE, 'cred', `ignore-${kind}.json`)); } catch { return false; }
  }

  function biliCredential() {
    // 按用户选的渠道来：own = 余光自己扫码登的，borrow = 借隔壁 bili 插件的，'' = 还没选
    const ch = (config.credChannel || {}).bili;
    if (ch === 'own') return biliOwnCredential();
    if (ch === 'borrow') return ignoreBorrowed('bili') ? null : biliPluginCredential();
    return null;
  }

  function heyboxState() {
    const ch = (config.credChannel || {}).heybox;
    if (ch === 'own') return hbOwnCredential();
    if (ch === 'borrow') {
      if (ignoreBorrowed('heybox')) return null;
      const f = path.join(DSH_HOME, 'heybox', 'state.json');
      try {
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (d.cookie && d.deviceId) return d;
      } catch { /* 没有就当没登录 */ }
    }
    return null;
  }

  // ---- B 站扫码登录：自建，不依赖 bili 插件 ----
  // 接口和 cookie 字段照 dsh-bili-subagent（MIT，作者 Yuuyuko-uu，https://github.com/Yuuyuko-uu）
  // 的 login.mjs 实测跑通的路子。passport 接口公开、不用签名；凭证存余光自己的目录。
  // 借用别家登录态只是省事，这里才是底线。
  const CRED_DIR = path.join(STORAGE, 'cred');
  const BILI_GEN = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header';
  const BILI_POLL_URL = (key) => 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(key) + '&source=main-fe-header';
  const BILI_SPI = 'https://api.bilibili.com/x/frontend/finger/spi';

  function biliOwnCredential() {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'bili.json'), 'utf8'));
      if (d.sessdata && d.buvid3) return d;
    } catch { /* 还没有自己的凭证 */ }
    return null;
  }

  function pickCookies(list) {
    const jar = {};
    const want = { SESSDATA: 'sessdata', bili_jct: 'bili_jct', DedeUserID: 'dedeuserid', buvid3: 'buvid3' };
    for (const raw of list ?? []) {
      const first = String(raw).split(';')[0] || '';
      const i = first.indexOf('=');
      if (i <= 0) continue;
      const name = first.slice(0, i).trim();
      const value = first.slice(i + 1).trim();
      if (want[name]) jar[want[name]] = value;
    }
    return jar;
  }

  async function ensureBuvid3(jar) {
    if (jar.buvid3) return jar;
    try {
      const r = await fetch(BILI_SPI, { headers: { 'User-Agent': BILI_UA } });
      const j = await r.json();
      if (j?.data?.b_3) jar.buvid3 = j.data.b_3;
    } catch { /* 拿不到就算了 */ }
    return jar;
  }

  async function biliLoginStart() {
    try {
      const r = await fetch(BILI_GEN, { headers: { 'User-Agent': BILI_UA } });
      const j = await r.json();
      if (!j?.data?.qrcode_key || !j?.data?.url) return { ok: false, message: '生成二维码失败' };
      return { ok: true, key: j.data.qrcode_key, url: j.data.url };
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error) };
    }
  }

  async function biliLoginPoll(key) {
    try {
      const res = await fetch(BILI_POLL_URL(key), { headers: { 'User-Agent': BILI_UA }, redirect: 'manual' });
      const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      let body = {};
      try { body = await res.json(); } catch { /* poll 有时空体 */ }
      const code = body?.data?.code;
      if (code === 0) {
        const jar = await ensureBuvid3(pickCookies(setCookies));
        if (!jar.sessdata) return { ok: true, done: false, state: 'unknown', message: '登录成功但响应里没有 SESSDATA' };
        fs.mkdirSync(CRED_DIR, { recursive: true });
        fs.writeFileSync(path.join(CRED_DIR, 'bili.json'), JSON.stringify({
          sessdata: jar.sessdata, bili_jct: jar.bili_jct ?? '', buvid3: jar.buvid3 ?? '', dedeuserid: jar.dedeuserid ?? '',
        }, null, 2));
        // 扫码成功就把渠道切成「自己登的」
        config.credChannel = { ...(config.credChannel || {}), bili: 'own' };
        saveConfig(config);
        return { ok: true, done: true, state: 'ok' };
      }
      const map = { 86101: 'waiting', 86090: 'scanned', 86038: 'expired' };
      return { ok: true, done: false, state: map[code] ?? 'unknown' };
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error) };
    }
  }

  // ---- 小黑盒自建扫码登录 ----
  // 签名算法（ov / generateSignature）和登录流程照 heybox（MIT，https://github.com/fbbDirge/dsh-xiaoheihe）
  // 字节级一致；凭证存余光自己的目录，不依赖 heybox 插件存在。
  const HB_ALPHABET = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89';
  const HB_API = 'https://api.xiaoheihe.cn';
  const HB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

  const hbMd5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
  const hbVm = (e) => (128 & e ? 255 & ((e << 1) ^ 27) : e << 1);
  const hbQm = (e) => hbVm(e) ^ e;
  const hbDollar = (e) => hbQm(hbVm(e));
  const hbYm = (e) => hbDollar(hbQm(hbVm(e)));
  const hbGm = (e) => hbYm(e) ^ hbDollar(e) ^ hbQm(e);
  function hbKm(e) {
    const t = [0, 0, 0, 0];
    t[0] = hbGm(e[0]) ^ hbYm(e[1]) ^ hbDollar(e[2]) ^ hbQm(e[3]);
    t[1] = hbQm(e[0]) ^ hbGm(e[1]) ^ hbYm(e[2]) ^ hbDollar(e[3]);
    t[2] = hbDollar(e[0]) ^ hbQm(e[1]) ^ hbGm(e[2]) ^ hbYm(e[3]);
    t[3] = hbYm(e[0]) ^ hbDollar(e[1]) ^ hbQm(e[2]) ^ hbGm(e[3]);
    e[0] = t[0]; e[1] = t[1]; e[2] = t[2]; e[3] = t[3];
    return e;
  }
  const hbAv = (text, alphabet, offset) => { const sliced = alphabet.slice(0, offset); let r = ''; for (let i = 0; i < text.length; i++) r += sliced[text.charCodeAt(i) % sliced.length]; return r; };
  const hbSv = (text, alphabet) => { let r = ''; for (let i = 0; i < text.length; i++) r += alphabet[text.charCodeAt(i) % alphabet.length]; return r; };
  const hbInterleave = (arr) => { let r = ''; const maxLen = Math.max(...arr.map((s) => s.length)); for (let i = 0; i < maxLen; i++) for (const s of arr) if (i < s.length) r += s[i]; return r; };
  function hbOv(path, timestamp, nonce) {
    const np = '/' + path.split('/').filter((s) => s).join('/') + '/';
    const interleaved = hbInterleave([hbAv(String(timestamp), HB_ALPHABET, -2), hbSv(np, HB_ALPHABET), hbSv(nonce, HB_ALPHABET)]).slice(0, 20);
    const hash = hbMd5(interleaved);
    const transformed = hbKm(hash.slice(-6).split('').map((c) => c.charCodeAt(0)));
    let checksum = String(transformed.reduce((s, v) => s + v, 0) % 100);
    if (checksum.length < 2) checksum = '0' + checksum;
    return hbAv(hash.substring(0, 5), HB_ALPHABET, -4) + checksum;
  }
  function hbSignature(apiPath) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = hbMd5(timestamp + Math.random().toString()).toUpperCase();
    return { hkey: hbOv(apiPath, timestamp + 1, nonce), _time: timestamp, nonce };
  }
  function hbSignedUrl(deviceId, pathName, extraParams) {
    const sig = hbSignature(pathName);
    const params = Object.assign({}, {
      os_type: 'web', app: 'heybox', client_type: 'web', version: '999.0.4', web_version: '2.5',
      x_client_type: 'web', x_app: 'heybox_website', heybox_id: '', x_os_type: 'Windows',
      device_info: 'Chrome', device_id: deviceId,
    }, { hkey: sig.hkey, _time: String(sig._time), nonce: sig.nonce }, extraParams || {});
    return HB_API + pathName + '?' + Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }
  async function hbGet(url, cookie) {
    const res = await fetch(url, {
      headers: { 'User-Agent': HB_UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', Referer: 'https://www.xiaoheihe.cn', Origin: 'https://www.xiaoheihe.cn', ...(cookie ? { Cookie: cookie } : {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return { body, cookies: setCookies };
  }
  function hbOwnCredential() {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(CRED_DIR, 'heybox.json'), 'utf8'));
      if (d.cookie && d.deviceId) return d;
    } catch { /* 还没自己的凭证 */ }
    return null;
  }
  const hbMergeCookies = (jar, cookies) => {
    for (const c of cookies) {
      const p = c.split(';', 1)[0];
      const i = p.indexOf('=');
      if (i > 0 && /^[\w-]+$/.test(p.slice(0, i))) jar.set(p.slice(0, i), p.slice(i + 1));
    }
  };
  const hbJarText = (jar) => [...jar].map(([k, v]) => k + '=' + v).join('; ');

  let hbLoginSession = null;

  async function heyboxLoginStart() {
    const deviceId = crypto.randomBytes(16).toString('hex');
    const url = hbSignedUrl(deviceId, '/account/get_qrcode_url/', { app: 'web' });
    const { body, cookies } = await hbGet(url);
    const qrUrl = body?.result?.qr_url;
    if (body?.status !== 'ok' || !qrUrl) {
      try {
        fs.mkdirSync(CRED_DIR, { recursive: true });
        fs.appendFileSync(path.join(CRED_DIR, 'login-debug.log'), JSON.stringify({
          at: new Date().toISOString(), step: 'heybox-fail',
          status: body?.status ?? null, msg: body?.msg ?? null,
          url, body: JSON.stringify(body).slice(0, 400),
        }) + '\n');
      } catch { /* 日志写不出就跳过 */ }
      return { ok: false, message: '小黑盒返回的二维码无效' };
    }
    const qr = new URL(qrUrl).searchParams.get('qr');
    const expire = Number(body?.result?.expire) || 120;
    const jar = new Map();
    hbMergeCookies(jar, cookies);
    hbLoginSession = { deviceId, qr, cookies: jar, expiresAt: Date.now() + expire * 1000 };
    return { ok: true, url: qrUrl };
  }

  async function heyboxLoginPoll() {
    if (!hbLoginSession) return { ok: false, message: '会话没了，重新出码' };
    const s = hbLoginSession;
    if (Date.now() >= s.expiresAt) { hbLoginSession = null; return { ok: true, done: false, state: 'expired' }; }
    const { body, cookies } = await hbGet(hbSignedUrl(s.deviceId, '/account/qr_state/', { qr: s.qr, app: 'web' }), hbJarText(s.cookies));
    hbMergeCookies(s.cookies, cookies);
    if (body?.status === 'need_google_check') return { ok: true, done: false, state: 'requires_2fa' };
    if (body?.status !== 'ok') return { ok: true, done: false, state: 'unknown' };
    const err = body?.result?.error;
    if (err === 'wait') return { ok: true, done: false, state: 'waiting' };
    if (err === 'ready') return { ok: true, done: false, state: 'scanned' };
    if (err === 'ok') {
      let identity = null;
      const pick = (r) => {
        const id = String(r?.profile?.heybox_id || r?.account_detail?.userid || '');
        const pkey = r?.pkey;
        if (/^\d+$/.test(id) && typeof pkey === 'string' && pkey) return { id, pkey };
        return null;
      };
      identity = pick(body?.result);
      if (!identity) {
        const restored = await hbGet(hbSignedUrl(s.deviceId, '/account/restore_login', {}), hbJarText(s.cookies));
        hbMergeCookies(s.cookies, restored.cookies);
        if (restored.body?.status === 'ok') identity = pick(restored.body?.result);
      }
      if (identity) {
        s.cookies.set('heybox_id', identity.id);
        s.cookies.set('user_heybox_id', identity.id);
        s.cookies.set('pkey', identity.pkey);
        s.cookies.set('user_pkey', identity.pkey);
        const cookie = hbJarText(s.cookies);
        fs.mkdirSync(CRED_DIR, { recursive: true });
        fs.writeFileSync(path.join(CRED_DIR, 'heybox.json'), JSON.stringify({ cookie, deviceId: s.deviceId, heyboxId: identity.id }, null, 2));
        config.credChannel = { ...(config.credChannel || {}), heybox: 'own' };
        saveConfig(config);
        hbLoginSession = null;
        return { ok: true, done: true, state: 'ok' };
      }
      return { ok: true, done: false, state: 'unknown', message: '平台没返回完整凭据' };
    }
    hbLoginSession = null;
    return { ok: true, done: false, state: 'expired' };
  }

  // ---- B 站：搜索 + 字幕（自己实现，只要 cookie，不要签名）----
  const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // 字幕/简介是否真跟这个游戏相关。B 站 AI 字幕会串视频（搜 A 游戏的字幕可能是
  // 手办开箱、新闻、歌词），所以拿到的文本必须含游戏名的字才算数。
  function textMatchesGame(text, gameName) {
    const t = String(text || '');
    if (t.includes(gameName)) return true;
    const cn = gameName.replace(/[^\u4e00-\u9fff]/g, '');
    if (cn.length >= 2) {
      // 中文名：任意 2 个连续字都不出现，就是无关内容
      for (let i = 0; i < cn.length - 1; i++) {
        if (t.includes(cn.slice(i, i + 2))) return true;
      }
      return false;
    }
    const words = gameName.match(/[A-Za-z]{3,}/g) || [];
    if (words.length) {
      const lower = t.toLowerCase();
      return words.some((w) => lower.includes(w.toLowerCase()));
    }
    return true;
  }

  async function biliSearch(gameName) {
    const cred = biliCredential();
    if (!cred) return { ok: false, message: '没找到 B 站登录态，先去刷 B 站的插件里扫码登录' };
    const cookie = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct || ''}; buvid3=${cred.buvid3}; DedeUserID=${cred.dedeuserid || ''}`;
    const headers = { 'User-Agent': BILI_UA, 'Referer': 'https://www.bilibili.com/', Cookie: cookie };
    // 每个请求都限时：之前没有超时，某个接口一慢整条自动搜就挂住，面板一直转「在搜攻略…」
    const ff = (u, opt = {}) => fetch(u, { ...opt, headers: opt.headers ?? headers, signal: AbortSignal.timeout(8000) });
    try {
      const kw = encodeURIComponent(gameName + ' 攻略');
      const sr = await ff(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${kw}&page=1`);
      const sj = await sr.json();
      // 多看几条：前 6 个里常有一半是纯中文标题，英文名的游戏要认译名才认得出
      const videos = (sj?.data?.result || []).slice(0, 20);
      const stripTag = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();
      // 英文名的游戏在 B 站上通常挂中文译名（Dead Cells → 死亡细胞），拿英文名去匹配中文标题
      // 一个字都对不上，实测 6 条里挡掉 3 条。B 站标题习惯把中文名写进《》，
      // 从带本名的标题里认一个出来当别名。
      let alias = '';
      for (const v of videos) {
        const t = stripTag(v?.title);
        if (!textMatchesGame(t, gameName)) continue;
        const m = t.match(/《([^》]{2,10})》/);
        if (m && /[\u4e00-\u9fff]/.test(m[1])) { alias = m[1]; break; }
      }
      const similar = (s) => textMatchesGame(s, gameName) || (alias !== '' && String(s || '').includes(alias));
      // 兜底：能对上本名（或译名）的标题不到三成，说明这游戏在 B 站上基本只剩中文名
      // （Slay the Spire 2 搜出来 20 条里只有 1 条带英文，18 条被挡光）。全挡等于学不到，
      // 这种时候放最相关的前 6 条。
      const matched = videos.filter((v) => similar(stripTag(v?.title))).length;
      const loose = videos.length > 0 && matched < videos.length * 0.3;
      const texts = [];
      for (let vi = 0; vi < videos.length; vi++) {
        const v = videos[vi];
        const bvid = v?.bvid;
        if (!bvid) continue;
        const vr = await ff(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
        const vj = await vr.json();
        const data = vj?.data || {};
        const title = String(data.title || '').replace(/<[^>]+>/g, '').trim();
        const desc = String(data.desc || '').trim();
        const pieces = [];
        // 拿标题当闸：标题都不像这款游戏，这条视频后面就别看了。认译名之后这一闸才挡得住该挡的。
        if (!similar(title) && !(loose && vi < 6)) continue;
        // 简介：up 主手写，干净、含黑话，永远优先。标题已经过了闸，这里不用再匹配一遍。
        // 分开标注：简介常常是 UP 主的系列视频目录（「全收集」「白金全成就」那种），
        // 和字幕混在一段里，模型会把目录当成术语抄出来。
        if (desc.length >= 10) pieces.push('【视频简介】\n' + desc);

        // 字幕：有解说的视频才有价值，无解说的会把 BGM 识别成歌词。
        // 拿回来过滤：带 ♪ 的是歌词，丢；不含游戏名字的是串了/无关，丢。
        const aid = data.aid;
        const cid = data.pages?.[0]?.cid;
        if (aid && cid) {
          try {
            const pr = await ff(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`);
            const pj = await pr.json();
            const subs = pj?.data?.subtitle?.subtitles || [];
            // subs[0] 未必是中文轨，也未必带地址——挑一条中文的、有 url 的
            const pickSub = subs.find((s) => String(s?.lan || '').includes('zh') && s?.subtitle_url)
              || subs.find((s) => s?.subtitle_url);
            const subUrl = pickSub?.subtitle_url || '';
            if (subUrl) {
              const fullUrl = subUrl.startsWith('//') ? 'https:' + subUrl : subUrl;
              const cr = await ff(fullUrl, { headers: { 'User-Agent': BILI_UA } });
              const cj = await cr.json();
              const subText = (cj?.body || []).map((b) => b?.content || '').join('\n');
              // 字幕里一次都没出现游戏名（或认出来的译名）就整条扔：B 站的 AI 字幕轨会串到
              // 别的视频上——博德之门3 那个 74P、81 小时的合集，P1 字幕是另一个 UP 主跑长途的
              // 卡车 vlog（「进了BC省」「482迈」），一个字都跟这游戏无关，喂给模型全是噪音。
              const named = textMatchesGame(subText, gameName) || (alias !== '' && subText.includes(alias));
              if (subText.length >= 50 && !subText.includes('♪') && named) {
                pieces.push('【字幕】\n' + subText);
              }
            }
          } catch { /* 字幕拿不到就算了，简介还在 */ }
        }

        // 每条限 2000 字：第一条的字幕可能整段串台（博德之门3 那条开头三千字是另一部作品的台词），
        // 不加限制它会把预算全吃掉，模型只看到那一堆垃圾。
        if (pieces.length) texts.push((title + '\n' + pieces.join('\n')).slice(0, 2000));
        if (texts.length >= 6) break;
      }
      if (!texts.length) return { ok: false, message: 'B 站没搜到带攻略内容的视频' };
      return { ok: true, text: texts.join('\n\n').slice(0, 20000) };
    } catch (error) {
      return { ok: false, message: 'B 站搜索失败：' + String(error?.message ?? error) };
    }
  }

  // 找隔壁 heybox 插件的入口。它是跟着 profile 装的，落在 profiles/<名字>/node_modules 下，
  // 写死 plugins/heybox 会找不到——自动学黑话在 Dead Cells 上连挂 8 次就是栽在这儿。
  function resolveHeyboxEntry() {
    const cands = [];
    try {
      const pdir = path.join(DSH_HOME, 'profiles');
      for (const e of fs.readdirSync(pdir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        cands.push(path.join(pdir, e.name, 'node_modules', 'heybox', 'lib', 'index.js'));
      }
    } catch { /* profiles 读不到就只试旧路径 */ }
    cands.push(path.resolve(PACKAGE_ROOT, '..', 'heybox', 'lib', 'index.js'));
    return cands.find((p) => fs.existsSync(p)) || '';
  }

  // ---- 小黑盒：搜索（借 heybox 的签名函数）----
  async function heyboxSearch(gameName) {
    const st = heyboxState();
    if (!st) return { ok: false, message: '没找到小黑盒登录态' };
    try {
      const modPath = resolveHeyboxEntry();
      if (!modPath) return { ok: false, message: '没装 heybox 插件（profiles 下找不到），小黑盒这条跳过' };
      const mod = await import(pathToFileURL(modPath).href);
      const { requestHeybox } = mod;
      // 用 general 而不是 link：general 会带出 filter_tags，那里是社区对这款游戏
      // 的核心分类（菜谱/结局/炼金配方/神谕/好感度…），本身就是现成的机制词。
      // link 模式只有帖子，而且实测很多是「美图分享」「破绷了」这种垃圾。
      const d = await requestHeybox(st, '/bbs/app/api/general/search/v1/web', { q: gameName, search_type: 'general', offset: '0', limit: '15' });
      const items = d?.result?.items || [];
      const pieces = [];
      for (const it of items) {
        const info = it?.info || {};
        if (it?.type === 'filter_tag' && Array.isArray(info.filter_tags)) {
          const tags = info.filter_tags
            .map((t) => String(t?.name || '').trim())
            .filter((n) => n && n !== '全部');
          if (tags.length) pieces.push('社区常用分类标签：' + tags.join('、'));
        } else if (it?.type === 'game') {
          const name = String(info.name || '').trim();
          const genres = Array.isArray(info.genres) ? info.genres.join('、') : '';
          if (name) pieces.push(`游戏：${name}${genres ? '（' + genres + '）' : ''}`);
        } else if (it?.type === 'link') {
          const title = String(info.title || '').replace(/<[^>]+>/g, '').trim();
          const desc = String(info.description || '').replace(/<[^>]+>/g, '').trim();
          const combined = (title + '\n' + desc).trim();
          // 帖子只留跟游戏名相关的，挡掉「美图分享」「破绷了」这类无关水帖
          if (combined.length < 8) continue;
          if (!textMatchesGame(combined, gameName)) continue;
          pieces.push(combined);
        }
      }
      if (!pieces.length) return { ok: false, message: '小黑盒没搜到攻略内容' };
      return { ok: true, text: pieces.join('\n\n').slice(0, 20000) };
    } catch (error) {
      return { ok: false, message: '小黑盒搜索失败：' + String(error?.message ?? error) };
    }
  }

  // ---- 游戏名归一化：把「游戏名+搜索词」这种写法折回已有的游戏名 ----
  // 走的是「输入里包含某个已有游戏名」这条：输错的人多半是在游戏名后面加了搜索词。
  function normalizeGameName(input) {
    const name = String(input || '').trim();
    if (!name) return name;
    try {
      const p = notesPath();
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      const existing = Object.keys(d).filter((k) => k && k.trim());
      if (existing.includes(name)) return name;
      const contains = existing.filter((e) => name.includes(e)).sort((a, b) => b.length - a.length);
      if (contains.length) return contains[0];
    } catch { /* 读不到就原样用 */ }
    return name;
  }

  // ---- 自动搜攻略：两个源都试，合并文本，摘词 ----
  async function autoLearn(rawGameName, keyword = '') {
    const gameName = normalizeGameName(rawGameName);
    // 关键词搜索：搜「游戏名 关键词」；不填关键词就搜「游戏名 攻略」（biliSearch 内部会补攻略）
    const kw = String(keyword ?? '').trim();
    const query = kw ? `${gameName} ${kw}` : gameName;
    const parts = [];
    const failures = [];
    const b = await biliSearch(query);
    if (b.ok) parts.push(b.text); else failures.push(b.message);
    const h = await heyboxSearch(query);
    if (h.ok) parts.push(h.text); else failures.push(h.message);
    if (!parts.length) {
      return { ok: false, message: '两个源都没搜到：' + failures.join('；') };
    }
    const merged = parts.join('\n\n');
    // 闸一：原料太少就不摘。几句话里硬摘，模型只会瞎编。
    if (merged.length < 300) {
      try {
        fs.appendFileSync(path.join(STORAGE, 'auto-learn.log'), JSON.stringify({
          at: new Date().toISOString(), game: gameName,
          biliLen: b.ok ? b.text.length : 0, heyboxLen: h.ok ? h.text.length : 0,
          failures, merged: merged.slice(0, 200),
        }) + '\n');
      } catch { /* 日志写不出就跳过 */ }
      return { ok: false, message: `搜到的攻略内容太少（${merged.length} 字），不摘了` };
    }
    const r = await extractTerms(gameName, merged);
    if (r.ok && Array.isArray(r.terms)) {
      // 闸二：术语必须在原料里出现过，否则是模型编的，丢掉。
      // （规则不做这条——规则是概括性的话，本来就是改写。）
      r.terms = r.terms.filter((t) => {
        const s = String(t || '').trim();
        if (!s) return false;
        if (merged.includes(s)) return true;
        return s.length >= 2 && merged.includes(s.slice(0, 2));
      });
      // extra 不过闸二：那本来就是模型自己补的、原料里没有的词。面板单独列一块，
      // 写清「攻略里没出现」，勾不勾她自己定——比只给搜到的十几个强。
      if (!Array.isArray(r.extra)) r.extra = [];
      r.extra = r.extra.map((t) => String(t || '').trim()).filter((s) => s && !r.terms.includes(s)).slice(0, 20);
      // 再单独要一批词：一次让模型干四件事（摘词、写规则、写梗、补术语），它常常只顾前三件，
      // 补充那项直接返回空——博德之门3 实测连「属性豁免」「大成功」都没补出来。单独问一次就正常了。
      try {
        const more = await modelTerms(gameName);
        if (more.length) {
          r.extra = [...new Set([...r.extra, ...more])].filter((t) => !r.terms.includes(t)).slice(0, 30);
        }
      } catch { /* 补不上就算了，不能挡住已经摘到的词 */ }
    }
    return { ...r, sources: { bili: b.ok, heybox: h.ok }, failures };
  }

  // ---- 自动补黑话：识别到黑话少的游戏，静默补到基础，补过就标记不再重复 ----
  const autoLearnedGames = new Set(); // 本会话内已经自动补过的游戏名，避免切来切去反复搜

  function countNotes(gameName) {
    // 读 games-notes.json，返回该游戏当前的黑话条数。没有条目返回 0。
    try {
      const p = notesPath();
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      const key = notesKeyFor(gameName, d);
      const note = d[key];
      return Array.isArray(note?.['黑话']) ? note['黑话'].length : 0;
    } catch {
      return 0;
    }
  }

  function notesKeyFor(gameName, notesData) {
    // 同一款游戏可能在黑话库里有两把 key（先补英文名、后补中文名），
    // 入库前归一到既有 key，别让中英文分成两条。
    const norm = (s) => String(s).trim().toLowerCase().replace(/[\s\-_:：]+/g, '');
    const d = notesData;
    const keys = Object.keys(d || {});
    const hit = keys.find((k) => norm(k) === norm(gameName));
    if (hit !== undefined) return hit;
    try {
      const allP = path.join(PACKAGE_ROOT, 'helper', 'games-all.json');
      const all = JSON.parse(fs.readFileSync(allP, 'utf8'));
      const aliases = new Set();
      for (const info of Object.values(all)) {
        const name = norm(String(info?.name || ''));
        const al = (info?.aliases || []).map((a) => norm(String(a)));
        // 两边都认：游戏名对上 name，或者对上别名。
        // 只看 name 会漏——词库键是「杀戮尖塔2」，她窗口标题是「Slay the Spire 2」，
        // 中文名的别名表里有英文名，反过来却没有，于是中英两边各认各的。
        if (name !== norm(gameName) && !al.includes(norm(gameName))) continue;
        if (info?.name) aliases.add(String(info.name));
        for (const a of (info?.aliases || [])) aliases.add(String(a));
      }
      for (const k of keys) {
        for (const a of aliases) {
          if (norm(a) === norm(k)) return k;
        }
      }
    } catch { /* 找不到别名表就原样用 */ }
    return gameName;
  }

  async function maybeAutoLearn(gameName) {
    if (!config.autoLearn) return;
    if (!gameName || autoLearnedGames.has(gameName)) return;
    if (countNotes(gameName) >= 5) return; // 已经有基础了，不补
    const r = await autoLearn(gameName);
    // 失败要留痕：之前静默失败，谁都看不到「补了没补、为什么没补」。
    try {
      fs.appendFileSync(path.join(STORAGE, 'auto-learn.log'), JSON.stringify({
        at: new Date().toISOString(), game: gameName, ok: r.ok,
        message: r.message ?? '', terms: (r.terms || []).length,
      }) + '\n');
    } catch { /* 日志写不出就算了 */ }
    if (!r.ok || !Array.isArray(r.terms) || r.terms.length === 0) return;
    // 成功了才记「本会话试过」；失败的以后还有机会再试
    autoLearnedGames.add(gameName);
    // 静默入库：直接合并进 games-notes.json，通知 sense 重载。
    // 这里不做审批——「补到基础」是自动的，后续想补更多走手动审批。
    try {
      const p = notesPath();
      let data = {};
      try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* 空文件 */ }
      const key = notesKeyFor(gameName, data);
      const existing = data[key] || {};
      const oldTerms = Array.isArray(existing['黑话']) ? existing['黑话'] : [];
      const oldRules = Array.isArray(existing['规则']) ? existing['规则'] : [];
      const oldMemes = Array.isArray(existing['梗']) ? existing['梗'] : [];
      const terms = Array.isArray(r.terms) ? r.terms : [];
      const rules = Array.isArray(r.rules) ? r.rules : [];
      const memes = Array.isArray(r.memes) ? r.memes : [];
      data[key] = {
        '黑话': [...new Set([...oldTerms, ...terms])],
        '规则': [...new Set([...oldRules, ...rules])],
        '梗': [...new Set([...oldMemes, ...memes])],
      };
      fs.writeFileSync(p, JSON.stringify(data, null, 1), 'utf8');
      sendHelper({ op: 'reload-notes' });
      lastLearned = { title: gameName, game: gameName, genres: [], at: Date.now() };
    } catch (error) {
      // 写库失败要留痕：之前静默吞，摘词明明成功却「没入库」，谁都看不见为什么
      try {
        fs.appendFileSync(path.join(STORAGE, 'auto-learn.log'), JSON.stringify({
          at: new Date().toISOString(), game: gameName, step: 'write-fail',
          message: String(error?.message ?? error),
        }) + '\n');
      } catch { /* 日志都写不出就算了 */ }
    }
  }

  // 撞上限那一刻，在字幕上留一句。让用户知道是「还在，只是不吵」，
  // 而不是「它是不是死了」。只留一次，别变成新的噪音。
  let toldCap = false;

  function maybeReact(event) {
    const now = Date.now();
    const factor = throttleFactor(now);
    if (factor === 0) return;
    if (factor > SLOW_STEPS[0]) {
      if (!toldCap && factor >= SLOW_STEPS[3]) {
        toldCap = true;
        try {
          fs.writeFileSync(HUD, '还在，先不吵。', 'utf8');
        } catch {
          /* 写不进去就算了，不值得为此中断 */
        }
      }
    } else {
      toldCap = false;
    }
    const match = String(config.windowMatch ?? '').trim().toLowerCase();
    if (match !== '' && !String(event.title ?? '').toLowerCase().includes(match)) return;
    // 刚打开陪看的前 5 秒先不抓：那会儿前台还是余光面板，抓下来就是对着自己说话
    if (autoOnAt > 0 && now - autoOnAt < 5000) return;
    // 沉默翻倍删了：它把冷却乘到 8 倍（六分钟一次），地图、看菜单这种安静画面被压得一句话说不出。
    // 省钱只靠上面的上限曲线（factor），别再叠一层。
    // 冷却按「上一次真的开口」和「上一次尝试」里较晚的那个算：
    // 尝试失败的也算数，否则早退分支就变成不占冷却的重试风暴。
    if (now - Math.max(lastReactAt, lastAttemptAt) < Number(config.cooldownMs ?? 45000) * factor) return;
    lastAttemptAt = now;
    // 自发事件失败只记 lastError，别让未捕获的 rejection 升级成 fatal load failure。
    // 反过来，成功一次就把「采样那一环」的旧报错擦掉：那类消息不带时间戳，
    // 留着就一直挂在面板上，看着像现在还在坏（11-19 那条 cannot unpack 就是这么挂了一晚）。
    void react(event)
      .then(() => {
        if (/^(grab failed|采样出错)/.test(lastError)) lastError = '';
      })
      .catch((error) => { lastError = String(error?.message ?? error); });
  }

  function askHelper(payload, kind, timeoutMs = 6000) {
    const proc = startHelper();
    if (proc === null) return Promise.reject(new Error(lastError || '帮工没起来'));
    return new Promise((resolve, reject) => {
      const entry = { kind, resolve, any: false, timer: null };
      entry.timer = setTimeout(() => {
        waitingQueue = waitingQueue.filter((w) => w !== entry);
        reject(new Error(`${kind} 超时`));
      }, timeoutMs);
      // 同上：兜底超时不该把宿主退出拖住
      if (typeof entry.timer.unref === 'function') entry.timer.unref();
      waitingQueue.push(entry);
      if (!sendHelper(payload)) {
        clearTimeout(entry.timer);
        waitingQueue = waitingQueue.filter((w) => w !== entry);
        reject(new Error('帮工没在跑'));
      }
    });
  }

  function snap(timeoutMs = 15000) {
    // 6 秒不够：看一眼要抓全屏 + OCR 读原图 + 存盘，实测 OCR 一跑就五秒往上，
    // 宿主先超时、事件后到，就成了「图拍了却当没拍到」。
    return askHelper({ op: 'snap' }, 'snap', timeoutMs);
  }

  function stateSnapshot() {
    const now = Date.now();
    const cutoff = now - 3600000;
    const recent = reactTimes.filter((at) => at >= cutoff).length;
    return {
      config: { ...config },
      helper: helper !== null && helper.exitCode === null ? 'running' : 'stopped',
      ready: helperReady,
      lastEvent,
      recentReactions: recent,
      leftThisHour: leftThisHour(),
      lastReactAt,
      agent: resolveAgent()?.session?.header?.id ?? null,
      lastError,
      pendingGames: { ...pendingGames },
      lastGame,
      lastLearned,
      ocrReady: checkOcr(),
      firstRun: config.firstRun !== false,
      // 今天的账：几次、平均几秒、平均多少 token、缓存命中多少、大概花了多少。
      // 只看「最近几次陪看」不够——超过十几条前面的就翻不到了，这里给个总数。
      // 价钱按 off-peak 单价估（输入 $0.15 / 缓存 $0.003 / 输出 $0.6 每百万），
      // 峰值时段会翻倍，所以这个数只能当参考，不是账单。
      looksStats: (() => {
        try {
          const all = fs.readdirSync(LOOKS_DIR).filter((n) => n.endsWith('.json')).sort().reverse();
          let direct = 0, sub = 0, sec = 0, inp = 0, cache = 0, cwr = 0, out = 0;
          for (const name of all) {
            try {
              const d = JSON.parse(fs.readFileSync(path.join(LOOKS_DIR, name), 'utf8'));
              const u = d.usage || {};
              // 子代理那几条还没记账，单独数个数，别混进平均里把数拉歪
              if (!u.inputTokens && !u.outputTokens && !u.cacheReadTokens) { sub += 1; continue; }
              direct += 1;
              sec += Number(d.ms || 0) / 1000;
              inp += Number(u.inputTokens || 0);
              cache += Number(u.cacheReadTokens || 0);
              cwr += Number(u.cacheWriteTokens || 0);
              out += Number(u.outputTokens || 0);
            } catch { /* 坏文件跳过 */ }
          }
          return {
            count: direct + sub,
            direct,
            sub,
            total: all.length,
            avgSec: direct > 0 ? Math.round((sec / direct) * 10) / 10 : 0,
            avgOut: direct > 0 ? Math.round(out / direct) : 0,
            sumIn: inp,
            sumCache: cache,
            sumWrite: cwr,
            sumOut: out,
            sumTotal: inp + cache + cwr + out,
            cacheRate: (inp + cache) > 0 ? Math.round((cache / (inp + cache)) * 100) : 0,
          };
        } catch { return null; }
      })(),
      // 最近几次陪看的账：它收到了什么、说了什么、花了多少。
      // 直调没有会话可翻，面板上这块就是替代品。
      looks: (() => {
        try {
          // 跟 LOOKS_KEEP 对齐：以前只取 40 条，一天下来上一局的账就被挤没了，
          // 面板上看起来像「记录不见了」。落盘留 1000，这里取 400（约八局，够看前几局）。
          const names = fs.readdirSync(LOOKS_DIR).filter((n) => n.endsWith('.json')).sort().reverse().slice(0, LOOKS_SHOW);
          return names.map((n) => {
            try {
              const d = JSON.parse(fs.readFileSync(path.join(LOOKS_DIR, n), 'utf8'));
              return {
                file: n,
                at: d.at,
                route: d.route,
                ms: d.ms,
                said: d.said,
                promptChars: typeof d.prompt === 'string' ? d.prompt.length : 0,
                promptHead: typeof d.prompt === 'string' ? d.prompt.slice(0, 300) : '',
                usage: d.usage ?? null,
                run: Number(d.run) || 0,
              };
            } catch { return null; }
          }).filter(Boolean);
        } catch { return []; }
      })(),
      // 登录态：渠道由用户选（'' 未选 / own 自己扫码 / borrow 借用隔壁），不自动替用户做主
      logins: (() => {
        const ch = config.credChannel || {};
        const biliCh = ch.bili === 'own' || ch.bili === 'borrow' ? ch.bili : '';
        const hbCh = ch.heybox === 'borrow' ? ch.heybox : '';
        let hbBorrow = false;
        try {
          const d = JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'heybox', 'state.json'), 'utf8'));
          hbBorrow = Boolean(d.cookie && d.deviceId);
        } catch { /* 隔壁没登录 */ }
        return {
          bili: { channel: biliCh, ready: biliCredential() !== null, canOwn: biliOwnCredential() !== null, canBorrow: biliPluginCredential() !== null },
          heybox: { channel: hbCh, ready: heyboxState() !== null, canBorrow: hbBorrow },
        };
      })(),
    };
  }

  function applyPatches(raw) {
    // 先记下改动前的开关值，改完用来判断「这次是不是真的动了字幕窗/弹幕」
    const prevHudOn = config.hudOn === true;
    const prevDanmakuOn = config.danmakuOn === true;
    const prevDanmakuCap = config.danmakuCapturable === true;
    // 第一次装：用户动过面板就收起三步引导
    if (config.firstRun !== false && raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
      config.firstRun = false;
    }
    for (const key of ['auto', 'windowOnly', 'intervalManual', 'floorManual']) {
      if (typeof raw[key] === 'boolean') {
        // 陪看从关到开：记一下时间，头几秒别抓（那会儿前台还是面板/DSH）
        if (key === 'auto' && raw.auto === true && config.auto !== true) {
          autoOnAt = Date.now();
        }
        config[key] = raw[key];
      }
    }
    if (config.tier === null || typeof config.tier !== 'object') {
      config.tier = { video: 'balance', game: 'balance', any: 'balance' };
    }
    const MODES = ['video', 'game'];
    const TIERS = ['save', 'balance', 'extreme'];
    // 把某一档的三个数真正套到 config 上。后面如果有显式传数字，会再覆盖一遍，
    // 所以「先切档、再拖滑块」的顺序是对的。
    const applyPreset = () => {
      const preset = PRESETS[config.mode]?.[config.tier[config.mode]];
      if (!preset) return;
      // 手调过的值不被档位覆盖：档位是基准，不是枷锁
      if (Number.isFinite(preset.intervalMs) && config.intervalManual !== true) config.intervalMs = preset.intervalMs;
      if (Number.isFinite(preset.floorSec) && config.floorManual !== true) config.floorSec = preset.floorSec;
    };
    if (typeof raw.mode === 'string' && MODES.includes(raw.mode)) {
      if (raw.mode !== config.mode) {
        config.mode = raw.mode;
        applyPreset();
      }
    }
    if (typeof raw.tier === 'string' && TIERS.includes(raw.tier)) {
      if (config.tier[config.mode] !== raw.tier) {
        config.tier[config.mode] = raw.tier;
        applyPreset();
      }
    } else if (raw.tier !== null && typeof raw.tier === 'object') {
      for (const mode of MODES) {
        if (TIERS.includes(raw.tier[mode])) config.tier[mode] = raw.tier[mode];
      }
    }
    if (typeof raw.targetSession === 'string') {
      config.targetSession = raw.targetSession;
    }
    if (typeof raw.sayCheck === 'string') {
      config.sayCheck = raw.sayCheck;
    }
    if (typeof raw.personaHint === 'string') {
      config.personaHint = raw.personaHint;
    }
    if (typeof raw.speak === 'boolean') {
      config.speak = raw.speak;
    }
    if (typeof raw.ttsCommand === 'string') {
      config.ttsCommand = raw.ttsCommand;
    }
    if (typeof raw.ttsBackend === 'string') {
      config.ttsBackend = raw.ttsBackend;
      config.voicePicked = true;
      const say = path.join(DSH_HOME, 'plugins', 'dsh-voice-say', 'say.mjs');
      if (raw.ttsBackend === 'sapi') {
        config.ttsCommand = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{text}')"`;
      } else if (raw.ttsBackend === 'say.mjs' && fs.existsSync(say)) {
        const v = String(config.ttsVoice || '').trim();
        config.ttsCommand = `node "${say}" --text "{text}" --speak${v ? ` --voice "${v}"` : ''}`;
      } else {
        config.ttsCommand = '';
      }
    }
    if (typeof raw.ttsVoice === 'string') {
      config.ttsVoice = raw.ttsVoice.trim();
      // 换音色就重拼命令（当前走 say.mjs 的话）
      if (String(config.ttsCommand || '').includes('say.mjs')) {
        const say = path.join(DSH_HOME, 'plugins', 'dsh-voice-say', 'say.mjs');
        const v = config.ttsVoice;
        config.ttsCommand = `node "${say}" --text "{text}" --speak${v ? ` --voice "${v}"` : ''}`;
      }
    }
    if (Number.isFinite(Number(raw.danmakuSpeed))) {
      config.danmakuSpeed = Math.max(40, Math.min(800, Number(raw.danmakuSpeed)));
    }
    if (typeof raw.danmakuOn === 'boolean') {
      config.danmakuOn = raw.danmakuOn;
    }
    if (typeof raw.hudStyle === 'string') config.hudStyle = raw.hudStyle;
    if (typeof raw.hudFontFamily === 'string' && raw.hudFontFamily.trim() !== '') config.hudFontFamily = raw.hudFontFamily;
    if (typeof raw.hudTextColor === 'string') config.hudTextColor = raw.hudTextColor.trim();
    if (Number.isFinite(Number(raw.hudFontSize))) config.hudFontSize = Math.max(9, Math.min(48, Number(raw.hudFontSize)));
    if (Number.isFinite(Number(raw.hudOpacity))) config.hudOpacity = Math.max(0.35, Math.min(1, Number(raw.hudOpacity)));
    if (typeof raw.hudFade === 'boolean') config.hudFade = raw.hudFade;
    if (Number.isFinite(Number(raw.hudHoldSec))) config.hudHoldSec = Math.max(2, Math.min(300, Number(raw.hudHoldSec)));
    if (Number.isFinite(Number(raw.hudFadeSec))) config.hudFadeSec = Math.max(0.3, Math.min(10, Number(raw.hudFadeSec)));
    if (typeof raw.hudCapturable === 'boolean') config.hudCapturable = raw.hudCapturable;
    if (typeof raw.danmakuCapturable === 'boolean') config.danmakuCapturable = raw.danmakuCapturable;
    if (typeof raw.reactModel === 'string' && raw.reactModel.trim() !== '') config.reactModel = raw.reactModel.trim();
    if (typeof raw.reactProvider === 'string' && raw.reactProvider.trim() !== '') config.reactProvider = raw.reactProvider.trim();
    // 直调开关：关掉就一律走子代理（直调出问题时的紧急退路）
    if (typeof raw.directLlm === 'boolean') { config.directLlm = raw.directLlm; llmDirectFails = 0; }
    if (Number.isFinite(Number(raw.danmakuFontSize))) config.danmakuFontSize = Math.max(9, Math.min(48, Number(raw.danmakuFontSize)));
    if (typeof raw.danmakuFontFamily === 'string' && raw.danmakuFontFamily.trim() !== '') config.danmakuFontFamily = raw.danmakuFontFamily;
    if (typeof raw.danmakuTextColor === 'string') config.danmakuTextColor = raw.danmakuTextColor.trim();
    if (['top', 'upper', 'middle', 'lower', 'bottom', 'full'].includes(raw.danmakuZone)) config.danmakuZone = raw.danmakuZone;
    if (['verySlow', 'slow', 'normal', 'fast', 'veryFast'].includes(raw.danmakuSpeedLevel)) config.danmakuSpeedLevel = raw.danmakuSpeedLevel;
    const numbers = [
      ['intervalMs', 400, 60000],
      ['floorSec', 5, 1800],
      ['silentMax', 10, 3600],
      ['singleEverySec', 0, 3600],
      ['cooldownMs', 5000, 3600000],
      ['maxPerHour', 1, 600],
      ['quietUntil', 0, Number.MAX_SAFE_INTEGER],
    ];
    for (const [key, min, max] of numbers) {
      const value = Number(raw[key]);
      if (Number.isFinite(value)) config[key] = Math.min(max, Math.max(min, value));
    }
    if (typeof raw.windowMatch === 'string') config.windowMatch = raw.windowMatch.trim();
    if (typeof raw.currentShow === 'string') config.currentShow = raw.currentShow.trim();
    if (typeof raw.showMemory === 'boolean') config.showMemory = raw.showMemory;
    if (typeof raw.gameAutoFetch === 'boolean') config.gameAutoFetch = raw.gameAutoFetch;
    if (typeof raw.autoLearn === 'boolean') config.autoLearn = raw.autoLearn;
    // 字幕窗/弹幕只在各自开关真的变了时才动。以前什么配置都无差别 applyHud()，
    // 结果改个弹幕开关也会把字幕窗重判一遍（连带清空字幕、重设尺寸）。
    const hudTouched = typeof raw.hudOn === 'boolean' && raw.hudOn !== prevHudOn;
    const danmakuTouched = typeof raw.danmakuOn === 'boolean' && raw.danmakuOn !== prevDanmakuOn;
    // 可截图开关要重启那个窗口才生效（窗口样式只在创建时设一次）
    const danmakuCapTouched = typeof raw.danmakuCapturable === 'boolean' && raw.danmakuCapturable !== prevDanmakuCap;
    if (typeof raw.hudOn === 'boolean') config.hudOn = raw.hudOn;
    saveConfig(config);
    if (hudTouched) applyHud();
    if (danmakuTouched || danmakuCapTouched) applyDanmaku();
    if (helper !== null) {
      sendHelper(helperConfigPatch(config));
    }
    return { ...config };
  }

  function recordError(error) {
    lastError = String(error?.stack ?? error?.message ?? error);
    try {
      fs.mkdirSync(STORAGE, { recursive: true });
      fs.writeFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${lastError}\n`, 'utf8');
    } catch {
      /* 连错误都写不下去就算了 */
    }
  }

  /** 加载进度打点：出问题时能看出停在哪一步。 */
  const steps = [];
  function mark(step) {
    steps.push(step);
    try {
      fs.mkdirSync(STORAGE, { recursive: true });
      fs.writeFileSync(path.join(STORAGE, 'apply-steps.json'), JSON.stringify({ at: new Date().toISOString(), steps }, null, 2), 'utf8');
    } catch {
      /* ignore */
    }
  }

  if (typeof ctx.on === 'function') {
    ctx.on('agent/turn-stopping', (payload) => {
      rememberAgent(payload?.agent);
    });
  }

  startHelper();
  mark('helper-started');
  ctx.logger?.info?.(`dsh-whale-glance: 陪看就位（自动 ${config.auto ? '开' : '关'}，采样 ${config.intervalMs}ms，截图在 ${FRAMES}）`);

  try {
  mark('registrations-begin');
  disposers.push(
    ctx.tools.register({
      name: 'sense_state',
      description: 'Whale Glance (余光) status: whether the screen watcher is running, current config (auto/interval/cooldown), last change event, reaction counts and last error.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: { type: 'object', additionalProperties: true, required: ['ok'], properties: { ok: { type: 'boolean' } } },
        render: (_args, value) => [
          {
            type: 'text',
            text: `陪看${value?.config?.auto ? '自动开着' : '自动关着'}；眼睛${value?.helper === 'running' ? '在线' : '未启动'}；这一小时说了 ${value?.recentReactions ?? 0} 次${value?.lastEvent ? `；上次画面变化 ${Math.round((value.lastEvent.score ?? 0) * 100)}%（${value.lastEvent.title ?? ''}）` : ''}${value?.lastError ? `；报错：${value.lastError}` : ''}`,
          },
        ],
      },
      async execute() {
        return { ok: true, ...stateSnapshot() };
      },
      presentCall() {
        return { card: 'generic', title: 'sense_state', kind: 'read' };
      },
    }),
  );

  mark('sense_state');
  disposers.push(
    ctx.tools.register({
      name: 'sense_config',
      description: 'Change whale-glance settings: auto (bool, wake me on screen changes), mode (video/game scene), tier (save/balance/extreme, per mode), intervalMs (sampling), floorSec (minimum seconds between wake-ups), cooldownMs, maxPerHour, quietUntil (epoch ms), windowMatch (window title filter), windowOnly (crop to that window), targetSession, sayCheck (gate command run before speaking). Omitted fields stay unchanged.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          auto: { type: 'boolean' },
          mode: { type: 'string', enum: ['video', 'game'], description: '场景：video=视频（看画面和台词），game=游戏（看资源和人口）' },
          tier: { type: 'string', enum: ['save', 'balance', 'extreme'], description: '强度：节约 / 平衡 / 极致，只作用于当前场景，每个场景各记各的' },
          intervalMs: { type: 'number' },
          floorSec: { type: 'number', description: '最短发言间隔（秒）：画面一直在动但没到切点时，最多隔这么久也叫一次' },
          cooldownMs: { type: 'number' },
          maxPerHour: { type: 'number' },
          quietUntil: { type: 'number' },
          windowMatch: { type: 'string', description: 'Only react when the foreground window title contains this text (case-insensitive); empty means any window.' },
          windowOnly: { type: 'boolean', description: '只截那个窗口的矩形，而不是整屏' },
          targetSession: { type: 'string', description: '唤醒消息发给哪个会话（会话 id）；空字符串 = 自动挑最活跃的那个' },
          sayCheck: { type: 'string', description: '开口前过闸的命令：说话前先跑它，退出码非零就不说这句话；命令里的 {text} 会替换成要说的那句，不写占位符就拼在末尾。空字符串 = 不过闸' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, required: ['ok'], properties: { ok: { type: 'boolean' } } },
        render: (_args, value) => [
          {
            type: 'text',
            text: `陪看：自动${value?.config?.auto ? '开' : '关'}，场景 ${value?.config?.mode ?? 'game'}，强度 ${value?.config?.tier?.[value?.config?.mode ?? 'game'] ?? 'balance'}，采样 ${value?.config?.intervalMs}ms，最短发言 ${value?.config?.floorSec}s，冷却 ${value?.config?.cooldownMs}ms`,
          },
        ],
      },
      async execute(args) {
        return { ok: true, config: applyPatches(args ?? {}) };
      },
      presentCall() {
        return { card: 'generic', title: 'sense_config', kind: 'write' };
      },
    }),
  );

  mark('sense_config');
  disposers.push(
    ctx.tools.register({
      name: 'sense_init',
      description: 'One-shot setup for the companion: pick a working voice backend, and write the owner\'s speaking style into personaHint. The calling agent (the owner\'s own AI, already in this session with its persona) answers the questionnaire itself and passes the answer as text — no subagents, no extra cost. Call without text to get the questionnaire.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: '一句话口癖描述，由你（主会话的 AI）根据自己的人设写，比如「自称本鱼，雌小鬼口吻，叫主人杂鱼」。不传就只返回问卷。' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, required: ['ok'], properties: { ok: { type: 'boolean' } } },
        render: (_args, value) => [
          { type: 'text', text: `陪看初始化：口癖${value?.personaHint ? '已填' : '还没填'}；语音${value?.voice === 'none' ? '没找到（得自己配 ttsCommand）' : `配了 ${value?.voice}`}` },
        ],
      },
      async execute(args) {
        try {
          const text = String(args?.text ?? '').trim();
          const voice = detectVoice(config.ttsVoice);
          config.ttsCommand = voice.ttsCommand;
          if (text !== '') config.personaHint = text;
          saveConfig(config);
          return {
            ok: true,
            personaHint: config.personaHint,
            ttsCommand: config.ttsCommand,
            voice: voice.voice,
            questionnaire: text === ''
              ? '陪看口癖问卷——按你自己的人设回答，答完带 text 再调一次 sense_init 写进去：\n1. 你自称什么（比如「本鱼」「我」）？\n2. 你怎么称呼主人？\n3. 你什么语气（比如「雌小鬼、骄横、爱嘲讽」）？\n4. 有没有口头禅或语气词？\n5. 绝对不能做什么？\n把答案浓缩成一句不超过 40 字的话。'
              : '',
          };
        } catch (error) {
          return { ok: false, message: String(error?.message ?? error) };
        }
      },
      presentCall() {
        return { card: 'generic', title: 'sense_init', kind: 'write' };
      },
    }),
  );
  disposers.push(
    ctx.tools.register({
      name: 'sense_autotune',
      description: 'Auto-tune the companion for the current pace: infer from the latest screen-change score (or a hint) and switch the tier so it wakes less on fast action and more on still screens. Call this when the owner is playing/watching and you want the cadence to fit without hand-tuning params.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pace: { type: 'string', enum: ['calm', 'normal', 'dense'], description: '可选：calm=画面静止/慢节奏，dense=画面一直变/快节奏；不传就按上次画面变化自动判断' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, required: ['ok'], properties: { ok: { type: 'boolean' } } },
        render: (_args, value) => [
          { type: 'text', text: `自动调参：画面${value?.scoreText ?? '未知'}，切到「${value?.tier ?? 'balance'}」档（${value?.tierZh ?? ''}）` },
        ],
      },
      async execute(args) {
        const score = Number(lastEvent?.score ?? 0);
        const pace = args?.pace || (score > 0.25 ? 'dense' : score < 0.02 ? 'calm' : 'normal');
        const tier = pace === 'dense' ? 'save' : pace === 'calm' ? 'extreme' : 'balance';
        const tierZh = tier === 'save' ? '节约（少唤醒）' : tier === 'extreme' ? '极致（多唤醒）' : '平衡';
        const scoreText = score > 0.25 ? '变化大' : score < 0.02 ? '基本静止' : '中等变化';
        const result = applyPatches({ tier });
        return { ok: true, tier, tierZh, scoreText, config: result };
      },
      presentCall() {
        return { card: 'generic', title: 'sense_autotune', kind: 'write' };
      },
    }),
  );
  disposers.push(
    ctx.tools.register({
      name: 'sense_snap',
      description: 'Force one screen capture right now (skips the change check and the cooldown) and return the saved JPEG path plus foreground window title. Use it when you want to look at the screen on demand.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: { type: 'object', additionalProperties: true, required: ['ok'], properties: { ok: { type: 'boolean' } } },
        render: (_args, value) => [{ type: 'text', text: `看了一眼：${value?.path ?? ''}（${value?.title ?? ''}）` }],
      },
      async execute() {
        const event = await snap();
        return { ok: true, path: event.path, title: event.title, at: event.at };
      },
      presentCall() {
        return { card: 'generic', title: 'sense_snap', kind: 'read' };
      },
    }),
  );

  mark('sense_snap');
  if (ctx.webServer !== undefined && ctx.webServer !== null) {
    disposers.push(
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const connection = ctx.connection;
          if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
            const rejection = connection.requestRejection(req);
            if (rejection !== undefined) {
              res.statusCode = rejection;
              res.end();
              return;
            }
          }
          const url = new URL(String(req.url ?? '/'), 'http://localhost');
          const pathname = url.pathname;
          try {
            if (pathname === `${ROUTE_PREFIX}/state` && req.method === 'GET') {
              sendJson(res, 200, { ok: true, ...stateSnapshot() });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/look` && req.method === 'GET') {
              // 某一次陪看的全文（提示词、回复、token）。只看名字，不许穿目录。
              const file = String(url.searchParams.get('file') ?? '');
              if (!/^[0-9A-Za-z._:-]+\.json$/.test(file)) {
                sendJson(res, 400, { ok: false, message: '文件名不对' });
                return;
              }
              try {
                const raw = fs.readFileSync(path.join(LOOKS_DIR, file), 'utf8');
                sendJson(res, 200, { ok: true, file, look: JSON.parse(raw) });
              } catch (error) {
                sendJson(res, 404, { ok: false, message: String(error?.message ?? error) });
              }
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/config` && req.method === 'POST') {
              const body = await readJsonBody(req);
              sendJson(res, 200, { ok: true, ...stateSnapshot(), config: applyPatches(body) });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/snap` && req.method === 'POST') {
              const event = await snap();
              sendJson(res, 200, { ok: true, path: event.path, title: event.title });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/look` && req.method === 'POST') {
              // 去抖：按钮/热键/连点可能在 1 秒内连发两次，同一张图喂两遍
              const nowLook = Date.now();
              if (nowLook - lastLookAt < 2500) {
                sendJson(res, 200, { ok: false, woke: false, path: '', title: '', message: '刚看过，别连点。' });
                return;
              }
              lastLookAt = nowLook;
              const event = await snap();
              if (event?.skipped) {
                sendJson(res, 200, { ok: false, woke: false, path: '', title: event.title, message: event.message || '当前不在指定窗口' });
                return;
              }
              const woke = await react({ ...event, event: 'snap' }, { looked: true }).catch((error) => {
                // 叫醒这一步失败要能看到原因，不能只是「拍完图没下文」
                try {
                  fs.appendFileSync(path.join(FRAMES, 'react-debug.log'), JSON.stringify({ at: new Date().toISOString(), step: 'react-throw', message: String(error?.message ?? error) }) + '\n');
                } catch { /* 日志写不出就算了 */ }
                return false;
              });
              sendJson(res, 200, { ok: true, woke, path: event.path, title: event.title, message: woke ? '' : '没叫醒（看图没说话），看 react-debug.log' });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/sessions` && req.method === 'GET') {
              const agents = agentList();
              sendJson(res, 200, {
                ok: true,
                sessions: listSessions(),
                current: String(config.targetSession ?? ''),
                // 列表空的时候得知道卡在哪：服务有没有拿到、每个 agent 的 header 长什么样
                debug: {
                  agents: agents.length,
                  headerKeys: agents.slice(0, 2).map((agent) => Object.keys(agent?.session?.header ?? {})),
                  sessionKeys: agents.slice(0, 2).map((agent) => Object.keys(agent?.session ?? {})),
                },
              });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/windows` && req.method === 'GET') {
              try {
                const event = await askHelper({ op: 'windows' }, 'windows', 5000);
                sendJson(res, 200, { ok: true, titles: event?.titles ?? [] });
              } catch (error) {
                sendJson(res, 200, { ok: false, titles: [], message: String(error?.message ?? error) });
              }
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/init` && req.method === 'POST') {
              try {
                // 1) 配语音。
                const voice = detectVoice(config.ttsVoice);
                config.ttsCommand = voice.ttsCommand;
                saveConfig(config);
                // 2) 往目标会话投一条消息，让主会话的 AI 自己写口癖。
                //    这是 QQ 桥那半同款的做法：agent.followup({ id, role: 'user', content, source })
                //    ——走 DSH 自己的回合，AI 带着完整人设，不用子代理、不背历史。
                //    必须 await：它返回 Promise，reject 不接住会带崩宿主（qq-bridge 踩过的坑）。
                let asked = false;
                const agent = resolveAgent();
                if (agent && typeof agent.followup === 'function') {
                  try {
                    await agent.followup({
                      id: crypto.randomUUID(),
                      role: 'user',
                      content: [{
                        type: 'text',
                        text: '【余光】帮我写一句陪看口癖。按你自己的人设来：自称什么、怎么称呼我、什么语气、有没有口头禅、绝对不能做什么——然后调 sense_init（带 text 参数）写进去，别在回复里长篇讲道理。',
                      }],
                      source: { kind: 'whale-glance' },
                    });
                    asked = true;
                  } catch {
                    /* 会话半死/agent 已释放：退回让用户自己说 */
                  }
                }
                sendJson(res, 200, {
                  ok: true,
                  personaHint: config.personaHint,
                  ttsCommand: config.ttsCommand,
                  voice: voice.voice,
                  asked,
                  message: asked
                    ? '语音配好了，写口癖的请求已经发到会话里，等它回一句就好。'
                    : '语音配好了。口癖去会话里让 AI 写：跟它说「帮我写陪看口癖」。',
                });
              } catch (error) {
                sendJson(res, 200, { ok: false, message: String(error?.message ?? error) });
              }
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/fonts` && req.method === 'GET') {
              try {
                let families = [];
                // tkinter 列得更全（中文字体也在），PowerShell 兜底
                try {
                  const r = spawnSync(findPython(), [
                    '-c',
                    'import tkinter, tkinter.font as f; r=tkinter.Tk(); r.withdraw(); print("\\n".join(sorted(set(f.families())))); r.destroy()',
                  ], { timeout: 15000, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
                  families = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
                } catch { /* ignore */ }
                if (families.length === 0) {
                  const r = spawnSync('powershell.exe', [
                    '-NoProfile', '-NonInteractive', '-Command',
                    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; [System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object { $_.Name }',
                  ], { timeout: 15000, encoding: 'utf8', windowsHide: true });
                  families = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
                }
                sendJson(res, 200, { ok: true, fonts: families });
              } catch (error) {
                sendJson(res, 200, { ok: false, fonts: [], message: String(error?.message ?? error) });
              }
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/install-ocr` && req.method === 'POST') {
              // 给 helper 用的 python 装 RapidOCR（约 200MB），装完自动重启 helper 让它生效。
              const done = await installOcr();
              sendJson(res, 200, done);
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/use-borrow` && req.method === 'POST') {
              // 用户主动选「借用隔壁插件」：先看那家有没有登录，有才把渠道切过去
              const body = await readJsonBody(req);
              const site = String(body?.site ?? 'bili');
              if (site === 'bili') {
                if (biliPluginCredential() === null) {
                  sendJson(res, 200, { ok: false, message: '隔壁 bili 插件还没登录，先用余光自己的扫码登，或者去那家登一次' });
                  return;
                }
                config.credChannel = { ...(config.credChannel || {}), bili: 'borrow' };
                fs.rmSync(path.join(CRED_DIR, 'ignore-bili.json'), { force: true });
                saveConfig(config);
                sendJson(res, 200, { ok: true });
                return;
              }
              if (site === 'heybox') {
                let ok = false;
                try {
                  const d = JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'heybox', 'state.json'), 'utf8'));
                  ok = Boolean(d.cookie && d.deviceId);
                } catch { /* 隔壁没登录 */ }
                if (!ok) {
                  sendJson(res, 200, { ok: false, message: '隔壁 heybox 插件还没登录，先去那家登一次' });
                  return;
                }
                config.credChannel = { ...(config.credChannel || {}), heybox: 'borrow' };
                fs.rmSync(path.join(CRED_DIR, 'ignore-heybox.json'), { force: true });
                saveConfig(config);
                sendJson(res, 200, { ok: true });
                return;
              }
              sendJson(res, 200, { ok: false, message: '不认识的渠道' });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/login-qr` && req.method === 'POST') {
              // 自建登录：出二维码。site=bili 时用自己的 passport 接口（不依赖 bili 插件）。
              const body = await readJsonBody(req);
              const site = String(body?.site ?? 'bili');
              const dbg = (obj) => {
                try {
                  fs.mkdirSync(CRED_DIR, { recursive: true });
                  fs.appendFileSync(path.join(CRED_DIR, 'login-debug.log'), JSON.stringify({ at: new Date().toISOString(), site, ...obj }) + '\n');
                } catch { /* 日志写不出就跳过 */ }
              };
              dbg({ step: 'start' });
              const r = site === 'heybox' ? await heyboxLoginStart() : await biliLoginStart();
              dbg({ step: 'start-result', ok: r.ok, message: r.message ?? '', hasUrl: Boolean(r.url) });
              if (!r.ok) {
                sendJson(res, 200, r);
                return;
              }
              // 二维码图：用 helper 的 python qrcode 画；没装就退回只给 url（前端显示提示）
              let qr = '';
              let qrErr = '';
              try {
                fs.mkdirSync(CRED_DIR, { recursive: true });
                const png = path.join(CRED_DIR, 'qrcode_login.png');
                const q = spawnSync(findPython(), ['-c', 'import sys,qrcode; qrcode.make(sys.argv[1]).save(sys.argv[2])', r.url, png], { timeout: 15000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
                if (q.status === 0 && fs.existsSync(png)) qr = fs.readFileSync(png).toString('base64');
                else qrErr = 'exit=' + q.status + ' ' + String(q.stderr ?? '').slice(0, 200);
              } catch (error) {
                qrErr = String(error?.message ?? error);
              }
              dbg({ step: 'qr', len: qr.length, err: qrErr });
              sendJson(res, 200, { ok: true, key: r.key ?? '', url: r.url, qr, qrErr });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/login-poll` && req.method === 'POST') {
              const body = await readJsonBody(req);
              const site = String(body?.site ?? 'bili');
              if (site === 'heybox') {
                sendJson(res, 200, await heyboxLoginPoll());
                return;
              }
              const key = String(body?.key ?? '');
              if (key === '') {
                sendJson(res, 200, { ok: false, message: '参数不对' });
                return;
              }
              sendJson(res, 200, await biliLoginPoll(key));
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/logout` && req.method === 'POST') {
              // 登出：own = 删自己扫码登的那份；borrowed = 记标记不再借隔壁的凭证。
              // 只动余光自己的文件，绝不碰别人插件的凭证。
              const body = await readJsonBody(req);
              const site = String(body?.site ?? 'bili');
              const mode = String(body?.mode ?? 'own');
              try {
                fs.mkdirSync(CRED_DIR, { recursive: true });
                if (site === 'bili' && mode === 'borrowed') {
                  fs.writeFileSync(path.join(CRED_DIR, 'ignore-bili.json'), '{}');
                } else if (site === 'bili') {
                  fs.rmSync(path.join(CRED_DIR, 'bili.json'), { force: true });
                } else if (site === 'heybox' && mode === 'own') {
                  fs.rmSync(path.join(CRED_DIR, 'heybox.json'), { force: true });
                } else if (site === 'heybox') {
                  fs.writeFileSync(path.join(CRED_DIR, 'ignore-heybox.json'), '{}');
                }
                // 登出就把渠道清空，回到「没选」
                if (site === 'bili' || site === 'heybox') {
                  config.credChannel = { ...(config.credChannel || {}), [site]: '' };
                  saveConfig(config);
                }
                sendJson(res, 200, { ok: true });
              } catch (error) {
                sendJson(res, 200, { ok: false, message: String(error?.message ?? error) });
              }
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/pending-games` && req.method === 'GET') {
              sendJson(res, 200, { ok: true, games: { ...pendingGames } });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/pending-games` && req.method === 'POST') {
              // 面板答复：{ title, is_game, game_name }
              const body = await readJsonBody(req);
              const title = String(body?.title ?? '').trim();
              const isGame = body?.is_game === true;
              const gameName = String(body?.game_name ?? '').trim();
              if (title.length > 0) {
                delete pendingGames[title];
                sendHelper({ op: 'resolve-game', title, is_game: isGame, game_name: gameName });
              }
              sendJson(res, 200, { ok: true });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/learn-terms` && req.method === 'POST') {
              // 学黑话：{ gameName, text } 用 flash 提取术语+规则，返回给面板确认。
              const body = await readJsonBody(req);
              const gameName = String(body?.gameName ?? '').trim();
              const text = String(body?.text ?? '').trim();
              if (gameName.length === 0 || text.length === 0) {
                sendJson(res, 200, { ok: false, message: '游戏名和攻略文本都不能空' });
                return;
              }
              const result = await extractTerms(gameName, text);
              sendJson(res, 200, result);
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/auto-learn` && req.method === 'POST') {
              // 自动找攻略：{ gameName } 去 B 站 + 小黑盒搜，合并文本，摘词，返回给面板确认。
              const body = await readJsonBody(req);
              const gameName = String(body?.gameName ?? '').trim();
              if (gameName.length === 0) {
                sendJson(res, 200, { ok: false, message: '游戏名不能空' });
                return;
              }
              let result;
              try {
                result = await autoLearn(gameName);
              } catch (error) {
                // 别让异常变成 500：面板那边只会看到「请求失败」，看不到具体原因
                result = { ok: false, message: '自动搜出错了：' + String(error?.message ?? error) };
              }
              sendJson(res, 200, result);
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/search-terms` && req.method === 'POST') {
              // 关键词搜索：{ gameName, keyword } 去 B 站 + 小黑盒搜「游戏名 关键词」，摘词返回给面板勾选
              const body = await readJsonBody(req);
              const gameName = String(body?.gameName ?? '').trim();
              const keyword = String(body?.keyword ?? '').trim();
              if (gameName.length === 0 || keyword.length === 0) {
                sendJson(res, 200, { ok: false, message: '游戏名和关键词都不能空' });
                return;
              }
              let result;
              try {
                result = await autoLearn(gameName, keyword);
              } catch (error) {
                result = { ok: false, message: '关键词搜索出错了：' + String(error?.message ?? error) };
              }
              sendJson(res, 200, result);
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/test-voice` && req.method === 'POST') {
              // 测试语音必须跟实际朗读走同一条路——不然测的是 say.mjs 的声音、
              // 真正陪看时用的却是 SAPI，按下去听到的和实际听到的不一样，这按钮就白按了。
              const text = '现在这样能听见吗？';
              void speakAloud(text)
                .then(() => sendJson(res, 200, { ok: true, message: `已用 ${String(config.ttsBackend || 'none')} 播了一段` }))
                .catch((err) => sendJson(res, 200, { ok: false, message: String(err?.message ?? err) }));
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/shows` && req.method === 'GET') {
              // 看番档案：返回所有番（剔除 _ 开头的内部字段），外加「最近写入」——
              // 最近写入是给「写错了马上发现」用的，面板上单列一块显示。
              const all = loadShows();
              const shows = {};
              for (const key of Object.keys(all)) {
                if (key.startsWith('_')) continue;
                shows[key] = all[key];
              }
              const recentWrites = Array.isArray(all['_最近写入']) ? all['_最近写入'].slice(-10).reverse() : [];
              sendJson(res, 200, { ok: true, shows, recentWrites });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/save-show` && req.method === 'POST') {
              // 写档案：{ name, episode, summary }，按番名归集到「剧情」数组。
              // 写之前必须带 name——防混：没有番名就不写，绝不瞎猜归到哪部。
              const body = await readJsonBody(req);
              // 名字那格可能带集数（「咒术回战 第3集」）：跟归档走同一条解析，归到番名下，
              // 集数单独记。不然同一个接口写出来的 key 跟陪看那边对不上，档案就串成两份。
              const parsedName = parseShowLabel(String(body?.name ?? '').trim());
              const name = parsedName.series;
              const summary = String(body?.summary ?? '').trim();
              if (name === '' || summary === '') {
                sendJson(res, 200, { ok: false, message: '番名和剧情都不能空' });
                return;
              }
              try {
                const all = loadShows();
                if (!all[name] || typeof all[name] !== 'object') all[name] = { 剧情: [] };
                if (!Array.isArray(all[name].剧情)) all[name].剧情 = [];
                // 集数：AI 传上来的可以是 3，也可以是「第3集」；都没传就用番名里带的那个。
                const episodeRaw = String(body?.episode ?? '').trim();
                const parsedEpisode = /^\d{1,3}$/.test(episodeRaw)
                  ? Number(episodeRaw)
                  : (parseShowLabel(episodeRaw).episode ?? parsedName.episode);
                const episodeNo = Number.isFinite(parsedEpisode) && parsedEpisode > 0 ? parsedEpisode : null;
                const seasonText = parsedName.season !== null ? `第${parsedName.season}季` : '';
                const epText = episodeNo !== null ? `${seasonText}第${episodeNo}集` : episodeRaw;
                const line = epText !== '' ? `${epText}：${summary}` : summary;
                // 同一条不重复写
                if (!all[name].剧情.includes(line)) all[name].剧情.push(line);
                if (episodeNo !== null) all[name].episode = episodeNo;
                if (parsedName.season !== null) all[name].season = parsedName.season;
                // 写入留痕：记下这次写进了哪部番、哪一集、什么时候。
                // 这不是给人看的日志，是给她「写错了立刻能发现」的凭据——
                // 不靠 AI 自觉，也不靠各家的规矩，代码管着。
                if (!Array.isArray(all['_最近写入'])) all['_最近写入'] = [];
                all['_最近写入'].push({
                  at: new Date().toISOString().slice(0, 19).replace('T', ' '),
                  name,
                  episode: epText || '-',
                });
                if (all['_最近写入'].length > 20) all['_最近写入'] = all['_最近写入'].slice(-20);
                fs.mkdirSync(STORAGE, { recursive: true });
                fs.writeFileSync(showsPath(), JSON.stringify(all, null, 1), 'utf8');
                sendJson(res, 200, { ok: true, name, line });
              } catch (error) {
                sendJson(res, 200, { ok: false, message: String(error?.message ?? error) });
              }
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/save-terms` && req.method === 'POST') {
              // 用户确认后入库：{ gameName, terms, rules, memes } 合并进 games-notes.json，通知 sense 重载。
              const body = await readJsonBody(req);
              const gameName = normalizeGameName(String(body?.gameName ?? '').trim());
              const terms = Array.isArray(body?.terms) ? body.terms.filter((t) => typeof t === 'string' && t.trim() !== '') : [];
              const rules = Array.isArray(body?.rules) ? body.rules.filter((r) => typeof r === 'string' && r.trim() !== '') : [];
              const memes = Array.isArray(body?.memes) ? body.memes.filter((m) => typeof m === 'string' && m.trim() !== '') : [];
              if (gameName.length === 0) {
                sendJson(res, 200, { ok: false, message: '游戏名不能空' });
                return;
              }
              try {
                const p = notesPath();
                let data = {};
                try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* 空文件或不存在 */ }
                const existing = data[notesKeyFor(gameName, data)] || {};
                const oldTerms = Array.isArray(existing['黑话']) ? existing['黑话'] : [];
                const oldRules = Array.isArray(existing['规则']) ? existing['规则'] : [];
                const oldMemes = Array.isArray(existing['梗']) ? existing['梗'] : [];
                const mergedTerms = [...new Set([...oldTerms, ...terms])];
                const mergedRules = [...new Set([...oldRules, ...rules])];
                const mergedMemes = [...new Set([...oldMemes, ...memes])];
                data[notesKeyFor(gameName, data)] = { '黑话': mergedTerms, '规则': mergedRules, '梗': mergedMemes };
                fs.writeFileSync(p, JSON.stringify(data, null, 1), 'utf8');
                sendHelper({ op: 'reload-notes' });
                sendJson(res, 200, { ok: true, gameName, terms: mergedTerms, rules: mergedRules, memes: mergedMemes });
              } catch (error) {
                sendJson(res, 200, { ok: false, message: String(error?.message ?? error) });
              }
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/last-react` && req.method === 'GET') {
              // 上一次陪看「喂了什么词、说了什么」，用来验证黑话/规则/梗真的进了提示词。
              try {
                const p = path.join(STORAGE, 'last-react.json');
                sendJson(res, 200, { ok: true, data: JSON.parse(fs.readFileSync(p, 'utf8')) });
              } catch {
                sendJson(res, 200, { ok: false, message: '还没有陪看记录' });
              }
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/notes` && req.method === 'GET') {
              // 黑话库：返回 games-notes.json 全部内容，面板用来审查它学了什么。
              try {
                const p = notesPath();
                const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                sendJson(res, 200, { ok: true, notes: data });
              } catch {
                sendJson(res, 200, { ok: true, notes: {} });
              }
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/notes` && req.method === 'POST') {
              // 删条目：{ game, kind: 'term'|'rule'|'meme', value } 删一条；{ game, deleteGame: true } 删整个游戏。
              // 改条目：{ game, kind, edit: true, oldValue, newValue } 原地替换，不挪位置。
              const body = await readJsonBody(req);
              const game = String(body?.game ?? '').trim();
              if (game.length === 0) {
                sendJson(res, 200, { ok: false, message: '游戏名不能空' });
                return;
              }
              try {
                const p = notesPath();
                const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (body?.deleteGame === true) {
                  delete data[game];
                } else if (body?.edit === true) {
                  // 改一条（错别字最常见）：按旧值定位，改完跟同组另一条撞了就去重。
                  const kind = body?.kind;
                  const arrKey = kind === 'rule' ? '规则' : kind === 'meme' ? '梗' : '黑话';
                  const oldValue = String(body?.oldValue ?? '');
                  const newValue = String(body?.newValue ?? '').trim();
                  const note = data[game] || {};
                  const arr = Array.isArray(note[arrKey]) ? note[arrKey] : [];
                  const i = arr.indexOf(oldValue);
                  if (newValue && i >= 0) {
                    if (arr.some((x, idx) => idx !== i && x === newValue)) arr.splice(i, 1);
                    else arr[i] = newValue;
                  }
                  note[arrKey] = arr;
                  data[game] = note;
                } else {
                  const kind = body?.kind;
                  const value = String(body?.value ?? '');
                  const note = data[game] || {};
                  const arrKey = kind === 'rule' ? '规则' : kind === 'meme' ? '梗' : '黑话';
                  const arr = Array.isArray(note[arrKey]) ? note[arrKey] : [];
                  note[arrKey] = arr.filter((x) => x !== value);
                  data[game] = note;
                }
                fs.writeFileSync(p, JSON.stringify(data, null, 1), 'utf8');
                sendHelper({ op: 'reload-notes' });
                sendJson(res, 200, { ok: true });
              } catch (error) {
                sendJson(res, 200, { ok: false, message: String(error?.message ?? error) });
              }
              return;
            }
            sendJson(res, 404, { ok: false, message: `no route for ${pathname}` });
          } catch (error) {
            sendJson(res, 500, { ok: false, message: String(error?.message ?? error) });
          }
        },
      }),
    );
  }
  mark('routes');
  } catch (error) {
    recordError(error);    ctx.logger?.warn?.(`dsh-whale-glance: 注册失败：${String(error?.message ?? error)}`);
  }

  // 进程真正退出前同步清一遍子进程（exit 事件不阻止退出，只做收尾）。
  // 注意：这里绝不能注册 SIGTERM/SIGINT listener——node 一旦有了信号监听，
  // 收到 SIGTERM 就不会自动退出了，反而把宿主升级的「SIGTERM 兜底」给废掉。
  if (!globalThis.__whaleGlanceExitHooked) {
    globalThis.__whaleGlanceExitHooked = true;
    process.on('exit', () => {
      disposed = true;
      try {
        stopHudWindow();
      } catch {
        /* ignore */
      }
      try {
        stopDanmaku();
      } catch {
        /* ignore */
      }
      try {
        helper?.kill();
        helper?.stdin.destroy?.();
        helper?.stdout?.destroy?.();
        helper?.stderr?.destroy?.();
      } catch {
        /* ignore */
      }
    });
  }

  // 上次关停时留下的尾段，这时候配置已经读进来了，补写进档案。
  void drainPendingTail();

  // 清理必须走 ctx.effect 注册。以前直接 return 一个函数，cordis 不认这个返回值，
  // 那段清理从来没执行过——关停时子进程和管道还活着，宿主升级就等不到「任务体面退出」。
  ctx.effect(() => () => {
    disposed = true;
    try {
      fs.appendFileSync(path.join(STORAGE, 'dispose.log'), JSON.stringify({ at: Date.now(), step: 'dispose-enter' }) + '\n');
    } catch { /* ignore */ }
    // 还没归档的尾段先落盘，下次启动补写——关停里等不到模型调用回来。
    try {
      stashPendingTail();
    } catch {
      /* ignore */
    }
    // 在途的陪看子代理：取消掉。它挂在宿主的子代理服务里，留着会挡住关停。
    try {
      const pending = liveActivation;
      liveActivation = null;
      pending?.dispose?.()?.catch?.(() => {});
    } catch {
      /* ignore */
    }
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    // 字幕窗和弹幕是 tkinter 独立进程，不杀干净会一直挂着。
    try {
      stopHudWindow();
    } catch {
      /* ignore */
    }
    try {
      stopDanmaku();
    } catch {
      /* ignore */
    }
    try {
      sendHelper({ op: 'quit' });
      helper?.stdin.end();
      helper?.kill();
      // helper 的 stdin/stdout/stderr 都是 pipe，是 node 的活跃句柄。
      // 光 kill 进程不够，管道不销毁，事件循环里还挂着句柄，宿主就退不掉。
      helper?.stdin.destroy?.();
      helper?.stdout?.destroy?.();
      helper?.stderr?.destroy?.();
    } catch {
      /* ignore */
    }
    for (const dispose of disposers.reverse()) {
      try {
        dispose?.();
      } catch {
        /* ignore */
      }
    }
  });
}
