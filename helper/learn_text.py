"""把用户粘进来的东西洗成干净的原文。

做三件事：
1. 还原 JSON 转义（从网页/接口抠出来的正文常带 \\u003c 这类）。
2. 有 HTML 就去标签、收图片地址、压空白。
3. 把帖子里的图下载下来，用本地 RapidOCR 读字拼回去（干货长图靠这个）。

用法：python learn_text.py [图片时间预算秒数] < 原始文本
输出：清洗后的纯文本（图里的字写成「【图里的字】…」单独一段）。
读不出字的图（表情、图标）自然被丢掉——不过滤尺寸，梗图带字照样能读到。
"""
import io
import re
import sys
import time
import urllib.request

BUDGET = float(sys.argv[1]) if len(sys.argv) > 1 else 90.0


def unescape_json(s):
    return (s.replace('\\u003c', '<').replace('\\u003e', '>')
             .replace('\\u0026', '&').replace('\\u002f', '/')
             .replace('\\n', '\n').replace('\\"', '"'))


def strip_html(s):
    imgs = re.findall(r'<img[^>]*?(?:data-original|src)\s*=\s*"([^"]+)"', s, flags=re.I)
    text = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', s, flags=re.I | re.S)
    text = re.sub(r'<[^>]+>', '\n', text)
    for k, v in (('&nbsp;', ' '), ('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
                 ('&quot;', '"'), ('&#39;', "'"), ('&ldquo;', '"'), ('&rdquo;', '"')):
        text = text.replace(k, v)
    lines = [ln.strip() for ln in text.splitlines()]
    return '\n'.join([ln for ln in lines if ln]), imgs


def ocr_urls(urls, budget):
    if not urls:
        return []
    try:
        import numpy as np
        from PIL import Image
        from rapidocr_onnxruntime import RapidOCR
    except Exception:
        return []
    engine = RapidOCR()
    t0 = time.time()
    got = []
    for u in urls:
        if time.time() - t0 > budget:
            break
        if not re.match(r'https?://', u):
            continue
        try:
            req = urllib.request.Request(u, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://www.xiaoheihe.cn/',
            })
            data = urllib.request.urlopen(req, timeout=8).read()
            if len(data) < 2000:
                continue
            img = Image.open(io.BytesIO(data)).convert('RGB')
            if img.width < 200 or img.height < 100:
                continue
            res, _ = engine(np.asarray(img))
            words = []
            for _box, t, s in (res or []):
                t = (t or '').strip()
                if len(t) >= 2 and float(s) >= 0.5:
                    words.append(t)
            if words:
                got.append(' '.join(words))
        except Exception:
            continue
    return got


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        print('')
        return
    s = unescape_json(raw)
    if re.search(r'<[a-zA-Z]', s):
        text, imgs = strip_html(s)
    else:
        text, imgs = re.sub(r'\n{3,}', '\n\n', s).strip(), []
    pics = ocr_urls(imgs, BUDGET)
    parts = [text] if text else []
    for p in pics:
        parts.append('【图里的字】' + p)
    print('\n'.join(parts))


if __name__ == '__main__':
    main()
