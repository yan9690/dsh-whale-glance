/**
 * 分段记忆的两样东西：什么算「值得收一段」，以及收段时给模型的提示词。
 *
 * 单独一份是为了能直接单测——整套 `lib/index.js` 要跑起来得有 DSH 的 ctx，
 * 这些判据没法在测试里单独验。逻辑本身不带副作用。
 */

// 说过几句才算一段。原来是 3，看她 11-22 那场只说了两句、整段被丢之后改成 2。
export const SEG_MIN_LINES = 2;
// 它一句没说、只有台词时，台词至少几行、几个字才值得总结。
// 太短的一行「啊？」总结不出东西，写出来只会是噪声。
// 字数门槛定在 12：三行短台词也算一段（动画台词常常一句十个字上下），
// 主门槛是行数，字数只是挡住「嗯」「啊」堆出来的空段。
export const SEG_MIN_SUB_ROWS = 3;
export const SEG_MIN_SUB_CHARS = 12;
// 台词最多带多少行给模型（原样保留原来的上限）。
const SUB_MAX_ROWS = 80;
const SUB_MAX_CHARS = 1200;

export function subtitleText(subtitles) {
  return (Array.isArray(subtitles) ? subtitles : [])
    .map((s) => String(s ?? '').trim())
    .filter((s) => s !== '')
    .slice(-SUB_MAX_ROWS)
    .join('\n')
    .slice(0, SUB_MAX_CHARS);
}

export function subtitleStats(subtitles) {
  const rows = (Array.isArray(subtitles) ? subtitles : [])
    .map((s) => String(s ?? '').trim())
    .filter((s) => s !== '');
  const chars = rows.join('').replace(/\s+/g, '').length;
  return { rows: rows.length, chars };
}

/**
 * 这一段值不值得写进档案。
 * 有两句以上它自己的话就收；没怎么开口时，台词够多也收——不然整个看剧过程它不说话，
 * 档案就永远是空白的（11-22 06:00 那场《可塑性记忆》就是这样）。
 */
export function segmentWorthArchiving(lines, subtitles) {
  const said = (Array.isArray(lines) ? lines : [])
    .map((l) => String(l?.text ?? '').trim())
    .filter((s) => s !== '');
  if (said.length >= SEG_MIN_LINES) return true;
  const { rows, chars } = subtitleStats(subtitles);
  return rows >= SEG_MIN_SUB_ROWS && chars >= SEG_MIN_SUB_CHARS;
}

/**
 * 收段的提示词。
 * 它开过口时，用它的话 + 台词互相校正（它常认错画面，台词是字更可靠）；
 * 它没开口时，只用台词，而且要求更紧——只写台词能确定的东西，别猜。
 */
export function buildSegmentPrompt({ said, subtitles }) {
  const spoken = (Array.isArray(said) ? said : [])
    .map((s) => String(s ?? '').trim())
    .filter((s) => s !== '');
  const subs = subtitleText(subtitles);
  const subBlock = subs !== '' ? [`台词（机器识别，可能有错字）：\n${subs}`, ''] : [];
  if (spoken.length >= SEG_MIN_LINES) {
    return [
      '下面是它陪看一段视频时陆续说过的几句话，还有同一段屏幕上读到的台词。',
      '用这两样，把这一段里能确定的东西写成两三句中文：发生了什么、谁和谁、留下了什么关键设定或包袱。',
      '它的话是当场对着画面猜的，可能有认错的地方：台词能对上的按台词写，对不上的宁可不写。',
      '不要观后感，不要评价画面，不要补没看到的情节。只输出那几句话本身，不要序号和标题。',
      '',
      ...subBlock,
      spoken.slice(-40).join('\n'),
    ].join('\n');
  }
  return [
    '这一段它没怎么开口，只有屏幕上读到的台词。',
    '只用台词里能确定的东西写一两句中文：谁在跟谁说话、说了什么要紧的事、留下什么明确信息。',
    '台词是机器识别的，可能有错字、可能断句不对：认不准的地方宁可不写，不要猜、不要补情节。',
    '不要观后感，不要评价画面。只输出那一两句本身，不要序号和标题。',
    '',
    ...subBlock,
    ...(spoken.length > 0 ? [`它顺口说的（很少，可能有认错的地方）：\n${spoken.slice(-5).join('\n')}`] : []),
  ].join('\n').trim();
}
