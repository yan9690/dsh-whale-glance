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


def set_click_through(root, on):
    """锁定后让鼠标点穿到下面去（游戏、桌面）。

    只加 WS_EX_TRANSPARENT 的话整窗都不收鼠标，右上角「已锁」也就点不到了，
    锁上就再也解不开。所以调用方按光标位置决定：光标挪到按钮栏上时先关掉穿透。
    """
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        hwnd = user32.GetAncestor(int(root.winfo_id()), GA_ROOT) or int(root.winfo_id())
        GWL_EXSTYLE = -20
        WS_EX_TRANSPARENT = 0x00000020
        style = user32.GetWindowLongW(wintypes.HWND(hwnd), GWL_EXSTYLE)
        if bool(style & WS_EX_TRANSPARENT) == bool(on):
            return True
        style = (style | WS_EX_TRANSPARENT) if on else (style & ~WS_EX_TRANSPARENT)
        user32.SetWindowLongW(wintypes.HWND(hwnd), GWL_EXSTYLE, style)
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


def cursor_pos():
    try:
        import ctypes
        from ctypes import wintypes

        pt = wintypes.POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
        return int(pt.x), int(pt.y)
    except Exception:
        return None


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


def set_window_alpha(root, alpha, transparent_style=False):
    """给整个窗口设透明度。

    透明档不能只传「整窗透明度」这一个标志：那样会把之前设好的颜色键一起抹掉，
    透明的背景立刻变成一块实心暗色（看着就是「有底了」）。所以透明档要
    把颜色键和透明度两个标志一起交给 Windows。
    """
    a = max(0.0, min(1.0, float(alpha)))
    if transparent_style:
        try:
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            hwnd = user32.GetAncestor(int(root.winfo_id()), GA_ROOT) or int(root.winfo_id())
            k = TRANSPARENT.lstrip("#")
            r, g, b = int(k[0:2], 16), int(k[2:4], 16), int(k[4:6], 16)
            user32.SetLayeredWindowAttributes(
                wintypes.HWND(hwnd), r | (g << 8) | (b << 16), int(round(a * 255)), 0x03)
            return
        except Exception:
            pass
    try:
        root.attributes("-alpha", a)
    except Exception:
        pass


_SCT = [None]


_SCT_BAD = [False]


def _sct():
    """mss 实例只建一次，每帧都新建会拖慢几十毫秒。mss 不在了就别反复 import 试探。"""
    if _SCT[0] is None:
        if _SCT_BAD[0]:
            raise ImportError("mss 不可用")
        try:
            import mss
            _SCT[0] = mss.mss()
        except Exception:
            _SCT_BAD[0] = True
            raise
    return _SCT[0]


def _screen_shot(left, top, width, height):
    """截一块屏幕，返回 PIL 的 RGB 图。优先 mss，没有就退回 Pillow 自带的 ImageGrab。

    mss 不是必须的：DSH 刷新运行时的依赖目录时会把它一起清掉（2026-11-21 18:02 就清过一次），
    那时候玻璃 / 毛玻璃会悄悄退回成一块平底色，看着像坏了。ImageGrab 抓的是同一块桌面，
    慢一点但够用，而且 Pillow 本来就在。
    """
    from PIL import Image
    try:
        img = _sct().grab({"left": left, "top": top, "width": width, "height": height})
        return Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")
    except Exception:
        pass
    from PIL import ImageGrab
    return ImageGrab.grab(bbox=(left, top, left + width, top + height)).convert("RGB")


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
        pil = _screen_shot(x, y, w, h).convert("RGBA")
        if pil.size != (w, h):
            pil = pil.resize((w, h), Image.BILINEAR)
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
# 宿主（Electron 主进程）的 pid。宿主没了就自己退——Windows 不会跟着父进程收子进程，
# 老版本因此能把一条没人管的字幕条一直留在屏上（11-21 21:29 那个「一大一小叠字」就是两条窗口）。
PARENT_PID = 0
try:
    PARENT_PID = int(os.environ.get("HUD_PARENT_PID") or 0)
except ValueError:
    PARENT_PID = 0

CREATE_NO_WINDOW = 0x08000000


def pid_alive(pid):
    """这个 pid 还活着吗。查不清就当它活着，宁可多留一会儿也别误杀。"""
    if not pid:
        return False
    try:
        import ctypes

        k32 = ctypes.windll.kernel32
        handle = k32.OpenProcess(0x1000, False, int(pid))   # QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = k32.GetExitCodeProcess(handle, ctypes.byref(code))
        k32.CloseHandle(handle)
        return bool(ok) and code.value == 259               # STILL_ACTIVE
    except Exception:
        return True


def _quiet_run(args, timeout=10.0):
    import subprocess

    return subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                          creationflags=CREATE_NO_WINDOW)


def _find_other_hud(ident):
    """命令行里带 hud_window.py、且吃的是同一份配置的那个 python 进程。

    单看 pid 不够——pid 会被系统回收再用；带上命令行里自己的配置路径才敢下手。
    """
    ident = os.path.abspath(ident).lower()
    script = (
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and "
        "$_.CommandLine -like '*hud_window.py*' } | ForEach-Object { $_.ProcessId; $_.CommandLine }"
    )
    try:
        out = _quiet_run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script])
    except Exception:
        return 0
    lines = [ln.strip() for ln in (out.stdout or "").splitlines() if ln.strip()]
    pid = 0
    for line in lines:
        if line.isdigit():
            pid = int(line)
            continue
        if pid and pid != os.getpid() and ident in line.lower():
            return pid
    return 0


