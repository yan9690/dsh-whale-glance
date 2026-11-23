/**
 * 端到端看门狗测试（不需要重启 DSH）：
 * 真起一个绿色窗口 → 帮工应该察觉画面变化 → host 应该 followup 假 agent。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-glance-watch-'));
process.env.DSH_HOME = tempHome;

const { apply } = await import('../lib/index.js');

const tools = new Map();
const followups = [];
const handlers = new Map();
const routes = new Map();

const effects = [];

const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  },
  webServer: {
    register(definition) {
      routes.set(definition.path, definition);
      return () => routes.delete(definition.path);
    },
  },
  agents: { list: () => [], get: () => undefined },
  on(event, handler) {
    handlers.set(event, handler);
    return () => handlers.delete(event);
  },
  // 插件现在用 ctx.effect(() => () => 清理) 注册清理（cordis 只认这个），
  // 桩里原来没有，apply 到那儿就 TypeError——这两个测试因此一直没跑起来过。
  effect(factory) {
    const disposer = typeof factory === 'function' ? factory() : undefined;
    effects.push(disposer);
    return () => { if (typeof disposer === 'function') disposer(); };
  },
  get() { return undefined; },
  // 叫醒走直调模型了，桩里给个假模型；不给的话 react 第一步就抛。
  llm: {
    async prepareCall() {
      return {
        config: {},
        async *stream() {
          yield { type: 'text-delta', text: '看到了：屏幕忽然亮成一片绿。' };
          yield { type: 'finish', finishReason: 'stop' };
        },
      };
    },
  },
  attachments: {
    async saveImage({ name }) { return { kind: 'image', path: name }; },
  },
  logger: { warn: () => {}, info: () => {} },
};

function makeReq(method, url, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk;
    },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value === undefined ? '' : String(value);
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

async function call(method, url, body) {
  const res = makeRes();
  await routes.get('/whale-glance').handler(makeReq(method, url, body), res);
  return res;
}

function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!condition) process.exitCode = 1;
}

const probeFile = path.join(tempHome, 'probe.txt');

/**
 * 起一个记事本打开 probe.txt，窗口标题就是「probe.txt - 记事本」，拿它当被测窗口。
 * 为什么不用 PowerShell 弹 WinForms 窗口：它的 PrintWindow 拿回来是全黑，帮工判「没抓到」
 * 就退回整屏，测试于是一直在看前台游戏。记事本的 PrintWindow 是能抓的（实测 811×666）。
 */
function openWindow() {
  fs.writeFileSync(probeFile, 'first screen\n', 'utf8');
  const child = spawn('notepad.exe', [probeFile], { stdio: 'ignore' });
  child.on('error', () => {});
  return child;
}

const dispose = apply(ctx);
let notepad = null;

