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
  width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center; padding: 0;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(16,29,48,.97), rgba(9,16,28,.97));
  border: 1px solid rgba(120,180,255,.28); color: #cfe2ff; font-size: 18px;
  box-shadow: 0 8px 24px rgba(0,0,0,.42); -webkit-app-region: no-drag;
}
.dsh-sense-chip:hover { background: rgba(70,120,190,.5); }
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
        styleSummary.textContent = '字幕窗样式（配色 / 字体 / 字号 / 透明度）';
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
          { key: 'silentMax', label: '强制开口时间', unit: '秒', min: 10, max: 3600, step: 1 },
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
        routeToggle.title = '开：自己直接调模型，一次五六秒、三千 token 上下，但没有会话可以翻。\n关：起一个子会话，慢一些（三十秒上下）也贵一些（一次两万），但 DSH 界面里能看到完整对话和 Token 卡片。';
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
        lookHead.title = '它每次收到了什么、说了什么、用了多少 token，都记在这儿。点标题展开。';
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

        // 记下这一集：档案唯一的写入口。后端只会往档案里写，不会自己长出来。
        // 番名不写死——留空就退回上面「正在看哪部」填的那部。
        const showSaveName = el('input', 'dsh-sense-sel');
        showSaveName.type = 'text';
        showSaveName.placeholder = '番名（留空就用上面「正在看哪部」）';
        showSaveName.title = '这次记到哪部番下面。留空就用上面「正在看哪部」填的那部；两处都空会报错，不瞎猜。';
        const showSaveEpisode = el('input', 'dsh-sense-sel');
        showSaveEpisode.type = 'text';
        showSaveEpisode.placeholder = '集数，比如 第2集（可空）';
        const showSaveSummary = el('textarea', 'dsh-sense-sel');
        showSaveSummary.rows = 3;
        showSaveSummary.placeholder = '这一集讲了什么：人物、关系、伏笔、关键设定。写事实，别写观后感。';
        showSaveSummary.style.width = '100%';
        showSaveSummary.style.resize = 'vertical';
        const showSaveBtn = el('button', 'dsh-sense-look');
        showSaveBtn.type = 'button';
        showSaveBtn.textContent = '记下这一集';
        showSaveBtn.title = '写进番剧档案；下一集陪看时它会读这些前情。';
        const showSaveHint = el('div', 'dsh-sense-advline');
        showSaveHint.style.color = '#8fd0ff';
        showSaveHint.style.minHeight = '16px';
        showSaveBtn.addEventListener('click', async () => {
          const name = showSaveName.value.trim() || showInput.value.trim();
          const episode = showSaveEpisode.value.trim();
          const summary = showSaveSummary.value.trim();
          if (summary === '') {
            showSaveHint.style.color = '#e0a33a';
            showSaveHint.textContent = '这一集讲了什么不能空。';
            return;
          }
          showSaveBtn.disabled = true;
          showSaveBtn.textContent = '记…';
          try {
            const result = await api('/save-show', {
              method: 'POST',
              body: JSON.stringify({ name, episode, summary }),
            });
            showSaveHint.style.color = '#8fd0ff';
            showSaveHint.textContent = `已记下《${result.name || name}》${episode ? ' ' + episode : ''}`;
            showSaveSummary.value = '';
            showSaveEpisode.value = '';
            // 写完立刻翻一遍档案：番名/集数写错要当场看见
            await loadShowList();
          } catch (error) {
            showSaveHint.style.color = '#e0a33a';
            showSaveHint.textContent = String(error && error.message ? error.message : error);
          } finally {
            showSaveBtn.disabled = false;
            showSaveBtn.textContent = '记下这一集';
          }
        });
        showBox.append(showSaveName, showSaveEpisode, showSaveSummary, showSaveBtn, showSaveHint);
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
        firstRunBox.textContent = '第一次用？三步：① 打开「陪我看」开关；② 点「装认字功能」（读屏幕上的字更准，可选）；③ 点「初始化口癖」。语音开机自动配，不用管。';
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
          // 语音下拉以前从来没被赋过值，永远停在第一项「静音」——
          // 配置里存着 say.mjs，重启后看着却像被重置了。
          if (document.activeElement !== voiceSelect) voiceSelect.value = backend;
          toneRow.style.display = backend === 'say.mjs' ? '' : 'none';
          if (document.activeElement !== toneSelect) toneSelect.value = String(config.ttsVoice ?? '');
          if (document.activeElement !== showInput) showInput.value = String(config.currentShow ?? '');
          // 记档的番名框：只在空着、且没在输入时跟上「正在看哪部」。
          // 不覆盖手打的番名，也不在刷新时把已填内容清掉。
          if (document.activeElement !== showSaveName && showSaveName.value.trim() === '') {
            showSaveName.value = String(config.currentShow ?? '');
          }
          showMemToggle.classList.toggle('on', config.showMemory === true);
          // 走哪条路：开着是直调，关掉退子会话
          const directOn = config.directLlm !== false;
          routeToggle.classList.toggle('on', directOn);
          routeText.textContent = directOn ? '直调（快、省）' : '子会话（慢、能翻）';
          routeNote.textContent = directOn
            ? '一次五六秒、三千 token 上下；没有会话，账在下面翻。'
            : '一次三十秒上下、两万 token 左右；DSH 界面里能翻完整对话。';
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
              parts.push(`上次 ${Number(u.inputTokens ?? 0)}→${Number(u.outputTokens ?? 0)} token`);
            }
            const ms = Number(last.ms);
            if (last.route === 'direct' && Number.isFinite(ms)) parts.push(`直调 ${(ms / 1000).toFixed(1)} 秒`);
          }
          if (state.lastError) parts.push(`报错：${String(state.lastError).slice(0, 40)}`);
          foot.textContent = parts.join(' · ');
          // 最近几次陪看：改成直调以后没有会话可翻，账只能在这儿看
          if (Array.isArray(state.looks)) {
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
              const sum = el('summary', 'dsh-sense-note');
              const u = item.usage ?? null;
              // 带日期：翻旧记录时不会把昨天的和今天的看成同一段
              const dd = new Date(item.at);
              const when = `${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')} ${dd.toLocaleTimeString('zh-CN', { hour12: false })}`;
              const ms = Number(item.ms);
              const took = Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} 秒` : '?';
              // 跟 DSH 会话里那张「Token 用量」卡对齐：总量、缓存命中率、四项分项，
              // 直调没有会话可看，只能在这儿照一张出来。
              let head = `${when} · ${item.route === 'direct' ? '直调' : '子代理'} · ${took} · 没记账`;
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
                head = `${when} · ${item.route === 'direct' ? '直调' : '子代理'} · ${took} · 输入 ${(inp - read).toLocaleString()} · 缓存 ${read.toLocaleString()} · 输出 ${out.toLocaleString()}`;
                detail = `\n合计 ${total.toLocaleString()} tok${read > 0 ? ` · 缓存命中 ${rate}%` : ''}`;
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
        const timer = setInterval(refresh, 15000);
        if (typeof timer.unref === 'function') timer.unref();

        const onResize = () => {
          pos = clampPos(pos.x, pos.y);
          applyPos();
        };
        window.addEventListener('resize', onResize);

        return () => {
          clearInterval(timer);
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