def claim_single_instance():
    """一份配置只留一个字幕窗：屏上已经有一条，就先把旧的关掉。

    没有这道锁的时候，宿主重启或崩掉会把它留下的 pythonw 抛在原地，新窗口再起来，
    屏幕上就是两条字幕：一条跟着字号变、一条不跟，看着像字叠在一起、一大一小。
    """
    me = os.getpid()
    ident = CONFIG or HUD
    lock = os.path.join(os.path.dirname(os.path.abspath(HUD)), "hud-window.pid")
    try:
        old = int((open(lock, encoding="utf-8").read() or "0").strip())
    except Exception:
        old = 0
    if old == me or not pid_alive(old):
        # 锁文件过期（或者这次是本版本第一次起）：扫一遍，升级前留下的老窗口没人登记过
        old = _find_other_hud(ident)
    if old and old != me and pid_alive(old):
        try:
            _quiet_run(["taskkill", "/PID", str(old), "/F"], timeout=8.0)
        except Exception:
            pass
        for _ in range(40):
            if not pid_alive(old):
                break
            time.sleep(0.05)
    try:
        with open(lock, "w", encoding="utf-8") as f:
            f.write(str(me))
    except Exception:
        return

    import atexit

    def _release():
        try:
            with open(lock, encoding="utf-8") as f:
                if int((f.read() or "0").strip()) == me:
                    os.remove(lock)
        except Exception:
            pass

    atexit.register(_release)

W, H = 560, 84
FONT_SIZE = 16
MIN_SIZE, MAX_SIZE = 9, 48
MIN_W, MIN_H, MAX_W = 320, 34, 1600   # 最窄 320：再窄字就竖着排成一长条，难看
TOP_PAD = 30               # 文字从按钮栏下面开始（单行/可动/× 在右上角，下面那排交给文字）
EDGE = 6
POLL_MS = 16
# 淡出分两段，面板上也是两个设置：先进来的这段时间保持清楚（多久开始淡），
# 再用这段时间从全亮化到全隐（淡出持续多久）。这里只是配置缺省时的兜底值。
FADE_HOLD_MS = 6000
FADE_MS = 1200
FADE_HOLD_LIMITS = (2.0, 300.0)  # 「多久开始淡」可调范围（秒），放到 5 分钟
FADE_LEN_LIMITS = (0.3, 10.0)    # 「淡出持续多久」可调范围（秒）

