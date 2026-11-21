/**
 * 分段记忆的判据和提示词：只测 lib/segment-rules.js 这些纯函数。
 * 这些是「档案写不写、写什么」的门口，改坏了不报错，只是档案悄悄变空。
 */
import {
  SEG_MIN_LINES, SEG_MIN_SUB_ROWS, SEG_MIN_SUB_CHARS,
  segmentWorthArchiving, buildSegmentPrompt, subtitleText, subtitleStats,
} from '../lib/segment-rules.js';

const ok = [];
const bad = [];
function check(name, cond, extra = '') {
  (cond ? ok : bad).push(`${name}${extra ? ' → ' + extra : ''}`);
}

const line = (t) => ({ at: Date.now(), text: t });

// ---- 门槛 ----
check('门槛已降到 2', SEG_MIN_LINES === 2, String(SEG_MIN_LINES));
check('两句就收', segmentWorthArchiving([line('甲'), line('乙')], []));
check('一句 + 没台词 不收', !segmentWorthArchiving([line('甲')], []));
check('零句 + 没台词 不收', !segmentWorthArchiving([], []));
check('一句 + 台词够 收', segmentWorthArchiving([line('甲')], ['第一句台词在这里', '第二句台词也在', '第三句台词还在']));
check('零句 + 台词够 收（它整段没开口也能写）', segmentWorthArchiving([], ['今天天气真不错啊', '我们要不要去海边', '那就这么定了']));
check('台词行数不够 不收', !segmentWorthArchiving([], ['嗯', '啊']));
check('行数够但字太少 不收', !segmentWorthArchiving([], ['嗯', '啊', '哦']));
check('空串/空白不算台词', !segmentWorthArchiving([], ['   ', '', '\n']));
check('一句短台词 + 两句长台词 收', segmentWorthArchiving([], ['你回来了', '我在等你一起吃饭', '菜都快凉了快坐']));

// ---- 台词统计 ----
const st = subtitleStats([' 甲 ', '', '乙']);
check('统计去空去空白', st.rows === 2 && st.chars === 2, JSON.stringify(st));
check('字幕文本去空行', subtitleText([' 甲 ', '', '乙']) === '甲\n乙', JSON.stringify(subtitleText([' 甲 ', '', '乙'])));

// ---- 提示词：它开过口 ----
const spoken = buildSegmentPrompt({ said: ['甲', '乙'], subtitles: ['台词一', '台词二', '台词三'] });
check('开过口时用「它说过的话」那套', spoken.includes('陆续说过的几句话'), spoken.slice(0, 40));
check('开过口时带台词', spoken.includes('台词一') && spoken.includes('台词（机器识别'), '');
check('开过口时不带「没怎么开口」那套', !spoken.includes('没怎么开口'));

// ---- 提示词：它没开口 ----
const silent = buildSegmentPrompt({ said: [], subtitles: ['伍堂部长特意推荐', '我觉得可以', '那我们就这么办'] });
check('没开口时明确说只有台词', silent.includes('没怎么开口'), silent.slice(0, 40));
check('没开口时带台词', silent.includes('伍堂部长特意推荐'));
check('没开口时要求不许猜', silent.includes('不要猜'), '');
check('没开口时不出现空的「它说的话」段', !silent.includes('陆续说过的几句话'));

// ---- 提示词：一句口都没有也不该崩 ----
const empty = buildSegmentPrompt({ said: [], subtitles: [] });
check('全空的提示词不崩且不含空台词块', typeof empty === 'string' && !empty.includes('台词（机器识别'), JSON.stringify(empty.slice(0, 30)));

// ---- 长台词截断 ----
const many = Array.from({ length: 200 }, (_, i) => `第${i}行台词`);
const longPrompt = buildSegmentPrompt({ said: [], subtitles: many });
check('台词只带最后 80 行', longPrompt.includes('第199行台词') && !longPrompt.includes('第0行台词'));
check('提示词长度有上限', longPrompt.length < 2400, String(longPrompt.length));

// ---- 门槛常量自洽 ----
check('台词门槛常量对得上', SEG_MIN_SUB_ROWS === 3 && SEG_MIN_SUB_CHARS === 12, `${SEG_MIN_SUB_ROWS}/${SEG_MIN_SUB_CHARS}`);

console.log(`通过 ${ok.length} 项`);
for (const l of ok) console.log('  PASS  ' + l);
if (bad.length) {
  console.log(`\n失败 ${bad.length} 项`);
  for (const l of bad) console.log('  FAIL  ' + l);
  process.exit(1);
}