try {
  // ⚠ 帮工的日志都在 frames/ 底下（SENSE_OUT_DIR = STORAGE/frames），不在 STORAGE 根。
  const framesDir = path.join(tempHome, 'storages', 'whale-glance', 'frames');
  const agent = {
    session: { header: { id: 'watch-session', origin: 'user' } },
    followup(message) {
      followups.push(message);
    },
  };
  handlers.get('agent/turn-stopping')({ agent });

  await tools.get('sense_config').execute({
    // floorSec 默认 60：那是「最少隔 60 秒才开口一次」，测试等不了，压到 2 秒。
    // maxPerHour 也放宽：默认值会先扣掉这一轮试出来的唤醒，factor 一大冷却就翻倍。
    auto: true, intervalMs: 700, cooldownMs: 5000, floorSec: 2, maxPerHour: 200,
    windowOnly: true, windowMatch: 'probe.txt',
  }, {});
  // 刚打开陪看的 5 秒里 host 侧有意不抓（那会儿前台还是余光面板，抓下来是对着自己说话）。
  // 这里等过这 5 秒再制造变化，否则唯一的 change 会被静默期吞掉，测试永远 0 次。
  await new Promise((resolve) => setTimeout(resolve, 5600));

  notepad = openWindow();
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 自动链路验到这里：变化事件要真的带着「被盯那个窗口」的标题到 host。
  // 这一条就是 1.0.8 修的那个 bug（以前报的是前台窗口的标题，windowMatch 一开就全被丢掉）。
  // 得在 /look 之前读：look 会把 lastEvent 覆盖掉。
  const stateBefore = await tools.get('sense_state').execute({}, {});
  check('记下的是 change 事件', stateBefore.lastEvent?.event === 'change',
    JSON.stringify({ event: stateBefore.lastEvent?.event, score: stateBefore.lastEvent?.score, title: stateBefore.lastEvent?.title, auto: stateBefore.config?.auto, match: stateBefore.config?.windowMatch, only: stateBefore.config?.windowOnly, ready: stateBefore.ready }));

  // 自动采样这一段只验到「变化事件带着正确标题到 host」——再往后那步依赖真实屏幕：
  // 变化面积到不了 AREA_CUT=0.25 就不算变，整窗突变又会被 SWITCH_CUT=0.95 当切屏挡掉，
  // 而这台机器的前台是游戏/浏览器，造不出稳定的「够大又没到满」的画面变化。
  // 所以「画面→说话」改用 /look 直接打一遍，跟 host-test 覆盖的是同一条链路。
  const countNow = async () => Number((await tools.get('sense_state').execute({}, {})).recentReactions ?? 0);
  const baseCount = await countNow();
  const look = await call('POST', '/whale-glance/look', {});
  const lookBody = look.json();
  check('看一眼能开口', look.statusCode === 200 && lookBody.ok === true, look.body.slice(0, 120));

  const deadline = Date.now() + 15000;
  let spoke = baseCount;
  while (Date.now() < deadline) {
    spoke = await countNow();
    if (spoke > baseCount) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  check('真的叫人了', spoke > baseCount, `${spoke - baseCount} 次`);

  const hudPath = path.join(tempHome, 'storages', 'subtitle.txt');
  const hudText = fs.existsSync(hudPath) ? fs.readFileSync(hudPath, 'utf8') : '';
  check('画面变化说出了话', hudText.includes('看到了'), hudText.slice(0, 60));
  // 没说话时得知道卡在哪一环：host 会把「没 agent / 上一轮还在跑」记在这里。
  const debugPath = path.join(tempHome, 'storages', 'whale-glance', 'frames', 'react-debug.log');
  if (!hudText.includes('看到了') && fs.existsSync(debugPath)) {
    console.log('  react-debug:', fs.readFileSync(debugPath, 'utf8').trim().slice(-400));
  }
  // 抓不到窗口时帮工会往这记 miss（含当时的前台标题和 match），比瞎猜快。
  const grabLog = path.join(framesDir, 'sense-grab.log');
  if (!hudText.includes('看到了') && fs.existsSync(grabLog)) {
    console.log('  sense-grab:', fs.readFileSync(grabLog, 'utf8').trim().slice(-400));
  }
  const wakeLog = path.join(framesDir, 'wake-why.log');
  if (!hudText.includes('看到了') && fs.existsSync(wakeLog)) {
    console.log('  wake-why:', fs.readFileSync(wakeLog, 'utf8').trim().slice(-400));
  }
  // 「只盯指定窗口、匹配不上就不说话」这条不用在这里等：它要等画面真的变，
  // 而这台机器造不出稳定的变化（见上面那段）。host-test 里已经覆盖了 windowMatch
  // 写进配置和推给帮工这两步，这里不重复。
} finally {
  try { notepad?.kill(); } catch { /* 已经退了 */ }
  try { dispose?.(); } catch { /* 关不干净也别卡着 */ }
  await new Promise((r) => setTimeout(r, 800));
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* 帮工还没退干净 */ }
  process.exit(process.exitCode ?? 0);
}
