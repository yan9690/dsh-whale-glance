"""余光弹幕：读字幕文件，每有新的一句，从右往左飘过去。透明、不挡点击。

用法：
    python danmaku.py <字幕文件路径> [config.json 路径]

- 独立窗口横跨整屏，文字在三条轨道上从右往左飘（位置/字号/字体/速度都读 config）。
- 透明色键 + WS_EX_TRANSPARENT：看得见、点不中，不挡游戏操作。
"""
import json
import os
import random
import sys
import time
import tkinter as tk
import tkinter.font as tkfont

KEY = "#010203"
GWL_EXSTYLE = -20
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000

HUD = sys.argv[1] if len(sys.argv) > 1 else ""
CONFIG = sys.argv[2] if len(sys.argv) > 2 else ""

DEFAULTS = {
    "danmakuFontSize": 16,
    "danmakuFontFamily": "Microsoft YaHei UI",
    "danmakuZone": "upper",
    "danmakuSpeedLevel": "normal",
    "danmakuSpeed": 220,          # 拉条的数值速度（像素/秒）；不在 DEFAULTS 里 read_config 会把它过滤掉
    "danmakuTextColor": "#eaf2ff",
    "danmakuCapturable": False,
}
LANE_H = 42         # 单轨高度
TICK_MS = 33        # 30fps

# 区域（跟 B 站一样按屏幕划分）：起点比例 + 轨道数
ZONES = {
    "top": (0.02, 3),
    "upper": (0.16, 3),
    "middle": (0.40, 3),
    "lower": (0.64, 3),
    "bottom": (0.84, 2),
    "full": (0.03, 9),
}
SPEEDS = {"extremelySlow": 50, "verySlow": 90, "slow": 150, "normal": 220, "fast": 320, "veryFast": 460, "extremelyFast": 650}


def outline_color(c):
    """描边颜色随主字亮度连续过渡：暗字浅灰边、亮字深灰边，过中线不会黑白闪跳。"""
    s = (c or "").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    try:
        r, g, b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except Exception:
        return "#000000"
    lum = r * 0.299 + g * 0.587 + b * 0.114
    t = max(0.0, min(1.0, lum / 255.0))
    edge = int(round(235 - 210 * t))
    return "#%02x%02x%02x" % (edge, edge, edge)


def read_hud():
    try:
        with open(HUD, encoding="utf-8") as f:
            return f.read().strip().split("\n")
    except Exception:
        return []


