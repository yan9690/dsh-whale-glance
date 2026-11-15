"""余光字幕条：可拖、可锁、可缩成单条、四边/四角都能调大小、多配色。

配色：
- dark / light：纯色底板
- glass：抓背后的屏幕（不模糊），叠一层半透明深色 —— 能看清背景
- transparent：背景挖成透明色键，只给文字留一块深色底

交互：
- 中间拖 = 移动窗口；四边/四角 6px 内拖 = 调大小
- 右上角按钮：—（单条/多行）、锁（锁定）、×（退出）
- Ctrl+滚轮 = 字号，Shift+滚轮 = 透明度，Alt+滚轮 = 切配色，双击 = 锁定
"""
import json
import os
import sys
import time
import tkinter as tk

WDA_EXCLUDEFROMCAPTURE = 0x00000011
GA_ROOT = 2
TRANSPARENT = "#010203"

# ---- Windows 小工具 ----
def hide_from_capture(root):
    try:
        import ctypes
        user32 = ctypes.windll.user32
        hwnd = user32.GetAncestor(int(root.winfo_id()), GA_ROOT) or int(root.winfo_id())
        return bool(user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE))
    except Exception:
        return False


def set_no_activate(root):
    """点字幕窗不抢焦点：游戏无边框/全屏时点它不会把游戏切到后台。

    只加 WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW。鼠标事件照常落到窗口上，
    所以拖、点按钮、滚轮都还可用；代价是收不到键盘（Esc 退出就失效了）。

    必须在窗口真正 map 之后再调——main() 里调太早，tkinter 后面显示窗口时
    会把 exstyle 覆盖回去（实测跑起来只剩 LAYERED，NOACTIVATE 不见了）。
    所以 tick 里也要补，直到设上为止。
    """
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        hwnd = user32.GetAncestor(int(root.winfo_id()), GA_ROOT) or int(root.winfo_id())
        GWL_EXSTYLE = -20
        WS_EX_NOACTIVATE = 0x08000000
        WS_EX_TOOLWINDOW = 0x00000080
        style = user32.GetWindowLongW(wintypes.HWND(hwnd), GWL_EXSTYLE)
        if style & WS_EX_NOACTIVATE and style & WS_EX_TOOLWINDOW:
            return True
        user32.SetWindowLongW(
            wintypes.HWND(hwnd), GWL_EXSTYLE, style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
        )
        # 光 SetWindowLong 不生效，得 SWP_FRAMECHANGED 刷一遍 Windows 才会读新样式。
        SWP_NOMOVE = 0x0002
        SWP_NOSIZE = 0x0001
        SWP_NOZORDER = 0x0004
        SWP_NOACTIVATE = 0x0010
        SWP_FRAMECHANGED = 0x0020
        user32.SetWindowPos(
            wintypes.HWND(hwnd), 0, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        return True
    except Exception:
        return False


def set_capturable(root, allow=False):
    try:
        import ctypes
        from ctypes import wintypes

        hwnd = ctypes.windll.user32.GetAncestor(int(root.winfo_id()), GA_ROOT) or int(root.winfo_id())
        ctypes.windll.user32.SetWindowDisplayAffinity(wintypes.HWND(hwnd), 0 if allow else WDA_EXCLUDEFROMCAPTURE)
    except Exception:
        pass


def round_region(root, radius=0):
    try:
        import ctypes
        from ctypes import wintypes

        hwnd = ctypes.windll.user32.GetAncestor(int(root.winfo_id()), GA_ROOT) or int(root.winfo_id())
        w = max(2, root.winfo_width())
        h = max(2, root.winfo_height())
        # 圆角跟底板的圆角走同一个公式，窗口裁边和底板才对得上
        if radius <= 0:
            radius = min(22, max(10, h // 5))
        rgn = ctypes.windll.gdi32.CreateRoundRectRgn(0, 0, w + 1, h + 1, radius * 2, radius * 2)
        ctypes.windll.user32.SetWindowRgn(wintypes.HWND(hwnd), rgn, True)
    except Exception:
        pass


def set_colorkey(root, key=TRANSPARENT):
    try:
        import ctypes
        from ctypes import wintypes

        hwnd = ctypes.windll.user32.GetAncestor(int(root.winfo_id()), GA_ROOT) or int(root.winfo_id())
        GWL_EXSTYLE = -20
        WS_EX_LAYERED = 0x00080000
        style = ctypes.windll.user32.GetWindowLongW(wintypes.HWND(hwnd), GWL_EXSTYLE)
        ctypes.windll.user32.SetWindowLongW(wintypes.HWND(hwnd), GWL_EXSTYLE, style | WS_EX_LAYERED)
        k = key.lstrip("#")
        r, g, b = int(k[0:2], 16), int(k[2:4], 16), int(k[4:6], 16)
        ctypes.windll.user32.SetLayeredWindowAttributes(wintypes.HWND(hwnd), r | (g << 8) | (b << 16), 0, 1)
    except Exception:
        pass


def clear_colorkey(root):
    try:
        import ctypes
        from ctypes import wintypes

        hwnd = ctypes.windll.user32.GetAncestor(int(root.winfo_id()), GA_ROOT) or int(root.winfo_id())
        ctypes.windll.user32.SetLayeredWindowAttributes(wintypes.HWND(hwnd), 0, 255, 2)
    except Exception:
        pass


_SCT = [None]


def _sct():
    """mss 实例只建一次，每帧都新建会拖慢几十毫秒。"""
    if _SCT[0] is None:
        import mss
        _SCT[0] = mss.mss()
    return _SCT[0]


def grab_backdrop(root, blur=0, tint=(13, 19, 26), alpha=0.35):
    """抓窗口背后的屏幕，可选模糊，再叠一层半透明深色。

    不 withdraw 自己：那个藏起来再露回来的动作会让窗口闪一下，全屏游戏里
    尤其明显。直接把窗口所在那块挖掉（填成主题色），再抓整屏。
    blur>0 时先缩到 1/4 再模糊再放大——全分辨率高斯太慢，撑不住高频刷新。
    """
    try:
        from PIL import Image, ImageFilter

        x, y = root.winfo_x(), root.winfo_y()
        w, h = max(2, root.winfo_width()), max(2, root.winfo_height())
        img = _sct().grab({"left": x, "top": y, "width": w, "height": h})
        pil = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX").convert("RGBA")
        if blur > 0:
            sw, sh = max(2, w // 4), max(2, h // 4)
            pil = pil.resize((sw, sh), Image.BILINEAR).filter(ImageFilter.GaussianBlur(blur))
            pil = pil.resize((w, h), Image.BILINEAR)
        overlay = Image.new("RGBA", pil.size,
                            (tint[0], tint[1], tint[2], int(max(0.0, min(1.0, alpha)) * 255)))
        return Image.alpha_composite(pil, overlay).convert("RGB")
    except Exception:
        return None


HUD = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "hud.txt")
CONFIG = sys.argv[3] if len(sys.argv) > 3 else ""

W, H = 560, 84
FONT_SIZE = 16
MIN_SIZE, MAX_SIZE = 9, 48
MIN_W, MIN_H, MAX_W = 320, 34, 1600   # 最窄 320：再窄字就竖着排成一长条，难看
TOP_PAD = 30               # 文字从按钮栏下面开始（单行/可动/× 在右上角，下面那排交给文字）
EDGE = 6
POLL_MS = 16

PALETTES = {
    "dark": ("#12181f", "#0d131a", "#eef4fb", "#5d7389"),
    "light": ("#eef3f8", "#ffffff", "#1a2430", "#6b7a8c"),
    "glass": ("#1a232e", "#121a24", "#eef4fb", "#8aa0b4"),
    "frosted": ("#1c2530", "#141c26", "#eef4fb", "#8aa0b4"),
}


def _hex_rgb(s):
    s = (s or "").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return None
    try:
        return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def _outline_color(c):
    """描边颜色随主字亮度连续过渡：暗字配浅灰边、亮字配深灰边。

    以前按亮度 128 一刀切黑白，色盘一拖过中线描边就从黑跳到白，眼睛像吃了闪光弹。
    现在用灰阶连续过渡（暗字 #ebebeb、亮字 #191919），过中线也是缓缓变深。
    """
    rgb = _hex_rgb(c)
    if rgb is None:
        return "#000000"
    lum = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114
    t = max(0.0, min(1.0, lum / 255.0))
    edge = int(round(235 - 210 * t))
    return "#%02x%02x%02x" % (edge, edge, edge)


def _readable(tc, bg, st):
    """字色和底色太接近就自动拉开：深底提亮、浅底压暗。

    调色器是整个色盘，暗色压在深色底上根本看不清——选了下半区等于没字。
    这里只保证「至少差 90」，选的颜色还是会生效，只是被拉到能看。
    """
    c = _hex_rgb(tc)
    b = _hex_rgb(bg)
    if c is None or b is None:
        return tc
    lum_c = sum(c) / 3.0
    lum_b = sum(b) / 3.0
    dark_bg = st in ("dark", "transparent") or lum_b < 110
    if dark_bg and lum_c - lum_b < 90:
        need = 90 - (lum_c - lum_b)
        c = tuple(min(255, int(v + need)) for v in c)
    elif (not dark_bg) and lum_b - lum_c < 90:
        need = 90 - (lum_b - lum_c)
        c = tuple(max(0, int(v - need)) for v in c)
    return "#%02x%02x%02x" % c


def read_text():
    try:
        with open(HUD, encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def read_config():
    if not CONFIG:
        return {}
    try:
        import json
        with open(CONFIG, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def write_config(cfg):
    """把改过的样式写回 config.json，面板那边轮询时能同步看到。"""
    if not CONFIG:
        return
    try:
        import json
        data = read_config()
        data.update(cfg)
        with open(CONFIG, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


# 有效的配色 id。Alt+滚轮切样式已删，这里只用来兜底校验 hudStyle 别是空/旧值。
STYLE_ORDER = ("dark", "light", "glass", "frosted", "transparent")


def main():
    root = tk.Tk()
    root.title("余光")
    root.overrideredirect(True)
    root.attributes("-topmost", True)
    cfg = read_config()
    style = str(cfg.get("hudStyle") or "dark")
    start_size = int(cfg.get("hudFontSize") or FONT_SIZE)
    start_family = str(cfg.get("hudFontFamily") or "Microsoft YaHei")
    start_opacity = float(cfg.get("hudOpacity") or 0.9)
    bar_bg, body_bg, fg, title_fg = PALETTES.get(style, PALETTES["dark"])
    root.attributes("-alpha", max(0.0, min(1.0, start_opacity)))
    root.configure(bg=body_bg)
    root.update_idletasks()
    sx, sy = root.winfo_screenwidth(), root.winfo_screenheight()
    root.geometry("%dx%d+%d+%d" % (W, H, (sx - W) // 2, int(sy * 0.10)))
    hide_from_capture(root)
    round_region(root)
    set_no_activate(root)

    state = {"locked": False, "size": start_size, "w": W, "single": False,
             "family": start_family, "style": style}

    # 没有标题栏了：三个按钮浮在右上角，文字区自己撑满
    btnbar = tk.Frame(root, bg=body_bg, height=22)
    btnbar.place(relx=1.0, x=-8, y=3, anchor="ne")
    btnbar.lift()

    def mkbtn(text, cmd):
        b = tk.Button(btnbar, text=text, bg=body_bg, fg="#c9d6e3", font=("Microsoft YaHei", 9),
                      bd=0, relief="flat", activebackground="#2f6fa8",
                      activeforeground="#e8f1fb", command=cmd, padx=6, pady=0)
        b.pack(side="right", padx=1)
        b.bind("<Enter>", lambda e: b.config(bg="#1e2a35", fg="#eef4fb"))
        b.bind("<Leave>", lambda e: b.config(bg=body_bg, fg="#c9d6e3"))
        return b

    # 内容区
    canvas = tk.Canvas(root, bg=body_bg, bd=0, highlightthickness=0)
    canvas.pack(fill="both", expand=True)
    btnbar.lift()  # canvas 后建会盖住按钮，得再提一次
    # 描边：四方向各垫一层（各偏 1px），比自己算轮廓简单，也不会显得整块往一边偏
    shadow_ids = []
    for _dx, _dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        shadow_ids.append(canvas.create_text(10 + _dx, TOP_PAD + _dy, text="", fill="#000000",
                                             font=(start_family, start_size, "bold"),
                                             anchor="nw", width=W - 20, justify="left"))
    text_id = canvas.create_text(10, TOP_PAD, text="", fill=fg,
                                 font=(start_family, start_size, "bold"),
                                 anchor="nw", width=W - 20, justify="left")
    bg_item = [None]
    bg_key = [None]

    # ---- 底板 ----
    def paint_backdrop(force=False):
        st = state["style"]
        # 不再每帧 update_idletasks：那一下比抓屏还贵，会把帧率拖死
        w = max(2, root.winfo_width())
        h = max(2, root.winfo_height())
        if not force and bg_key[0] == (st, w, h):
            return
        bg_key[0] = (st, w, h)
        pil = None
        if st == "frosted":
            # 毛玻璃 = 抓背景 + 模糊。跟 glass 同一条路，只是多一道高斯模糊。
            pil = grab_backdrop(root, blur=2, tint=(255, 255, 255), alpha=0.26)
        elif st == "glass":
            # 玻璃 = 抓背后画面 + 一层提亮白。
            pil = grab_backdrop(root, blur=0, tint=(255, 255, 255), alpha=0.20)
        if pil is None:
            if bg_item[0] is not None:
                canvas.itemconfigure(bg_item[0], state="hidden")
            return
        try:
            from PIL import ImageTk
            # 每次重建 PhotoImage 并 itemconfigure。别用 paste：频繁 paste 到
            # PhotoImage 在 Windows 上会坏，切几次底板就黑——昨晚好端端的
            # 就是因为没这层 paste，是我今天加优化加出来的。
            photo = ImageTk.PhotoImage(pil)
            if bg_item[0] is None:
                bg_item[0] = canvas.create_image(0, 0, image=photo, anchor="nw")
                canvas.tag_lower(bg_item[0])
            else:
                canvas.itemconfigure(bg_item[0], image=photo, state="normal")
            canvas.image = photo
        except Exception:
            pass

    # ---- 透明档的接鼠标边（画在 canvas 里，跟窗口尺寸一起变，不会像 highlight 那样缺一段）----
    edge_item = [None]

    def draw_edge():
        return  # 透明档回到「只留文字」，不再画边

    # ---- 尺寸 ----
    def fit_height():
        root.update_idletasks()
        bbox = canvas.bbox(text_id)
        text_h = (bbox[3] - bbox[1]) if bbox else 20
        want_h = max(MIN_H, TOP_PAD + text_h + 8)
        want_w = max(MIN_W, min(MAX_W, state["w"]))
        # 宽和高任何一个变了都要重设 geometry。以前只比高度，切回多行时文字变宽、
        # 高度差不到 2px 就不重设，窗口还是旧窄宽度，多出来的行直接被裁掉。
        if abs(root.winfo_width() - want_w) > 2 or abs(root.winfo_height() - want_h) > 2:
            root.geometry("%dx%d" % (want_w, want_h))
            # geometry 是异步的，winfo 不会立刻返回新尺寸。不等它生效就 round_region，
            # 圆角裁剪区还是旧的宽高，会把新窗口裁掉一截——单行切多行就裁成一行半。
            root.update_idletasks()
        round_region(root)

    # 没话说的时候摆几行占位，纯演示排版，别夹带任何角色台词
    PLACEHOLDER = [
        "占位演示：只说一句的时候，条子就这么长。",
        "占位演示：句子长一点会自己往下撑开，这一行就是用来看换行效果的。",
        "占位演示：这是第三行。多行显示最近五句，单行只显示最新那一句。",
    ]

    last_shown = [""]

    def render():
        raw = read_text()
        # 保留普通空行当「分条间隔」（宿主用 \n\n 分隔每条），只掐掉首尾空行。
        # 以前把所有空行都过滤了，三条话还是会糊成一整块。
        lines = raw.split("\n") if raw else []
        while lines and not lines[0].strip():
            lines.pop(0)
        while lines and not lines[-1].strip():
            lines.pop()
        if not lines:
            # 文件空有两种：真没说过话（显示占位），和宿主换窗口/清账时清空
            # （上一句还没到寿，被闪成「占位演示」）。后者保持原句别闪。
            if last_shown[0]:
                return
            lines = list(PLACEHOLDER)
        if state["single"]:
            nonblank = [l for l in lines if l.strip()]
            text = nonblank[-1] if nonblank else ""
        else:
            text = "\n".join(lines[-7:])  # 最近三条（每条+空行）约五行，再多就顶出去了
        last_shown[0] = text
        # 先按「不换行」量一遍自然宽度：短句把条子收窄，长句才撑到上限再折行。
        # 以前固定 560、要手动拖，就是因为从来没量过这句话到底多宽。
        canvas.itemconfigure(text_id, text=text, width=0)
        for _sid in shadow_ids:
            canvas.itemconfigure(_sid, text=text, width=0)
        root.update_idletasks()  # 让 bbox 反映新文本，不然拿到的是旧宽度
        bbox = canvas.bbox(text_id)
        natural = (bbox[2] - bbox[0]) if bbox else 200
        if not state.get("manualW"):
            # 单行别撑太长：一句就一行左右折，太宽像横幅；多行才允许放宽
            cap = 720 if state["single"] else MAX_W
            state["w"] = max(MIN_W, min(cap, natural + 132))
        canvas.itemconfigure(text_id, width=max(80, state["w"] - 20))
        for _sid in shadow_ids:
            canvas.itemconfigure(_sid, width=max(80, state["w"] - 20))
        fit_height()

    def flash_style_test():
        """换样式时闪一条测试字，让人当场看到新样式长什么样。1.5 秒后恢复真内容。"""
        try:
            test = "测试：这是当前样式的效果，能看清吗？"
            canvas.itemconfigure(text_id, text=test, width=0)
            for _sid in shadow_ids:
                canvas.itemconfigure(_sid, text=test, width=0)
            root.update_idletasks()
            bbox = canvas.bbox(text_id)
            natural = (bbox[2] - bbox[0]) if bbox else 200
            if not state.get("manualW"):
                cap = 720 if state["single"] else MAX_W
                state["w"] = max(MIN_W, min(cap, natural + 132))
            canvas.itemconfigure(text_id, width=max(80, state["w"] - 20))
            for _sid in shadow_ids:
                canvas.itemconfigure(_sid, width=max(80, state["w"] - 20))
            fit_height()
            last_shown[0] = test
            root.after(1500, render)
        except Exception:
            pass

    # ---- 样式 ----
    def apply_cfg():
        cfg = read_config()
        st = str(cfg.get("hudStyle") or "dark")
        # frosted 已删，旧配置里还留着这个值就归一成 dark，别让它卡在一个不存在的配色上
        if st not in STYLE_ORDER:
            st = "dark"
        size = int(cfg.get("hudFontSize") or FONT_SIZE)
        family = str(cfg.get("hudFontFamily") or "Microsoft YaHei")
        opacity = float(cfg.get("hudOpacity") or 0.9)
        text_color = str(cfg.get("hudTextColor") or "").strip()
        # 玻璃/毛玻璃靠抓屏吃饭，一旦允许截自己就会抓到自己（越抓越黑），这两档强制排除
        allow_cap = cfg.get("hudCapturable") is True and st not in ("glass", "frosted")
        set_capturable(root, allow_cap)
        # 字体或字号变了就得重新量宽度：不同字体同一个字宽差别很大，
        # 不重量的话新字体会被旧的窄宽度裁掉。换了字体就当没手动拖过。
        font_changed = (state.get("family") != family) or (state.get("size") != size)
        style_changed = state.get("style") != st
        state["style"] = st
        state["size"] = size
        state["family"] = family
        if font_changed:
            state["manualW"] = False  # 换字体重量宽度，别沿用旧的窄条

        if st == "transparent":
            for w in (root, btnbar, canvas):
                try:
                    w.configure(bg=TRANSPARENT)
                except Exception:
                    pass
            # 透明像素的鼠标会穿透到下层窗口，边缘抓不住。用画出来的细边接鼠标；
            # 不用 canvas 的 highlight——那个在拉伸之后会缺掉底边那一段
            canvas.configure(highlightthickness=0)
            draw_edge()
            root.attributes("-alpha", 1.0)
            set_colorkey(root)
            # 没有标题栏，不用再调标题颜色
            canvas.itemconfigure(text_id, fill=(text_color or "#eef4fb"),
                                 font=(family, size, "bold"),
                                 width=max(80, state["w"] - 20))
            # 透明档也得同步描边色，不然阴影还是建时的黑色，黑字压黑边等于没描
            for _sid in shadow_ids:
                canvas.itemconfigure(_sid, state="normal",
                                     fill=_outline_color(text_color or "#eef4fb"),
                                     font=(family, size, "bold"),
                                     width=max(80, state["w"] - 20))
            if bg_item[0] is not None:
                canvas.itemconfigure(bg_item[0], state="hidden")
            if font_changed:
                render()  # 换字体要重量宽度，否则大字体被窄条裁掉
            else:
                fit_height()
            if style_changed:
                root.after(80, flash_style_test)
            return

        clear_colorkey(root)
        try:
            root.attributes("-transparentcolor", "")
        except Exception:
            pass
        p_bar, p_body, p_fg, p_title = PALETTES.get(st, PALETTES["dark"])
        if text_color:
            # 用户选什么就是什么，不强行改。深底上选暗色会看不清，面板上已经提示过了
            p_fg = text_color
        # 只有深色/浅色吃这个透明度。玻璃的底板本身就是半透明叠出来的，
        # 再乘一次 alpha 会露出底下的深色 canvas，看着就是发黑。
        if st in ("dark", "light"):
            root.attributes("-alpha", max(0.0, min(1.0, opacity)))
        else:
            root.attributes("-alpha", 1.0)
        root.configure(bg=p_body)
        btnbar.configure(bg=p_body)
        canvas.configure(bg=p_body, highlightthickness=0)
        for _sid in shadow_ids:
            # 有背景的档位不需要描边，藏起来
            canvas.itemconfigure(_sid, state="hidden",
                                 font=(family, size, "bold"),
                                 fill=_outline_color(p_fg),
                                 width=max(80, state["w"] - 20))
        canvas.itemconfigure(text_id, fill=p_fg, font=(family, size, "bold"),
                             width=max(80, state["w"] - 20))
        if font_changed:
            render()  # 按新字体重量宽度；不重量的话大字体就被旧窄条裁掉
        else:
            fit_height()
        if style_changed:
            root.after(80, flash_style_test)
        paint_backdrop(force=True)

    # ---- 按钮 ----
    def toggle_single():
        state["single"] = not state["single"]
        # 按钮上写清楚当前是哪一档，别让人靠猜符号
        btn_mini.config(text="多行" if state["single"] else "单行")
        # 切换要真刷新：render 里 early return 是给「文件空时保留旧句」用的，
        # 手动切档必须无条件重画，不然按钮变了、字幕没变
        last_shown[0] = ""
        render()

    def toggle_lock():
        state["locked"] = not state["locked"]
        # 按钮一律写「当前状态」：锁着=已锁，能拖=可动。
        # 之前「锁/锁定」两种叫法分不清是状态还是动作，反着读也说得通。
        btn_lock.config(text="已锁" if state["locked"] else "可动")

    def close_hud():
        # × 不只是关窗口，是把「字幕窗」这个功能关掉：写 hudOn=false，
        # 不然 index.js 那边下次改任何设置都会因为 hudOn 还是 true 重新弹出来
        write_config({"hudOn": False})
        root.destroy()

    btn_close = mkbtn("×", close_hud)
    btn_lock = mkbtn("可动", toggle_lock)
    # 默认是多行，按钮上先写「单行」（意思是点它切到单行）
    btn_mini = mkbtn("单行", toggle_single)

    def text_pad():
        """文字右边要给按钮栏让路。以前写死 116，按钮一多就盖住字；按实际宽度算。"""
        try:
            return max(24, btnbar.winfo_reqwidth() + 18)
        except Exception:
            return 116


    # ---- 拖动 / 调大小（四边四角都能拖）----
    move_drag = {}
    resize_drag = {}

    def edge_of(x, y):
        # 透明档没有可见边框，边放宽到 12px 才好抓；其余档 6px 够用
        edge = 12 if state.get("style") == "transparent" else EDGE
        w, h = root.winfo_width(), root.winfo_height()
        d = ""
        if y <= edge:
            d += "n"
        elif y >= h - edge:
            d += "s"
        if x <= edge:
            d += "w"
        elif x >= w - edge:
            d += "e"
        return d

    CURSORS = {"n": "sb_v_double_arrow", "s": "sb_v_double_arrow",
               "e": "sb_h_double_arrow", "w": "sb_h_double_arrow",
               "nw": "size_nw_se", "se": "size_nw_se",
               "ne": "size_ne_sw", "sw": "size_ne_sw"}

    def on_motion(e):
        if state["locked"] or resize_drag:
            return
        d = edge_of(e.x, e.y)
        e.widget.configure(cursor=CURSORS.get(d, "fleur"))

    def on_press(e):
        if state["locked"]:
            return
        d = edge_of(e.x, e.y)
        if d:
            resize_drag["dir"] = d
            resize_drag["x"] = e.x_root
            resize_drag["y"] = e.y_root
            resize_drag["geom"] = (root.winfo_x(), root.winfo_y(), root.winfo_width(), root.winfo_height())
        else:
            move_drag["x"] = e.x_root
            move_drag["y"] = e.y_root
            move_drag["wx"] = root.winfo_x()
            move_drag["wy"] = root.winfo_y()
        state["dragging"] = True

    def on_drag(e):
        if state["locked"]:
            return
        if resize_drag:
            dx = e.x_root - resize_drag["x"]
            dy = e.y_root - resize_drag["y"]
            gx, gy, gw, gh = resize_drag["geom"]
            d = resize_drag["dir"]
            nw, nh, nx, ny = gw, gh, gx, gy
            if "e" in d:
                nw = max(MIN_W, min(MAX_W, gw + dx))
            if "w" in d:
                nw = max(MIN_W, min(MAX_W, gw - dx))
                nx = gx + (gw - nw)
            if "s" in d:
                nh = max(MIN_H, gh + dy)
            if "n" in d:
                nh = max(MIN_H, gh - dy)
                ny = gy + (gh - nh)
            state["w"] = nw
            # 手动拖过宽度就记下来，之后不再被文字长度自动改回去
            if "e" in d or "w" in d:
                state["manualW"] = True
                # 拖宽窄时只改文字宽度，高度留到松手再算：
                # 拖动中每帧 fit_height 都要重设 geometry，按钮栏跟着不停重绘，看着就是闪。
                canvas.itemconfigure(text_id, width=max(80, nw - 20))
                for _sid in shadow_ids:
                    canvas.itemconfigure(_sid, width=max(80, nw - 20))
                state["resizedW"] = True
                return
            canvas.itemconfigure(text_id, width=max(80, nw - 20))
            for _sid in shadow_ids:
                canvas.itemconfigure(_sid, width=max(80, nw - 20))
            root.geometry("%dx%d+%d+%d" % (nw, nh, nx, ny))
            round_region(root)
            return
        if "x" in move_drag:
            root.geometry("+%d+%d" % (move_drag["wx"] + e.x_root - move_drag["x"],
                                      move_drag["wy"] + e.y_root - move_drag["y"]))

    def on_release(e):
        had = bool(resize_drag) or ("x" in move_drag)
        state["dragging"] = False
        resize_drag.clear()
        move_drag.clear()
        if had:
            if state.pop("resizedW", False):
                fit_height()  # 松手才按新宽度重算高度，拖动中不重算就不闪
            paint_backdrop(force=True)

    canvas.bind("<Motion>", on_motion)
    canvas.bind("<Button-1>", on_press)
    canvas.bind("<B1-Motion>", on_drag)
    canvas.bind("<ButtonRelease-1>", on_release)

    # ---- 快捷键 ----
    def on_wheel(e):
        state["size"] = max(MIN_SIZE, min(MAX_SIZE, state["size"] + (1 if e.delta > 0 else -1)))
        canvas.itemconfigure(text_id, font=(state["family"], state["size"], "bold"))
        fit_height()
        # 必须写回配置：不写的话，下次任何配置变动触发 apply_cfg 时会按旧字号重绘，
        # 看着就像「滚轮调的字号被重置了」。
        write_config({"hudFontSize": state["size"]})

    def on_alpha_wheel(e):
        # 只有深色/浅色能滚透明度，别的档乘 alpha 会发黑
        if state.get("style") not in ("dark", "light"):
            return
        cur = float(root.attributes("-alpha"))
        nxt = max(0.0, min(1.0, cur + (0.05 if e.delta > 0 else -0.05)))
        root.attributes("-alpha", nxt)
        write_config({"hudOpacity": round(nxt, 3)})

    canvas.bind("<Control-MouseWheel>", on_wheel)
    canvas.bind("<Shift-MouseWheel>", on_alpha_wheel)
    canvas.bind("<Double-Button-1>", lambda e: toggle_lock())
    # Esc 退出去掉了：窗口设了 no-activate，收不到键盘，绑了也用不了。退出走 × 按钮。

    # ---- 轮询 ----
    last = [None]
    cfg_mtime = [0.0]
    last_grab = [0.0]

    def tick():
        cur = read_text()
        if cur != last[0]:
            render()
            last[0] = cur
            # 埋点：字幕窗真正读到新内容的时间，跟 host 写文件的时间一对比
            # 就知道「模型答完」到「字幕出现」中间到底差在哪
            try:
                with open(os.path.join(os.path.dirname(HUD), "hud-debug.log"), "a", encoding="utf-8") as _f:
                    _f.write(json.dumps({"at": int(time.time() * 1000), "src": "hud-render", "chars": len(cur)}, ensure_ascii=False) + "\n")
            except Exception:
                pass
        try:
            mt = os.path.getmtime(CONFIG) if CONFIG else 0.0
        except OSError:
            mt = 0.0
        if mt != cfg_mtime[0]:
            cfg_mtime[0] = mt
            apply_cfg()
        # 玻璃/毛玻璃每帧重抓，跟着背后画面走；拖动时暂停，否则每帧重建
        # 底图会让按钮层跟着闪。透明档补接鼠标边。
        if state.get("style") in ("glass", "frosted"):
            if not state.get("dragging"):
                paint_backdrop(force=True)
        elif state.get("style") == "transparent":
            draw_edge()
        # no-activate 得等窗口真 map 了才设得上，且切样式时 apply_cfg 里的
        # set_capturable/colorkey 可能把 exstyle 覆盖回去。所以每轮都补一次——
        # set_no_activate 内部已有 early return（样式在就直接返回、不 SetWindowPos），
        # 每轮调用不闪也不费。之前用 no_activate_done 停掉它，切样式后就被覆盖了，
        # 拖动又切回桌面。
        set_no_activate(root)
        root.after(POLL_MS, tick)

    render()
    tick()
    root.mainloop()


if __name__ == "__main__":
    main()