PALETTES = {
    # 第四个是辅助字（按钮、提示）的颜色，比主字暗一档，不再抢视线。
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


def _contrast(a, b):
    """两个颜色的对比度（WCAG 那种算法，1:1 到 21:1）。读不出来才需要拦。"""
    ra, rb = _hex_rgb(a), _hex_rgb(b)
    if ra is None or rb is None:
        return 21.0

    def lum(rgb):
        vals = []
        for v in rgb:
            v = v / 255.0
            vals.append(v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2]

    hi, lo = sorted((lum(ra), lum(rb)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


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


def _mix_hex(a, b, k):
    """两个颜色按 k 混一下（0 = 全 a，1 = 全 b）。淡出和描边兑淡都用它。"""
    ca = _hex_rgb(a) or (238, 244, 251)
    cb = _hex_rgb(b) or (18, 24, 31)
    k = max(0.0, min(1.0, k))
    return "#%02x%02x%02x" % tuple(int(round(x + (y - x) * k)) for x, y in zip(ca, cb))


MAX_SHADOWS = 4   # 描边那圈上下左右四项；其余档位建着一直藏着


def _shadow_offsets(size, style=""):
    """描边那圈垫几个像素、往哪几个方向垫。

    有底色的档位（深色/浅色/玻璃）不用描边，那几项建着一直藏着，所以真正用得着
    描边的只有透明档——透明档的字直接压在画面上，靠一圈描边把自己从背景里抠出来。

    只垫上下左右四个方向、d 像素。11-21 试过把透明档描边加厚成两圈 2px 实心暗晕，
    她当场否了：原本那一圈细边更好看。所以这里回原样，别再动。
    """
    d = max(1, int(round(float(size) / 14.0)))
    return ((-d, 0), (d, 0), (0, -d), (0, d))


def _shadow_softness(size):
    """小字号把描边往主字色里兑淡多少（0 = 原色不动）。

    偏移的像素已经到 1px 的地板，10 号跟 20 号的偏移量其实都是 1px，靠偏移
    再细不下去；而 13px 的汉字笔画本身才一两个像素宽，边上再挂一圈纯 #1d1d1d，
    整行看着就是发灰发糊。所以小字号把环兑淡一点：边还在（浅色底上认得出字），
    字是白的。14 号以上一点不兑，保持原来的观感。
    """
    n = int(size)
    if n >= 14:
        return 0.0
    return max(0.0, min(0.28, (14 - n) * 0.05))


def _shadow_base(fg, size):
    """描边那一圈的底色：先按主字亮度推灰阶，再按字号兑淡。"""
    return _mix_hex(_outline_color(fg), fg, _shadow_softness(size))


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
    # 先把屏上可能还挂着的旧窗口收掉：一条就够，叠加起来就是「字叠在一起」。
    claim_single_instance()
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
             "family": start_family, "style": style,
             # 淡出：alpha 是当前的亮暗系数（0 全隐、1 全亮），baseAlpha 是这档样式本身的不透明度，
             # 最后真正塞给窗口的是两者相乘。holdMs / fadeMs 是面板上那两项设置。
             "alpha": 1.0, "baseAlpha": max(0.0, min(1.0, start_opacity)),
             "fadeOn": cfg.get("hudFade") is not False,
             "holdMs": FADE_HOLD_MS, "fadeMs": FADE_MS,
             "hover": False}

    def _now_ms():
        return time.time() * 1000.0

    def cursor_in_hud():
        try:
            pos = cursor_pos()
            if not pos:
                return False
            # 只认现在这块看得见的窗口。以前把「淡出前的大尺寸」也算进来，
            # 结果条子淡没、缩成一小条之后，指针在那块已经空了的旧位置上经过一下
            # 就把它叫醒——她那边看到的就是「没人碰它，自己又冒出来，然后接着淡」
            # （11-21 20:59 报的循环）。
            wx, wy = root.winfo_rootx(), root.winfo_rooty()
            w, h = root.winfo_width(), root.winfo_height()
            return wx <= pos[0] <= wx + w and wy <= pos[1] <= wy + h
        except Exception:
            return False

    fade_tick = [0]
    line_seen = {}      # 每一行第一次出现的时间（毫秒）：淡出按每一行自己的寿命算
    line_gone = set()   # 已经淡完、先撤下来但 hud.txt 里还留着的行
    state["fg"] = fg
    state["bg"] = body_bg

    _mix = _mix_hex

    def sample_bg():
        """透明档没有底色：淡出得往「它背后那块画面」上化，不然会留一片灰字。"""
        try:
            x, y = root.winfo_rootx(), root.winfo_rooty()
            w, h = max(2, root.winfo_width()), max(2, root.winfo_height())
            from PIL import Image
            pil = _screen_shot(x, y, w, h).resize((1, 1), Image.BOX)
            return "#%02x%02x%02x" % pil.getpixel((0, 0))
        except Exception:
            return state.get("bg") or "#101010"

    def restore_recent():
        """指针扫回来：把刚淡没的那几句重新摆上，并从这一刻重新计时。

        淡完的行会被 line_gone 撤下来（见 _render），窗口跟着缩成一小条。
        这一步不做的话，paint_fade 里 ages 永远是空的，hover 被强制成 False、
        目标透明度恒为 0——docstring 里写的「扫回条子上会立刻整条亮着」就失效了。
        摆回去时把 line_seen 重置成现在：指针一离开，它们照常按停留/淡出再走一遍，
        不会赖在屏幕上。
        """
        try:
            if any(slot["text"] for slot in line_pool):
                return          # 还有东西在屏上，不用它出手
            raw = read_text()
            if raw:
                back = [l for l in last_real[-5:] if l in raw]
                if not back:
                    return      # 文件里已经是别的话了，别把旧话翻出来
            else:
                # 没字幕的时候条子上摆的是占位演示，那几行也得能唤回来——
                # 否则空条子淡完就永远回不来（11-21 20:26 她说「只有透明档能唤醒」）
                back = last_real[-5:] or list(PLACEHOLDER)
            now = _now_ms()
            for l in back:
                line_seen[l] = now
            line_gone.clear()
            render()
        except Exception:
            pass

    def paint_fade():
        """按时间淡：多久开始淡、淡多久，全都是真时间，不是「每拍减一点」。

        以前是每拍减 step（step = 16ms / fadeMs）累加出来的，tick 一被拖慢
        （抓屏、换样式、切窗口都占时间），淡出就比她设的秒数慢一截：她设 10 秒，
        实际十几秒还在。现在直接用「最新那句的年龄」算透明度，设几秒就是几秒。

        鼠标扫回条子上会立刻整条亮着，方便回头看清刚才那句。
        「淡出」关掉时，只要还有话就一直是亮的，不自己躲。
        """
        if state.get("_inPaint"):
            return
        state["_inPaint"] = True
        try:
            now = _now_ms()
            fade_tick[0] += 1
            if fade_tick[0] % 3 == 0:
                _in_now = cursor_in_hud()
                # 连续两拍都算在条子上才认，防止指针擦边、或窗口刚缩放时光标判定抖一下
                state["_hoverHit"] = int(state.get("_hoverHit") or 0) + 1 if _in_now else 0
                state["hover"] = _in_now
            hover = bool(state.get("hover")) or bool(state.get("dragging"))
            # 指针刚扫进来那一下（不是每拍）：把淡掉的那几句重新摆上来。
            # 要连着两拍都在条子上才算数——擦边路过、窗口刚缩放时判定抖一下，都不该叫醒。
            if hover and int(state.get("_hoverHit") or 0) >= 2:
                if not state.get("_hoverWas"):
                    restore_recent()
                state["_hoverWas"] = True
            elif not hover:
                state["_hoverWas"] = False
            base = max(0.0, min(1.0, float(state.get("baseAlpha", 1.0))))
            fade_on = bool(state.get("fadeOn", True))
            hold_ms = float(state.get("holdMs") or FADE_HOLD_MS)
            fade_ms = max(80.0, float(state.get("fadeMs") or FADE_MS))
            # 最新那句的年龄决定整条窗口什么时候开始躲开
            ages = [now - line_seen.get(slot["text"], now) for slot in line_pool if slot["text"]]
            if ages and fade_on and not hover:
                newest_age = min(ages)
                win_k = max(0.0, min(1.0, (newest_age - hold_ms) / fade_ms))
                target = 1.0 - win_k
            elif ages:
                # 淡出关了，或者指针停在条子上：有字就一直亮着
                win_k = 0.0
                target = 1.0
            else:
                # 一句都不剩就把整条收掉。以前这里按「最新一句年龄」算，
                # 没行时年龄算 0，alpha 又爬回 1，画面上留一个空条子。
                win_k = 1.0
                hover = False
                target = 0.0
            cur = float(state.get("alpha", 1.0))
            tr = state.get("style") == "transparent"
            # 目标值直接由时间算；只有「往回暗」这一路留 180ms 的缓，免得好好的
            # 字幕因为指针刚扫出去就「啪」一下暗下来
            last_at = float(state.get("fadeAt") or now)
            state["fadeAt"] = now
            if target >= cur:
                nxt = target
            else:
                nxt = max(target, cur - max(0.0, now - last_at) / 180.0)
            state["alpha"] = nxt
            set_window_alpha(root, nxt * base, tr)
            fg = state.get("fg") or "#eef4fb"
            bg = state.get("bg") or "#12181f"
            if not tr and win_k > 0 and not hover:
                if now - float(state.get("bgAt") or 0.0) > 800:
                    state["bgAt"] = now
                    state["bg"] = sample_bg()
                    bg = state["bg"]
            expired = False
            for slot in line_pool:
                t = slot["text"]
                if not t:
                    continue
                if tr:
                    # 透明档不拿字色去混「采样出来的那块平均底色」。以前是混的，
                    # 结果整段淡出时间里字都是一块平均色的鬼影：压在真实画面上既像
                    # 空心刻字，化到 k=1 还留一层洗不掉的字形。透明档本来就有整窗
                    # 透明度可淡，让字和描边保持原色、由窗口 alpha 一起去淡，
                    # 淡的是真像素，跟背后画面怎么变都是对的。
                    canvas.itemconfigure(slot["main"], fill=fg)
                    _edge = _shadow_base(fg, state.get("size") or start_size)
                    for _sid in slot["shadows"]:
                        canvas.itemconfigure(_sid, fill=_edge)
                    continue
                if hover or not fade_on:
                    k = 0.0
                else:
                    k = max(0.0, min(1.0, (now - line_seen.get(t, now) - hold_ms) / fade_ms))
                col = _mix(fg, bg, k)
                canvas.itemconfigure(slot["main"], fill=col)
                # 有底板的档位描边是藏着的，这里留着只为不改它们的行为
                edge = "#000000"
                for _sid in slot["shadows"]:
                    canvas.itemconfigure(_sid, fill=edge)
                if k >= 1.0:
                    line_gone.add(t)
                    expired = True
            animate_rows()
            if expired and not hover:
                render()
        finally:
            state["_inPaint"] = False

    def animate_rows():
        """新的一句顶进来时整列往上推：旧行从原位滑到新位，新行从下面滑上来。"""
        for slot in line_pool:
            if not slot["text"]:
                continue
            ty = float(slot.get("ty", TOP_PAD))
            cy = float(slot.get("cy", ty))
            if abs(ty - cy) <= 0.5:
                cy = ty
            else:
                cy += (ty - cy) * 0.32
            slot["cy"] = cy
            # 已经到位也要把画布坐标刷一遍：layout 只写 ty/cy（目标值），真正落笔在这里。
            # 以前 cy == ty 时直接 continue，于是换字号/切单行那种「整块落位」（_snap）后
            # 目标位置改了、字还钉在旧坐标上——字号一小字就叠到一块儿（11-21 21:41 滚轮截的图）。
            canvas.coords(slot["main"], 10, cy)
            for (_dx, _dy), _sid in zip(SHADOW_OFFSETS[0], slot["shadows"]):
                canvas.coords(_sid, 10 + _dx, cy + _dy)

    # 没有标题栏了：三个按钮浮在右上角，文字区自己撑满
    btnbar = tk.Frame(root, bg=body_bg, height=22)
    btnbar.place(relx=1.0, x=-8, y=3, anchor="ne")
    btnbar.lift()

    def place_bar():
        btnbar.place(relx=1.0, x=-8, y=3, anchor="ne")
        btnbar.lift()

    def hide_bar():
        try:
            btnbar.place_forget()
        except Exception:
            pass

    def bar_zone():
        """右上角「按钮那一条」的范围。

        锁定后按钮栏平时是收起来的（一直挂着挡画面），只有指针挪进这块区域才冒出来。
        窗口设了穿透时 tkinter 收不到鼠标事件，所以这块判断只能靠轮询光标位置，
        不能等 <Enter>。
        """
        try:
            wx, wy = root.winfo_rootx(), root.winfo_rooty()
            bw = max(88, btnbar.winfo_reqwidth())
            bh = max(18, btnbar.winfo_reqheight())
            return (wx + root.winfo_width() - bw - 12, wy, wx + root.winfo_width(), wy + bh + 10)
        except Exception:
            return None

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
    # 描边：四方向各垫一层，比自己算轮廓简单，也不会显得整块往一边偏。
    # 偏移半径跟着字号走（见 _shadow_offsets），字号一改要重算，所以放在列表里。
    # 每一行文字各占一套（主字 + 描边），这样老行能自己先淡，不用整条一起变。
    # 描边项一次建满 MAX_SHADOWS 个：透明档要两圈十六个，别的时候只用四个，
    # 用不到的留着藏着——不然换了样式还得把整池子拆了重建。
    SHADOW_OFFSETS = [_shadow_offsets(start_size, (state.get("style") or ""))]
    LINE_GAP = 6
    line_pool = []

    def line_slot(i):
        while len(line_pool) <= i:
            # 新格子要按「现在」的字号字体建：启动时是多少不代表现在还是多少，
            # 拿 start_size 建的话，改完字号再多出一行，那一行就是旧尺寸，跟上面几行对不齐
            _sz = int(state.get("size") or start_size)
            _fm = state.get("family") or start_family
            sh = []
            for _k in range(MAX_SHADOWS):
                sh.append(canvas.create_text(10, TOP_PAD, text="", fill=_shadow_base(fg, _sz),
                                             font=(_fm, _sz, "bold"),
                                             anchor="nw", width=W - 20, justify="left",
                                             state="hidden"))
            main = canvas.create_text(10, TOP_PAD, text="", fill=fg,
                                      font=(_fm, _sz, "bold"),
                                      anchor="nw", width=W - 20, justify="left",
                                      state="hidden")
            line_pool.append({"main": main, "shadows": sh, "text": "", "h": 20})
        return line_pool[i]

    def layout_shadows(slot):
        """按当前那张偏移表把一行的描边摆好；表里没有的项藏起来。"""
        offs = SHADOW_OFFSETS[0]
        cy = float(slot.get("cy", slot.get("ty", TOP_PAD)))
        for _i, _sid in enumerate(slot["shadows"]):
            if _i < len(offs):
                canvas.coords(_sid, 10 + offs[_i][0], cy + offs[_i][1])
            else:
                canvas.itemconfigure(_sid, state="hidden")

    def hide_from(i):
        for slot in line_pool[i:]:
            canvas.itemconfigure(slot["main"], state="hidden", text="")
            for _sid in slot["shadows"]:
                canvas.itemconfigure(_sid, state="hidden", text="")
            slot["text"] = ""
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
        bottom = TOP_PAD
        for slot in line_pool:
            # 用目标位置（ty）算高度，别用当前画布坐标：正在上滑的行还没到位，
            # 按当前坐标量窗口会先撑大再缩回，看着像抖一下
            if slot["text"]:
                ty = float(slot.get("ty", TOP_PAD))
                bottom = max(bottom, ty + float(slot.get("h") or 20))
        text_h = (bottom - TOP_PAD) if bottom > TOP_PAD else 20
        want_h = max(MIN_H, TOP_PAD + text_h + 8)
        want_w = max(MIN_W, min(MAX_W, state["w"]))
        # 淡完之后窗口会缩成一小条（不为一个空条子留一大块看不见的窗口）。
        # 唤醒只认这一小块，指针扫到这儿才算数——别的空白位置路过不算。
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
    last_real = []     # 最后显示过的真句子：宿主清空文件时拿它重摆，别闪成占位演示

    def layout(keep):
        """把这几行排上去：先量自然宽度决定条子多宽，再按各自高度从上往下摞。

        排位时让还在屏上的句子留在原来那一格：新句子只出现在最下面那格，
        老句子整列往上挪一格——看起来就是被新话「顶」上去，不是整块重画。
        位置是目标值，真正滑过去在 animate_rows 里一帧一帧做。
        """
        # 1) 每句话先认领格子：老句子优先留在自己原来那一格
        old = [(i, s["text"]) for i, s in enumerate(line_pool) if s["text"]]
        claim = {}
        used = set()
        for text in keep:
            if text in claim:
                continue
            for i, t in old:
                if t == text and i not in used:
                    claim[text] = i
                    used.add(i)
                    break
        need = len(keep)
        free = [i for i in range(max(need, len(line_pool))) if i not in used][:need]
        plan = []
        for text in keep:
            idx = claim.get(text)
            if idx is None:
                idx = free.pop(0) if free else 0
            plan.append((text, idx))

        # 2) 按 plan 把字放到格里，没轮到的格子藏起来
        shown = set()
        # 描边要不要亮，得在这儿定：apply_cfg 会把有底板的档位那圈描边藏起来，
        # 而单行/多行切一下，被藏起来的行再露出来时只有主字被叫醒——
        # 屏幕上看就是「描边没了」（11-21 20:26 她报的）。
        _rim = state.get("style") == "transparent"
        _noff = len(SHADOW_OFFSETS[0])
        for text, idx in plan:
            slot = line_slot(idx)
            canvas.itemconfigure(slot["main"], text=text, width=0, state="normal")
            for _i, _sid in enumerate(slot["shadows"]):
                canvas.itemconfigure(
                    _sid, text=text, width=0,
                    state="normal" if (_rim and _i < _noff) else "hidden")
            shown.add(idx)
        for i, slot in enumerate(line_pool):
            if i in shown:
                continue
            # 藏起来的行连字一起清掉：只藏不清的话，谁把它露出来就是一句旧话的鬼影
            # （11-21 23:05 她截的「单行 + 滚轮，两行字叠着」就是这么来的）。
            canvas.itemconfigure(slot["main"], state="hidden", text="")
            for _sid in slot["shadows"]:
                canvas.itemconfigure(_sid, state="hidden", text="")
            slot["text"] = ""
            slot.pop("ty", None)
            slot.pop("cy", None)
            slot["h"] = 20
        root.update_idletasks()  # 让 bbox 反映新文本，不然量到的是旧宽度

        # 3) 宽度：按最长那句撑开
        natural = 200
        for _text, idx in plan:
            b = canvas.bbox(line_pool[idx]["main"])
            if b:
                natural = max(natural, b[2] - b[0])
        if not state.get("manualW"):
            # 单行别撑太长：一句就一行左右折，太宽像横幅；多行才允许放宽
            cap = 720 if state["single"] else MAX_W
            state["w"] = max(MIN_W, min(cap, natural + 132))
        for _text, idx in plan:
            slot = line_pool[idx]
            canvas.itemconfigure(slot["main"], width=max(80, state["w"] - 20))
            for _sid in slot["shadows"]:
                canvas.itemconfigure(_sid, width=max(80, state["w"] - 20))
        root.update_idletasks()

        # 4) 从上往下摞，记下每一格的目标位置
        _snap = bool(state.pop("_snap", False))
        y = TOP_PAD
        for text, idx in plan:
            slot = line_pool[idx]
            b = canvas.bbox(slot["main"])
            h = (b[3] - b[1]) if b else 20
            slot["h"] = h
            if _snap:
                # 换档、换字号是整块重排：直接落到位。滑的话几行会一起从各自的旧高度
                # 往新位置挤，中途叠成一团（11-21 20:26 她截了图）。
                slot["cy"] = float(y)
            elif slot.get("text") != text:
                # 一句话里多出来的新行：先从下面一格的位置出发，由 animate_rows 滑上来
                slot["cy"] = float(y + h + LINE_GAP)
            slot["text"] = text
            slot["ty"] = float(y)
            if slot.get("cy") is None:
                slot["cy"] = float(y)
            y += h + LINE_GAP
        fit_height()
        paint_fade()

    def render(force=False):
        # 防重入：layout 末尾会再调一次 paint_fade，那边发现「该收了」又会折回来叫 render。
        # 没有这道闸，改字号之后重排一次能自己套自己，最后 RecursionError 把 tick 打死。
        if state.get("_inRender"):
            return
        state["_inRender"] = True
        try:
            _render(force)
        finally:
            state["_inRender"] = False

    def _render(force):
        raw = read_text()
        # 只留真句子，空行不再当分隔符用（行距本来就是分开的）
        lines = [l for l in (raw.split("\n") if raw else []) if l.strip()]
        if not lines:
            # 文件空有两种：真没说过话（显示占位演示），和宿主换窗口/清账时清空
            # （上一句还没到寿，被闪成「占位演示」）。后者保持原句别闪。
            alive = [l for l in last_real if l not in line_gone]
            fresh_ph = [p for p in PLACEHOLDER if p not in line_gone]
            if force or (not last_real and fresh_ph):
                # 一、手动改了设置（字号/单行）；二、还没说过话：摆占位演示。
                # 占位字是给人看排版效果的，每次都重新计时，不然刚改完字号就是淡没的样子。
                lines = list(PLACEHOLDER)
                _t0 = _now_ms()
                for _l in lines:
                    line_seen[_l] = _t0
                line_gone.clear()
            elif alive:
                # 上一句还没到寿：按原样重摆。以前这里直接 return，一改字号/切单行，
                # 条子还按老尺寸老位置摆着——字叠在一起，最后一行被窗口裁掉。
                lines = alive
                line_gone.clear()
            else:
                # 该收的都收干净了：把行藏起来，别每拍再画一遍空条子
                line_gone.clear()
                for _slot in line_pool:
                    canvas.itemconfigure(_slot["main"], state="hidden", text="")
                    for _sid in _slot["shadows"]:
                        canvas.itemconfigure(_sid, state="hidden", text="")
                    _slot["text"] = ""
                return
        else:
            # 这里别清 line_gone：深色/浅色档已经淡没的那句还在文件里，
            # 一清就又冒出来、然后立刻再淡没，每拍重排一次，费电还闪。
            last_real[:] = lines[-5:]
        if state["single"]:
            show = lines[-1:]
        else:
            show = lines[-5:]      # 最近五句，再多就顶出去了
        now = _now_ms()
        for l in show:
            if l not in line_seen:
                line_seen[l] = now
        # hud.txt 里已经删掉的行，时间记录也一起清掉，别越攒越多
        for l in list(line_seen):
            if l not in lines:
                line_seen.pop(l, None)
                line_gone.discard(l)
        show = [l for l in show if l not in line_gone]
        last_shown[0] = "\n".join(show) or last_shown[0]
        layout(show)

    def flash_style_test():
        """换样式时闪一条测试字，让人当场看到新样式长什么样。1.5 秒后恢复真内容。"""
        try:
            test = "测试：这是当前样式的效果，能看清吗？"
            line_gone.discard(test)
            line_seen[test] = _now_ms()
            last_shown[0] = test
            layout([test])
            root.after(1500, render)
        except Exception:
            pass

    # ---- 样式 ----
    def apply_cfg():
        cfg = read_config()
        st = str(cfg.get("hudStyle") or "dark")
        # 五档：dark / light / glass（抓背景不模糊）/ frosted（glass + 高斯模糊，毛玻璃）/ transparent。
        # 这里只挡真正不认识的旧值，别把 frosted 当废档归一掉。
        if st not in STYLE_ORDER:
            st = "dark"
        size = int(cfg.get("hudFontSize") or FONT_SIZE)
        family = str(cfg.get("hudFontFamily") or "Microsoft YaHei")
        opacity = float(cfg.get("hudOpacity") or 0.9)
        # 淡出两个时间：holdSec 多久开始淡，fadeSec 淡出本身持续多久
        state["fadeOn"] = cfg.get("hudFade") is not False
        try:
            hold_sec = float(cfg.get("hudHoldSec") or FADE_HOLD_MS / 1000.0)
        except Exception:
            hold_sec = FADE_HOLD_MS / 1000.0
        try:
            len_sec = float(cfg.get("hudFadeSec") or FADE_MS / 1000.0)
        except Exception:
            len_sec = FADE_MS / 1000.0
        state["holdMs"] = max(FADE_HOLD_LIMITS[0], min(FADE_HOLD_LIMITS[1], hold_sec)) * 1000.0
        state["fadeMs"] = max(FADE_LEN_LIMITS[0], min(FADE_LEN_LIMITS[1], len_sec)) * 1000.0
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
        if font_changed or style_changed:
            if font_changed:
                state["manualW"] = False  # 换字体重量宽度，别沿用旧的窄条
            # 描边的偏移表跟字号和样式都有关（透明档要两圈），任何一个变了都重算，
            # 再把屏上的行重摆一遍（animate_rows 在行已经停稳时会直接 continue，
            # 不重摆的话边会停在老位置）
            SHADOW_OFFSETS[0] = _shadow_offsets(size, st)
            for slot in line_pool:
                layout_shadows(slot)

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
            state["baseAlpha"] = 1.0
            state["alpha"] = 1.0
            set_colorkey(root)
            # 透明档也要能吃整窗透明度（淡出用），但必须带着颜色键一起设，
            # 否则键被抹掉，背景就从「透过去」变成一块实心暗色
            set_window_alpha(root, 1.0, True)
            state["bgAt"] = 0.0  # 下一次淡出重新采一次背后的颜色
            state["fg"] = text_color or "#eef4fb"
            # 没有标题栏，不用再调标题颜色
            for slot in line_pool:
                canvas.itemconfigure(slot["main"], fill=state["fg"],
                                     font=(family, size, "bold"),
                                     width=max(80, state["w"] - 20))
                # 透明档也得同步描边色，不然阴影还是建时的黑色，黑字压黑边等于没描。
                # 但**只伺候露在外面的行**：单行模式下把藏着的行的描边一起叫醒，
                # 它们那几句旧话就会在条子上露一脸（11-21 23:05「单行 + 滚轮」那张截图，
                # 就是藏着的两行描边被这里重新 normal 了，字还压在最新那句上）。
                _vis = canvas.itemcget(slot["main"], "state") != "hidden"
                if _vis:
                    layout_shadows(slot)
                for _i, _sid in enumerate(slot["shadows"]):
                    canvas.itemconfigure(_sid,
                                         state=("normal" if _i < len(SHADOW_OFFSETS[0]) else "hidden") if _vis else "hidden",
                                         fill=_shadow_base(state["fg"], size),
                                         font=(family, size, "bold"),
                                         width=max(80, state["w"] - 20))
            if bg_item[0] is not None:
                canvas.itemconfigure(bg_item[0], state="hidden")
            if font_changed:
                state["_snap"] = True   # 字号一变整块重排，直接落位
                render(True)  # 换字体要重量宽度，否则大字体被窄条裁掉；手动改设置要强制重排
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
            # 用户选什么就是什么。只有一种例外：字和底几乎一样亮，整条读不出来
            # （浅色底配近白字就是这么来的），那退回配色自带的字色——看不见的字条不算选择
            if _contrast(text_color, p_body) >= 2.2:
                p_fg = text_color
        # 只有深色/浅色吃这个透明度。玻璃的底板本身就是半透明叠出来的，
        # 再乘一次 alpha 会露出底下的深色 canvas，看着就是发黑。
        state["baseAlpha"] = max(0.0, min(1.0, opacity)) if st in ("dark", "light") else 1.0
        state["alpha"] = 1.0
        set_window_alpha(root, state["baseAlpha"], False)
        root.configure(bg=p_body)
        btnbar.configure(bg=p_body)
        canvas.configure(bg=p_body, highlightthickness=0)
        state["fg"] = p_fg
        state["bg"] = p_body
        for slot in line_pool:
            canvas.itemconfigure(slot["main"], fill=p_fg, font=(family, size, "bold"),
                                 width=max(80, state["w"] - 20))
            for _sid in slot["shadows"]:
                # 有背景的档位不需要描边，藏起来
                canvas.itemconfigure(_sid, state="hidden",
                                     font=(family, size, "bold"),
                                     fill=_shadow_base(p_fg, size),
                                     width=max(80, state["w"] - 20))
        if font_changed:
            state["_snap"] = True   # 字号一变整块重排，直接落位
            render(True)  # 按新字体重量宽度；手动改设置要强制重排，不然条子还按老尺寸摆着
        else:
            fit_height()
        if style_changed:
            root.after(80, flash_style_test)
        paint_fade()
        paint_backdrop(force=True)

    # ---- 按钮 ----
    def toggle_single():
        state["single"] = not state["single"]
        # 换档是整块重排，别让几行叠着滑过去
        state["_snap"] = True
        # 按钮上写清楚当前是哪一档，别让人靠猜符号
        btn_mini.config(text="多行" if state["single"] else "单行")
        # 切换要真刷新：force 让空文件也重排（占位演示要重新计时），
        # 不然按钮变了、条子还是三行/还是老的尺寸
        render(True)

    def toggle_lock():
        state["locked"] = not state["locked"]
        # 按钮一律写「当前状态」：锁着=已锁，能拖=可动。
        # 之前「锁/锁定」两种叫法分不清是状态还是动作，反着读也说得通。
        btn_lock.config(text="已锁" if state["locked"] else "可动")
        # 锁上就把按钮栏收起来，别一直挂在画面右上角；指针挪到那一角才冒头。
        # 解锁立刻放回来，不然人找不到解开的入口。
        if state["locked"]:
            hide_bar()
            set_click_through(root, True)
        else:
            place_bar()
            set_click_through(root, False)

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
                for slot in line_pool:
                    canvas.itemconfigure(slot["main"], width=max(80, nw - 20))
                    for _sid in slot["shadows"]:
                        canvas.itemconfigure(_sid, width=max(80, nw - 20))
                state["resizedW"] = True
                return
            for slot in line_pool:
                canvas.itemconfigure(slot["main"], width=max(80, nw - 20))
                for _sid in slot["shadows"]:
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
        # 只改配置，重排交给 apply_cfg：它会重算描边偏移、按新字号重量宽度、整块落位
        # （_snap + render(True)）。以前这里自己改 state 再 fit_height，行还钉在旧字号
        # 的位置和宽度上，字号一大字就叠在一起（11-21 21:41 她用 Ctrl+滚轮缩字号截的图）。
        cfg = read_config()
        cur = int(cfg.get("hudFontSize") or state.get("size") or FONT_SIZE)
        nxt = max(MIN_SIZE, min(MAX_SIZE, cur + (1 if e.delta > 0 else -1)))
        if nxt == cur:
            return
        write_config({"hudFontSize": nxt})
        apply_cfg()   # 别等下一拍轮询，滚轮要跟手

    def on_alpha_wheel(e):
        # 只有深色/浅色能滚透明度，别的档乘 alpha 会发黑
        if state.get("style") not in ("dark", "light"):
            return
        base = float(state.get("baseAlpha") or 0.9) + (0.05 if e.delta > 0 else -0.05)
        base = max(0.05, min(1.0, round(base, 3)))
        state["baseAlpha"] = base
        set_window_alpha(root, max(0.0, min(1.0, float(state.get("alpha", 1.0)) * base)),
                         state.get("style") == "transparent")
        write_config({"hudOpacity": base})

    canvas.bind("<Control-MouseWheel>", on_wheel)
    canvas.bind("<Shift-MouseWheel>", on_alpha_wheel)
    canvas.bind("<Double-Button-1>", lambda e: toggle_lock())
    # Esc 退出去掉了：窗口设了 no-activate，收不到键盘，绑了也用不了。退出走 × 按钮。

    # ---- 轮询 ----
    last = [None]
    cfg_mtime = [0.0]
    life = [0]
    last_grab = [0.0]
    through_tick = [0]

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
        # 宿主没了、或者面板上把字幕窗关了：自己也退，别让一条没人管的条子留在屏上。
        # 每 40 拍（约 0.6 秒）查一次就够了，不必每帧问系统。
        life[0] += 1
        if life[0] % 40 == 0:
            if PARENT_PID and not pid_alive(PARENT_PID):
                root.destroy()
                return
            if read_config().get("hudOn") is False:
                root.destroy()
                return
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
        # 淡出：每一行按自己的出现时间淡，鼠标扫回来就亮着
        paint_fade()
        # 锁定时字幕条要「点得穿」：不然她在游戏里点画面，鼠标被字幕条吞掉，
        # 打着打着就点空了。每 5 拍查一次光标，落在右上角按钮上时先收回穿透。
        # 淡到看不见的时候也一样放过鼠标，不然会在画面上留一块看不见的拦路石。
        through_tick[0] += 1
        if through_tick[0] % 5 == 0:
            faded = float(state.get("alpha", 1.0)) < 0.15
            locked = bool(state.get("locked"))
            pos = cursor_pos()
            zone = bar_zone()
            if pos and zone:
                in_btns = bool(zone[0] <= pos[0] <= zone[2] and zone[1] <= pos[1] <= zone[3])
            else:
                in_btns = True   # 算不出位置就让它出来，宁可偶尔挡一下也别点不到
            if locked:
                # 锁定时按钮栏平时收着，指针挪到右上角那一小块才冒出来
                if in_btns:
                    if not btnbar.winfo_ismapped():
                        place_bar()
                elif btnbar.winfo_ismapped():
                    hide_bar()
            if locked or faded:
                # 锁定时整条点得穿（游戏里点画面不会被吞）；只有指针在按钮上才收回穿透
                set_click_through(root, not (locked and in_btns))
            else:
                set_click_through(root, False)
        root.after(POLL_MS, tick)

    render()
    tick()
    root.mainloop()


if __name__ == "__main__":
    main()