def read_config():
    cfg = dict(DEFAULTS)
    if not CONFIG:
        return cfg
    try:
        with open(CONFIG, encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            cfg.update({k: raw[k] for k in DEFAULTS if k in raw})
    except Exception:
        pass
    return cfg


def click_through(root):
    try:
        import ctypes

        u32 = ctypes.windll.user32
        hwnd = u32.GetAncestor(root.winfo_id(), 2) or root.winfo_id()
        style = u32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        style |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
        u32.SetWindowLongW(hwnd, GWL_EXSTYLE, style)
    except Exception:
        pass


def main():
    root = tk.Tk()
    root.overrideredirect(True)
    root.attributes("-topmost", True)
    root.attributes("-transparentcolor", KEY)
    root.configure(bg=KEY)
    sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
    root.geometry("%dx%d+0+0" % (sw, sh))
    root.update_idletasks()
    click_through(root)
    cfg = read_config()
    # 弹幕要不要被「人自己」的截图/录屏拍到。默认关（拍不到），演示时打开。
    # 陪看那边是向窗口要它自己渲染的画面，跟这条无关——弹幕永远进不了陪看的图。
    try:
        import ctypes

        hwnd = ctypes.windll.user32.GetAncestor(root.winfo_id(), 2) or root.winfo_id()
        hide = cfg.get("danmakuCapturable") is not True
        ctypes.windll.user32.SetWindowDisplayAffinity(hwnd, 0x00000011 if hide else 0)
    except Exception:
        pass

    cv = tk.Canvas(root, bg=KEY, highlightthickness=0, bd=0)
    cv.pack(fill="both", expand=True)
    # 待喷的句子队列。一次只放一条，跟朗读节奏走，不要一口气全吐。
    pending = []
    next_spawn_at = 0.0
    style = {
        "family": str(cfg.get("danmakuFontFamily") or DEFAULTS["danmakuFontFamily"]),
        "size": int(cfg.get("danmakuFontSize") or DEFAULTS["danmakuFontSize"]),
        "zone": str(cfg.get("danmakuZone") or DEFAULTS["danmakuZone"]),
        "speedLevel": str(cfg.get("danmakuSpeedLevel") or DEFAULTS["danmakuSpeedLevel"]),
        "speed": float(cfg.get("danmakuSpeed") or 0) or None,
        "color": str(cfg.get("danmakuTextColor") or DEFAULTS["danmakuTextColor"]),
    }

    def make_lanes():
        zone = style["zone"] if style["zone"] in ZONES else "upper"
        top_ratio, count = ZONES[zone]
        top = int(sh * top_ratio)
        gap = style["size"] + max(8, LANE_H - style["size"])
        return [top + i * gap for i in range(count)]

    lanes = make_lanes()
    busy = [0.0] * len(lanes)
    items = []   # [canvas_id, x, y, width, lane_index]
    seen = set()
    # 启动时先把字幕里现成的那句记下来，别一开就把它飘一遍
    _first = read_hud()
    if _first:
        _last = _first[-1].strip()
        if _last:
            seen.add(_last)
    cfg_mtime = [0.0]

    def pick_y(size):
        """在弹幕区里挑一个 y：随机，但避开正在飘的那些（免得两条叠一起）。"""
        lo, hi = lanes[0], lanes[-1]
        for _ in range(8):
            y = random.randint(lo, hi)
            clash = False
            for it in items:
                if abs(it[2] - y) < size + 8:
                    clash = True
                    break
            if not clash:
                return y
        return random.randint(lo, hi)

    def spawn(text):
        family = style["family"]
        size = style["size"]
        for i, right in enumerate(busy):
            if right < sw - 60:
                w = tkfont.Font(family=family, size=size, weight="bold").measure(text)
                x0 = sw + w // 2
                # y 用这一条轨道自己的位置，不要再随机。
                # 以前 busy[i] 判断「第 i 条道空了」，y 却另去 pick_y 随机取，
                # 结果是这条道明明空着，弹幕却飘到别人道上，几条叠在一起。
                y0 = lanes[i]
                # 黑字垫偏 2px 当描边，主字压上面——背景再花也认得出
                # 描边四方向各一层（各偏 1px），不会显得整句往一边偏
                offs = ((-1, 0), (1, 0), (0, -1), (0, 1))
                shadow_ids = [
                    cv.create_text(x0 + dx, y0 + dy, text=text,
                                   font=(family, size, "bold"),
                                   fill=outline_color(style["color"]), anchor="center")
                    for dx, dy in offs
                ]
                item_id = cv.create_text(x0, y0, text=text,
                                         font=(family, size, "bold"), fill=style["color"], anchor="center")
                items.append([item_id, x0, y0, w, i, shadow_ids, offs])
                busy[i] = sw
                return

    def tick():
        # config 变了就重读（字号/字体/位置/速度实时生效）
        try:
            mt = os.path.getmtime(CONFIG) if CONFIG else 0.0
        except OSError:
            mt = 0.0
        if mt != cfg_mtime[0]:
            cfg_mtime[0] = mt
            new_cfg = read_config()
            style["family"] = str(new_cfg.get("danmakuFontFamily") or DEFAULTS["danmakuFontFamily"])
            style["size"] = int(new_cfg.get("danmakuFontSize") or DEFAULTS["danmakuFontSize"])
            style["zone"] = str(new_cfg.get("danmakuZone") or DEFAULTS["danmakuZone"])
            style["speedLevel"] = str(new_cfg.get("danmakuSpeedLevel") or DEFAULTS["danmakuSpeedLevel"])
            style["speed"] = float(new_cfg.get("danmakuSpeed") or 0) or None
            style["color"] = str(new_cfg.get("danmakuTextColor") or DEFAULTS["danmakuTextColor"])
            lanes[:] = make_lanes()
            busy[:] = [0.0] * len(lanes)

        # 速度：优先用拉条的数值（dmemakuSpeed，40~800），老配置只有档位就按档位查
        speed = style.get("speed")
        if not isinstance(speed, (int, float)) or speed <= 0:
            speed = SPEEDS.get(style.get("speedLevel"), SPEEDS["normal"])
        step = speed * TICK_MS / 1000.0
        for it in items:
            it[1] -= step
            cv.coords(it[0], it[1], it[2])
            if len(it) > 6:
                for sid, (dx, dy) in zip(it[5], it[6]):
                    cv.coords(sid, it[1] + dx, it[2] + dy)
        for it in list(items):
            if it[1] < -it[3]:
                cv.delete(it[0])
                if len(it) > 6:
                    for sid in it[5]:
                        cv.delete(sid)
                busy[it[4]] = 0.0
                items.remove(it)

        lines = read_hud()
        if lines:
            # 新出现的行先进队列，不要一次全喷出去。
            # 以前是 fresh 里四条一起 spawn，看着像一口气吐完，跟念出来的节奏对不上。
            fresh = [ln.strip() for ln in lines if ln.strip() and ln.strip() not in seen]
            for text in fresh[:4]:
                seen.add(text)
                pending.append(text)
            # 已经飘过的也记进 seen，免得下次重复
            for ln in lines:
                if ln.strip():
                    seen.add(ln.strip())

        # 一次只放一条；上一条按字数估一个朗读时长，够长了再放下一条。
        now = time.time()
        if pending and now >= next_spawn_at:
            text = pending.pop(0)
            spawn(text)
            next_spawn_at = now + max(1.6, min(7.0, len(text) * 0.22))
        root.after(TICK_MS, tick)

    # 开弹幕就先飘一条测试，不用等真的说话才知道效果
    try:
        spawn("测试：弹幕效果，这样清楚吗？")
    except Exception:
        pass
    tick()
    root.mainloop()


if __name__ == "__main__":
    main()
