/**
 * Host 半冒烟测试：假 ctx、临时 DSH_HOME、假 agent。
 * 验证：帮工起得来、截得到图、配置能读写、点「看我一眼」会真的 followup 唤醒。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-glance-test-'));
process.env.DSH_HOME = tempHome;

const { apply } = await import('../lib/index.js');

const tools = new Map();
const routes = new Map();
const handlers = new Map();
const agents = [];
const followups = [];

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
  agents: {
    list: () => agents,
    get: () => undefined,
  },
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
  // 现在叫醒走的是「直调模型」（ctx.llm），不再借子代理；桩里给了个假模型，
  // 不然 react 一路抛，测试只能验到截屏那一层。
  llm: {
    async prepareCall() {
      return {
        config: {},
        async *stream() {
          yield { type: 'text-delta', text: '看到了：画面换了一栋楼，那个绿框还在。' };
          yield { type: 'finish', finishReason: 'stop' };
        },
      };
    },
  },
  attachments: {
    async saveImage({ name }) { return { kind: 'image', path: name }; },
  },
  logger: { warn: (message) => console.warn('[warn]', message), info: () => {} },
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

const dispose = apply(ctx);

try {
  check('三个工具注册', ['sense_state', 'sense_config', 'sense_snap'].every((name) => tools.has(name)));
  check('面板路由注册', routes.has('/whale-glance'));

  const state = await tools.get('sense_state').execute({}, {});
  check('自动陪看默认关', state.config.auto === false);

  const config = await tools.get('sense_config').execute({ intervalMs: 999999 }, {});
  check('采样被夹紧', config.config.intervalMs === 60000, JSON.stringify(config.config));
  check('写着盘上', JSON.parse(fs.readFileSync(path.join(tempHome, 'storages', 'whale-glance', 'config.json'), 'utf8')).intervalMs === 60000);

  const snap = await tools.get('sense_snap').execute({}, {});
  check('截到图', typeof snap.path === 'string' && fs.existsSync(snap.path), snap.path);
  check('图有内容', fs.statSync(snap.path).size > 4096);
  console.log(`      前台窗口：${snap.title}`);

  const after = await tools.get('sense_state').execute({}, {});
  check('帮工在线', after.helper === 'running', JSON.stringify({ helper: after.helper, error: after.lastError }));

  // 假 agent：模拟会话结束那一钩子，然后点「看我一眼」
  const agent = {
    session: { header: { id: 'test-session', origin: 'user' } },
    followup(message) {
      followups.push(message);
    },
  };
  const turnStopping = handlers.get('agent/turn-stopping');
  check('挂了 turn-stopping 钩子', typeof turnStopping === 'function');
  turnStopping({ agent });

  const look = await call('POST', '/whale-glance/look', {});
  const body = look.json();
  check('看我一眼返回 ok', look.statusCode === 200 && body.ok === true && body.woke === true, look.body);

  // 契约变了：说完不再 followup 回主会话（那会把主线整个叫醒、把钱吐回去），
  // 结论落在字幕文件 + chat-history + last-react.json 三处。老断言查的是 followup，早就过期。
  const hudPath = path.join(tempHome, 'storages', 'subtitle.txt');
  const hudText = fs.existsSync(hudPath) ? fs.readFileSync(hudPath, 'utf8') : '';
  check('字幕文件写了这一句', hudText.includes('看到了'), hudText.slice(0, 60));
  const histPath = path.join(tempHome, 'storages', 'whale-glance', 'chat-history.txt');
  const histText = fs.existsSync(histPath) ? fs.readFileSync(histPath, 'utf8') : '';
  check('留档里有这一句', histText.includes('看到了'), histText.slice(0, 60));
  let lastReact = null;
  try {
    lastReact = JSON.parse(fs.readFileSync(path.join(tempHome, 'storages', 'whale-glance', 'last-react.json'), 'utf8'));
  } catch { /* 没写出就是没有 */ }
  check('last-react.json 记了这一句', String(lastReact?.said ?? '').includes('看到了'));
  check('没有去叫醒主会话（省钱的约定）', followups.length === 0, `${followups.length} 次`);

  const noAgent = await call('POST', '/whale-glance/snap', {});
  check('snap 路由能用', noAgent.statusCode === 200 && noAgent.json().ok === true);
} finally {
  try { dispose?.(); } catch { /* 关不干净也别让测试卡着 */ }
  await new Promise((r) => setTimeout(r, 800));
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* 帮工还没退干净 */ }
  process.exit(process.exitCode ?? 0);
}
