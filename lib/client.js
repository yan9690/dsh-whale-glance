/**
 * `dsh-whale-glance` — browser half.
 *
 * 左下角一块「陪看」面板：选在看什么、用多大力气、出什么图，
 * 再加「看我一眼」「看这一段」两个按钮。
 *
 * 面板和小球都能拖着走，位置记在 localStorage。
 * 挂在 `/whale-glance` 路由上，不走 React。
 */
window.__ModuleLoader__.load({
  id: 'dsh-whale-glance',
  factory: () => {
    const ROUTE = '/whale-glance';
    const STORAGE_KEY = 'dsh-whale-glance.panel.v1';

    const MODES = [
      { id: 'game', label: '游戏', hint: '打游戏用。抓得比别人勤，重点看资源、人口、小地图这些数字。' },
      { id: 'video', label: '视频', hint: '看剧、看视频用。会连下方字幕一起截，省得漏台词。' },
    ];

    const CSS = `
.dsh-sense-panel {
  position: fixed; z-index: 2147481800; left: 16px; top: 96px;
  width: 286px; display: flex; flex-direction: column;
  height: 440px;
  min-height: 180px;
  max-height: calc(100vh - 130px);
  overflow: hidden;
  color: #e8f1ff; font-size: 12px;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  background: linear-gradient(180deg, rgba(16,29,48,.97), rgba(9,16,28,.97));
  border: 1px solid rgba(120,180,255,.24); border-radius: 16px;
  box-shadow: 0 18px 44px rgba(0,0,0,.48);
  -webkit-app-region: no-drag;
}
.dsh-sense-resizer {
  flex: none; height: 12px; cursor: ns-resize;
  display: flex; align-items: center; justify-content: center;
  border-top: 1px solid rgba(120,180,255,.14);
}
.dsh-sense-resizer::before {
  content: ''; width: 40px; height: 4px; border-radius: 2px;
  background: rgba(140,170,210,.55);
}
.dsh-sense-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px; user-select: none;
  background: rgba(30,52,86,.55); border-bottom: 1px solid rgba(120,180,255,.14);
  border-radius: 16px 16px 0 0; cursor: move;
}
.dsh-sense-dot { width: 8px; height: 8px; border-radius: 50%; background: #7d8fa8; flex: none; }
.dsh-sense-dot.on { background: #4ea1ff; box-shadow: 0 0 10px #4ea1ff; }
.dsh-sense-title { font-weight: 600; letter-spacing: .02em; }
.dsh-sense-spacer { flex: 1; }
.dsh-sense-mini { background: transparent; color: #9fb6d4; border: none; cursor: pointer; font-size: 14px; padding: 0 2px; }
.dsh-sense-mini:hover { color: #e8f1ff; }
.dsh-sense-advlist { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.dsh-sense-advitem { background: rgba(120,180,255,.06); border: 1px solid rgba(120,180,255,.14); border-radius: 8px; padding: 8px 10px; }
.dsh-sense-advhead { color: #dce9ff; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.dsh-sense-advline { color: #9fb6d4; font-size: 12px; line-height: 1.5; }
.dsh-sense-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; overflow-y: scroll; overflow-x: hidden; min-height: 0; flex: 1; scrollbar-gutter: stable; }
.dsh-sense-toggle[disabled] { opacity: .42; cursor: not-allowed; }
.dsh-sense-color { width: 34px; height: 20px; padding: 0; border: 1px solid rgba(120,180,255,.24); border-radius: 5px; background: transparent; cursor: pointer; }
.dsh-sense-body::-webkit-scrollbar { width: 10px; }
.dsh-sense-body::-webkit-scrollbar-thumb { background: rgba(120,180,255,.32); border-radius: 5px; border: 2px solid transparent; background-clip: padding-box; }
.dsh-sense-body::-webkit-scrollbar-thumb:hover { background: rgba(120,180,255,.55); background-clip: padding-box; }
.dsh-sense-body::-webkit-scrollbar-track { background: rgba(255,255,255,.05); border-radius: 5px; }
.dsh-sense-body::-webkit-scrollbar-corner { background: transparent; }
.dsh-sense-pending { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px dashed rgba(120,180,255,.3); border-radius: 9px; background: rgba(90,140,210,.08); }
.dsh-sense-pending-head { color: #9fb6d4; font-size: 11px; }
.dsh-sense-pending-item { display: flex; flex-direction: column; gap: 5px; }
.dsh-sense-pending-title { color: #e8f1ff; font-size: 11px; word-break: break-all; }
.dsh-sense-pending-btns { display: flex; gap: 6px; }
.dsh-sense-pending-btns button { flex: 1; font-size: 11px; padding: 4px 6px; border-radius: 7px; cursor: pointer; border: 1px solid rgba(120,180,255,.25); background: rgba(90,140,210,.14); color: #cfe2ff; }
.dsh-sense-pending-btns button:hover { background: rgba(110,170,250,.26); }
.dsh-sense-pending-btns button.no { color: #d8a0a0; border-color: rgba(255,140,140,.3); }
.dsh-sense-pending-input { flex: 1; min-width: 0; background: rgba(12,22,38,.9); color: #dbe8ff; border: 1px solid rgba(120,180,255,.25); border-radius: 7px; padding: 4px 6px; font-size: 11px; }
.dsh-sense-row { display: flex; align-items: center; gap: 10px; }
.dsh-sense-row > span { flex: none; min-width: 72px; color: #a8bcdb; white-space: nowrap; }
.dsh-sense-toggle {
  flex: 1; display: flex; align-items: center; justify-content: space-between;
  background: rgba(90,140,210,.13); color: #cfe2ff; border: 1px solid rgba(120,180,255,.2);
  border-radius: 9px; padding: 5px 9px; cursor: pointer; font-size: 11px;
}
.dsh-sense-toggle .knob { width: 30px; height: 16px; border-radius: 999px; background: rgba(140,170,210,.3); position: relative; flex: none; }
.dsh-sense-toggle .knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #dce9ff; transition: transform .15s; }
.dsh-sense-toggle.on .knob { background: #4ea1ff; }
.dsh-sense-toggle.on .knob::after { transform: translateX(14px); }
.dsh-sense-seg { flex: 1; display: flex; gap: 8px; min-width: 0; }
.dsh-sense-seg button {
  flex: 1; min-width: 0; padding: 5px 2px; font-size: 11px; cursor: pointer;
  background: rgba(90,140,210,.12); color: #b9cde8;
  border: 1px solid rgba(120,180,255,.18); border-radius: 8px;
}
.dsh-sense-seg button:hover { background: rgba(110,170,250,.22); }
.dsh-sense-seg button.on { background: #4ea1ff; color: #04121f; border-color: #4ea1ff; font-weight: 700; }
.dsh-sense-sel {
  flex: 1; min-width: 0; background: rgba(12,22,38,.9); color: #dbe8ff;
  border: 1px solid rgba(120,180,255,.2); border-radius: 9px; padding: 5px 6px; font-size: 11px;
}
.dsh-sense-slider { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-sense-slider input[type=range] { flex: 1; min-width: 0; accent-color: #4ea1ff; }
.dsh-sense-value { flex: none; width: 54px; text-align: right; color: #8fd0ff; font-variant-numeric: tabular-nums; font-size: 10.5px; }
.dsh-sense-num { flex: none; width: 66px; box-sizing: border-box; background: rgba(12,22,38,.9); color: #dbe8ff; border: 1px solid rgba(120,180,255,.25); border-radius: 7px; padding: 3px 6px; font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }
.dsh-sense-num[disabled] { opacity: .45; cursor: not-allowed; }
.dsh-sense-btns { display: flex; gap: 6px; }
.dsh-sense-look {
  flex: 1; background: #6fb2ff; color: #04121f; border: none; border-radius: 10px;
  padding: 7px 10px; cursor: pointer; font-size: 12px; font-weight: 700;
}
.dsh-sense-look:hover { background: #8cc4ff; }
.dsh-sense-look:disabled { opacity: .55; cursor: default; }
.dsh-sense-look.ghost {
  flex: none; width: 82px; background: rgba(90,140,210,.16); color: #cfe2ff;
  border: 1px solid rgba(120,180,255,.28); font-weight: 600;
}
.dsh-sense-look.ghost:hover { background: rgba(110,170,250,.3); }
.dsh-sense-note {
  color: #8ba4c6; font-size: 10.5px; line-height: 1.55;
  background: rgba(80,130,200,.09); border: 1px solid rgba(120,180,255,.1);
  border-radius: 8px; padding: 7px 9px;
}
.dsh-sense-note-head { color: #cfe2ff; margin-bottom: 3px; }
.dsh-sense-note-foot { color: #6f86a4; margin-top: 3px; }
.dsh-sense-hint {
  color: #7e94b2; font-size: 10px; line-height: 1.45;
  padding-left: 64px; margin-top: -3px;
}
.dsh-sense-grid {
  display: grid; grid-template-columns: 30px 1fr 1fr 1.35fr; gap: 2px 5px;
  align-items: baseline; font-variant-numeric: tabular-nums;
}
.dsh-sense-grid .cell-head { color: #7e94b2; font-size: 10px; }
.dsh-sense-grid .cell-label { color: #93a9c8; font-weight: 600; }
.dsh-sense-grid .on { color: #e6f1ff; }
.dsh-sense-grid .on.cell-label { color: #8fd0ff; font-weight: 700; }
.dsh-sense-foot { color: #8098b8; font-size: 11px; line-height: 1.85; min-height: 16px; margin: 4px 0 12px; }
.dsh-sense-grouphead { color: #7f96b5; font-size: 10.5px; margin: 10px 0 2px; padding-top: 6px; border-top: 1px solid rgba(120,150,190,.18); cursor: pointer; }
.dsh-sense-rungroup > summary { list-style: none; }
.dsh-sense-rungroup > summary::-webkit-details-marker { display: none; }
.dsh-sense-rungroup > summary::before { content: '▸ '; }
.dsh-sense-rungroup[open] > summary::before { content: '▾ '; }
.dsh-sense-chip {
  position: fixed; z-index: 2147481800; left: 16px; top: 96px;
  width: 42px; height: 42px; border: 0; padding: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: transparent; box-shadow: none; color: #cfe2ff; font-size: 18px;
  -webkit-app-region: no-drag;
}
/* 图标自己的边缘就是透明的（图片外圈 9px 渐隐），别再垫一层底板/圆框，
   不然圆钮边上会多出一圈深色，看着像个贴纸。 */
.dsh-sense-chip img { width: 42px; height: 42px; display: block; object-fit: contain; pointer-events: none; -webkit-user-drag: none; }
/* 没底板了，靠一圈投影把它从背景上拎起来；悬停时换成偏蓝的光。 */
.dsh-sense-chip { filter: drop-shadow(0 2px 4px rgba(0,0,0,.5)); }
.dsh-sense-chip:hover { filter: drop-shadow(0 0 7px rgba(120,180,255,.85)); }
`;

    function el(tag, className) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      return node;
    }

    async function api(path, options) {
      const response = await fetch(`${ROUTE}${path}`, {
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        ...options,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) throw new Error(body?.message || `HTTP ${response.status}`);
      return body;
    }

    function readLayout() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }

    function writeLayout(value) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        /* 无所谓 */
      }
    }

    return {
      apply() {
        const saved = readLayout();
        let collapsed = saved.collapsed === true;
        for (const node of Array.from(document.querySelectorAll('[data-dsh-whale-glance]'))) node.remove();
        for (const node of Array.from(document.querySelectorAll('style[data-dsh-whale-glance-css]'))) node.remove();

        const style = document.createElement('style');
        style.dataset.dshWhaleSenseCss = 'true';
        style.textContent = CSS;
        document.head.appendChild(style);

        const chip = el('button', 'dsh-sense-chip');
        chip.type = 'button';
        chip.dataset.dshWhaleSense = 'chip';
        chip.title = '余光';
        // 鲸鱼娘头像（base64 内嵌，不联网加载；来源与署名见 CREDITS.md）。
        // 来源链见 CREDITS.md：溟月 @上善无形 → 大肥鱼化 @ZipZipPipe → 图 @孤独的小泽。
        chip.innerHTML = '<img alt="" src="data:image/png;base64,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" style="width:100%;height:100%;object-fit:cover;object-position:50% 45%;" />';

        const panel = el('div', 'dsh-sense-panel');
        panel.dataset.dshWhaleSense = 'panel';
        // 恢复上次拖出来的高度（没存过就用 CSS 默认 440）
        const savedH = Number(saved.h);
        if (Number.isFinite(savedH) && savedH >= 180) panel.style.height = savedH + 'px';

        const head = el('div', 'dsh-sense-head');
        const dot = el('span', 'dsh-sense-dot');
        const title = el('span', 'dsh-sense-title');
        title.textContent = '余光';
        const spacer = el('span', 'dsh-sense-spacer');
        const collapse = el('button', 'dsh-sense-mini');
        collapse.type = 'button';
        collapse.textContent = '—';
        head.append(dot, title, spacer, collapse);

        const body = el('div', 'dsh-sense-body');

        // ---- 自动陪看 ----
        const autoRow = el('div', 'dsh-sense-row');
        const autoLabel = el('span');
        autoLabel.textContent = '陪看';
        const autoToggle = el('button', 'dsh-sense-toggle');
        autoToggle.type = 'button';
        const autoText = el('span');
        autoText.textContent = '看着屏幕，想说话才说';
        const autoKnob = el('span', 'knob');
        autoToggle.append(autoText, autoKnob);
        autoRow.append(autoLabel, autoToggle);
        body.append(autoRow);

        // ---- 弹幕 ----
        const dmRow = el('div', 'dsh-sense-row');
        const dmLabel = el('span');
        dmLabel.textContent = '弹幕';
        const dmToggle = el('button', 'dsh-sense-toggle');
        dmToggle.type = 'button';
        const dmText = el('span');
        dmText.textContent = '台词从右往左飘';
        const dmKnob = el('span', 'knob');
        dmToggle.append(dmText, dmKnob);
        dmToggle.addEventListener('click', async () => {
          const next = !dmToggle.classList.contains('on');
          dmToggle.classList.toggle('on', next);
          try {
            sync(await api('/config', { method: 'POST', body: JSON.stringify({ danmakuOn: next }) }));
            foot.textContent = next ? '弹幕开了，台词会飘过去。' : '弹幕关了。';
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        });
        dmRow.append(dmLabel, dmToggle);
        body.append(dmRow);

        // ---- 弹幕样式（字号 / 字体 / 位置 / 速度）----
        const dmStyle = el('details', 'dsh-sense-adv');
        const dmSummary = el('summary');
        dmSummary.textContent = '弹幕样式（字号 / 字体 / 位置 / 速度）';
        dmStyle.append(dmSummary);

        // 可截图：只管「人自己」的截图/录屏。陪看拿的是窗口自己渲染的画面，弹幕压根进不去。
        const dmCapRow = el('div', 'dsh-sense-row');
        const dmCapLabel = el('span');
        dmCapLabel.textContent = '可截图';
        const dmCapToggle = el('button', 'dsh-sense-toggle');
        dmCapToggle.type = 'button';
        const dmCapText = el('span');
        dmCapText.textContent = '开了会被截到';
        const dmCapKnob = el('span', 'knob');
        dmCapToggle.append(dmCapText, dmCapKnob);
        dmCapToggle.title = '默认关：弹幕不出现在你自己的截图和录屏里。\n要录屏给人看的时候打开——屏幕上怎么写，录下来就是怎么写的。\n陪看不受这条影响，它抓的是窗口自己渲染的画面，弹幕永远进不去。';
        dmCapRow.title = dmCapToggle.title;
        dmCapToggle.addEventListener('click', async () => {
          const next = !dmCapToggle.classList.contains('on');
          dmCapToggle.classList.toggle('on', next);
          try {
            sync(await api('/config', { method: 'POST', body: JSON.stringify({ danmakuCapturable: next }) }));
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        });
        dmCapRow.append(dmCapLabel, dmCapToggle);
        dmStyle.append(dmCapRow);

        const dmFontRow = el('div', 'dsh-sense-row');
        const dmFontLabel = el('span');
        dmFontLabel.textContent = '字体';
        const dmFontSelect = el('select', 'dsh-sense-sel');
        dmFontSelect.title = '弹幕用的字体，列出系统里装过的。';
        let dmFontsLoaded = false;
        const loadDmFonts = async () => {
          if (dmFontsLoaded) return;
          dmFontsLoaded = true;
          try {
            const result = await api('/fonts');
            const list = Array.isArray(result.fonts) ? result.fonts : [];
            dmFontSelect.replaceChildren();
            for (const name of list) {
              const option = el('option');
              option.value = name;
              option.textContent = name;
              dmFontSelect.append(option);
            }
            // 跟字幕窗同样的处理：当前字体不在系统列表里就补一项，别让下拉空着
            const want = String(lastConfig?.danmakuFontFamily ?? 'Microsoft YaHei UI');
            if (!list.includes(want)) {
              const option = el('option');
              option.value = want;
              option.textContent = want;
              dmFontSelect.prepend(option);
            }
            dmFontSelect.value = want;
          } catch { /* 列不出来就空着 */ }
        };
        dmFontSelect.addEventListener('mousedown', () => void loadDmFonts());
        dmFontSelect.addEventListener('focus', () => void loadDmFonts());
        dmFontSelect.addEventListener('change', () => void patch({ danmakuFontFamily: dmFontSelect.value }));
        dmFontRow.append(dmFontLabel, dmFontSelect);
        dmStyle.append(dmFontRow);
        void loadDmFonts();  // 面板一打开就列字体，不然下拉先是空的，上次选的字也显示不出来

        const dmSliders = [
          { key: 'danmakuFontSize', label: '字号', min: 9, max: 40, step: 1, scale: (v) => `${Math.round(v)}` },
        ];
        const dmSliderRefs = {};
        for (const item of dmSliders) {
          const row = el('div', 'dsh-sense-row');
          const label = el('span');
          label.textContent = item.label;
          const wrap = el('div', 'dsh-sense-slider');
          const range = el('input');
          range.type = 'range';
          range.min = String(item.min);
          range.max = String(item.max);
          range.step = String(item.step);
          const value = el('span', 'dsh-sense-value');
          let timer = null;
          range.addEventListener('input', () => {
            value.textContent = item.scale(Number(range.value));
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => void patch({ [item.key]: Number(range.value) }), 260);
          });
          wrap.append(range, value);
          row.append(label, wrap);
          dmStyle.append(row);
          dmSliderRefs[item.key] = { range, value, scale: item.scale };
        }
        // 位置（按屏幕区域划，跟 B 站一样）
        const dmZoneRow = el('div', 'dsh-sense-row');
        const dmZoneLabel = el('span');
        dmZoneLabel.textContent = '位置';
        const dmZoneSelect = el('select', 'dsh-sense-sel');
        for (const item of [
          { id: 'top', label: '顶部' },
          { id: 'upper', label: '中上' },
          { id: 'middle', label: '中间' },
          { id: 'lower', label: '中下' },
          { id: 'bottom', label: '底部' },
          { id: 'full', label: '全屏' },
        ]) {
          const option = el('option');
          option.value = item.id;
          option.textContent = item.label;
          dmZoneSelect.append(option);
        }
        dmZoneSelect.addEventListener('change', () => void patch({ danmakuZone: dmZoneSelect.value }));
        dmZoneRow.append(dmZoneLabel, dmZoneSelect);
        dmStyle.append(dmZoneRow);

        // 速度（拉条：40~800 像素每秒，档位换连续）
        const dmSpeedRow = el('div', 'dsh-sense-row');
        const dmSpeedLabel = el('span');
        dmSpeedLabel.textContent = '速度';
        const dmSpeedWrap = el('div', 'dsh-sense-slider');
        const dmSpeedRange = el('input');
        dmSpeedRange.type = 'range';
        dmSpeedRange.min = '40';
        dmSpeedRange.max = '800';
        dmSpeedRange.step = '10';
        const dmSpeedValue = el('span', 'dsh-sense-value');
        let dmSpeedTimer = null;
        dmSpeedRange.addEventListener('input', () => {
          dmSpeedValue.textContent = dmSpeedRange.value + ' px/s';
          // 拖的时候就发（防抖 200ms），弹幕那边靠 mtime 重读，拖到哪看一眼就变到哪
          if (dmSpeedTimer !== null) clearTimeout(dmSpeedTimer);
          dmSpeedTimer = setTimeout(() => {
            dmSpeedTimer = null;
            void patch({ danmakuSpeed: Number(dmSpeedRange.value) });
          }, 200);
        });
        dmSpeedRange.addEventListener('change', () => void patch({ danmakuSpeed: Number(dmSpeedRange.value) }));
        dmSpeedWrap.append(dmSpeedRange, dmSpeedValue);
        dmSpeedRow.append(dmSpeedLabel, dmSpeedWrap);
        dmStyle.append(dmSpeedRow);

        // 弹幕文字颜色
        const dmColorRow = el('div', 'dsh-sense-row');
        const dmColorLabel = el('span');
        dmColorLabel.textContent = '文字色';
        const dmColorInput = el('input', 'dsh-sense-color');
        dmColorInput.type = 'color';
        dmColorInput.title = '弹幕文字的颜色。';
        dmColorInput.addEventListener('input', () => void patch({ danmakuTextColor: dmColorInput.value }));
        dmColorRow.append(dmColorLabel, dmColorInput);
        dmStyle.append(dmColorRow);

        body.append(dmStyle);

        // ---- 字幕窗 ----
        const hudRow = el('div', 'dsh-sense-row');
        const hudLabel = el('span');
        hudLabel.textContent = '字幕窗';
        const hudToggle = el('button', 'dsh-sense-toggle');
        hudToggle.type = 'button';
        const hudText = el('span');
        hudText.textContent = '显示字幕条';
        const hudKnob = el('span', 'knob');
        hudToggle.append(hudText, hudKnob);
        hudToggle.addEventListener('click', async () => {
          const next = !hudToggle.classList.contains('on');
          hudToggle.classList.toggle('on', next);
          try {
            sync(await api('/config', { method: 'POST', body: JSON.stringify({ hudOn: next }) }));
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        });
        hudRow.append(hudLabel, hudToggle);
        body.append(hudRow);

        // 字幕窗怎么操作，得写在看得见的地方
        const hudHint = el('div', 'dsh-sense-hint');
        hudHint.textContent = '拖中间移动 / 拖四边调大小 / 双击锁定 / Ctrl+滚轮字号 / Shift+滚轮透明度（只有深色、浅色能调）';
        body.append(hudHint);

        // 字幕窗样式（配色/字号/透明度，折叠起来）
        const styleDetails = el('details', 'dsh-sense-adv');
        const styleSummary = el('summary');
        styleSummary.textContent = '字幕窗样式（配色 / 字体 / 字号 / 透明度 / 淡出）';
        styleDetails.append(styleSummary);

        // 配色模板（下拉，跟选窗口/选发送一样）
        const styleRow = el('div', 'dsh-sense-row');
        const styleLabel = el('span');
        styleLabel.textContent = '配色';
        const styleSelect = el('select', 'dsh-sense-sel');
        for (const item of [{ id: 'dark', label: '深色' }, { id: 'light', label: '浅色' }, { id: 'glass', label: '玻璃' }, { id: 'frosted', label: '毛玻璃' }, { id: 'transparent', label: '透明（只留文字）' }]) {
          const option = el('option');
          option.value = item.id;
          option.textContent = item.label;
          styleSelect.append(option);
        }
        styleSelect.addEventListener('change', () => void patch({ hudStyle: styleSelect.value }));
        styleRow.append(styleLabel, styleSelect);
        styleDetails.append(styleRow);

        // 字体（列出系统装过的字体）
        const fontRow = el('div', 'dsh-sense-row');
        const fontLabel = el('span');
        fontLabel.textContent = '字体';
        const fontSelect = el('select', 'dsh-sense-sel');
        fontSelect.title = '字幕用的字体，列出系统里装过的。';
        let fontsLoaded = false;
        const loadFonts = async () => {
          if (fontsLoaded) return;
          fontsLoaded = true;
          try {
            const result = await api('/fonts');
            const list = Array.isArray(result.fonts) ? result.fonts : [];
            fontSelect.replaceChildren();
            for (const name of list) {
              const option = el('option');
              option.value = name;
              option.textContent = name;
              fontSelect.append(option);
            }
            // 当前字体不在系统列表里（名字对不上登记的那个）就补一项，别让下拉空着
            const want = String(lastConfig?.hudFontFamily ?? 'Microsoft YaHei');
            if (!list.includes(want)) {
              const option = el('option');
              option.value = want;
              option.textContent = want;
              fontSelect.prepend(option);
            }
            fontSelect.value = want;
          } catch { /* 列不出来就空着 */ }
        };
        fontSelect.addEventListener('mousedown', () => void loadFonts());
        fontSelect.addEventListener('focus', () => void loadFonts());
        fontSelect.addEventListener('change', () => void patch({ hudFontFamily: fontSelect.value }));
        fontRow.append(fontLabel, fontSelect);
        styleDetails.append(fontRow);
        void loadFonts();  // 面板一打开就把字体列出来，不然下拉先是空的

        // 字号 + 透明度
        // 可被截图（默认关：开着的话字幕条会盖住画面，还会被它自己读成屏幕内容）
        const capRow = el('div', 'dsh-sense-row');
        const capLabel = el('span');
        capLabel.textContent = '可截图';
        const capToggle = el('button', 'dsh-sense-toggle');
        capToggle.type = 'button';
        const capText = el('span');
        // 写死「会被截到」比「出现在截图里」直白——开之前就知道后果
        capText.textContent = '开了会被截到';
        const capKnob = el('span', 'knob');
        capToggle.append(capText, capKnob);
        capToggle.title = '默认关：字幕窗不出现在你自己的截图和录屏里。\n要录屏给人看的时候打开——屏幕上怎么写，录下来就是怎么写的。\n陪看不受这条影响，它抓的是窗口自己渲染的画面，字幕窗永远进不去。';
        capRow.title = capToggle.title;
        capToggle.addEventListener('click', async () => {
          const next = !capToggle.classList.contains('on');
          capToggle.classList.toggle('on', next);
          try {
            sync(await api('/config', { method: 'POST', body: JSON.stringify({ hudCapturable: next }) }));
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        });
        capRow.append(capLabel, capToggle);
        styleDetails.append(capRow);

        // 淡出：总开关 + 两段时间。「多久开始淡」和「淡出本身多久」是两件事，
        // 分开调——只调其中一个都会觉得不对劲。
        const fadeRow = el('div', 'dsh-sense-row');
        const fadeLabel = el('span');
        fadeLabel.textContent = '淡出';
        const fadeToggle = el('button', 'dsh-sense-toggle');
        fadeToggle.type = 'button';
        const fadeText = el('span');
        fadeText.textContent = '到点自己淡出';
        const fadeKnob = el('span', 'knob');
        fadeToggle.append(fadeText, fadeKnob);
        fadeToggle.title = '开着：字幕停留一会儿就慢慢消失（多行时每行各按自己的时间淡）。\n关了：一直亮着不自己躲，直到下一条。';
        fadeRow.title = fadeToggle.title;
        fadeToggle.addEventListener('click', async () => {
          const next = !fadeToggle.classList.contains('on');
          fadeToggle.classList.toggle('on', next);
          try {
            sync(await api('/config', { method: 'POST', body: JSON.stringify({ hudFade: next }) }));
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        });
        fadeRow.append(fadeLabel, fadeToggle);
        styleDetails.append(fadeRow);

        const hudSliders = [
          { key: 'hudFontSize', label: '字号', min: 9, max: 48, step: 1, scale: (v) => `${Math.round(v)}` },
          { key: 'hudOpacity', label: '透明度', min: 35, max: 100, step: 1, scale: (v) => `${Math.round(v)}%`, toValue: (v) => v / 100, fromValue: (v) => v * 100 },
        ];
        const hudSliderRefs = {};
        for (const item of hudSliders) {
          const row = el('div', 'dsh-sense-row');
          const label = el('span');
          label.textContent = item.label;
          const wrap = el('div', 'dsh-sense-slider');
          const range = el('input');
          range.type = 'range';
          range.min = String(item.min);
          range.max = String(item.max);
          range.step = String(item.step);
          const value = el('span', 'dsh-sense-value');
          let timer = null;
          range.addEventListener('input', () => {
            value.textContent = item.scale(Number(range.value));
            if (timer !== null) clearTimeout(timer);
            const raw = Number(range.value);
            timer = setTimeout(() => void patch({ [item.key]: item.toValue ? item.toValue(raw) : raw }), 260);
          });
          wrap.append(range, value);
          row.append(label, wrap);
          styleDetails.append(row);
          hudSliderRefs[item.key] = { range, value, scale: item.scale };
        }

        // 停留 / 淡出时长：这两个量常要精确到一个数，拖滑块对不准，所以照「最短开口」那套
        // 做成数字输入框——点进去直接敲，回车或点别处提交，越界夹回范围，提交的都是秒
        // （后端 index.js 读 hudHoldSec 2–300 整数秒、hudFadeSec 0.3–10 秒，不是十分之一秒）。
        const hudNumFields = [
          { key: 'hudHoldSec', label: '停留', unit: '秒', min: 2, max: 300, step: 1, digits: 0, hint: '2–300 秒，数字可以直接填' },
          { key: 'hudFadeSec', label: '淡出时长', unit: '秒', min: 0.3, max: 10, step: 0.1, digits: 1, hint: '0.3–10 秒，数字可以直接填' },
        ];
        const hudNumRefs = {};
        for (const item of hudNumFields) {
          const row = el('div', 'dsh-sense-row');
          const label = el('span');
          label.textContent = item.label;
          const wrap = el('div', 'dsh-sense-slider');
          const num = el('input', 'dsh-sense-num');
          num.type = 'number';
          num.min = String(item.min);
          num.max = String(item.max);
          num.step = String(item.step);
          num.inputMode = item.digits > 0 ? 'decimal' : 'numeric';
          num.style.marginLeft = 'auto';  // 没有滑块撑着，把输入框顶到右边，跟「最短开口」对齐
          num.title = `${item.min}–${item.max} 秒，点进去直接改，回车或点别处生效。`;
          let timer = null;
          const apply = (raw) => {
            const rawN = Number(raw) || 0;
            const clamped = Math.max(item.min, Math.min(item.max, rawN));
            // 按步进归整：秒数是整数，淡出是 0.1 一档（浮点乘法会带尾巴，落回去时再收一次）
            const snapped = item.step >= 1 ? Math.round(clamped) : Math.round(clamped / item.step) * item.step;
            num.value = snapped.toFixed(item.digits);
            if (timer !== null) clearTimeout(timer);
            const payload = { [item.key]: Number(snapped.toFixed(item.digits)) };
            timer = setTimeout(() => void patch(payload), 260);
          };
          num.addEventListener('change', () => apply(num.value));
          num.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') apply(num.value);
          });
          const unit = el('span', 'dsh-sense-unit');
          unit.textContent = item.unit;
          wrap.append(num, unit);
          row.append(label, wrap);
          const hint = el('div', 'dsh-sense-hint');
          hint.textContent = item.hint;
          styleDetails.append(row, hint);
          hudNumRefs[item.key] = { input: num };
        }

        // 字幕文字颜色
        const hudColorRow = el('div', 'dsh-sense-row');
        const hudColorLabel = el('span');
        hudColorLabel.textContent = '文字色';
        const hudColorInput = el('input', 'dsh-sense-color');
        hudColorInput.type = 'color';
        hudColorInput.title = '字幕文字的颜色；换配色时它会保留。';
        hudColorInput.addEventListener('input', () => void patch({ hudTextColor: hudColorInput.value }));
        hudColorRow.append(hudColorLabel, hudColorInput);
        styleDetails.append(hudColorRow);

        body.append(styleDetails);

        // ---- 场景 ----
        const modeButtons = {};
        const modeRow = el('div', 'dsh-sense-row');
        const modeLabel = el('span');
        modeLabel.textContent = '场景';
        const modeSeg = el('div', 'dsh-sense-seg');
        for (const item of MODES) {
          const button = el('button');
          button.type = 'button';
          button.textContent = item.label;
          button.title = item.hint;  // 每个按钮自己的说明，悬停才显示
          button.addEventListener('click', () => void patch({ mode: item.id }));
          modeButtons[item.id] = button;
          modeSeg.append(button);
        }
        modeRow.append(modeLabel, modeSeg);
        const modeHint = el('div', 'dsh-sense-hint');
        body.append(modeRow, modeHint);


        // ---- 发到哪个会话 ----
        const toRow = el('div', 'dsh-sense-row');
        const toLabel = el('span');
        toLabel.textContent = '发到';
        const toSelect = el('select', 'dsh-sense-sel');
        toSelect.title = '唤醒消息发给哪个会话。「跟随当前」= 发给最近在用的那个。';
        toSelect.addEventListener('mousedown', () => void loadSessions());
        toSelect.addEventListener('focus', () => void loadSessions());
        toSelect.addEventListener('change', () => void patch({ targetSession: toSelect.value }));
        toRow.append(toLabel, toSelect);
        const toHint = el('div', 'dsh-sense-hint');
        body.append(toRow, toHint);

        // ---- 口癖（陪看说话的语气）----
        const personaRow = el('div', 'dsh-sense-row');
        const personaLabel = el('span');
        personaLabel.textContent = '口癖';
        const personaInput = el('input', 'dsh-sense-sel');
        personaInput.type = 'text';
        personaInput.placeholder = '留空 = 通用腔；比如「自称本鱼，雌小鬼口吻」';
        personaInput.title = '陪看说话的语气。留空就用默认腔。';
        let personaTimer = null;
        personaInput.addEventListener('input', () => {
          if (personaTimer !== null) clearTimeout(personaTimer);
          personaTimer = setTimeout(() => void patch({ personaHint: personaInput.value.trim() }), 400);
        });
        const initBtn = el('button', 'dsh-sense-look');
        initBtn.type = 'button';
        initBtn.textContent = '一键初始化';
        initBtn.title = '配默认语音。口癖去主会话里跟 AI 说「帮我写陪看口癖」，它自己会调 sense_init 填。';
        initBtn.addEventListener('click', async () => {
          try {
            const result = await api('/init', { method: 'POST', body: JSON.stringify({}) });
            if (result?.personaHint) personaInput.value = result.personaHint;
            if (result?.message) foot.textContent = result.message;
          } catch { /* 配不好就算了 */ }
        });
        personaRow.append(personaLabel, personaInput);
        body.append(personaRow);

        // ---- 语音配置（夹在中间）----
        const voiceRow = el('div', 'dsh-sense-row');
        const voiceLabel = el('span');
        voiceLabel.textContent = '语音';
        const voiceSelect = el('select', 'dsh-sense-sel');
        voiceSelect.title = '朗读用的语音后端。';
        for (const item of [{ id: 'none', label: '静音' }, { id: 'sapi', label: 'Windows SAPI' }, { id: 'say.mjs', label: 'say.mjs 桥' }]) {
          const option = el('option');
          option.value = item.id;
          option.textContent = item.label;
          voiceSelect.append(option);
        }
        voiceSelect.addEventListener('change', () => void patch({ ttsBackend: voiceSelect.value }));
        voiceRow.append(voiceLabel, voiceSelect);
        body.append(voiceRow);
        // 语音后端健康：DSH 更新运行时会清掉 pip 装的 edge_tts，那以后句句静默失败，
        // 光听「怎么没声了」看不出来。后端查出来的结论挂在这儿。
        const voiceHint = el('div', 'dsh-sense-note');
        voiceHint.style.display = 'none';
        body.append(voiceHint);

        // 音色：say.mjs 用哪个声音念（别人的机器上没有晓伊，默认留空用 say.mjs 自己的）
        const toneRow = el('div', 'dsh-sense-row');
        const toneLabel = el('span');
        toneLabel.textContent = '音色';
        const toneSelect = el('select', 'dsh-sense-sel');
        toneSelect.title = 'say.mjs 念话用的音色。留「默认」就用它自己的音色。';
        for (const item of [
          { id: '', label: '默认（晓晓）' },
          { id: 'zh-CN-XiaoyiNeural', label: '晓伊' },
          { id: 'zh-CN-YunxiNeural', label: '云希' },
          { id: 'zh-CN-YunyangNeural', label: '云扬' },
          { id: 'zh-CN-XiaochenNeural', label: '晓辰' },
        ]) {
          const option = el('option');
          option.value = item.id;
          option.textContent = item.label;
          toneSelect.append(option);
        }
        toneSelect.addEventListener('change', () => void patch({ ttsVoice: toneSelect.value }));
        toneRow.append(toneLabel, toneSelect);
        body.append(toneRow);

        // ---- 口癖按钮（挪到下面）----
        const testVoiceBtn = el('button', 'dsh-sense-look');
        testVoiceBtn.type = 'button';
        testVoiceBtn.textContent = '播放测试语音';
        testVoiceBtn.title = '用当前配置念一句短的，确认音色和音量。';
        testVoiceBtn.addEventListener('click', async () => {
          testVoiceBtn.disabled = true;
          try {
            const r = await api('/test-voice', { method: 'POST', body: JSON.stringify({}) });
            if (r.ok) foot.textContent = '念了一句，听见了吗？';
            else foot.textContent = '没念出来：' + (r.message || '');
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          } finally {
            testVoiceBtn.disabled = false;
          }
        });
        const personaBtnRow = el('div', 'dsh-sense-btns');
        personaBtnRow.append(testVoiceBtn, initBtn);
        body.append(personaBtnRow);

        async function loadSessions() {
          const keep = toSelect.value;
          try {
            const result = await api('/sessions');
            const list = Array.isArray(result.sessions) ? result.sessions : [];
            toSelect.replaceChildren();
            const autoOption = el('option');
            autoOption.value = '';
            autoOption.textContent = '跟随当前会话';
            toSelect.append(autoOption);
            for (const item of list) {
              const option = el('option');
              option.value = item.id;
              const short = String(item.id).replace(/^session-/, '').slice(0, 6);
              option.textContent = `${String(item.title).slice(0, 22)}（${short}）`;
              toSelect.append(option);
            }
            toSelect.value = keep;
            toHint.textContent = list.length === 0
              ? '这会儿拿不到别的会话，只能跟着当前这个走。'
              : `列出了 ${list.length} 个会话，挑一个就只发它。`;
          } catch {
            /* 列不出来就保持原样，不影响别的 */
          }
        }

        // ---- 只看窗口 ----
        const winRow = el('div', 'dsh-sense-row');
        const winLabel = el('span');
        winLabel.textContent = '窗口';
        const winSelect = el('select', 'dsh-sense-sel');
        winSelect.title = '只用标题包含所选名字的窗口来判定画面变化。「不限制」= 整个屏幕都看。';
        winSelect.addEventListener('mousedown', () => void loadWindows());
        winSelect.addEventListener('focus', () => void loadWindows());
        winSelect.addEventListener('change', () => {
          const value = winSelect.value;
          void patch({ windowMatch: value, windowOnly: value !== '' });
        });
        winRow.append(winLabel, winSelect);
        const winHint = el('div', 'dsh-sense-hint');
        body.append(winRow, winHint);

        // ---- 说话节奏（间隔 + 上限，留给用户调）----
        // 默认展开：「多久说一句」是最常想改的一项，藏在折叠区里等于没有。
        const adv = el('details', 'dsh-sense-adv');
        adv.open = true;
        const advSummary = el('summary');
        advSummary.textContent = '说话节奏（间隔 / 上限）';
        adv.append(advSummary);
        const sliders = [
          { key: 'floorSec', label: '最短开口', unit: '秒', min: 5, max: 300, step: 1, combo: 'cooldownMs', comboScale: 1000 },
          { key: 'silentMax', label: '最多沉默多久', unit: '秒', min: 10, max: 3600, step: 1 },
          { key: 'maxPerHour', label: '每小时上限', unit: '次', min: 1, max: 600, step: 1 },
        ];
        const sliderRefs = {};
        for (const item of sliders) {
          const row = el('div', 'dsh-sense-row');
          const label = el('span');
          label.textContent = item.label;
          const wrap = el('div', 'dsh-sense-slider');
          const range = el('input');
          range.type = 'range';
          range.min = String(item.min);
          range.max = String(item.max);
          range.step = String(item.step);
          // 右边这个数字可以直接敲，不用一格一格拖
          const num = el('input', 'dsh-sense-num');
          num.type = 'number';
          num.min = String(item.min);
          num.max = String(item.max);
          num.step = String(item.step);
          let timer = null;
          const apply = (raw) => {
            const rawN = Number(raw) || 0;
            const n = Math.max(item.min, Math.min(item.max, rawN));
            const v = item.step >= 1 ? Math.round(n) : n;
            num.value = String(v);
            range.value = String(v);
            if (timer !== null) clearTimeout(timer);
            const payload = { [item.key]: item.toValue ? item.toValue(v) : v };
            // 记一笔「这个数是我手调的」：切档位时不要被那一档的基准盖回去
            if (item.key === 'intervalMs') payload.intervalManual = true;
            if (item.key === 'floorSec') payload.floorManual = true;
            if (item.combo) payload[item.combo] = item.comboScale ? v * item.comboScale : v;
            timer = setTimeout(() => void patch(payload), 260);
          };
          range.addEventListener('input', () => apply(range.value));
          num.addEventListener('change', () => apply(num.value));
          num.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') apply(num.value);
          });
          const unit = el('span', 'dsh-sense-unit');
          unit.textContent = item.unit ?? '';
          wrap.append(range, num, unit);
          row.append(label, wrap);
          adv.append(row);
          sliderRefs[item.key] = { range, value: num, scale: item.scale };
        }
        body.append(adv);

        // ---- 两个按钮 ----
        const buttonRow = el('div', 'dsh-sense-btns');
        const lookButton = el('button', 'dsh-sense-look');
        lookButton.type = 'button';
        lookButton.textContent = '看我一眼';
        lookButton.title = '立刻抓一张当前前台窗口看一眼，不管画面有没有变化。\n离开 DSH 时不用回来点：任何窗口下按 Ctrl+Alt+G 都一样。';
        lookButton.addEventListener('click', async () => {
          lookButton.disabled = true;
          lookButton.textContent = '在看了…';
          try {
            const result = await api('/look', { method: 'POST', body: '{}' });
            if (result.ok === false) {
              foot.textContent = result.message || '当前不在指定窗口，没抓。';
            } else {
              foot.textContent = result.woke ? '叫你了，等我说话。' : '没找到活跃会话，先发条消息再叫我。';
            }
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          } finally {
            lookButton.disabled = false;
            lookButton.textContent = '看我一眼';
          }
        });
        buttonRow.append(lookButton);
        body.append(buttonRow);
        // 状态行（这一小时开口几次）摆在看一眼下面，跟按钮是同一件事
        const foot = el('div', 'dsh-sense-foot');
        body.append(foot);

        // ---- 认出什么游戏 + 要不要自动补库 ----
        const gameBox = el('div', 'dsh-sense-pending');
        const gameHead = el('div', 'dsh-sense-pending-head');
        gameHead.textContent = '还没看到正在玩什么';
        gameBox.append(gameHead);
        const learnedLine = el('div', 'dsh-sense-note');
        learnedLine.style.display = 'none';
        learnedLine.style.color = '#7fd6a0';
        gameBox.append(learnedLine);
        body.append(gameBox);

        // ---- 走哪条路开口：直调 / 子会话 ----
        // 两条路各有各的好：直调快又省，子会话慢又贵，但界面里能翻到完整对话和 Token 卡片。
        const routeBox = el('div', 'dsh-sense-pending');
        const routeHead = el('div', 'dsh-sense-pending-head');
        routeHead.textContent = '怎么开口';
        const routeToggle = el('button', 'dsh-sense-toggle');
        routeToggle.type = 'button';
        const routeText = el('span');
        const routeKnob = el('span', 'knob');
        routeToggle.append(routeText, routeKnob);
        routeToggle.title = '开：它自己直接连模型，一次五六秒、几千字用量，但 DSH 里没有会话可翻。\n关：起一个分身，慢一些也贵一些，但 DSH 界面里能看到完整对话。';
        routeToggle.addEventListener('click', () => {
          const next = !routeToggle.classList.contains('on');
          routeToggle.classList.toggle('on', next);
          void patch({ directLlm: next });
        });
        const routeNote = el('div', 'dsh-sense-note');
        routeBox.append(routeHead, routeToggle, routeNote);
        body.append(routeBox);

        // ---- 最近几次陪看：它收到了什么、说了什么、花了多少 ----
        // 走子代理的时候这些在会话里能翻；改成直调以后没有会话，账就只剩这里。
        const lookBox = el('div', 'dsh-sense-pending');
        const lookList = el('div', 'dsh-sense-advlist');
        lookList.style.maxHeight = '380px';
        lookList.style.overflowY = 'auto';
        const lookHead = el('div', 'dsh-sense-pending-head');
        lookHead.title = '它每次收到了什么、说了什么、花掉多少，都记在这儿。点标题展开。';
        // 有箭头才像能点开的东西；没箭头只有一个标题，谁知道能点
        const setLooksOpen = (open) => {
          lookList.style.display = open ? '' : 'none';
          const arrow = open ? '\u25BE' : '\u25B8';
          const hint = open ? '收起' : '点开看';
          lookHead.textContent = arrow + ' 最近几次陪看（' + hint + '）';
        };
        lookList.style.display = 'none';
        lookHead.style.cursor = 'pointer';
        lookHead.addEventListener('click', () => {
          setLooksOpen(lookList.style.display === 'none');
        });
        setLooksOpen(false);
        lookBox.append(lookHead, lookList);
        body.append(lookBox);

        // ---- 看番档案：视频模式显示，游戏模式藏 ----
        const showBox = el('div', 'dsh-sense-pending');
        const showHead = el('div', 'dsh-sense-pending-head');
        showHead.textContent = '正在看哪部（只记进度，不查剧情）';
        const showInput = el('input', 'dsh-sense-sel');
        showInput.type = 'text';
        showInput.placeholder = '《番名》';
        showInput.title = '填了只用来记进度、续前情，不会联网查剧情、不会剧透。';
        showInput.addEventListener('change', () => void patch({ currentShow: showInput.value.trim() }));
        const showMemToggle = el('button', 'dsh-sense-toggle');
        showMemToggle.type = 'button';
        const showMemText = el('span');
        showMemText.textContent = '记进度（建番剧档案）';
        const showMemKnob = el('span', 'knob');
        showMemToggle.append(showMemText, showMemKnob);
        showMemToggle.title = '关：只看最近几句字幕，不建库、没有长期记忆。开：读番剧档案，续上前几集的前情、人物和设定。';
        showMemToggle.addEventListener('click', () => {
          const next = !showMemToggle.classList.contains('on');
          showMemToggle.classList.toggle('on', next);
          void patch({ showMemory: next });
        });
        showBox.append(showHead, showInput, showMemToggle);

        // 看番档案：点开列出已经存下来的番名和每集前情，方便核对有没有记混
        const showViewBtn = el('button', 'dsh-sense-mini');
        showViewBtn.type = 'button';
        showViewBtn.textContent = '看档案';
        showViewBtn.title = '列出已经记下的番剧和每集前情，核对有没有记混。';
        const showListView = el('div', 'dsh-sense-advlist');
        showListView.style.display = 'none';
        // 拉一次 /shows 画进列表。「看档案」和「记下这一集」都走这一份，
        // 免得两处各写一遍、字段改了漏改一处。
        async function loadShowList() {
          try {
            const r = await api('/shows');
            const shows = (r && r.shows) || {};
            const recent = Array.isArray(r && r.recentWrites) ? r.recentWrites : [];
            const names = Object.keys(shows);
            showListView.textContent = '';
            // 最近写入单列一块：写错番名、写错集数，一眼能看出来
            if (recent.length > 0) {
              const box = el('div', 'dsh-sense-advitem');
              const head = el('div', 'dsh-sense-advhead');
              head.textContent = '最近写入';
              box.append(head);
              for (const w of recent) {
                const line = el('div', 'dsh-sense-advline');
                line.textContent = `${w.at || ''}  →  《${w.name || ''}》 ${w.episode || ''}`;
                box.append(line);
              }
              showListView.append(box);
            }
            if (names.length === 0) {
              showListView.textContent = '还没有档案。';
            } else {
              for (const n of names) {
                const item = el('div', 'dsh-sense-advitem');
                const head = el('div', 'dsh-sense-advhead');
                head.textContent = n;
                item.append(head);
                const eps = Array.isArray(shows[n] && shows[n].剧情) ? shows[n].剧情 : [];
                for (const e of eps.slice(-6)) {
                  const line = el('div', 'dsh-sense-advline');
                  line.textContent = e;
                  item.append(line);
                }
                showListView.append(item);
              }
            }
            showListView.style.display = '';
          } catch (error) {
            showListView.textContent = '读档案失败：' + String(error && error.message ? error.message : error);
            showListView.style.display = '';
          }
        }
        showViewBtn.addEventListener('click', () => {
          if (showListView.style.display !== 'none') {
            showListView.style.display = 'none';
            return;
          }
          void loadShowList();
        });
        showBox.append(showViewBtn, showListView);

        // 档案由陪看自己写：一局收尾时它把这一集收成几句事实写进 shows.json。
        // 面板不再留手填入口——看番的人不会顺手填表单，那框只会挡路。
        body.append(showBox);

        const fetchRow = el('div', 'dsh-sense-row');
        const fetchLabel = el('span');
        fetchLabel.textContent = '自动认游戏';
        const fetchToggle = el('button', 'dsh-sense-toggle');
        fetchToggle.type = 'button';
        const fetchText = el('span');
        fetchText.textContent = '认不出就联网查';
        const fetchKnob = el('span', 'knob');
        fetchToggle.append(fetchText, fetchKnob);
        fetchToggle.title = '开着：遇到没见过的游戏，会自动联网查它的资料并存下来，下次就认得。\n关掉：完全不联网，只用本机已有的资料。';
        fetchToggle.addEventListener('click', async () => {
          const next = !fetchToggle.classList.contains('on');
          fetchToggle.classList.toggle('on', next);
          try {
            sync(await api('/config', { method: 'POST', body: JSON.stringify({ gameAutoFetch: next }) }));
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        });
        fetchRow.append(fetchLabel, fetchToggle);
        body.append(fetchRow);

        // 自动补黑话：识别到黑话少的游戏，静默搜攻略补到基础
        const autoLearnRow = el('div', 'dsh-sense-row');
        const autoLearnLabel = el('span');
        autoLearnLabel.textContent = '自动补黑话';
        const autoLearnToggle = el('button', 'dsh-sense-toggle');
        autoLearnToggle.type = 'button';
        const autoLearnText = el('span');
        autoLearnText.textContent = '黑话不够就自己补';
        const autoLearnKnob = el('span', 'knob');
        autoLearnToggle.append(autoLearnText, autoLearnKnob);
        autoLearnToggle.title = '开着：识别到黑话少于 5 条的游戏，自动去 B 站和小黑盒搜攻略补到基础。\n关掉：不自动，要补就手动点「学黑话」里的「自动找攻略」。';
        autoLearnToggle.addEventListener('click', async () => {
          const next = !autoLearnToggle.classList.contains('on');
          autoLearnToggle.classList.toggle('on', next);
          try {
            sync(await api('/config', { method: 'POST', body: JSON.stringify({ autoLearn: next }) }));
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        });
        autoLearnRow.append(autoLearnLabel, autoLearnToggle);
        body.append(autoLearnRow);

        // ---- 学黑话（养成：给游戏补术语和规则）----
        const learnBox = el('details', 'dsh-sense-adv');
        const learnSummary = el('summary');
        learnSummary.textContent = '学黑话（给游戏补术语）';
        learnBox.append(learnSummary);

        const learnGameRow = el('div', 'dsh-sense-row');
        const learnGameLabel = el('span');
        learnGameLabel.textContent = '游戏';
        const learnGameInput = el('input', 'dsh-sense-sel');
        learnGameInput.type = 'text';
        learnGameInput.placeholder = '游戏真名，别加「梗」「攻略」这类词';
        learnGameInput.title = '这里填的是「要加到哪个游戏下面」，不是搜索框。\n想要梗，游戏名就填游戏本名，梗会在摘词结果里单独一组让你勾。\n已经学过的游戏会出现在下拉里，选一个就不会建重复条目。';
        // 已有游戏的下拉提示：防止把「游戏名+搜索词」这种写法当游戏名建出新条目
        const learnGameList = el('datalist');
        learnGameList.id = 'dsh-sense-game-names';
        learnGameInput.setAttribute('list', learnGameList.id);
        learnGameInput.addEventListener('focus', () => {
          void api('/notes').then((r) => {
            const notes = r?.notes && typeof r.notes === 'object' ? r.notes : {};
            learnGameList.replaceChildren();
            for (const name of Object.keys(notes)) {
              const opt = el('option');
              opt.value = name;
              learnGameList.append(opt);
            }
          }).catch(() => {});
        });
        learnGameRow.append(learnGameLabel, learnGameInput, learnGameList);
        learnBox.append(learnGameRow);

        // 关键词搜索：填游戏名 + 关键词，去搜攻略摘词（跟上面「自动找攻略」并列）
        const learnKeywordRow = el('div', 'dsh-sense-row');
        const learnKeywordLabel = el('span');
        learnKeywordLabel.textContent = '关键词';
        const learnKeywordInput = el('input', 'dsh-sense-sel');
        learnKeywordInput.type = 'text';
        learnKeywordInput.placeholder = '想搜什么，比如「变异 流派」「新手 开局」';
        const learnSearchBtn = el('button', 'dsh-sense-look');
        learnSearchBtn.type = 'button';
        learnSearchBtn.textContent = '搜索';
        // 按钮别跟输入框抢宽度：关键词框要能看清自己在打什么
        learnSearchBtn.style.flex = 'none';
        learnSearchBtn.style.width = '64px';
        learnSearchBtn.title = '用「游戏名 + 关键词」去 B 站、小黑盒搜，搜到的攻略交给模型摘词，结果在下面勾选入库。';
        learnKeywordRow.append(learnKeywordLabel, learnKeywordInput, learnSearchBtn);
        learnBox.append(learnKeywordRow);

        const learnText = el('textarea', 'dsh-sense-sel');
        learnText.rows = 4;
        learnText.placeholder = '粘贴一段攻略 / 介绍文本；也可以直接粘 B 站、小黑盒的链接，会自动抓正文（连图里的字一起读）';
        learnText.style.width = '100%';
        learnText.style.resize = 'vertical';
        learnBox.append(learnText);

        const learnBtn = el('button', 'dsh-sense-look');
        learnBtn.type = 'button';
        learnBtn.textContent = '提取术语';
        learnBtn.title = '把上面的文本交给模型，提取这个游戏的黑话术语和基本规则。花一点钱，一次几厘。';
        learnBox.append(learnBtn);

        // 自动找攻略：去 B 站 + 小黑盒搜，合并文本再摘词，不用手动粘贴
        const autoBtn = el('button', 'dsh-sense-look');
        autoBtn.type = 'button';
        autoBtn.textContent = '自动找攻略';
        autoBtn.title = '去 B 站和小黑盒搜「游戏名 攻略」，拼起来交给模型摘词。要借用它们的登录态（只读），没登录会自动跳过。';
        autoBtn.style.marginLeft = '6px';
        learnBox.append(autoBtn);

        learnSearchBtn.addEventListener('click', async () => {
          const gameName = learnGameInput.value.trim();
          const keyword = learnKeywordInput.value.trim();
          if (gameName.length === 0 || keyword.length === 0) {
            foot.textContent = '游戏名和关键词都不能空';
            return;
          }
          learnSearchBtn.disabled = true;
          learnSearchBtn.textContent = '在搜…';
          foot.textContent = '搜「' + gameName + ' ' + keyword + '」，几十秒。';
          try {
            const result = await api('/search-terms', { method: 'POST', body: JSON.stringify({ gameName, keyword }) });
            if (result.ok) {
              renderLearn(result, gameName);
              if (result.failures && result.failures.length > 0) foot.textContent = '搜到一部分：' + result.failures.join('；');
            } else {
              learnResult.replaceChildren();
              learnResult.style.display = '';
              const h = el('div', 'dsh-sense-pending-head');
              h.textContent = '没搜到「' + keyword + '」：';
              const b = el('div');
              b.style.whiteSpace = 'pre-wrap';
              b.textContent = result.message || '未知原因';
              learnResult.append(h, b);
              foot.textContent = result.message || '关键词搜索失败';
            }
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          } finally {
            learnSearchBtn.disabled = false;
            learnSearchBtn.textContent = '搜索';
          }
        });

        const learnResult = el('div', 'dsh-sense-pending');
        learnResult.style.display = 'none';
        learnBox.append(learnResult);

        learnBtn.addEventListener('click', async () => {
          const gameName = learnGameInput.value.trim();
          const text = learnText.value.trim();
          if (gameName.length === 0 || text.length === 0) {
            foot.textContent = '游戏名和攻略文本都不能空';
            return;
          }
          learnBtn.disabled = true;
          learnBtn.textContent = '提取中…';
          try {
            const result = await api('/learn-terms', { method: 'POST', body: JSON.stringify({ gameName, text }) });
            renderLearn(result, gameName);
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          } finally {
            learnBtn.disabled = false;
            learnBtn.textContent = '提取术语';
          }
        });

        autoBtn.addEventListener('click', async () => {
          const gameName = learnGameInput.value.trim();
          if (gameName.length === 0) {
            foot.textContent = '先填游戏名';
            return;
          }
          autoBtn.disabled = true;
          autoBtn.textContent = '在搜攻略…（几十秒）';
          foot.textContent = '搜 B 站和黑盒的攻略，再交给模型摘词，几十秒，结果出在这块下边。';
          try {
            const result = await api('/auto-learn', { method: 'POST', body: JSON.stringify({ gameName }) });
            if (result.ok) {
              renderLearn(result, gameName);
              // 顺手把失败源报在底部，让人知道哪个源没搜到
              if (result.failures && result.failures.length > 0) {
                foot.textContent = '搜到一部分：' + result.failures.join('；');
              }
            } else {
              // 失败要看得见：不光写在底部小字里，结果区也摆出来
              learnResult.replaceChildren();
              learnResult.style.display = '';
              const failHead = el('div', 'dsh-sense-pending-head');
              failHead.textContent = '没搜到' + (gameName ? '「' + gameName + '」' : '') + '：';
              const failBody = el('div');
              failBody.style.whiteSpace = 'pre-wrap';
              // 模型没按格式返回时把原文露一截：只写「没解析出 JSON」，谁也不知道它是截断了还是跑题了
              const rawPeek = result.raw ? String(result.raw).replace(/\s+/g, ' ').slice(0, 160) : '';
              failBody.textContent = (result.message || '未知原因')
                + (rawPeek ? `\n\n模型原话（共 ${String(result.raw).length} 字）：\n${rawPeek}${String(result.raw).length > 160 ? '…' : ''}` : '');
              learnResult.append(failHead, failBody);
              foot.textContent = result.message || '自动搜失败';
            }
          } catch (error) {
            // 连请求都失败了也要摆在结果区，不能只留底部一行小字
            const msg = String(error.message ?? error);
            learnResult.replaceChildren();
            learnResult.style.display = '';
            const failHead = el('div', 'dsh-sense-pending-head');
            failHead.textContent = '自动搜出错了：';
            const failBody = el('div');
            failBody.style.whiteSpace = 'pre-wrap';
            failBody.textContent = msg;
            learnResult.append(failHead, failBody);
            foot.textContent = msg;
          } finally {
            autoBtn.disabled = false;
            autoBtn.textContent = '自动找攻略';
          }
        });

        function renderLearn(result, gameName) {
          learnResult.replaceChildren();
          learnResult.style.display = '';
          const checks = new Map(); // key -> 是否勾选

          const head = el('div', 'dsh-sense-pending-head');
          head.textContent = '像审批文件一样过一遍：默认全勾，把不要的取消，再点确认采纳。';
          learnResult.append(head);

          const saveBtn = el('button', 'dsh-sense-look');
          saveBtn.type = 'button';
          const updateCount = () => {
            let n = 0;
            for (const v of checks.values()) if (v) n++;
            saveBtn.textContent = `确认采纳（${n} 条）`;
            saveBtn.disabled = n === 0;
          };

          const mkList = (title, list, prefix) => {
            if (!Array.isArray(list) || list.length === 0) return;
            const cap = el('div', 'dsh-sense-note');
            cap.textContent = title;
            learnResult.append(cap);
            for (const item of list) {
              const key = prefix + item;
              checks.set(key, true); // 默认勾选
              const row = el('label');
              row.style.cursor = 'pointer';
              row.style.display = 'flex';
              row.style.alignItems = 'flex-start';
              row.style.gap = '8px';
              row.style.padding = '2px 0';
              const cb = el('input');
              cb.type = 'checkbox';
              cb.checked = true;
              cb.style.flexShrink = '0';
              cb.style.marginTop = '3px';
              cb.addEventListener('change', () => {
                checks.set(key, cb.checked);
                updateCount();
              });
              const txt = el('span');
              txt.textContent = item;
              // 不借用 dsh-sense-row：那个类的 > span 会被锁成 64px 宽、不换行
              txt.style.flex = '1';
              txt.style.minWidth = '0';
              txt.style.whiteSpace = 'normal';
              txt.style.overflowWrap = 'anywhere';
              txt.style.wordBreak = 'break-word';
              txt.style.lineHeight = '1.5';
              row.append(cb, txt);
              learnResult.append(row);
            }
          };

          mkList('术语（黑话）', result.terms, 't:');
          // 模型自己补的：攻略里没出现过，所以单独摆一块，名字就说清楚
          mkList('模型补充（攻略里没出现，自己看要不要）', result.extra, 'e:');
          mkList('规则', result.rules, 'r:');
          mkList('梗（社区梗 / 名场面）', result.memes, 'm:');

          learnResult.append(saveBtn);
          updateCount();

          saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            const terms = (Array.isArray(result.terms) ? result.terms : []).filter((t) => checks.get('t:' + t))
              // 模型补充的勾了也要落盘，不然勾了等于白勾
              .concat((Array.isArray(result.extra) ? result.extra : []).filter((t) => checks.get('e:' + t)));
            const rules = (Array.isArray(result.rules) ? result.rules : []).filter((r) => checks.get('r:' + r));
            const memes = (Array.isArray(result.memes) ? result.memes : []).filter((m) => checks.get('m:' + m));
            try {
              const r = await api('/save-terms', { method: 'POST', body: JSON.stringify({ gameName, terms, rules, memes }) });
              foot.textContent = `已存进「${r.gameName}」：术语 ${r.terms.length}、规则 ${r.rules.length}、梗 ${(r.memes || []).length}，下次就认得了。`;
              learnResult.style.display = 'none';
            } catch (error) {
              foot.textContent = String(error.message ?? error);
            } finally {
              saveBtn.disabled = false;
            }
          });
        }

        body.append(learnBox);

        // ---- 黑话库：审查它学了什么 ----
        const libBox = el('details', 'dsh-sense-adv');
        const libSummary = el('summary');
        libSummary.textContent = '黑话库';
        libBox.append(libSummary);

        const libRefresh = el('button', 'dsh-sense-look');
        libRefresh.type = 'button';
        libRefresh.textContent = '刷新';
        libRefresh.style.margin = '4px 0';
        libBox.append(libRefresh);

        const libList = el('div');
        libList.style.display = 'flex';
        libList.style.flexDirection = 'column';
        libList.style.gap = '6px';
        libBox.append(libList);

        // 记住哪些游戏是展开的：重新渲染后（比如删了一条）要恢复，别收起来
        const openGames = new Set();

        async function renderNotes() {
          try {
            const r = await api('/notes');
            const notes = r.notes && typeof r.notes === 'object' ? r.notes : {};
            const games = Object.keys(notes);
            libList.replaceChildren();
            if (games.length === 0) {
              const empty = el('div', 'dsh-sense-note');
              empty.textContent = '还没学任何游戏的黑话。';
              libList.append(empty);
              return;
            }
            for (const game of games) {
              const note = notes[game] || {};
              const terms = Array.isArray(note['黑话']) ? note['黑话'] : [];
              const rules = Array.isArray(note['规则']) ? note['规则'] : [];
              const memes = Array.isArray(note['梗']) ? note['梗'] : [];
              const g = el('details');
              if (openGames.has(game)) g.open = true;
              g.addEventListener('toggle', () => {
                if (g.open) openGames.add(game); else openGames.delete(game);
              });
              const gs = el('summary');
              gs.textContent = `${game}（术语 ${terms.length}、规则 ${rules.length}、梗 ${memes.length}）`;
              g.append(gs);

              const delGame = el('button', 'dsh-sense-mini');
              delGame.type = 'button';
              delGame.textContent = '删整个';
              delGame.title = '把这个游戏的整个条目删掉（点两次才真删）';
              delGame.style.marginLeft = '8px';
              let delGameArmed = false;
              let delGameTimer = 0;
              const disarmDelGame = () => {
                delGameArmed = false;
                delGame.textContent = '删整个';
                delGame.style.color = '';
              };
              delGame.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!delGameArmed) {
                  delGameArmed = true;
                  delGame.textContent = '确定删？';
                  delGame.style.color = '#ff9a9a';
                  delGameTimer = setTimeout(disarmDelGame, 3000);
                  return;
                }
                clearTimeout(delGameTimer);
                disarmDelGame();
                try {
                  await api('/notes', { method: 'POST', body: JSON.stringify({ game, deleteGame: true }) });
                  renderNotes();
                } catch (err) { foot.textContent = String(err.message ?? err); }
              });
              gs.append(delGame);
              g.append(gs);

              const mkDelList = (title, list, kind) => {
                if (!list.length) return;
                const cap = el('div', 'dsh-sense-note');
                cap.textContent = title;
                g.append(cap);
                for (const item of list) {
                  const row = el('div');
                  row.style.display = 'flex';
                  row.style.alignItems = 'flex-start';
                  row.style.justifyContent = 'space-between';
                  row.style.gap = '8px';
                  row.style.padding = '2px 0';
                  const txt = el('span');
                  txt.textContent = item;
                  txt.style.flex = '1';
                  txt.style.minWidth = '0';
                  txt.style.overflowWrap = 'anywhere';
                  txt.style.wordBreak = 'break-word';
                  txt.style.whiteSpace = 'normal';
                  const edit = el('button', 'dsh-sense-mini');
                  edit.type = 'button';
                  edit.textContent = '改';
                  edit.title = '改这一条（错别字就在这里改），回车保存，Esc 取消';
                  edit.style.flexShrink = '0';
                  edit.addEventListener('click', () => {
                    if (row.querySelector('input')) return;
                    const input = el('input', 'dsh-sense-sel');
                    input.type = 'text';
                    input.value = item;
                    input.style.flex = '1';
                    input.style.minWidth = '0';
                    input.style.fontSize = '12px';
                    let done = false;
                    const finish = async (save) => {
                      if (done) return;
                      done = true;
                      const next = input.value.trim();
                      if (!save || next === '' || next === item) {
                        void renderNotes();
                        return;
                      }
                      try {
                        await api('/notes', { method: 'POST', body: JSON.stringify({ game, kind, edit: true, oldValue: item, newValue: next }) });
                      } catch (err) {
                        foot.textContent = String(err.message ?? err);
                      }
                      void renderNotes();
                    };
                    input.addEventListener('keydown', (ev) => {
                      if (ev.key === 'Enter') {
                        ev.preventDefault();
                        void finish(true);
                      } else if (ev.key === 'Escape') {
                        ev.preventDefault();
                        void finish(false);
                      }
                    });
                    // 改完点别处也算保存，免得改到一半白改
                    input.addEventListener('blur', () => void finish(true));
                    txt.replaceWith(input);
                    input.focus();
                    input.select();
                  });
                  const del = el('button', 'dsh-sense-mini');
                  del.type = 'button';
                  del.textContent = '删';
                  del.title = '删掉这一条（点两次才真删）';
                  del.style.flexShrink = '0';
                  let delArmed = false;
                  let delTimer = 0;
                  const disarmDel = () => {
                    delArmed = false;
                    del.textContent = '删';
                    del.style.color = '';
                  };
                  del.addEventListener('click', async () => {
                    if (!delArmed) {
                      delArmed = true;
                      del.textContent = '确定？';
                      del.style.color = '#ff9a9a';
                      delTimer = setTimeout(disarmDel, 3000);
                      return;
                    }
                    clearTimeout(delTimer);
                    disarmDel();
                    try {
                      await api('/notes', { method: 'POST', body: JSON.stringify({ game, kind, value: item }) });
                      renderNotes();
                    } catch (err) { foot.textContent = String(err.message ?? err); }
                  });
                  row.append(txt, edit, del);
                  g.append(row);
                }
              };
              mkDelList('术语', terms, 'term');
              mkDelList('规则', rules, 'rule');
              mkDelList('梗', memes, 'meme');
              libList.append(g);
            }
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        }
        libRefresh.addEventListener('click', () => void renderNotes());
        libSummary.addEventListener('click', () => { if (libBox.open) void renderNotes(); });
        body.append(libBox);

        // ---- 文字识别（OCR）：一行状态，跟登录态同样的排法，不折叠 ----
        const ocrRow = el('div');
        ocrRow.style.display = 'flex';
        ocrRow.style.alignItems = 'center';
        ocrRow.style.gap = '8px';
        const ocrLabel = el('span');
        ocrLabel.textContent = '文字识别（OCR）：检测中';
        const ocrBtn = el('button', 'dsh-sense-mini');
        ocrBtn.type = 'button';
        ocrBtn.textContent = '安装';
        ocrBtn.title = '在本机装 RapidOCR（约 200MB）。装完屏幕上的数字、台词才读得准；不装也能用，数字容易看错。';
        ocrBtn.style.display = 'none';
        ocrBtn.addEventListener('click', async () => {
          ocrBtn.disabled = true;
          ocrBtn.textContent = '在装（约 200MB，几分钟）…';
          try {
            const r = await api('/install-ocr', { method: 'POST' });
            if (r.ok) {
              ocrLabel.textContent = '文字识别（OCR）：已安装';
              ocrBtn.style.display = 'none';
            } else {
              ocrLabel.textContent = '文字识别（OCR）：安装失败 ' + (r.message || '');
              ocrBtn.disabled = false;
              ocrBtn.textContent = '重试';
            }
          } catch (err) {
            ocrLabel.textContent = '文字识别（OCR）：' + String(err.message ?? err);
            ocrBtn.disabled = false;
            ocrBtn.textContent = '重试';
          }
        });
        ocrRow.append(ocrLabel, ocrBtn);
        body.append(ocrRow);


        // ---- 第一次装的三步引导：动过面板任意开关就消失 ----
        const firstRunBox = el('div', 'dsh-sense-note');
        firstRunBox.style.display = 'none';
        firstRunBox.style.lineHeight = '1.7';
        firstRunBox.textContent = '第一次用？三步：① 打开「陪看」开关；② 点「安装」（读屏幕上的字更准，可选）；③ 点「一键初始化」。语音开机自动配，不用管。';
        body.append(firstRunBox);

        // ---- 登录态：自建登录 + 借用两个渠道，各自能登出 ----
        const loginBox = el('div', 'dsh-sense-note');
        loginBox.style.lineHeight = '1.8';
        loginBox.textContent = '登录只用来搜攻略、摘黑话。没装隔壁插件可以使用余光自己的登录。';

        let curBiliOwn = false;
        let curBiliBorrowed = false;
        let curHbOwn = false;

        const biliRow = el('div');
        biliRow.style.display = 'flex';
        biliRow.style.alignItems = 'center';
        biliRow.style.gap = '8px';
        const biliLabel = el('span');
        biliLabel.textContent = 'B站：检测中';
        const biliLoginBtn = el('button', 'dsh-sense-mini');
        biliLoginBtn.type = 'button';
        biliLoginBtn.textContent = '扫码登录';
        const biliBorrowBtn = el('button', 'dsh-sense-mini');
        biliBorrowBtn.type = 'button';
        biliBorrowBtn.textContent = '使用 bili 插件的登录凭证';
        const biliOutBtn = el('button', 'dsh-sense-mini');
        biliOutBtn.type = 'button';
        biliOutBtn.textContent = '登出';
        biliOutBtn.style.display = 'none';
        biliRow.append(biliLabel, biliLoginBtn, biliBorrowBtn, biliOutBtn);

        const hbRow = el('div');
        hbRow.style.display = 'flex';
        hbRow.style.alignItems = 'center';
        hbRow.style.gap = '8px';
        const hbLabel = el('span');
        hbLabel.textContent = '小黑盒：';
        const hbBtn = el('button', 'dsh-sense-mini');
        hbBtn.type = 'button';
        hbBtn.textContent = '使用 heybox 插件的登录凭证';
        hbBtn.addEventListener('click', async () => {
          try {
            const r = await api('/use-borrow', { method: 'POST', body: JSON.stringify({ site: 'heybox' }) });
            if (!r.ok) { foot.textContent = r.message || '借不到'; return; }
            hbLabel.textContent = '小黑盒：已登录';
            hbBtn.style.display = 'none';
            hbOutBtn.style.display = '';
            sync(await api('/state'));
          } catch (err) { foot.textContent = String(err.message ?? err); }
        });
        const hbScanBtn = el('button', 'dsh-sense-mini');
        hbScanBtn.type = 'button';
        hbScanBtn.textContent = '扫码登录';
        hbScanBtn.addEventListener('click', async () => {
          stopBiliPoll();
          hbScanBtn.disabled = true;
          try {
            const r = await api('/login-qr', { method: 'POST', body: JSON.stringify({ site: 'heybox' }) });
            if (!r.ok) { foot.textContent = r.message || '出码失败'; hbScanBtn.disabled = false; return; }
            if (r.qr) {
              qrImg.src = 'data:image/png;base64,' + r.qr;
              qrImg.style.display = '';
              qrTip.textContent = '用手机小黑盒 App 扫码，扫完确认。';
            } else {
              qrImg.style.display = 'none';
              qrTip.textContent = '没装二维码库，用小黑盒 App 扫这段：' + r.url;
            }
            hbRow.after(qrBox);
            qrBox.style.display = '';
            qrBox.scrollIntoView({ block: 'nearest' });
            biliPollTimer = setInterval(async () => {
              try {
                const p = await api('/login-poll', { method: 'POST', body: JSON.stringify({ site: 'heybox' }) });
                if (!p.ok) { foot.textContent = p.message; return; }
                if (p.done) {
                  stopBiliPoll();
                  qrBox.style.display = 'none';
                  hbLabel.textContent = '小黑盒：已登录';
                  hbScanBtn.style.display = 'none';
                  hbBtn.style.display = 'none';
                  hbOutBtn.style.display = '';
                  foot.textContent = '小黑盒登录好了。';
                  sync(await api('/state'));
                } else if (p.state === 'expired') {
                  stopBiliPoll();
                  qrTip.textContent = '二维码过期了，重新点一下。';
                  hbScanBtn.disabled = false;
                } else if (p.state === 'scanned') {
                  qrTip.textContent = '扫到了，手机上确认。';
                }
              } catch (err) { foot.textContent = String(err.message ?? err); }
            }, 1500);
          } catch (err) {
            foot.textContent = String(err.message ?? err);
            hbScanBtn.disabled = false;
          }
        });
        const hbOutBtn = el('button', 'dsh-sense-mini');
        hbOutBtn.type = 'button';
        hbOutBtn.textContent = '登出';
        hbOutBtn.style.display = 'none';
        hbOutBtn.addEventListener('click', async () => {
          try {
            const mode = curHbOwn ? 'own' : 'borrowed';
            await api('/logout', { method: 'POST', body: JSON.stringify({ site: 'heybox', mode }) });
            hbLabel.textContent = '小黑盒：未登录';
            hbOutBtn.style.display = 'none';
            curHbOwn = false;
            sync(await api('/state'));
          } catch (err) { foot.textContent = String(err.message ?? err); }
        });
        hbRow.append(hbLabel, hbScanBtn, hbBtn, hbOutBtn);

        const qrBox = el('div');
        qrBox.style.display = 'none';
        qrBox.style.margin = '6px 0';
        const qrImg = el('img');
        qrImg.style.width = '160px';
        qrImg.style.height = '160px';
        qrImg.style.imageRendering = 'pixelated';
        const qrTip = el('div', 'dsh-sense-note');
        qrTip.textContent = '用手机 B 站扫码，扫完在手机上确认。';
        qrBox.append(qrImg, qrTip);
        body.append(qrBox);

        let biliPollTimer = null;
        const stopBiliPoll = () => {
          if (biliPollTimer !== null) { clearInterval(biliPollTimer); biliPollTimer = null; }
        };
        biliBorrowBtn.addEventListener('click', async () => {
          try {
            const r = await api('/use-borrow', { method: 'POST', body: JSON.stringify({ site: 'bili' }) });
            if (!r.ok) { foot.textContent = r.message || '借不到'; return; }
            // 借用成了就把二维码收掉，别让上一张赖在那儿
            stopBiliPoll();
            qrBox.style.display = 'none';
            biliLabel.textContent = 'B站：已登录';
            biliLoginBtn.style.display = 'none';
            biliBorrowBtn.style.display = 'none';
            biliOutBtn.style.display = '';
            foot.textContent = '用上 bili 插件的登录凭证了。';
            sync(await api('/state'));
          } catch (err) { foot.textContent = String(err.message ?? err); }
        });
        biliLoginBtn.addEventListener('click', async () => {
          stopBiliPoll();
          biliLoginBtn.disabled = true;
          biliLoginBtn.textContent = '出码中…';
          try {
            const r = await api('/login-qr', { method: 'POST', body: JSON.stringify({ site: 'bili' }) });
            if (!r.ok) {
              foot.textContent = r.message || '出码失败';
              biliLoginBtn.disabled = false;
              biliLoginBtn.textContent = '扫码登录';
              return;
            }
            if (r.qr) {
              qrImg.src = 'data:image/png;base64,' + r.qr;
              qrImg.style.display = '';
              qrTip.textContent = '用手机 B 站扫码，扫完在手机上确认。';
            } else {
              qrImg.style.display = 'none';
              qrTip.textContent = '没装二维码库，去 B 站 App 扫这段链接登录：' + r.url;
            }
            biliRow.after(qrBox);
            qrBox.style.display = '';
            qrBox.scrollIntoView({ block: 'nearest' });
            biliLoginBtn.textContent = '轮询中…';
            const key = r.key;
            biliPollTimer = setInterval(async () => {
              try {
                const p = await api('/login-poll', { method: 'POST', body: JSON.stringify({ site: 'bili', key }) });
                if (!p.ok) { foot.textContent = p.message; return; }
                if (p.done) {
                  stopBiliPoll();
                  qrBox.style.display = 'none';
                  biliLabel.textContent = 'B站：已登录';
                  biliLoginBtn.textContent = '重新登录';
                  biliLoginBtn.disabled = false;
                  biliOutBtn.style.display = '';
                  foot.textContent = 'B 站登录好了。';
                  sync(await api('/state'));
                } else if (p.state === 'expired') {
                  stopBiliPoll();
                  qrTip.textContent = '二维码过期了，重新点一下登录。';
                  biliLoginBtn.disabled = false;
                  biliLoginBtn.textContent = '扫码登录';
                } else if (p.state === 'scanned') {
                  qrTip.textContent = '扫到了，去手机上确认。';
                }
              } catch (err) { foot.textContent = String(err.message ?? err); }
            }, 2000);
          } catch (err) {
            foot.textContent = String(err.message ?? err);
            biliLoginBtn.disabled = false;
            biliLoginBtn.textContent = '扫码登录';
          }
        });
        biliOutBtn.addEventListener('click', async () => {
          try {
            const mode = curBiliOwn ? 'own' : 'borrowed';
            await api('/logout', { method: 'POST', body: JSON.stringify({ site: 'bili', mode }) });
            biliLabel.textContent = 'B站：未登录';
            biliOutBtn.style.display = 'none';
            biliLoginBtn.textContent = '扫码登录';
            curBiliOwn = false;
            curBiliBorrowed = false;
            sync(await api('/state'));
          } catch (err) { foot.textContent = String(err.message ?? err); }
        });

        // ---- 认不出的游戏，问一句 ----
        const pendingBox = el('div', 'dsh-sense-pending');
        pendingBox.style.display = 'none';
        const pendingHead = el('div', 'dsh-sense-pending-head');
        pendingHead.textContent = '刚才看到几个没认出来的窗口，是不是游戏？';
        pendingBox.append(pendingHead);
        body.append(pendingBox);
        // 登录区挪到面板底部：最不常动的东西放最后；那句提示摆最底下
        body.append(biliRow);
        body.append(hbRow);
        body.append(loginBox);


        panel.append(head, body);

        // 量「内容自己撑起来有多高」：临时把高度设成 auto 让内容撑开，同步读一次再还原，
        // 中间不会重绘，所以不会闪。
        // 不能用 body.scrollHeight：它是滚动容器，scrollHeight 永远不小于可见高度，
        // 面板越高它越跟着长，上限会一路顶到「屏幕高-130」，拖到底就留一片空白。
        function measureContentHeight() {
          const prev = panel.style.height;
          panel.style.height = 'auto';
          const h = panel.offsetHeight;
          panel.style.height = prev;
          return h;
        }
        // 存下来的高度可能是以前拖超的（旧版上限写错，能一路拖到「屏幕高-130」）。
        // 内容都建好之后量一次，超了就收回来，别一打开就底部一片空。
        function clampPanelHeight() {
          const max = Math.min(measureContentHeight(), window.innerHeight - 130);
          const floor = Math.max(180, max);
          if (panel.offsetHeight > floor) {
            panel.style.height = floor + 'px';
            writeLayout({ ...readLayout(), h: floor });
          }
        }

        // 底部拖拽条：明显一点，别像原生 resize 那样藏在右下角
        const resizer = el('div', 'dsh-sense-resizer');
        resizer.title = '按住上下拖，调面板高度';
        resizer.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = panel.offsetHeight;
          // 拖之前量一次内容高度。不能每帧量——改高度会让布局一直抖。
          const contentH = measureContentHeight();
          const maxH = Math.min(contentH, window.innerHeight - 130);
          const onMove = (ev) => {
            // 往下拖 = 拉长，往上拖 = 缩短。
            // 上限取「内容实际高度」和「屏幕剩余」里较小的那个，拖不到比内容还长、不会留空白。
            const nh = Math.min(Math.max(startH + (ev.clientY - startY), 180), maxH);
            panel.style.height = nh + 'px';
            writeLayout({ ...readLayout(), h: nh });
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        panel.append(resizer);
        document.body.append(panel, chip);
        // 内容都建好了，先把高度收回到真实内容高度（localStorage 里可能存着旧版拖超的值）。
        clampPanelHeight();
        // 状态是异步刷进来的，字长会变，等它落定再量一次。
        setTimeout(clampPanelHeight, 700);
        window.addEventListener('resize', () => clampPanelHeight());

        // ---- 拖动 ----
        const startPos = saved.pos && typeof saved.pos.x === 'number'
          ? { x: saved.pos.x, y: saved.pos.y }
          : { x: 16, y: Math.max(16, window.innerHeight - 520) };
        let pos = { ...startPos };
        let drag = null;

        function clampPos(x, y, small) {
          // 收起时按小球的尺寸算，不然会拿面板那 460px 高去卡，拖不到屏幕下半部分
          const width = small ? (chip.offsetWidth || 40) : (panel.offsetWidth || 286);
          const height = small ? (chip.offsetHeight || 40) : (panel.offsetHeight || 460);
          const maxX = Math.max(0, window.innerWidth - width);
          const maxY = Math.max(0, window.innerHeight - height);
          return { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(0, y)) };
        }

        function applyPos() {
          panel.style.left = `${pos.x}px`;
          panel.style.top = `${pos.y}px`;
          // 收起时小球就落在面板左上角的位置
          chip.style.left = `${pos.x}px`;
          chip.style.top = `${pos.y}px`;
        }

        function onMove(event) {
          if (drag === null) return;
          pos = clampPos(event.clientX - drag.dx, event.clientY - drag.dy);
          panel.style.left = `${pos.x}px`;
          panel.style.top = `${pos.y}px`;
          chip.style.left = `${pos.x}px`;
          chip.style.top = `${pos.y}px`;
        }

        function onUp() {
          if (drag === null) return;
          drag = null;
          document.body.style.cursor = '';
          writeLayout({ ...readLayout(), collapsed, pos });
        }

        head.addEventListener('mousedown', (event) => {
          if (event.button !== 0) return;
          if (event.target instanceof Element && event.target.closest('button')) return;
          const box = panel.getBoundingClientRect();
          drag = { dx: event.clientX - box.left, dy: event.clientY - box.top };
          document.body.style.cursor = 'move';
          event.preventDefault();
        });
        window.addEventListener('mousemove', onMove);

        // 小球也能拖
        let chipDrag = null;
        let suppressChipClick = false;
        chip.addEventListener('mousedown', (event) => {
          if (collapsed !== true) return;
          const box = chip.getBoundingClientRect();
          chipDrag = { dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false };
          event.preventDefault();
        });
        window.addEventListener('mousemove', (event) => {
          if (chipDrag === null) return;
          chipDrag.moved = true;
          pos = clampPos(event.clientX - chipDrag.dx, event.clientY - chipDrag.dy, true);
          chip.style.left = `${pos.x}px`;
          chip.style.top = `${pos.y}px`;
        });
        window.addEventListener('mouseup', () => {
          if (chipDrag === null) return;
          const moved = chipDrag.moved;
          chipDrag = null;
          if (!moved) return;
          suppressChipClick = true;
          setTimeout(() => {
            suppressChipClick = false;
          }, 0);
          writeLayout({ ...readLayout(), collapsed, pos });
        });
        window.addEventListener('mouseup', onUp);

        // ---- 交互 ----
        async function patch(body) {
          try {
            sync(await api('/config', { method: 'POST', body: JSON.stringify(body) }));
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        }

        async function loadWindows() {
          const current = winSelect.value;
          try {
            const result = await api('/windows');
            const list = Array.isArray(result.titles) ? result.titles : [];
            winSelect.replaceChildren();
            const anyOption = el('option');
            anyOption.value = '';
            anyOption.textContent = '不限制';
            winSelect.append(anyOption);
            for (const name of list) {
              const option = el('option');
              option.value = name;
              option.textContent = name.length > 34 ? `${name.slice(0, 33)}…` : name;
              winSelect.append(option);
            }
            const wanted = current || lastConfig?.windowMatch || '';
            // 比大小写不敏感：窗口标题的大小写常和配置里存的不一致，
            // 精确比就会被判成「不在了」，其实窗口还在。
            const norm = (s) => String(s).trim().toLowerCase();
            const hit = list.find((t) => norm(t) === norm(wanted));
            if (wanted !== '' && !hit) {
              const option = el('option');
              option.value = wanted;
              option.textContent = `${wanted.slice(0, 28)}（不在了）`;
              winSelect.append(option);
            }
            winSelect.value = hit || wanted;
          } catch (error) {
            foot.textContent = `拿不到窗口列表：${String(error.message ?? error).slice(0, 40)}`;
          }
        }


        function renderPending(games) {
          const items = Object.values(games || {}).slice(0, 5);
          while (pendingBox.lastChild !== pendingHead) pendingBox.removeChild(pendingBox.lastChild);
          pendingBox.style.display = items.length > 0 ? 'flex' : 'none';
          for (const game of items) {
            const item = el('div', 'dsh-sense-pending-item');
            const t = el('div', 'dsh-sense-pending-title');
            t.textContent = game.title || '未知窗口';
            t.title = game.title || '';
            item.append(t);

            const input = el('input', 'dsh-sense-pending-input');
            input.type = 'text';
            input.placeholder = '这是哪个游戏？（可留空）';
            input.dataset.pendingTitle = game.title;

            const btns = el('div', 'dsh-sense-pending-btns');
            const yes = el('button');
            yes.type = 'button';
            yes.textContent = '是游戏';
            yes.addEventListener('click', () => {
              void (async () => {
                try {
                  await api('/pending-games', {
                    method: 'POST',
                    body: JSON.stringify({ title: game.title, is_game: true, game_name: input.value.trim() }),
                  });
                  foot.textContent = `记下了：${input.value.trim() || game.title}。`;
                } catch (error) {
                  foot.textContent = String(error.message ?? error);
                }
              })();
            });
            const no = el('button');
            no.type = 'button';
            no.textContent = '不是';
            no.className = 'no';
            no.addEventListener('click', () => {
              void (async () => {
                try {
                  await api('/pending-games', {
                    method: 'POST',
                    body: JSON.stringify({ title: game.title, is_game: false }),
                  });
                  foot.textContent = '好，这个不再问了。';
                } catch (error) {
                  foot.textContent = String(error.message ?? error);
                }
              })();
            });
            btns.append(yes, no);
            item.append(input, btns);
            pendingBox.append(item);
          }
        }

        let lastConfig = null;

        function sync(state) {
          const config = state?.config;
          if (config === null || typeof config !== 'object') return;
          lastConfig = config;
          autoToggle.classList.toggle('on', config.auto === true);
          dmToggle.classList.toggle('on', config.danmakuOn === true);
          hudToggle.classList.toggle('on', config.hudOn !== false);
          capToggle.classList.toggle('on', config.hudCapturable === true);
          dmCapToggle.classList.toggle('on', config.danmakuCapturable === true);
          firstRunBox.style.display = state.firstRun ? '' : 'none';
          if (state.ocrReady === true) {
            ocrLabel.textContent = '文字识别（OCR）：已安装';
            ocrBtn.style.display = 'none';
          } else if (state.ocrReady === false) {
            ocrLabel.textContent = '文字识别（OCR）：未安装';
            ocrBtn.style.display = '';
          }
          // 登录态：没选渠道就显示未登录 + 两条登录路；选了就显示渠道 + 登出
          const biliL = state.logins?.bili || {};
          const hbL = state.logins?.heybox || {};
          const biliReady = biliL.ready === true;
          const hbReady = hbL.ready === true;
          curBiliOwn = biliL.channel === 'own';
          curBiliBorrowed = biliL.channel === 'borrow';
          biliLabel.textContent = biliReady ? 'B站：已登录' : 'B站：未登录';
          biliLoginBtn.style.display = biliReady ? 'none' : '';
          biliBorrowBtn.style.display = (biliReady || biliL.canBorrow !== true) ? 'none' : '';
          biliOutBtn.style.display = biliReady ? '' : 'none';
          curHbOwn = hbL.channel === 'own';
          hbLabel.textContent = hbReady ? '小黑盒：已登录' : '小黑盒：未登录';
          hbScanBtn.style.display = hbReady ? 'none' : '';
          hbBtn.style.display = (hbReady || hbL.canBorrow !== true) ? 'none' : '';
          hbOutBtn.style.display = hbReady ? '' : 'none';
          // 玻璃 / 毛玻璃靠抓屏吃饭，截到自己会越抓越黑，这两档把开关置灰
          // （毛玻璃以前没锁，开了也不生效——helper 那边两档都强制排除）
          const capFrozen = config.hudStyle === 'glass' || config.hudStyle === 'frosted';
          capToggle.disabled = capFrozen;
          capToggle.title = capFrozen
            ? '玻璃/毛玻璃要抓屏，截到自己会越抓越黑，这两档不让开。'
            : '默认关：字幕窗不出现在你自己的截图和录屏里。\n要录屏给人看的时候打开——屏幕上怎么写，录下来就是怎么写的。\n陪看不受这条影响，它抓的是窗口自己渲染的画面，字幕窗永远进不去。';
          if (document.activeElement !== styleSelect) {
            styleSelect.value = String(config.hudStyle ?? 'dark');
          }
          if (document.activeElement !== fontSelect) {
            fontSelect.value = String(config.hudFontFamily ?? 'Microsoft YaHei');
          }
          for (const item of hudSliders) {
            const entry = hudSliderRefs[item.key];
            const v = Number(config[item.key]);
            if (Number.isFinite(v) && document.activeElement !== entry.range) {
              const shown = item.fromValue ? item.fromValue(v) : v;
              entry.range.value = String(shown);
              entry.value.textContent = item.scale(shown);
            }
          }
          // 透明度只对深色/浅色生效，玻璃/毛玻璃/透明下把它置灰，省得拖了发黑
          const opacityEntry = hudSliderRefs['hudOpacity'];
          if (opacityEntry) {
            const applyOpacity = config.hudStyle === 'dark' || config.hudStyle === 'light';
            opacityEntry.range.disabled = !applyOpacity;
          }
          // 淡出关掉时，两段时间没有意义，置灰（还是显示，不藏起来）
          const hudFadeOn = config.hudFade !== false;
          fadeToggle.classList.toggle('on', hudFadeOn);
          for (const item of hudNumFields) {
            const entry = hudNumRefs[item.key];
            const v = Number(config[item.key]);
            if (Number.isFinite(v) && document.activeElement !== entry.input) {
              entry.input.value = v.toFixed(item.digits);
            }
            entry.input.disabled = !hudFadeOn;
          }
          const HEX = /^#[0-9a-f]{6}$/i;
          if (document.activeElement !== hudColorInput) {
            hudColorInput.value = HEX.test(String(config.hudTextColor ?? '')) ? config.hudTextColor : '#eef4fb';
          }
          if (document.activeElement !== dmColorInput) {
            dmColorInput.value = HEX.test(String(config.danmakuTextColor ?? '')) ? config.danmakuTextColor : '#eaf2ff';
          }
          if (document.activeElement !== dmFontSelect && typeof config.danmakuFontFamily === 'string') {
            dmFontSelect.value = config.danmakuFontFamily;
          }
          if (document.activeElement !== dmZoneSelect && typeof config.danmakuZone === 'string') {
            dmZoneSelect.value = config.danmakuZone;
          }
          {
            const sp = Number(config.danmakuSpeed);
            if (Number.isFinite(sp) && document.activeElement !== dmSpeedRange) {
              dmSpeedRange.value = String(sp);
              dmSpeedValue.textContent = sp + ' px/s';
            }
          }
          for (const item of dmSliders) {
            const entry = dmSliderRefs[item.key];
            const v = Number(config[item.key]);
            if (Number.isFinite(v) && document.activeElement !== entry.range) {
              entry.range.value = String(v);
              entry.value.textContent = item.scale(v);
            }
          }
          const mode = config.mode ?? 'game';
          const isVideo = mode === 'video';
          showBox.style.display = isVideo ? '' : 'none';
          gameBox.style.display = isVideo ? 'none' : '';
          learnBox.style.display = isVideo ? 'none' : '';
          fetchRow.style.display = isVideo ? 'none' : '';
          autoLearnRow.style.display = isVideo ? 'none' : '';
          for (const item of MODES) modeButtons[item.id].classList.toggle('on', item.id === mode);
          modeHint.textContent = mode === 'video'
            ? '看视频用：字幕攒最近几句一起读，画面拼图看这一段在演什么。'
            : '打游戏用：看画面变化，停下来读面板上的字，攒最近一段拼图给你。';
          // 场景说明挂在每个按钮的 title 上（见上），这里不再覆盖
          if (document.activeElement !== toSelect) {
            const wanted = String(config.targetSession ?? '');
            if (toSelect.options.length === 0) void loadSessions();
            else if (toSelect.value !== wanted) toSelect.value = wanted;
          }
          // 音色只对 say.mjs 有效，SAPI / 静音时藏起来，免得看着像能用
          const backend = String(config.ttsBackend ?? 'none');
          // 语音后端在不在：查出来的结论就写一行，别让她从「没声」往回猜
          const voice = state.voice && typeof state.voice === 'object' ? state.voice : null;
          if (backend === 'none' || voice === null || voice.ok === null || voice.ok === undefined) {
            voiceHint.style.display = 'none';
          } else if (voice.ok === true) {
            voiceHint.style.display = '';
            voiceHint.style.color = '#6f86a4';
            voiceHint.textContent = '语音后端正常。';
          } else {
            voiceHint.style.display = '';
            voiceHint.style.color = '#ff9b9b';
            voiceHint.textContent = '语音这会儿出不来声：' + (String(voice.reason || '').slice(0, 120) || '后端不可用') + '。字还会出，只是没声。';
          }
          // 语音下拉以前从来没被赋过值，永远停在第一项「静音」——
          // 配置里存着 say.mjs，重启后看着却像被重置了。
          if (document.activeElement !== voiceSelect) voiceSelect.value = backend;
          toneRow.style.display = backend === 'say.mjs' ? '' : 'none';
          if (document.activeElement !== toneSelect) toneSelect.value = String(config.ttsVoice ?? '');
          if (document.activeElement !== showInput) showInput.value = String(config.currentShow ?? '');
          showMemToggle.classList.toggle('on', config.showMemory === true);
          // 走哪条路：开着是直连，关掉退成分身
          const directOn = config.directLlm !== false;
          routeToggle.classList.toggle('on', directOn);
          routeText.textContent = directOn ? '直连（省）' : '分身（慢、能翻）';
          routeNote.textContent = directOn
            ? '一次五六秒、三千字上下；没有会话，账在下面翻。'
            : '一次三十秒上下、两万字左右；DSH 界面里能翻完整对话。';
          const target = String(config.targetSession ?? '');
          toHint.textContent =
            target === ''
              ? '默认发给最近在用的那个会话。'
              : '只发给这一个；它不在了就退回「跟随当前」。';
          if (document.activeElement !== winSelect) {
            const wanted = typeof config.windowMatch === 'string' ? config.windowMatch : '';
            if (winSelect.value !== wanted) {
              if (winSelect.options.length === 0) void loadWindows();
              else winSelect.value = wanted;
            }
          }
          const picked = typeof config.windowMatch === 'string' ? config.windowMatch : '';
          winHint.textContent =
            picked === ''
              ? '整个屏幕都看。'
              : `只盯标题含「${picked.slice(0, 16)}」的窗口，图也只截那一块。`;
          if (picked !== '' && config.windowOnly !== true) {
            void patch({ windowMatch: picked, windowOnly: true });
          }
          for (const item of sliders) {
            const entry = sliderRefs[item.key];
            const value = Number(config[item.key]);
            if (Number.isFinite(value) && document.activeElement !== entry.range && document.activeElement !== entry.value) {
              const shown = item.fromValue ? item.fromValue(value) : value;
              entry.range.value = String(shown);
              entry.value.value = String(shown);
            }
          }
          if (document.activeElement !== personaInput) {
            personaInput.value = typeof config.personaHint === 'string' ? config.personaHint : '';
          }
          dot.classList.toggle('on', config.auto === true && state.helper === 'running');
          const parts = [state.helper === 'running' ? '正在看屏幕' : '屏幕那边没启动'];
          if (typeof state.recentReactions === 'number') {
            const left = Number(state.leftThisHour);
            // 剩多少要一眼看得见：快用完的时候它自己会放慢，别再让人靠猜
            const tail = Number.isFinite(left) ? `，还剩 ${left} 次` : '';
            parts.push(`这一小时开口 ${state.recentReactions} 次${tail}`);
            if (Number.isFinite(left) && left <= 0) {
              foot.style.color = '#e0a33a';
            } else if (Number.isFinite(left) && left <= 3) {
              foot.style.color = '#e0a33a';
            } else {
              foot.style.color = '';
            }
          }
          // 最近一次花了多少，平铺在状态行上，不用点开
          if (Array.isArray(state.looks) && state.looks.length > 0) {
            const last = state.looks[0];
            const u = last.usage ?? null;
            if (u !== null && typeof u === 'object') {
              parts.push(`上次 ${Number(u.inputTokens ?? 0)}→${Number(u.outputTokens ?? 0)} 字`);
            }
            const ms = Number(last.ms);
            if (last.route === 'direct' && Number.isFinite(ms)) parts.push(`直连 ${(ms / 1000).toFixed(1)} 秒`);
          }
          if (state.lastError) parts.push(`报错：${String(state.lastError).slice(0, 40)}`);
          foot.textContent = parts.join(' · ');
          // 最近几次陪看：改成直调以后没有会话可翻，账只能在这儿看
          if (Array.isArray(state.looks)) {
            // 面板每 15 秒拉一次状态、整份列表重建一遍，展开着的 <details> 会被收起来——
            // 看到一半忽然合上，像被人点了一下。重建前先记下哪些是展开的，建完还原。
            const openKeys = new Set();
            for (const d of lookList.querySelectorAll('details[data-k]')) {
              if (d.open) openKeys.add(d.dataset.k);
            }
            lookList.textContent = '';
            if (state.looks.length === 0) {
              const empty = el('div', 'dsh-sense-note');
              empty.textContent = '还没有记录。';
              lookList.append(empty);
            }
            // 按「这次陪看」分组：开关开一次 = 一组，这一整段的调用全搁在里头。
            // 开着玩一小时想看这一段花了多少，直接看那一行，不用自己数次数。
            // 后端已按 LOOKS_SHOW 截好条数，这里别再截一次 ——
            // 两处各截 40 的时候，一局自己就占满 40 条，上一局永远显不出来。
            const items = state.looks;
            const groups = [];
            for (const it of items) {
              const key = Number(it.run) || 0;
              const last = groups[groups.length - 1];
              if (last && last.key === key) last.items.push(it);
              else groups.push({ key, items: [it] });
            }
            const renderOne = (item) => {
              const det = el('details');
              // 重建时靠这个找回「本来是展开的」那几条
              det.dataset.k = 'i' + String(item.at ?? '');
              const sum = el('summary', 'dsh-sense-note');
              const u = item.usage ?? null;
              // 带日期：翻旧记录时不会把昨天的和今天的看成同一段
              const dd = new Date(item.at);
              const when = `${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')} ${dd.toLocaleTimeString('zh-CN', { hour12: false })}`;
              const ms = Number(item.ms);
              const took = Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} 秒` : '?';
              // 跟 DSH 会话里那张「Token 用量」卡对齐：总量、缓存命中率、四项分项，
              // 直调没有会话可看，只能在这儿照一张出来。
              let head = `${when} · ${item.route === 'direct' ? '直连' : '分身'} · ${took} · 没记账`;
              let detail = '';
              if (u !== null && typeof u === 'object') {
                const inp = Number(u.inputTokens ?? 0);
                const out = Number(u.outputTokens ?? 0);
                const read = Number(u.cacheReadTokens ?? 0);
                const total = Number.isFinite(Number(u.totalTokens)) && u.totalTokens !== null
                  ? Number(u.totalTokens)
                  : inp + out;
                const rate = inp > 0 ? Math.round((read / inp) * 100) : 0;
                // 直调这条路根本没有缓存可用，写「命中 0%」会被读成「缓存浪费了」。
                // 只有真的读到缓存才提命中率；没读到就干脆不说。
                // 分项直接摆在行上：算钱就是拿这三个数乘各自的价，不用点开找
                head = `${when} · ${item.route === 'direct' ? '直连' : '分身'} · ${took} · 输入 ${(inp - read).toLocaleString()} · 缓存 ${read.toLocaleString()} · 输出 ${out.toLocaleString()}`;
                detail = `\n合计 ${total.toLocaleString()} 字${read > 0 ? ` · 缓存命中 ${rate}%` : ''}`;
              }
              sum.textContent = head;
              const headText = String(item.promptHead ?? '');
              const pre = el('pre');
              pre.style.whiteSpace = 'pre-wrap';
              pre.style.wordBreak = 'break-word';
              pre.style.fontSize = '11px';
              pre.style.opacity = '0.82';
              pre.style.margin = '4px 0 8px';
              const cut = Number(item.promptChars ?? 0) > headText.length ? '…（后面还有）' : '';
              pre.textContent = `${detail ? `【用量】${detail}\n\n` : ''}【发给模型的】\n${headText || '（没记）'}${cut}\n\n【它说的】\n${String(item.said || '（没说）')}`;
              det.append(sum, pre);
              return det;
            };
            // 时间带上日期：翻到昨天、前天的时候不会看混
            const fmtWhen = (d) => {
              const dt = new Date(d);
              return `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
                + ` ${dt.toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)}`;
            };
            for (const g of groups) {
              // 分段小计：这一段自己花了多少，四项分开报，只报原始用量
              let gTok = 0;
              let gMs = 0;
              let gN = 0;
              let gIn = 0;
              let gCache = 0;
              let gOut = 0;
              for (const it of g.items) {
                const uu = it.usage;
                if (!uu || typeof uu !== 'object') continue;
                const ii = Number(uu.inputTokens ?? 0);
                const cc = Number(uu.cacheReadTokens ?? 0);
                const oo = Number(uu.outputTokens ?? 0);
                gTok += Number.isFinite(Number(uu.totalTokens)) && uu.totalTokens !== null ? Number(uu.totalTokens) : ii + oo;
                gIn += Math.max(0, ii - cc);
                gCache += cc;
                gOut += oo;
                gMs += Number(it.ms ?? 0);
                gN += 1;
              }
              const box = el('details', 'dsh-sense-rungroup');
              box.dataset.k = 'g' + String(g.key ?? '');
              const gh = el('summary', 'dsh-sense-grouphead');
              // run 是打开陪看的时刻，组里第一条是最新那次，正好当这一段的收尾
              const sTxt = fmtWhen(g.key);
              const eTxt = fmtWhen(g.items[0].at);
              const span = g.key > 0
                ? (sTxt.slice(0, 5) === eTxt.slice(0, 5) ? `${sTxt}–${eTxt.slice(6)}` : `${sTxt}–${eTxt}`)
                : '更早（那会儿还没按陪看分段）';
              const bits = [`${span} · ${g.items.length} 次`];
              if (gN > 0) {
                bits.push(`合计 ${gTok.toLocaleString()} tok`);
                bits.push(`未缓存输入 ${gIn.toLocaleString()}`);
                bits.push(`缓存读取 ${gCache.toLocaleString()}`);
                bits.push(`输出 ${gOut.toLocaleString()}`);
                bits.push(`平均 ${Math.round(gMs / gN / 100) / 10} 秒`);
              }
              gh.textContent = bits.join(' · ');
              box.append(gh);
              for (const item of g.items) box.append(renderOne(item));
              lookList.append(box);
            }
            if (openKeys.size > 0) {
              for (const d of lookList.querySelectorAll('details[data-k]')) {
                if (openKeys.has(d.dataset.k)) d.open = true;
              }
            }
          }
          if (state.pendingGames && typeof state.pendingGames === 'object') {
            renderPending(state.pendingGames);
          }
          // 认出什么游戏：让人一眼看出它是有资料还是瞎猜
          const game = state.lastGame;
          if (game && typeof game === 'object' && typeof game.game === 'string' && game.game.trim() !== '') {
            const genres = Array.isArray(game.genres) && game.genres.length > 0 ? `（${game.genres.join('、')}）` : '';
            gameHead.textContent = `认出来了：${game.game}${genres}`;
            gameHead.style.color = '#8fd0ff';
            // 顺手把认出的游戏名填进「学黑话」的游戏框，省得手动输
            if (learnGameInput.value.trim() === '') learnGameInput.value = game.game;
          } else {
            gameHead.textContent = '还没看到正在玩什么';
            gameHead.style.color = '';
          }
          // 刚学到的新游戏：显示在识别行下面，让人看见「自动查资料」真的发生了
          const learned = state.lastLearned;
          if (learned && typeof learned === 'object' && typeof learned.game === 'string' && learned.game.trim() !== '') {
            const g2 = Array.isArray(learned.genres) && learned.genres.length > 0 ? `（${learned.genres.join('、')}）` : '';
            learnedLine.textContent = `刚学到：${learned.game}${g2}，下次就认得了`;
            learnedLine.style.display = '';
          } else {
            learnedLine.style.display = 'none';
          }
          fetchToggle.classList.toggle('on', config.gameAutoFetch !== false);
          autoLearnToggle.classList.toggle('on', config.autoLearn === true);
        }

        async function refresh() {
          try {
            sync(await api('/state'));
          } catch (error) {
            foot.textContent = `连不上 Host：${String(error.message ?? error).slice(0, 40)}`;
          }
        }

        // ---- 开关 / 折叠 ----
        autoToggle.addEventListener('click', async () => {
          const next = !autoToggle.classList.contains('on');
          autoToggle.classList.toggle('on', next);
          try {
            const state = await api('/config', { method: 'POST', body: JSON.stringify({ auto: next }) });
            sync(state);
            foot.textContent = next ? '自动陪看开了，我看着。' : '自动陪看关了，想聊就点我。';
          } catch (error) {
            foot.textContent = String(error.message ?? error);
          }
        });

        function applyCollapsed() {
          panel.style.display = collapsed ? 'none' : 'flex';
          chip.style.display = collapsed ? 'block' : 'none';
        }

        collapse.addEventListener('click', () => {
          collapsed = true;
          writeLayout({ ...readLayout(), collapsed, pos });
          applyCollapsed();
          applyPos();
        });
        chip.addEventListener('click', () => {
          if (suppressChipClick) return;
          collapsed = false;
          writeLayout({ ...readLayout(), collapsed, pos });
          applyCollapsed();
          applyPos();
          void refresh();
        });

        applyCollapsed();
        applyPos();
        void refresh();
        void loadWindows();
        // 面板得跟屏幕上发生的事同步：在字幕窗/弹幕上点 ×，那边一秒内就该翻回「关」。
        // 原来十五秒一轮，点了叉面板还亮着「开」，等得人以为没关掉。这里改成
        // 一秒二一轮；面板收起来、或者页面切到后台时不轮，省得白跑。
        const timer = setInterval(() => {
          if (collapsed || document.hidden) return;
          void refresh();
        }, 1200);
        if (typeof timer.unref === 'function') timer.unref();
        const onVisible = () => {
          if (!document.hidden) void refresh();
        };
        document.addEventListener('visibilitychange', onVisible);

        const onResize = () => {
          pos = clampPos(pos.x, pos.y);
          applyPos();
        };
        window.addEventListener('resize', onResize);

        return () => {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('resize', onResize);
          style.remove();
          panel.remove();
          chip.remove();
        };
      },
    };
  },
});
