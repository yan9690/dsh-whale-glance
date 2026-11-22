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

const effects = [];

const ctx = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  },
  webServer: { register: () => () => {} },
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

function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!condition) process.exitCode = 1;
}

/** 弹一个亮绿色置顶窗口，3 秒后关掉——制造一次明显的画面变化。 */
function openWindow() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    'Add-Type -AssemblyName System.Drawing;',
    '$f = New-Object System.Windows.Forms.Form;',
    "$f.TopMost = $true; $f.FormBorderStyle = 'None'; $f.StartPosition = 'Manual';",
    '$f.Left = 120; $f.Top = 120; $f.Width = 1000; $f.Height = 700;',
    "$f.BackColor = [System.Drawing.Color]::Lime;",
    '$f.Show();',
    'Start-Sleep -Seconds 3;',
    '$f.Close();',
  ].join(' ');
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
  child.on('error', () => {});
  return child;
}

const dispose = apply(ctx);

try {
  const agent = {
    session: { header: { id: 'watch-session', origin: 'user' } },
    followup(message) {
      followups.push(message);
    },
  };
  handlers.get('agent/turn-stopping')({ agent });

  await tools.get('sense_config').execute({ auto: true, intervalMs: 700, threshold: 0.03, cooldownMs: 5000 }, {});
  await new Promise((resolve) => setTimeout(resolve, 1200));

  openWindow();

  // 契约变了：说完不再 followup 回主会话（那会把主线整个叫醒），
  // 结果落在字幕文件 + recentReactions 计数上。老断言查 followup，早过期。
  const countNow = async () => Number((await tools.get('sense_state').execute({}, {})).recentReactions ?? 0);

  const deadline = Date.now() + 25000;
  let spoke = 0;
  while (Date.now() < deadline) {
    spoke = await countNow();
    if (spoke > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  check('自动陪看真的叫人了', spoke > 0, `${spoke} 次`);

  const hudPath = path.join(tempHome, 'storages', 'subtitle.txt');
  const hudText = fs.existsSync(hudPath) ? fs.readFileSync(hudPath, 'utf8') : '';
  check('画面变化说出了话', hudText.includes('看到了'), hudText.slice(0, 60));

  const state = await tools.get('sense_state').execute({}, {});
  check('记下的是 change 事件', state.lastEvent?.event === 'change', JSON.stringify(state.lastEvent?.score));

  // 只盯指定窗口：匹配不上时，画面再变也不该开口
  await tools.get('sense_config').execute({ windowMatch: 'zzz-根本没有这个窗口', cooldownMs: 5000 }, {});
  const before = await countNow();
  openWindow();
  const quietDeadline = Date.now() + 12000;
  let after = before;
  while (Date.now() < quietDeadline) {
    after = await countNow();
    if (after !== before) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  check('窗口不匹配就不说话', after === before, `多说了 ${after - before} 次`);
} finally {
  try { dispose?.(); } catch { /* 关不干净也别卡着 */ }
  await new Promise((r) => setTimeout(r, 800));
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* 帮工还没退干净 */ }
  process.exit(process.exitCode ?? 0);
}
