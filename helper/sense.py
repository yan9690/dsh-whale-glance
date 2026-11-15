#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-whale-glance helper —— 陪看的眼睛（拼图版）。

每隔 interval 抓一张屏，在 64×36 的网格上算 HSV 变化分；够分的帧先留着，
冷却到期时把攒下的帧拼成一张图交出去（宽度跟档位走），一张图的 token 摊到多帧画面上，
静止的屏幕几乎不出图。

`snap` 走另一条路：原始分辨率的全屏单帧。拼图里格子太小、看不清字的时候用这个。

stdin 每行一个 JSON 命令：
  {"op": "snap"}                                    立刻截一张全屏原图
  {"op": "config", "intervalMs": 2000, "threshold": 0.06, "cooldownMs": 45000, "maxWidth": 1280}
  {"op": "quit"}

stdout 每行一个 JSON：
  {"event": "ready"} / {"event": "config", ...}
  {"event": "change", "path": ..., "score": 0.21, "sheet": true, "frames": [{"t": 0.0, "score": 0.2}]}
  {"event": "snap", "path": ..., "full": true}
  {"event": "error", "message": ...}
"""

import collections
import ctypes
import difflib
import json
import math
import os
import msvcrt
import sys
import threading
import time
from ctypes import wintypes

if sys.platform != "win32":
    raise SystemExit("dsh-whale-glance 只支持 Windows")

try:
    from PIL import Image, ImageDraw, ImageFont, ImageGrab
except Exception as exc:  # pragma: no cover
    sys.stderr.write("Pillow 不可用: %r\n" % (exc,))
    raise SystemExit(2)

try:
    import numpy as np
except Exception as exc:  # pragma: no cover
    np = None
    sys.stderr.write("numpy 不可用，用纯 Python 差分: %r\n" % (exc,))

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

user32 = ctypes.windll.user32

# 三个模式（追剧 / 打游戏 / 随便看）× 三档（节约 / 平衡 / 极致）。
# 档位是预设包：选中就整套换掉 intervalMs / floorSec / 出图形式 / 单张宽度比例。
PROFILES = {
    "video": {
        "save":    {"intervalMs": 2500, "floorSec": 90.0, "sheetMode": "sheet", "singleRatio": 0.0,  "sheetW": 798,  "spanSec": 6, "maxFrames": 4},
        "balance": {"intervalMs": 2500, "floorSec": 60.0, "sheetMode": "both",  "singleRatio": 0.66, "sheetW": 1050, "spanSec": 8, "maxFrames": 6},
        "extreme": {"intervalMs": 2000, "floorSec": 45.0, "sheetMode": "both",  "singleRatio": 0.83, "sheetW": 1260, "spanSec": 10, "maxFrames": 9},
    },
    "game": {
        "save":    {"intervalMs": 1500, "floorSec": 90.0, "sheetMode": "sheet", "singleRatio": 0.0,  "sheetW": 798,  "spanSec": 6, "maxFrames": 4},
        "balance": {"intervalMs": 1000, "floorSec": 60.0, "sheetMode": "both",  "singleRatio": 0.66, "sheetW": 1050, "spanSec": 8, "maxFrames": 6},
        "extreme": {"intervalMs": 1000, "floorSec": 45.0, "sheetMode": "both",  "singleRatio": 0.83, "sheetW": 1260, "spanSec": 10, "maxFrames": 9},
    },
}
TIERS = ("save", "balance", "extreme")
MODES = ("video", "game")

STATE = {
    "auto": False,
    "normalize": True,
    "mode": "game",       # 默认游戏：桌面模式删了，只剩游戏 / 视频
    "windowMatch": "",
    "windowOnly": False,
    "hudCapturable": False,   # 字幕窗能不能被截屏拍到（玻璃档=True）
    "intervalMs": 2500,
    "threshold": 0.07,
    "cooldownMs": 45000,
    "maxWidth": 1280,
    "floorSec": 60.0,
    "silentMax": 300.0,     # 画面一直没变时，最多沉默这么久也看一眼
    "pace": "",             # 认出前台游戏的节奏：fast 快 / slow 慢 / "" 没认出
    "game": "",             # 认出前台游戏的名字
    "_lastTitle": "",       # 上次的前台标题，变了才重新认
    "singleEverySec": 180.0,   # 全屏图多久才给一张（拼图不受这个管，它便宜）
    "tier": {"video": "balance", "game": "balance"},
    "sheetMode": {"video": "", "game": ""},   # "" = 跟随档位默认
    "motion": 0.0,          # 最近几帧差分的平均，主循环每轮更新
    "stillSec": 0.0,        # 连续静止了几秒
    "jumped": False,        # 最近一次静止归零是不是「断崖」（打开面板）导致的
    "autoFetch": True,      # 认不出的游戏要不要自动联网抓百科补库（面板可关）
}

OUT_DIR = os.environ.get("SENSE_OUT_DIR") or os.path.join(
    os.path.expanduser("~"), ".dsh", "storages", "whale-glance", "frames"
)
DEBUG_LOG = os.path.join(OUT_DIR, "sense-debug.log")   # 快节奏调参用的采样日志：score / streak

LOCK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".helper.lock")
_LOCK_FILE = None


def claim_single_instance():
    """一个屏幕只留一个帮工。

    四个会话各拉一个 helper，每个都以为自己该发，冷却各算各的，合起来就成了
    「关了开关还在响」。用独占锁而不是 pid 文件——同时启动时 pid 文件会被
    四个进程一起覆盖，锁是原子的，只有一个能拿到。
    """
    global _LOCK_FILE
    try:
        _LOCK_FILE = open(LOCK_PATH, "a+", encoding="utf-8")
        msvcrt.locking(_LOCK_FILE.fileno(), msvcrt.LK_NBLCK, 1)
        return True
    except Exception:
        return False


GRID = (64, 36)
MAX_FRAMES = 4             # 兜底帧数（档位没配 maxFrames 时用）
BUFFER_CAP = 20            # 短历史留二十帧：动满要拼 16 格，得留够 + 余量
RECENT_FRAMES = 24         # 「看这一段」的滚动缓冲（只存缩略图，约 24MB）
MIN_CUT = 0.04             # 绝对地板：太灵敏会把光标抖动当变化
GUTTER = 2

# ---- 采样节奏自适应 ----
# 画面动得多快，决定下一次什么时候抓。打团那几秒要密，读科技树要慢。
MOTION_WINDOW = 5          # 最近五次差分的平均，比单帧稳
MOTION_BUSY = 0.06         # 高于它：在打，间隔压到三分之一（旧的，平均分口径，快节奏判定已弃用）
MOVING_SCORE_CUT = 0.05   # 单帧差分均值 ≥ 5% 算「有变动」。用 score 不用 area——area 被 cell_cut=0.12 卡掉，打团小变化上不来
MOVING_WINDOW = 10       # 最近多少帧算「近况」
MOVING_RATIO = 0.6      # 近况里 60% 帧在动，算「持续激烈」——不要求连续，打团的动是高低波动的
SWITCH_CUT = 0.95      # 单帧变化冲到 0.95 以上 = 切窗口/加载画面，不是游戏内容，别唤醒。
                       # 0.8 太狠：打 boss 放技能、爆炸特效也能冲到 0.85，被当成切屏，一晚上不开口。
MOTION_STILL = 0.02        # 低于它：基本静止
READ_MOTION_CUT = 0.06     # 读字判「是不是停着看东西」的阈值：比 MOTION_STILL 宽，
                           # 菜单文字在变、角色待机微动时 score 常是 0.04-0.08，用 0.02 判
                           # 静止永远凑不满，读字这条就进不去（「停留很久图上有字也没触发」）
STILL_READ_SEC = 5.0       # 路 A：连续静止这么久，认为人在读字（11-13 从 8 改到 5，停着思考就插话）
READ_JUMP_HOLD = 2.0       # 路 B：断崖（画面突增，像打开面板）之后稳住这么久就进读字，不用等满 5 秒
READ_JUMP_DELTA = 0.25     # 断崖判据：score 比前几帧均值高这么多
READ_JUMP_ABS = 0.3        # 且绝对值过这个门槛，才算断崖（不是普通小动作）
STILL_SAMPLE_SEC = 12.0    # 静止时也隔这么久留一帧，免得想问的时候没图

# ---- 亮度归一 + 黑边补偿（移植自 dsh-see-now 0.2 / Apache-2.0）----
# 绝对 HSV 差配常数阈值，暗场必漏切点。这里把分数换算到「参考亮度 96、无黑边」的刻度上。
REF_V = 96          # 标定点：亮画面（V ≥ 96）gain 恒为 1，日常桌面不受影响
GAIN_MAX = 1.85     # 逐档压暗实测的饱和点（不是 3，3 会过冲）
V_FLOOR = 40        # meanV 低于它按 40 算，防止除爆
NOISE_FLOOR = 2     # 0–255 刻度上的噪声地板，以下不放大
BAR_MEAN = 16       # 黑边行：窗口内 V 均值 < 它
BAR_MAX = 24        # 且一次都没亮过（峰值 < 它）
BAR_CAP = 0.35      # 黑边占比超过它 = 整段黑场，不补偿
BAR_WINDOW = 24     # 判「一直黑」的窗口帧数
BG = (52, 52, 58)   # 拼图底色：改中灰。帧数不够格子不满时，空位是灰的不是黑的（黑格看着像抓坏了）
SEAM = (58, 58, 64)
TAG_BG = (255, 235, 59)
TAG_FG = (12, 12, 14)

GRAB_LOCK = threading.Lock()
FRAMES_LOCK = threading.Lock()
BUFFER = []                # [{"small", "full", "t", "score"}]
RECENT = collections.deque(maxlen=RECENT_FRAMES)   # 「看这一段」用的滚动缩略图
ROWS = collections.deque(maxlen=BAR_WINDOW)   # 滚动窗口里的逐行 V 均值


def emit(payload):
    # 宿主按 UTF-8 解码。Windows 的 stdout 默认是 GBK，窗口标题里碰到
    # 零宽空格这类字符会直接抛 UnicodeEncodeError，所以自己写字节。
    # 埋点：helper 这边每次 emit 都留一条，用来判断「拍了图没下文」是
    # helper 没发出来，还是发了宿主没收到。
    try:
        with open(os.path.join(OUT_DIR, "helper-emit.log"), "a", encoding="utf-8") as _f:
            _f.write(json.dumps({"at": time.time(), "event": payload.get("event"), "op": payload.get("op")}, ensure_ascii=False) + "\n")
    except Exception:
        pass
    data = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def log(text):
    sys.stderr.write(str(text) + "\n")
    sys.stderr.flush()


def foreground_title():
    try:
        hwnd = user32.GetForegroundWindow()
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return ""
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        return buf.value.strip()
    except Exception:
        return ""


# 游戏资料库：games-all.json（预置几百个游戏的名称/简介/类型）。
GAME_DB = {}
# 游戏黑话 + 基础规则：games-notes.json（按游戏名索引）。
GAME_NOTES = {}


def _norm(s):
    """小写 + 只留字母数字（中文保留），用于游戏名子串匹配。

    以前这里排掉了非 ASCII，等于中文游戏名（洛克王国这类）永远认不出来。
    """
    return "".join(c for c in (s or "").lower() if c.isalnum())


def _words(s):
    """英文标题按词切分（小写、只留字母数字），中文原样连着。

    英文不能直接做子串匹配：短词会误中别的游戏名（如 `raft` 藏在别的名字里）。
    所以英文按词比，中文才用子串（中文没有词边界这回事）。
    """
    out = []
    buf = []
    for c in (s or "").lower():
        if c.isascii() and c.isalnum():
            buf.append(c)
        else:
            if buf:
                out.append("".join(buf))
                buf = []
            if c.isalnum():
                out.append(c)
    if buf:
        out.append("".join(buf))
    return out


def _is_cjk(s):
    return any("\u4e00" <= c <= "\u9fff" for c in (s or ""))


def _words_contain(needle, haystack):
    """needle 的词序列是否完整出现在 haystack 里（整词对齐，不切词）。"""
    if not needle or not haystack or len(needle) > len(haystack):
        return False
    for i in range(len(haystack) - len(needle) + 1):
        if haystack[i:i + len(needle)] == needle:
            return True
    return False


def load_game_notes():
    """读 games-notes.json：每款游戏的「黑话 + 基础规则」。

    这份以前只有 game_probe.py（命令行体检）在读，主链路从来没加载过——
    等于采集好的黑话一直躺在文件里、模型一个字都看不到，只能看画面瞎猜。
    现在按规范化游戏名建索引，detect_game 命中后带进事件。
    """
    global GAME_NOTES
    # 黑话库放用户数据目录（跟 host 的 notesPath 一致）；旧版本在插件目录，
    # 首次读到新位置时自动迁移过去。
    fresh = os.path.join(os.path.expanduser("~"), ".dsh", "storages", "whale-glance", "games-notes.json")
    legacy = os.path.join(os.path.dirname(os.path.abspath(__file__)), "games-notes.json")
    if not os.path.exists(fresh) and os.path.exists(legacy):
        try:
            os.makedirs(os.path.dirname(fresh), exist_ok=True)
            import shutil
            shutil.copyfile(legacy, fresh)
        except Exception:
            pass
    path = fresh if os.path.exists(fresh) else legacy
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return
    for name, note in data.items():
        key = _norm(name)
        if key and isinstance(note, dict):
            GAME_NOTES[key] = note


def game_note(name):
    """按游戏名取黑话和规则；没有就返回空。"""
    key = _norm(name or "")
    if not key:
        return None
    note = GAME_NOTES.get(key)
    if note:
        return note
    # 名字带后缀（「某某：副标题」vs「某某」）时，退回前缀匹配
    for k, v in GAME_NOTES.items():
        if k and (k in key or key in k):
            return v
    return None


def load_game_db():
    """读 games-all.json 到 GAME_DB。key 用英文名规范化。"""
    global GAME_DB
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "games-all.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return
    for aid, info in data.items():
        name = (info or {}).get("name", "")
        key = _norm(name)
        if key and key not in GAME_DB:
            GAME_DB[key] = info


def detect_game(title):
    """窗口标题 -> (游戏名, 节奏, 资料)；认不出返回 (None, None, None)。

    用 games-all.json 的英文名做子串匹配：标题的英文串落在某个游戏英文名里就算中。
    """
    key = _norm(title)
    # 至少两个字才比：一个中文字或一个英文字母会误匹配一大片
    if len(key) < 2:
        return None, None, None

    def shape(info, pace):
        return info.get("name", ""), pace, info

    def pace_of(info):
        # 不再用类型词猜快慢（动作/策略标签会判反）。采样节奏交给画面 motion，
        # 这里只保留字段兼容，恒返回空——detect_game 的返回值里 pace 就没用了。
        return ""

    # 三级：先精确命中（名字或别名完全等于标题），再退到模糊。
    # 模糊匹配要分语言：中文用子串（中文没有词边界），英文按词边界
    # （短词会误中别的游戏名）。
    loose = None   # (长度, info) —— 模糊里挑最长的名字，越具体越准
    key_words = _words(title)
    for gkey, info in GAME_DB.items():
        name_key = _norm(info.get("name", "")) or _norm(gkey)
        if not name_key:
            continue
        # 每一组都留「规范化串」和「原始串」两份：
        # 精确匹配用规范化的（去空格/标点），英文词边界匹配必须用原始的，
        # 否则 `Witch's Apocalyptic Journey` 被压成 `witchsapocalypticjourney`，
        # 再也切不出词，永远对不上。
        name_raw = str(info.get("name", ""))
        pairs = [(name_key, name_raw)]
        for a in (info.get("aliases") or []):
            an = _norm(a)
            if an:
                pairs.append((an, str(a)))
        for nk, nk_raw in pairs:
            if key == nk:
                # 精确命中但这条没类型（旧数据只有名字），先记下继续找，
                # 库里可能还有另一条带类型的中文条目能对上。
                if info.get("genres"):
                    return shape(info, pace_of(info))
                if loose is None or len(nk) > loose[0]:
                    loose = (len(nk), info)
                continue
            # 中文子串：只在两边都含中文时试，三字以上才做（两字词太容易误命中）
            if _is_cjk(nk) and _is_cjk(key) and len(key) >= 3 and (key in nk or nk in key):
                if loose is None or len(nk) > loose[0]:
                    loose = (len(nk), info)
            # 英文词边界：中英混排的名字也要能用英文标题认出来。
            # 以前只在 nk 不含中文时才走这里，导致中文名+英文名的条目永远匹配不上英文窗口标题。
            nk_words = [w for w in _words(nk_raw) if not _is_cjk(w)]
            if len(nk_words) > 1 or (nk_words and nk_words == key_words):
                if nk_words == key_words:
                    return shape(info, pace_of(info))
                if len(nk_words) > 1 and _words_contain(key_words, nk_words):
                    if loose is None or len(nk) > loose[0]:
                        loose = (len(nk), info)
    if loose is not None:
        return shape(loose[1], pace_of(loose[1]))
    return None, None, None


# ---- 认不出的游戏：后台抓一次百科回填 ----
FETCH_TRIED = set()       # 试过的标题，一个只试一次，别循环抓
FETCH_LOCK = threading.Lock()
PENDING_SENT = set()      # 已经发过「这是不是游戏」的标题，一个只问一次
DISMISSED = set()         # 用户点过「不是游戏」的标题，永远不再问
GAME_STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "game-state.json")


def _load_game_state():
    """启动时把三个去重集合从磁盘读回来，重启不丢、不重复问。"""
    try:
        with open(GAME_STATE_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return
    for key, target in (("fetch_tried", FETCH_TRIED), ("pending_sent", PENDING_SENT), ("dismissed", DISMISSED)):
        items = data.get(key)
        if isinstance(items, list):
            target.update(str(x) for x in items)


def _save_game_state():
    """三个去重集合写盘。文件小、改得少，直接整写，不加锁也不碍事。"""
    try:
        data = {
            "fetch_tried": sorted(FETCH_TRIED),
            "pending_sent": sorted(PENDING_SENT),
            "dismissed": sorted(DISMISSED),
        }
        with open(GAME_STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    except Exception:
        pass

# 判断「前台窗口像不像游戏」的启发式。宁可漏掉（不问），也别拿浏览器标题去骚扰。
GAME_EXE_MARKERS = ("steamapps", "epic games", "gog galaxy", "gog games",
                    "battle.net", "riot games", "ubisoft", "xbox games")
GAME_CLASS_MARKERS = ("unitywndclass", "unrealwindow", "sdl_app", "glfw30",
                      "glfw", "godot", "direct3dwindowclass", "cryengine")
NON_GAME_EXE = ("chrome.exe", "firefox.exe", "msedge.exe", "explorer.exe", "code.exe",
                "devenv.exe", "powershell.exe", "cmd.exe", "notepad.exe", "qq.exe",
                "wechat.exe", "winword.exe", "excel.exe", "spotify.exe", "photoshop.exe",
                # 启动器不是游戏：它们常带 SDL_app 之类的引擎类名，不排掉会被误判
                "steam.exe", "steamwebhelper.exe", "steamservice.exe",
                "epicgameslauncher.exe", "battle.net.exe", "riotclientservices.exe",
                "goggalaxy.exe", "galaxyclient.exe", "ubisoftconnect.exe")
NON_GAME_CLASS = ("chrome_widgetwin_1", "mozillawindowclass", "cabinetwclass", "#32770",
                  "progman", "workerw", "applicationframeinputwindow",
                  "windows.ui.core.corewindow")


def foreground_exe_cls():
    """前台窗口的 (exe 全路径, 类名)。拿不到就返回空串，不抛。"""
    try:
        hwnd = user32.GetForegroundWindow()
        cls = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, cls, 256)
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        exe = ""
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x1000, False, pid.value)   # PROCESS_QUERY_LIMITED_INFORMATION
        if h:
            buf = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(1024)
            if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                exe = buf.value
            k32.CloseHandle(h)
        return exe, cls.value
    except Exception:
        return "", ""


def is_likely_game(exe, cls):
    """前台窗口像不像游戏。明确排除（浏览器/编辑器/资源管理器）优先，
    再认平台目录和引擎类名；两样都没有就保守当「不是」。"""
    en = os.path.basename(exe or "").lower()
    cn = (cls or "").lower()
    if en in NON_GAME_EXE or cn in NON_GAME_CLASS:
        return False
    if any(m in (exe or "").lower() for m in GAME_EXE_MARKERS):
        return True
    if any(m in cn for m in GAME_CLASS_MARKERS):
        return True
    return False


# 类型词表：百度百科的 desc 里常写着「角色扮演游戏」「模拟经营游戏」，
# 卡片里的 m9_class 又只给「D类单机游戏」这种粗分类。补库要的是类型，就从 desc 里捞。
_GENRE_WORDS = [
    "角色扮演", "模拟经营", "模拟", "即时战略", "策略", "动作冒险", "动作", "射击",
    "冒险", "解谜", "卡牌", "音乐", "体育", "竞速", "沙盒", "生存", "建造", "塔防",
    "养成", "开放世界", "平台跳跃", "roguelike", "rogue", "独立", "休闲", "恐怖",
]


def _genres_from_desc(desc):
    """从简介里捞类型词，按词表顺序去重，最多留三个。"""
    text = str(desc or "").lower()
    found = []
    for word in _GENRE_WORDS:
        if word.lower() in text and word not in found:
            found.append(word)
    return found[:3]


def _bk_lookup(keyword):
    """百度百科公开 API：返回 (title, desc, genres) 或 None。不带 key。"""
    import re
    import urllib.request
    import urllib.parse

    u = ("https://baike.baidu.com/api/openapi/BaikeLemmaCardApi"
         "?scope=103&format=json&appid=379020&bk_length=300&bk_key="
         + urllib.parse.quote(keyword))
    try:
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return None
    desc = str(d.get("desc", "")).strip()
    title = str(d.get("title", keyword)).strip()
    genres = []
    for c in d.get("card", []):
        if c.get("key") == "m9_class":
            # 值里常带 <sup> 引用和标签，清掉
            for x in (c.get("value") or []):
                clean = re.sub(r"<[^>]+>", "", str(x))
                clean = re.sub(r"\[\d+\]", "", clean)
                clean = re.sub(r"\d+$", "", clean).strip()
                if clean and clean not in genres:
                    genres.append(clean)
    # m9_class 往往只有「D类单机游戏」，再从简介里捞真类型
    for g in _genres_from_desc(desc):
        if g not in genres:
            genres.append(g)
    if not desc or not genres:
        return None
    return title, desc, genres


def _steam_lookup(keyword):
    """Steam 商店公开接口：搜 appid 再拿详情，返回 (title, desc, genres) 或 None。

    百度百科对不少游戏没有「分类」卡片（Cult of the Lamb 就是），补库于是永远失败；
    Steam 的类型和简介是现成的，还有中文。不用 key。
    """
    import urllib.request
    import urllib.parse

    try:
        u = ("https://store.steampowered.com/api/storesearch/?term="
             + urllib.parse.quote(keyword) + "&l=schinese&cc=CN")
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
        items = d.get("items") or []
        appid = items[0].get("id") if items else None
        if not appid:
            return None
        u2 = "https://store.steampowered.com/api/appdetails?appids=%s&l=schinese" % appid
        req2 = urllib.request.Request(u2, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req2, timeout=10) as r:
            d2 = json.loads(r.read().decode("utf-8", "replace"))
        info = (d2.get(str(appid)) or {}).get("data") or {}
        name = str(info.get("name") or "").strip()
        desc = str(info.get("short_description") or "").strip()
        genres = [str(g.get("description") or "").strip() for g in (info.get("genres") or [])]
        genres = [g for g in genres if g]
        if not name or not desc:
            return None
        return name, desc, genres
    except Exception:
        return None


# ---- 小黑盒签名（照 heybox 插件，MIT，https://github.com/fbbDirge/dsh-xiaoheihe）----
# 用来把英文窗口标题翻成中文名：百度百科对英文名常搜不到，
# 对中文名就能搜到，缺的只是一次翻译。
_HB_ALPHABET = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89"


def _hb_md5(s):
    import hashlib
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _hb_vm(e):
    return (255 & ((e << 1) ^ 27)) if (128 & e) else (e << 1)


def _hb_qm(e):
    return _hb_vm(e) ^ e


def _hb_dollar(e):
    return _hb_qm(_hb_vm(e))


def _hb_ym(e):
    return _hb_dollar(_hb_qm(_hb_vm(e)))


def _hb_gm(e):
    return _hb_ym(e) ^ _hb_dollar(e) ^ _hb_qm(e)


def _hb_km(e):
    t = [0, 0, 0, 0]
    t[0] = _hb_gm(e[0]) ^ _hb_ym(e[1]) ^ _hb_dollar(e[2]) ^ _hb_qm(e[3])
    t[1] = _hb_qm(e[0]) ^ _hb_gm(e[1]) ^ _hb_ym(e[2]) ^ _hb_dollar(e[3])
    t[2] = _hb_dollar(e[0]) ^ _hb_qm(e[1]) ^ _hb_gm(e[2]) ^ _hb_ym(e[3])
    t[3] = _hb_ym(e[0]) ^ _hb_dollar(e[1]) ^ _hb_qm(e[2]) ^ _hb_gm(e[3])
    e[0], e[1], e[2], e[3] = t[0], t[1], t[2], t[3]
    return e


def _hb_av(text, offset):
    sliced = _HB_ALPHABET[:offset]
    return "".join(sliced[ord(c) % len(sliced)] for c in text)


def _hb_sv(text):
    return "".join(_HB_ALPHABET[ord(c) % len(_HB_ALPHABET)] for c in text)


def _hb_interleave(arr):
    out = []
    for i in range(max(len(s) for s in arr)):
        for s in arr:
            if i < len(s):
                out.append(s[i])
    return "".join(out)


def _hb_ov(path, timestamp, nonce):
    np = "/" + "/".join([s for s in path.split("/") if s]) + "/"
    inter = _hb_interleave([_hb_av(str(timestamp), -2), _hb_sv(np), _hb_sv(nonce)])[:20]
    h = _hb_md5(inter)
    trans = _hb_km([ord(c) for c in h[-6:]])
    cs = str(sum(trans) % 100)
    if len(cs) < 2:
        cs = "0" + cs
    return _hb_av(h[:5], -4) + cs


def _hb_signature(path):
    import random
    import time
    ts = int(time.time())
    nonce = _hb_md5(str(ts) + str(random.random())).upper()
    return _hb_ov(path, ts + 1, nonce), ts, nonce


def _hb_credential():
    """小黑盒登录态：优先余光自己存的，其次借 heybox 插件的。"""
    home = os.path.expanduser("~")
    for p in (os.path.join(home, ".dsh", "storages", "whale-glance", "cred", "heybox.json"),
              os.path.join(home, ".dsh", "heybox", "state.json")):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            if d.get("cookie") and d.get("deviceId"):
                return str(d["cookie"]), str(d["deviceId"])
        except Exception:
            continue
    return "", ""


def _heybox_game(keyword):
    """小黑盒搜索，返回 (中文名, steam_appid)；查不到返回 ("", "")。"""
    import urllib.request
    import urllib.parse
    cookie, device_id = _hb_credential()
    if not cookie or not device_id:
        return "", ""
    api_path = "/bbs/app/api/general/search/v1/web"
    try:
        hkey, ts, nonce = _hb_signature(api_path)
        params = {
            "os_type": "web", "app": "heybox", "client_type": "web", "version": "999.0.4",
            "web_version": "2.5", "x_client_type": "web", "x_app": "heybox_website",
            "heybox_id": "", "x_os_type": "Windows", "device_info": "Chrome",
            "device_id": device_id, "hkey": hkey, "_time": str(ts), "nonce": nonce,
            "q": keyword, "search_type": "general", "offset": "0", "limit": "15",
        }
        u = "https://api.xiaoheihe.cn" + api_path + "?" + "&".join(
            "%s=%s" % (urllib.parse.quote(k), urllib.parse.quote(str(v))) for k, v in params.items())
        req = urllib.request.Request(u, headers={
            "User-Agent": "Mozilla/5.0", "Accept": "*/*",
            "Referer": "https://www.xiaoheihe.cn", "Origin": "https://www.xiaoheihe.cn",
            "Cookie": cookie,
        })
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
        if d.get("status") != "ok":
            return "", ""
        for it in (d.get("result", {}).get("items") or []):
            if it.get("type") == "new_game_list":
                for g in ((it.get("info") or {}).get("game_list") or []):
                    n = str(g.get("name") or "").strip()
                    if n:
                        return n, str(g.get("steam_appid") or "").strip()
    except Exception:
        return "", ""
    return "", ""


def _heybox_lookup(keyword):
    """只要中文名。"""
    return _heybox_game(keyword)[0]


def _find_edge():
    """找一个能用无头模式的 Chromium 浏览器：Edge（Windows 自带）优先，其次 Chrome。"""
    import shutil
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return shutil.which("msedge") or shutil.which("chrome") or ""


def _heybox_page_genres(appid):
    """截小黑盒游戏页 + 本地 OCR，把类型标签读回来。

    小黑盒的 API 不返回类型（genres 永远是空数组），但网页上有
    「动作 冒险 独立 策略 基地建设」「动作类 Rogue」。绕开接口：
    用 Edge 无头截图，再用 RapidOCR 读字。只依赖 Windows 自带 Edge。
    """
    import re
    import subprocess
    import tempfile
    edge = _find_edge()
    if not edge or not appid:
        return ""
    out = os.path.join(tempfile.gettempdir(), "heybox_game_%s.png" % appid)
    # 页面是单页应用，偶尔截到还没渲染完的空壳（几十 KB）。太小就重试，
    # 正常渲染出来都在两百 KB 以上。
    for attempt in range(3):
        try:
            if os.path.exists(out):
                os.remove(out)
            subprocess.run(
                [edge, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
                 "--disable-extensions", "--screenshot=" + out, "--window-size=1280,1000",
                 "https://www.xiaoheihe.cn/app/topic/game/pc/%s" % appid],
                timeout=45, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception:
            return ""
        try:
            if os.path.exists(out) and os.path.getsize(out) > 100 * 1024:
                break
        except OSError:
            pass
        time.sleep(2)
    if not os.path.exists(out):
        return ""
    try:
        from PIL import Image
        lines = ocr_read(Image.open(out).convert("RGB"))
    except Exception:
        return ""
    genres = []
    for line in lines:
        for word in _GENRE_WORDS:
            if word.lower() in line.lower() and word not in genres:
                genres.append(word)
        m = re.search(r"([\u4e00-\u9fff]{2,6}类\s*[A-Za-z]+)", line)
        if m and m.group(1) not in genres:
            genres.append(m.group(1))
    return "、".join(genres[:6])


def bg_fetch_game(title):
    """后台补库：认不出就抓一次百科，写回 games-all.json 并更新 STATE。

    抓到就把这个标题当已确认游戏（从待确认里撤下）；没抓到就不动，
    让宿主那边的「这是不是游戏」卡片继续问用户。
    """
    if title in DISMISSED:
        # 用户点过「不是游戏」：既不再问、也不再补库，不然每次都白学一遍
        return
    got = _bk_lookup(title)
    cn, appid = _heybox_game(title)
    if not got and cn and cn != title:
        got = _bk_lookup(cn)
    if not got:
        got = _steam_lookup(title)
    if not got:
        return
    name, desc, genres = got
    # 截图 OCR 补类型：百度百科只给「角色扮演」这种，小黑盒页面给的是
    # 「动作 冒险 独立 策略 基地建设 / 动作类 Rogue」——准得多。有 appid 就试一次。
    if appid:
        extra = _heybox_page_genres(appid)
        if extra:
            merged = list(genres)
            for g in extra.split("、"):
                if g and g not in merged:
                    merged.append(g)
            genres = merged
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "games-all.json")
        with FETCH_LOCK:
            data = {}
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
            key = _norm(name)
            if not key:
                return
            # aliases 存原始窗口标题（常是英文名）：百科给的是中文名，下次窗口标题
            # 还是英文，没这条别名就永远匹配不上中文条目，等于白补。
            aliases = [title] if title and _norm(title) != key else []
            data[key] = {"name": name, "short_description": desc, "genres": genres, "aliases": aliases}
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            GAME_DB[key] = data[key]
        STATE["game"] = name
        STATE["pace"] = ""
        # 抓到就说明标题确实是个游戏，不用再问
        PENDING_SENT.discard(title)
        _save_game_state()
        # 告诉面板「学到新游戏了」，让自动补库这件事能被人看见，
        # 而不是默默写文件、谁也不知道它补没补。
        try:
            emit({
                "event": "game-learned",
                "title": title,
                "game": name,
                "genres": genres,
            })
        except Exception:
            pass
    except Exception:
        pass


def resolve_unknown(title, is_game, game_name=""):
    """面板的「这是不是游戏」答复。

    is_game=False  -> 记进 DISMISSED，这个标题永远不再问。
    is_game=True   -> 把 game_name（可选，空则用标题）当别名写回库；没给名就先记一条待办。
    """
    if not is_game:
        DISMISSED.add(title)
        _save_game_state()
        return
    name = (game_name or "").strip() or title
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "games-all.json")
        with FETCH_LOCK:
            data = {}
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
            key = _norm(name)
            if not key:
                return
            if key not in data:
                data[key] = {"name": name, "short_description": "", "genres": [], "aliases": [title]}
            else:
                info = data[key]
                aliases = set(info.get("aliases") or [])
                aliases.add(title)
                info["aliases"] = sorted(aliases)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            GAME_DB[key] = data[key]
        STATE["game"] = name
        PENDING_SENT.discard(title)
        _save_game_state()
    except Exception:
        pass


def foreground_rect():
    """前台窗口在屏幕上的矩形。拿不到就 None，调用方退回整屏。"""
    try:
        hwnd = user32.GetForegroundWindow()
        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return None
        if rect.right - rect.left < 64 or rect.bottom - rect.top < 64:
            return None
        return (rect.left, rect.top, rect.right, rect.bottom)
    except Exception:
        return None


def grab_rect(rect):
    with GRAB_LOCK:
        return ImageGrab.grab(bbox=rect, all_screens=False)


def foreground_hwnd():
    """当前前台窗口句柄。拿不到返回 None。"""
    try:
        hwnd = user32.GetForegroundWindow()
        if hwnd and user32.IsWindowVisible(hwnd):
            return hwnd
    except Exception:
        pass
    return None


def grab_window_direct(hwnd):
    """按窗口要它自己渲染的画面（PrintWindow + PW_RENDERFULLCONTENT）。

    和「截屏幕上那块矩形」的区别：叠在这个窗口上面的东西——字幕窗、弹幕、聊天窗、
    弹窗——都不会进图，拿到的是窗口自己画的内容。
    这也意味着字幕窗开不开「可截图」，陪看这边都不受影响：那条开关只管人自己截图/录屏。

    独占全屏、或者个别游戏会返回全黑图，这种返回 None，调用方退回 grab_rect，
    行为跟以前一样，不会因为它拿不到就整个失灵。
    """
    try:
        gdi32 = ctypes.windll.gdi32
        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return None
        w = rect.right - rect.left
        h = rect.bottom - rect.top
        if w < 64 or h < 64:
            return None
        hdc = user32.GetWindowDC(hwnd)
        mdc = gdi32.CreateCompatibleDC(hdc)
        bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
        old = gdi32.SelectObject(mdc, bmp)
        ok = user32.PrintWindow(hwnd, mdc, 2)  # PW_RENDERFULLCONTENT
        img = None
        if ok:
            class BITMAPINFOHEADER(ctypes.Structure):
                _fields_ = [
                    ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                    ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                    ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                    ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
                    ("biClrImportant", wintypes.DWORD),
                ]
            bi = BITMAPINFOHEADER()
            bi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bi.biWidth = w
            bi.biHeight = -h
            bi.biPlanes = 1
            bi.biBitCount = 32
            bi.biCompression = 0
            buf = ctypes.create_string_buffer(w * h * 4)
            if gdi32.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(bi), 0) == h:
                img = Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB")
        gdi32.SelectObject(mdc, old)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(mdc)
        user32.ReleaseDC(hwnd, hdc)
        if img is None:
            return None
        # 整张单色（全黑/全白）就是没抓到，别当画面喂下去
        ext = img.getextrema()
        if all(lo == hi for lo, hi in ext) and ext[0][0] in (0, 255):
            return None
        return img
    except Exception:
        return None


def list_windows():
    """当前看得见的顶层窗口标题，去重、去空、排序。给面板做下拉用。"""
    titles = []
    seen = set()

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _walk(hwnd, _lparam):
        try:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value.strip()
            if title and title not in seen:
                seen.add(title)
                titles.append(title)
        except Exception:
            pass
        return True

    try:
        user32.EnumWindows(_walk, 0)
    except Exception:
        pass
    return sorted(titles)


def grab_full():
    with GRAB_LOCK:
        return ImageGrab.grab(all_screens=False)


def find_window_rect(match):
    """按标题子串找一个可见窗口，返回 (rect, title)。找不到返回 (None, "")。

    用于「看我一眼」：面板里选定了只看某个窗口，就该抓那一块——
    哪怕它被别的窗口挡着、不在前台。找不到才退回前台那块。
    """
    want = (match or "").strip().lower()
    if not want:
        return None, ""
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _walk(hwnd, _lparam):
        try:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value.strip()
            if not title or want not in title.lower():
                return True
            rect = wintypes.RECT()
            if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
                w = rect.right - rect.left
                h = rect.bottom - rect.top
                if w >= 64 and h >= 64:
                    found.append(((rect.left, rect.top, rect.right, rect.bottom), title))
        except Exception:
            pass
        return True

    try:
        user32.EnumWindows(_walk, 0)
    except Exception:
        pass
    return found[0] if found else (None, "")


def find_window_hwnd(match):
    """按标题子串找可见窗口，返回 (hwnd, title)。找不到返回 (None, "")。

    「看我一眼」要用它：拿到句柄就能向窗口要画面（PrintWindow），
    游戏在后台、被别的窗口挡着、无边框全屏也照样能截到。
    只按屏幕矩形截的话，截到的是盖在上面的那个窗口（通常是 DSH 自己）。
    """
    want = (match or "").strip().lower()
    if not want:
        return None, ""
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _walk(hwnd, _lparam):
        try:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value.strip()
            if not title or want not in title.lower():
                return True
            rect = wintypes.RECT()
            if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
                w = rect.right - rect.left
                h = rect.bottom - rect.top
                if w >= 64 and h >= 64:
                    found.append((hwnd, title))
        except Exception:
            pass
        return True

    try:
        user32.EnumWindows(_walk, 0)
    except Exception:
        pass
    return found[0] if found else (None, "")


# 抓不到时日志节流用的时间戳
_LAST_MISS = [0.0]


def _is_fullscreen(rect):
    """矩形是不是几乎占满整个屏幕——全屏独占游戏的前台窗口判断。"""
    try:
        sw = int(ctypes.windll.user32.GetSystemMetrics(0)) or 1920
        sh = int(ctypes.windll.user32.GetSystemMetrics(1)) or 1080
        l, t, r, b = rect
        return (r - l) >= sw * 0.95 and (b - t) >= sh * 0.95
    except Exception:
        return False


def mask_hud(img, ox=0, oy=0):
    """把字幕窗（标题「余光」）那块涂黑。

    可截图模式 + 全屏游戏时只能截屏，截屏会把字幕窗自己拍进来；不涂掉的话
    它会被 OCR 认回去、或者让模型把「占位演示」当成画面内容。
    ox/oy 是这张图对应屏幕左上角的偏移（窗口矩形截屏时要减掉）。
    """
    try:
        rect, _title = find_window_rect("余光")
        if rect is None or img is None:
            return img
        from PIL import ImageDraw
        l, t, r, b = rect
        l2, t2, r2, b2 = l - ox, t - oy, r - ox, b - oy
        if r2 <= 0 or b2 <= 0 or l2 >= img.width or t2 >= img.height:
            return img
        ImageDraw.Draw(img).rectangle(
            [max(0, l2), max(0, t2), min(img.width, r2), min(img.height, b2)],
            fill=(0, 0, 0),
        )
    except Exception:
        pass
    return img


def grab_for_state():
    """按当前设置抓一张：只盯窗口时先确认前台，再只抓那块。不匹配返回 None。

    抓屏优先「截屏」（几十毫秒）：字幕窗默认设了 WDA_EXCLUDEFROMCAPTURE，截屏拍不到它，
    所以前台直接用 ImageGrab 比 PrintWindow 快一个数量级。
    全屏游戏拿不到窗口矩形/截不到时退回整屏截屏——全屏游戏本来就是整个屏幕。
    抓不到会把原因记进 sense-grab.log，别再无声明地空转。
    """
    def _miss(reason):
        # 抓不到时 5 秒最多记一条，避免一直不匹配把日志刷爆
        now_ts = time.time()
        if now_ts - _LAST_MISS[0] < 5:
            return None
        _LAST_MISS[0] = now_ts
        try:
            with open(os.path.join(OUT_DIR, "sense-grab.log"), "a", encoding="utf-8") as f:
                f.write(json.dumps({
                    "at": now_ts,
                    "reason": reason,
                    "match": str(STATE.get("windowMatch") or ""),
                    "fg": foreground_title()[:60],
                }, ensure_ascii=False) + "\n")
        except Exception:
            pass
        return None

    def _black(img):
        # 加载/切换瞬间的纯黑页（洛克王国那个黑底精灵球就是），别拼进图里骗模型
        try:
            from PIL import ImageStat
            return ImageStat.Stat(img.convert("L")).mean[0] < 12
        except Exception:
            return False

    match = str(STATE["windowMatch"]).strip().lower()
    capturable = bool(STATE.get("hudCapturable"))
    # 视频模式不理「只盯窗口」：看片时窗口是浏览器，还拿上次的游戏标题去比，
    # 永远对不上，一张都不抓。视频就看整屏。
    if STATE["windowOnly"] and STATE["mode"] != "video":
        # 说好只盯某个窗口，却没给窗口名——那就一张都别抓。
        if not match:
            return _miss("no-match")
        fg = foreground_title()
        # 字幕窗是置顶无边框，看视频/全屏时它会抢前台，GetWindowText 拿到「余光」。
        # 这不是用户在看的东西，当不存在，继续按全屏/后台路径抓。
        if fg.strip() == "余光":
            fg = ""
        if match in fg.lower():
            rect = foreground_rect()
            if capturable:
                # 字幕窗开着「可截图」（要录屏）：PrintWindow 优先（不拍到自己），
                # 但全屏独占游戏 PrintWindow 会返回黑图，失败就退回截屏——
                # 截屏会拍到字幕窗，拍完把「余光」窗口那块涂黑，别让自己的字进图。
                hwnd = foreground_hwnd()
                if hwnd:
                    direct = grab_window_direct(hwnd)
                    if direct is not None:
                        return direct
                if rect is not None:
                    img = grab_rect(rect)
                    if img is not None:
                        if _black(img):
                            return _miss("black-frame")
                        return mask_hud(img, rect[0], rect[1])
                img = grab_full()
                if img is not None:
                    if _black(img):
                        return _miss("black-frame")
                    return mask_hud(img, 0, 0)
                return _miss("all-paths-failed")
            # 默认（字幕窗不可捕获）：截屏优先，快一个数量级
            if rect is not None:
                img = grab_rect(rect)
                if img is not None:
                    if _black(img):
                        return _miss("black-frame")
                    return img
            img = grab_full()
            if img is not None:
                if _black(img):
                    return _miss("black-frame")
                return img
            hwnd = foreground_hwnd()
            if hwnd:
                direct = grab_window_direct(hwnd)
                if direct is not None:
                    return direct
            return _miss("all-paths-failed")
        # 前台标题匹配不到：先找目标窗口（可能被切到后台），PrintWindow 能抓后台窗口。
        # 找不到才考虑全屏独占（前台标题空但窗口占满屏，其实游戏在前台）。
        hwnd, _wt = find_window_hwnd(match)
        if hwnd:
            direct = grab_window_direct(hwnd)
            if direct is not None:
                return direct
        fg_rect = foreground_rect()
        if fg_rect is not None and _is_fullscreen(fg_rect):
            if not capturable:
                img = grab_full()
                if img is not None:
                    return img
        return _miss("foreground-mismatch")
    # 没指定窗口：先截前台那个窗口（小屏看视频时整屏会带一堆桌面），失败再全屏。
    if not capturable:
        rect = foreground_rect()
        if rect is not None:
            img = grab_rect(rect)
            if img is not None:
                if _black(img):
                    return _miss("black-frame")
                return img
        img = grab_full()
        if img is not None:
            if _black(img):
                return _miss("black-frame")
            return img
    hwnd = foreground_hwnd()
    if hwnd:
        direct = grab_window_direct(hwnd)
        if direct is not None:
            return direct
    img = grab_full()
    if img is None:
        return _miss("full-failed")
    return img


def to_grid(image):
    """整屏 → 档位宽度的缩略图 → 64×36 HSV 网格；顺带吐逐行亮度（归一用）。

    缩略图宽度跟档位走（save 798 / balance 1050 / extreme 1260），拼图才够清楚；
    判分网格固定 64×36，不随档位变——判分要的是稳定，不是清晰。
    """
    w = sheet_width()
    h = sheet_height()
    if STATE["mode"] == "video":
        # 视频线 64 格拼图，每格才一百多像素，缩略图 320 宽就够，
        # 不用跟游戏一样存 1248 的大缩略——省内存，200 帧也才几十兆。
        w, h = 320, 180
    small = image.convert("RGB").resize((w, h), Image.BILINEAR)
    hsv = small.convert("HSV").resize(GRID, Image.BILINEAR)
    if np is not None:
        rows = None
        if STATE["normalize"]:
            full = np.asarray(small.convert("HSV"), dtype=np.int16)
            rows = full[:, :, 2].mean(axis=1)
        return small, np.asarray(hsv, dtype=np.int16), rows
    return small, hsv.tobytes(), None


def score_pair(prev, cur):
    """0..1 的变化分：亮度 0.5 / 饱和度 0.3 / 色相 0.2（色相按环形距离）。"""
    if prev is None or cur is None:
        return 1.0
    if np is not None:
        if prev.shape != cur.shape:
            return 1.0
        dh = np.abs(prev[..., 0] - cur[..., 0]).astype(np.int32)
        dh = np.minimum(dh, 255 - dh)
        ds = np.abs(prev[..., 1] - cur[..., 1]).astype(np.int32)
        dv = np.abs(prev[..., 2] - cur[..., 2]).astype(np.int32)
        weighted = 0.2 * dh + 0.3 * ds + 0.5 * dv
        return float(weighted.mean()) / 255.0
    if len(prev) != len(cur):
        return 1.0
    total = 0
    for i in range(0, len(prev), 3):
        dh = abs(prev[i] - cur[i])
        dh = min(dh, 255 - dh)
        ds = abs(prev[i + 1] - cur[i + 1])
        dv = abs(prev[i + 2] - cur[i + 2])
        total += 0.2 * dh + 0.3 * ds + 0.5 * dv
    return total / ((len(prev) // 3) * 255.0)


def diff_stats(prev, cur, cell_cut=0.12):
    """一次差分，给两个数：多少格子变了、变化平均多猛。

    只看平均值会骗人。鱼缸里只有百分之几的格子动（鱼在游），但那几格变得很彻底，
    平均下来跟换了个场景一样高。看面积才分得清「小动作」和「真换了」。
    """
    if prev is None or cur is None:
        return 1.0, 1.0
    if np is not None:
        if prev.shape != cur.shape:
            return 1.0, 1.0
        dh = np.abs(prev[..., 0] - cur[..., 0]).astype(np.int32)
        dh = np.minimum(dh, 255 - dh)
        ds = np.abs(prev[..., 1] - cur[..., 1]).astype(np.int32)
        dv = np.abs(prev[..., 2] - cur[..., 2]).astype(np.int32)
        weighted = (0.2 * dh + 0.3 * ds + 0.5 * dv) / 255.0
        return float((weighted >= cell_cut).mean()), float(weighted.mean())
    single = score_pair(prev, cur)
    return (1.0 if single >= cell_cut else 0.0), single


def scene_changed(prev, cur):
    """换场景了没：大面积铺开算真换，局部动得再猛也只是小动作。"""
    area, mean = diff_stats(prev, cur)
    return area >= AREA_CUT or mean >= HARD_CUT


def row_window(rows):
    """把这一帧的逐行亮度推进窗口，返回 (有效行 V 均值, 黑边占比)。

    黑边判的是「一直黑」而不是「这一帧黑」：片头黑场随后会亮，只看当前帧
    会把整幅画面当成黑边，分数被白白放大 1.5 倍。
    """
    if rows is None or np is None:
        return None, 0.0
    ROWS.append(rows)
    stack = np.asarray(ROWS, dtype=np.float32)
    row_mean = stack.mean(axis=0)
    row_max = stack.max(axis=0)
    dark = (row_mean < BAR_MEAN) & (row_max < BAR_MAX)
    height = int(dark.shape[0])
    top = 0
    while top < height and dark[top]:
        top += 1
    bottom = 0
    while bottom < height - top and dark[height - 1 - bottom]:
        bottom += 1
    frac = (top + bottom) / float(height)
    if frac >= BAR_CAP or frac >= 0.999:
        frac = 0.0                      # 整段黑场没有「补偿」可言
    lo, hi = top, height - bottom
    if hi <= lo:
        return None, 0.0
    return float(row_mean[lo:hi].mean()), frac


def normalize_score(score, mean_v, bar_frac):
    """把 0..1 的变化分换算到「参考亮度、无黑边」的刻度上。

    亮场是恒等的：gain=1 且没有黑边时原样返回，日常桌面一分不变。
    """
    if not STATE["normalize"] or mean_v is None:
        return score
    raw = score * 255.0
    if raw < NOISE_FLOOR:
        return score                    # 地板以下不放大，否则噪声会变成假切点
    gain = 1.0
    if mean_v > 0:
        gain = min(GAIN_MAX, max(1.0, REF_V / max(V_FLOOR, mean_v)))
    bf = min(bar_frac, BAR_CAP) if bar_frac > 0 else 0.0
    if gain == 1.0 and bf == 0.0:
        return score
    return min(1.0, (raw * gain) / max(0.05, 1.0 - bf) / 255.0)


def _font(size):
    try:
        return ImageFont.load_default(size=size)
    except Exception:
        return ImageFont.load_default()


def _cover(image, width, height):
    """按 cover 铺满，居中裁切。"""
    scale = max(width / image.width, height / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.BILINEAR,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def _layout(count, aspect=None):
    """格子排布：**每格保持源画面的宽高比**，按帧数选列数让整张图接近方形。

    比例不写死 16:9：4:3 的屏幕、21:9 的带鱼屏、竖屏都一样，
    用实际抓到的画面比例算，免得别人的机器上被拉扁或裁边。
    """
    w = sheet_width()
    if aspect is None or aspect <= 0:
        # 没给就用 16:9 兜底（正常路径都会拿到真实画面比例）
        aspect = 16.0 / 9.0
    if count <= 1:
        return 1, 1, w, max(1, int(round(w / aspect)))
    if count == 2:
        # 两帧上下排，每行一条完整画面
        return 1, 2, w, max(1, int(round(w / aspect)))
    # 选列数：空不超过两格，然后让**整张图的高度接近屏幕高度**（横着摆、不拉长），
    # 同样接近再看每格大小。10 帧因此排 4 列 3 行（1248×525），不是 5 列 2 行（1248×280 太扁）。
    best = None
    target_h = w / aspect
    for c in range(1, min(count, 8) + 1):
        r = int(math.ceil(count / float(c)))
        if r > c * 3 or c > r * 3:
            continue
        empty = c * r - count
        if empty > 2:
            continue
        cellw = w // c
        total_h = r * (cellw / aspect)
        # 高度差优先，其次每格大，最后才看形状
        score = (abs(total_h - target_h), empty, -(cellw ** 2))
        if best is None or score < best[0]:
            best = (score, c, r)
    _, cols, rows = best
    cell_w = w // cols
    cell_h = max(1, int(round(cell_w / aspect)))
    return cols, rows, cell_w, cell_h


def _split_segments(frames, seg_sec=10.0):
    """切段：到 seg_sec 之后，等下一个**镜头切换点**再断，最多等到 1.6 倍。

    以前一刀切在第 10 秒，不管那里是不是镜头中间——一段「大厅→载入→加载动画」
    的连续过渡会被劈成两张图，哪张都看不全。现在只在镜头边界断，一段就是几个完整的镜头。
    """
    segs = []
    cur = []
    seg_start = None
    for f in frames:
        t = f.get("t", 0) or 0
        if seg_start is None:
            seg_start = t
        el = t - seg_start
        # 够时长、并且这帧是切点（或已经拖到 1.6 倍不得不切）才断
        if cur and el >= seg_sec and (f.get("cut") or el >= seg_sec * 1.6):
            segs.append(cur)
            cur = []
            seg_start = t
        cur.append(f)
    if cur:
        segs.append(cur)
    return segs


def _pick_segment(seg, want=64):
    """从一段里挑 want 格：优先挑切镜头那几帧（快切素材不丢镜头），不够再均匀补。"""
    if len(seg) <= want:
        return seg
    cuts = [f for f in seg if f.get("cut")]
    if len(cuts) >= want:
        result = cuts[:want]
    else:
        result = list(cuts)
        noncuts = [f for f in seg if not f.get("cut")]
        need = want - len(result)
        if need > 0 and noncuts:
            step = (len(noncuts) - 1) / float(need) if need > 1 else 0
            for i in range(need):
                result.append(noncuts[int(round(i * step))])
    # 按时间排回顺序，别打乱先后
    result.sort(key=lambda f: f.get("t", 0) or 0)
    return result


def compose(frames):
    """把留着的那几帧拼成一张图，每格左上角烧序号。

    从原图缩，不用那张 64×36 的判分缩略图——放大四倍只会是糊的。
    """
    count = len(frames)
    w = sheet_width()
    # 格子宽高比跟着第一帧的真实画面走（4:3、21:9、竖屏都自适应，不写死 16:9）
    aspect = None
    try:
        zero = frames[0].get("full") or frames[0].get("small")
        if zero is not None and zero.height:
            aspect = zero.width / float(zero.height)
    except Exception:
        aspect = None
    cols, rows, cell_w, cell_h = _layout(count, aspect)
    canvas_h = rows * cell_h + (rows - 1) * GUTTER
    sheet = Image.new("RGB", (w, canvas_h), BG)
    draw = ImageDraw.Draw(sheet)
    tag_font = _font(20)

    for index, frame in enumerate(frames):
        col = index % cols
        row = index // cols
        x = col * (cell_w + GUTTER)
        y = row * (cell_h + GUTTER)
        width = w - x if col == cols - 1 else cell_w
        height = canvas_h - y if row == rows - 1 else cell_h
        source = frame.get("full") or frame["small"]
        sheet.paste(_cover(source, width, height), (x, y))

        label = str(index + 1)
        draw.rectangle([x + 4, y + 4, x + 10 + 13 * len(label), y + 31], fill=TAG_BG)
        draw.text((x + 9, y + 7), label, font=tag_font, fill=TAG_FG)

        # 不画秒数了：AI 会把 "12.3s" 当成画面里的字读进去。格子编号已经说明先后。

    for col in range(1, cols):
        seamed = col * (cell_w + GUTTER) - GUTTER
        draw.rectangle([seamed, 0, seamed + GUTTER - 1, canvas_h], fill=SEAM)
    for row in range(1, rows):
        seamed = row * (cell_h + GUTTER) - GUTTER
        draw.rectangle([0, seamed, w, seamed + GUTTER - 1], fill=SEAM)
    return sheet


MAX_FILES = 400          # frames 目录最多留这么多张，超了从最旧的删起


def prune():
    """截图会一直攒，这里按张数封顶，免得越堆越多。"""
    try:
        names = [name for name in os.listdir(OUT_DIR) if name.endswith(".jpg")]
        if len(names) <= MAX_FILES:
            return
        paths = [os.path.join(OUT_DIR, name) for name in names]
        paths.sort(key=os.path.getmtime)
        for path in paths[: len(paths) - MAX_FILES]:
            os.remove(path)
    except Exception:
        pass


def save_jpeg(image, prefix):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "%s-%d.jpg" % (prefix, int(time.time() * 1000)))
    image.convert("RGB").save(path, "JPEG", quality=72)
    prune()
    return path


def resize_width(image, width):
    width = int(width)
    if width <= 0 or image.width <= width:
        return image
    height = max(1, round(image.height * width / image.width))
    return image.resize((width, height), Image.LANCZOS)


def screen_width():
    """当前显示器宽度；拿不到就当 1920。"""
    try:
        return int(ctypes.windll.user32.GetSystemMetrics(0)) or 1920
    except Exception:
        return 1920


def single_target_width():
    """单张 / 字幕条的宽度。

    PROFILES 里存的是「占屏幕宽度的比例」，不是死数字——1080p 上
    0.66 约 1270、0.83 约 1590；换 4K 或 1366 的屏幕按同样比例缩，
    再夹在 900–1700 之间（再宽就只是白烧 token）。
    """
    ratio = float(current_profile().get("singleRatio") or 0.0)
    if ratio <= 0:
        return int(STATE["maxWidth"])
    raw = int(screen_width() * ratio)
    return max(900, min(1700, int(round(raw / 100.0)) * 100))


def adaptive_wait(base):
    """下一次抓图等多久——连续曲线，不是档位跳变。

    画面越动，间隔越短；越静，间隔越长。中间按指数平滑过渡。
    视频线单独更密：动满压到 0.15 秒，10 秒窗口才攒得出 60 帧，
    拼图才铺得满、不丢精彩瞬间也不漏字幕。
    """
    base = max(0.25, float(base))
    motion = float(STATE.get("motion") or 0.0)
    # 归一化到 [0,1]：0 = 完全静止，1 = MOTION_BUSY 及以上
    k = min(1.0, motion / MOTION_BUSY)
    # 指数衰减：静 2.4 倍 → 动满 0.25 倍
    ratio = 0.25 + (2.4 - 0.25) * ((1.0 - k) ** 1.5)
    wait = base * ratio
    if STATE["mode"] == "video":
        # 视频线：把整条曲线再压到 0.15 倍，动满 ≈ 0.15s，静 ≈ 0.9s
        return max(0.15, wait * 0.15)
    return max(0.25, wait)


def still_reading():
    """是不是在「读东西」。两条路：

    路 A：连续静止满 STILL_READ_SEC（5 秒）——慢游戏一直静着看。
    路 B：断崖（画面突增，像打开面板）之后稳住 READ_JUMP_HOLD（2 秒）——
         动作游戏打开装备/菜单那一刻的停顿，不用等满 5 秒。
    以前那条「局部动 2 秒也算」砍了：它在动作游戏里把砍怪当读字，单张刷屏。
    """
    if STATE["mode"] == "video":
        return False
    still = float(STATE.get("stillSec") or 0.0)
    if STATE.get("jumped") and still >= READ_JUMP_HOLD:
        return True
    return still >= STILL_READ_SEC


def _text_similar(a, b, threshold=0.85):
    """两条字幕像不像同一条。OCR 每帧都会抖一两个字，只比全等去不掉重复。"""
    if a == b:
        return True
    if not a or not b:
        return False
    try:
        return difflib.SequenceMatcher(None, a, b).ratio() >= threshold
    except Exception:
        return False


def subtitle_strip(image, width=None, bottom=0.25):
    """裁屏幕底部一条，字幕基本都在里面；宽度按 width 缩放，字不至于糊。"""
    if width is None:
        width = max(1000, int(screen_width() * 0.66))
    top = int(image.height * (1.0 - bottom))
    strip = image.crop((0, top, image.width, image.height))
    return resize_width(strip, width)


def subtitle_sheet(frames=None, width=None, max_lines=5):
    """把最近几句字幕条竖着拼成一张：视频字幕一句一闪，单看一帧不知道在聊什么。

    字幕条在采样时已经裁好、去重存进 SUBTITLE_STRIPS，这里直接取最近 max_lines 条拼。
    """
    if width is None:
        width = max(1000, int(screen_width() * 0.66))
    strips = [s for _t, s in SUBTITLE_STRIPS[-max_lines:]]
    if not strips:
        return None
    h = sum(s.height for s in strips)
    out = Image.new("RGB", (width, h), (0, 0, 0))
    y = 0
    for s in strips:
        out.paste(s, (0, y))
        y += s.height
    return out


def save_full(image):
    # 读字高清：上限 1920。小屏（1366 等）不放大，原样存；4K 缩到 1920 够读字，
    # 再大只是白烧 token。这样跨分辨率都自适应，不用人调 maxWidth。
    if image.width > READING_WIDTH:
        image = resize_width(image, READING_WIDTH)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "full-%d.jpg" % int(time.time() * 1000))
    image.convert("RGB").save(path, "JPEG", quality=72)
    prune()
    return path


def take_buffer():
    with FRAMES_LOCK:
        taken = list(BUFFER)
        BUFFER.clear()
    return taken


def offer_frame(small, t, score, grid=None, big=None, cut=False):
    """每次采样都留一帧，攒成一条连续的短历史。

    拼图要的是「连着走的几步」，所以不能只挑变化大的那几帧——那样攒出来的
    永远是几个孤立的瞬间，四格常常只有一两格，凑不满。
    small 是缩略图（拼图用）；big 是读字版，只给 OCR 用；
    cut 标记「这帧是切镜头那一帧」，视频线按段挑格时优先留它，快切素材才不丢镜头。
    """
    with FRAMES_LOCK:
        BUFFER.append({"small": small, "t": t, "score": score, "grid": grid, "big": big, "cut": cut})
        # 视频线要铺满「一次开口间隔」内的帧：floorSec / 0.15 秒一帧 + 余量
        # （30 秒开口 → 约 220 帧；缩略图 320 宽，内存不到 40 兆）
        cap = int(float(STATE.get("floorSec") or 10) / 0.15) + 20 if STATE["mode"] == "video" else BUFFER_CAP
        while len(BUFFER) > cap:
            BUFFER.pop(0)


def current_profile():
    mode = STATE["mode"]
    tier = STATE["tier"].get(mode, "balance")
    if tier not in TIERS:
        tier = "balance"
    return PROFILES[mode][tier]


def sheet_width():
    """拼图整幅宽度：按屏幕宽的比例走，不写死像素。

    实测：图从 1280 砍到 800，token 只降 1.5%——省画质根本不省钱，只让字变糊。
    所以画质拉到屏幕能给的最高，档位只管「多久看一次 / 多久说一句」的频率。
    1080p 屏 ≈ 1248，4K 屏自动变大，跨分辨率不用人调。
    """
    sw = screen_width()
    return max(1000, int(sw * 0.65))


def read_big_width():
    """每帧读字版宽度 = 屏幕宽 × 比例，不写死像素。"""
    return max(900, int(screen_width() * READ_BIG_WIDTH_RATIO))


def sheet_height():
    """拼图整幅高度，跟着宽度走，保持 16:9 的宽高比。"""
    return sheet_width() * 9 // 16


def apply_preset():
    """切模式/档位时把预设参数套进去。图形式的覆盖单独存，不在这里动。"""
    preset = current_profile()
    STATE["intervalMs"] = int(preset["intervalMs"])
    STATE["floorSec"] = float(preset["floorSec"])


def effective_sheet_mode():
    """出图形式一律跟档位走：这不是用户选项，面板上早删了。"""
    return current_profile()["sheetMode"]


SHEET_MIN_DIFF = 0.025   # 首尾差异低于这个，等于花四倍面积看同一张，退回单格
SILENT_MAX = 300.0       # 最长沉默：画面一直没变，隔这么久也得看一眼，免得人以为它不看了
READING_GAP = 20.0       # 读字触发/高清的间隔：静止够 STILL_READ_SEC 后再等这一点，确认在读书、又不至于错过
READING_WIDTH = 1920     # 读字高清的宽度上限：1080p 原图不动，2K/4K 缩到这里，够读小字又不白烧
READ_BIG_WIDTH_RATIO = 0.66   # 每帧「读字版」宽 = 屏幕宽 × 这个比例（1080p ≈ 1267），不写死像素
READING_SAME_CUT = 0.003 # 读字画面变化低于这个 = 跟上次一样（挂机），别再重复发
AREA_CUT = 0.25          # 变化的格子占到这个比例，算真的换了场景
HARD_CUT = 0.08          # 平均变化猛到这个程度，面积再小也算大事（闪白、全屏切换）

# 视频跟游戏不是一回事：游戏的画面一直在动，视频一页能停三十秒，
# 变的是字幕和旁白。拿游戏的阈值去量视频，等于永远量不到。
VIDEO_AREA_CUT = 0.08    # 视频里这么大面积换了，就够看了
VIDEO_QUIET = 25.0       # 视频的冷却上限：旁白一直在讲，别一压就一分半
VIDEO_SILENT_MAX = 90.0  # 视频里最长沉默，再长就该瞄一眼了


def pick_sheet_frames(count=None):
    """从最新那条短历史里按时间均匀挑几格。

    帧数上限和时间跨度的基准来自档位；再乘上画面变化率的浮动：
    - 动得猛（打怪、连招）→ span 缩短，看短一段密集过程；帧数往上限探
    - 基本不动（看菜单、读字）→ span 拉长，兜住缓慢变化；帧数降到 1-2 格
    count 留参数是给「看这一段」这种显式指定条数的路径用。
    """
    prof = current_profile()
    base_span = float(prof.get("spanSec") or 8.0)
    motion = float(STATE.get("motion") or 0.0)
    # 连续曲线：动满收窄跨度、多帧；静拉长跨度、降到 2 格。
    k = min(1.0, motion / MOTION_BUSY)  # 0=静，1=动满
    if STATE["mode"] == "video":
        # 视频线跨度跟着画面走：
        #   对话戏（几乎不动）采样松到 0.7 秒一帧，窗口要 60 秒才凑够 64 格；
        #   打斗（画面狂动）采样密到 0.15 秒一帧，窗口收窄到 20 秒，盲区才小
        #   （固定 60 秒的话打斗里 64 格要摊 60 秒，每格隔近一秒，动作全糊成一块）。
        span = max(20.0, 60.0 - 40.0 * k)
    else:
        span = max(3.0, base_span * (2.0 - 1.5 * k))
    if count is None:
        # 视频线这里**不预先挑帧**：把窗口里攒的帧全交出去，由 render_outputs
        # 先按 10 秒切段、每段再各自挑 64 格。要是这里先均匀挑成 64 帧，
        # 切段后每 10 秒只剩十来帧，段内稀得看不清，就是你看到的「123 变成 12 23」。
        if STATE["mode"] == "video":
            count = 10 ** 6
        else:
            cap = 16
            count = int(round(4 + (cap - 4) * (k ** 1.2)))
            count = max(4, min(cap, count))
    with FRAMES_LOCK:
        frames = [dict(item) for item in BUFFER]
    if not frames:
        return []
    newest = frames[-1]["t"]
    recent = [item for item in frames if newest - item["t"] <= span]
    if recent:
        frames = recent
    if count <= 1 or len(frames) <= 1:
        return frames[-1:]

    if len(frames) <= count:
        return frames
    step = (len(frames) - 1) / float(count - 1)
    return [frames[min(len(frames) - 1, int(round(index * step)))] for index in range(count)]


GAP_CUT = 0.10            # 相邻两格之间动多少算「这一段里真动过」（比换场景宽松）


def trim_redundant(frames):
    """拼之前逐帧去重：相邻两格画面几乎没动就合并，静止段落不占格子。

    挂机、停在菜单、看静止画面时，这一段会缩成很少几格，格子省给有变化的画面；
    这正是「静止不花 token」落到拼图层。但绝不砍成一帧——留首尾，模型才看得出「这段时间是静的」。
    """
    if len(frames) < 2:
        return frames
    out = [frames[0]]
    for f in frames[1:]:
        prev = out[-1]
        area, mean = diff_stats(prev.get("grid"), f.get("grid"))
        if area >= GAP_CUT or mean >= HARD_CUT * 0.5:
            out.append(f)  # 这一步真动过，留
    # 至少保留首尾，避免静止段只剩一帧
    if len(out) == 1 and frames[-1] is not out[0]:
        out.append(frames[-1])
    return out


LAST_SINGLE = [0.0]        # 上一次递全屏图的时间。拼图和全屏价钱差三倍，得分开算
LAST_READING_GRID = [None] # 上一次读字高清的画面指纹：挂机时画面没变，就别再重复喂一张


# ---- OCR：本地读字 ----
# 静止读字（菜单/商店/技能树）时，屏幕上的字用本地 RapidOCR 读出来，
# 文字喂模型（几百 token），代替发高清图给模型读（几万 token）。
_OCR_ENGINE = [None]       # 懒加载：第一次用才初始化，避免拖慢 sense 启动
OCR_TEXT = [""]            # 最近一次读字出的文字，emit_change 时塞进事件
SUBTITLE_HISTORY = []      # 视频模式：最近几句字幕（(时间, 文本)），一句一闪看不出上下文
SUBTITLE_STRIPS = []       # 视频模式：去重后的字幕条小图缓存（(时间, PIL图)），拼多句字幕用，最多 8 条


def _ocr_engine():
    """懒加载 RapidOCR。装不上/初始化失败返回 None，主链路退回发图给模型读。"""
    if _OCR_ENGINE[0] is not None:
        return _OCR_ENGINE[0] if _OCR_ENGINE[0] is not False else None
    try:
        from rapidocr_onnxruntime import RapidOCR
        _OCR_ENGINE[0] = RapidOCR()
    except Exception as exc:
        sys.stderr.write("RapidOCR 不可用，退回发图读字: %r\n" % (exc,))
        _OCR_ENGINE[0] = False
    return _OCR_ENGINE[0] if _OCR_ENGINE[0] is not False else None


def ocr_read(image):
    """读一张高清图，返回过滤后的文字列表。引擎不可用返回 []。

    噪声过滤（实测总结）：
    - 置信度低于 0.5 的丢
    - 空串、单字符丢
    - F1~F12 / Enter / Tab / Esc 这类键位提示丢
    - 纯符号丢（「10X」「ARRG」「000000」这类没意义）
    """
    engine = _ocr_engine()
    if engine is None:
        return []
    try:
        arr = np.asarray(image.convert("RGB")) if np is not None else None
        if arr is None:
            return []
        result, _ = engine(arr)
    except Exception:
        return []
    if not result:
        return []
    out = []
    for _box, text, score in result:
        t = (text or "").strip()
        if not t or len(t) <= 1:
            continue
        if float(score) < 0.5:
            continue
        up = t.upper()
        if up in ("ENTER", "TAB", "ESC", "SHIFT", "CTRL", "ALT", "SPACE"):
            continue
        # F1..F12 键位提示
        if len(t) <= 3 and (t[0] in "Ff") and t[1:].isdigit():
            continue
        # 去掉标点后什么都不剩，就是纯符号/纯图标，没意义
        if not any(c.isalnum() for c in t):
            continue
        out.append(t)
    return out


def read_frames_text(frames, fallback=None):
    """按平方根向上取整挑几帧读字：1→1、2→2、4→2、9→3、12→4、16→4。

    读每帧的「读字版」（1280 宽），标出是第几帧，让模型看出这段中间数字/提示变没变。
    同一句重复出现的只记第一次。
    """
    total = len(frames)
    if total <= 0:
        return "\n".join(ocr_read(fallback)) if fallback is not None else ""
    want = max(1, int(math.ceil(total ** 0.5)))
    if want >= total:
        picks = list(range(total))
    elif want == 1:
        picks = [total - 1]
    else:
        step = (total - 1) / float(want - 1)
        picks = sorted({int(round(i * step)) for i in range(want)})
    seen = set()
    blocks = []
    for idx in picks:
        frame = frames[idx]
        img = frame.get("big") or frame.get("small")
        if img is None:
            continue
        try:
            words = [w for w in ocr_read(img) if w not in seen]
        except Exception:
            continue
        if not words:
            continue
        for w in words:
            seen.add(w)
        blocks.append("第%d/%d帧：%s" % (idx + 1, total, " ".join(words)))
    if not blocks and fallback is not None:
        return "\n".join(ocr_read(fallback))
    return "\n".join(blocks)


def render_outputs(frames, full):
    """按当前状态产出图，返回 [(kind, path)]。互斥——每次最多一张。

    视频 -> 只发字幕条；静止读字 -> OCR 出文字 + 小图（省 token）；
    画面在动 -> 拼图看过程（出图形式选了 single/both 时再按节流补一张单张）。
    """
    mode = STATE["mode"]
    shape = effective_sheet_mode()
    width = single_target_width()
    reading = still_reading()
    out = []
    OCR_TEXT[0] = ""  # 默认清空，只有读字分支才填
    if mode == "video":
        # 字幕条是主力（便宜，信息在字幕）；画面拼图也发——没字幕的搞笑视频，梗在画面里。
        if full is None:
            full = frames[-1]["small"]
        strip_w = max(1000, int(screen_width() * 0.66))  # 按屏幕比例，不写死 1280
        strip = subtitle_sheet(frames, strip_w)
        # 字幕条是规整白字黑边、位置固定，OCR 最拿手。把台词读成文字，跟拼图一起给模型：
        # 画面看这几十秒在发生什么，台词看人家在说什么，两样合起来才懂这一段。
        # 字幕一句一闪，单看一句不知道在聊什么：攒最近几句一起给
        words = [w for w in ocr_read(strip) if str(w).strip()]
        # 单帧内先去一遍：同一条字幕常被 OCR 按行/按块读成两三条，
        # 「现在几点了」在一帧里能出五遍，全塞进提示词就是噪声。
        uniq = []
        for w in words:
            if not any(_text_similar(w, u) for u in uniq):
                uniq.append(w)
        text_now = " ".join(uniq).strip()
        # 去重跟「最近几条」比，不只跟上一条：字幕会隔一句又重复出现，
        # 只比上一条的话，「也就是说这一连串骚动」这种能在提示词里连出五遍。
        # 用相似度（不是全等）——同一条字幕每帧 OCR 都可能差一两个字。
        recent_texts = [t for _ts, t in SUBTITLE_HISTORY[-6:]]
        if text_now and not any(_text_similar(text_now, t) for t in recent_texts):
            SUBTITLE_HISTORY.append((time.time(), text_now))
            # 字幕留得够长才接得上剧情：30 秒的窗口里，"申请被改"和"这仗赢不光彩"
            # 常常隔着一整场戏，接不上就理解偏。留到约 4 分钟（120 条），够撑一个段落。
            cap = 120
            if len(SUBTITLE_HISTORY) > cap:
                SUBTITLE_HISTORY.pop(0)
        OCR_TEXT[0] = "\n".join(t for _ts, t in SUBTITLE_HISTORY)
        # OCR 读出字了就不发字幕条图，省那张一千多 token 的图——OCR 都读不清的字，模型看图更读不清
        # 拆段：把跨度切成 10 秒一段，每段 64 格一张图，几张按顺序一起发。
        # 不拆的话 60 秒跨度的 64 格每格隔近一秒，对话戏都糊成一块。
        segments = _split_segments(frames, 10.0)
        sheets = [("sheet", save_jpeg(compose(_pick_segment(seg, 64)), "sheet")) for seg in segments if seg]
        if OCR_TEXT[0].strip():
            out.extend(sheets)
        else:
            # 没读到字（可能没字幕、或字糊到 OCR 也不认）：发字幕条图给模型自己看，兜底
            if strip is not None:
                out.append(("strip", save_jpeg(strip, "strip")))
            out.extend(sheets)
        return out
    if reading:
        # 静止读字：本地 OCR 出文字 + 高清图。读字就得高清，图不再缩到 800——
        # 那是之前为了省 token 瞎降的，800 的图字糊、模型读不动，OCR 也跟着错。
        if full is None:
            full = frames[-1]["small"]
        if (time.time() - LAST_SINGLE[0]) < READING_GAP:
            return out
        # 挂机闸门：画面跟上次发的高清几乎一样（人没动），就别再重复喂图，省 token。
        cur_grid = frames[-1].get("grid") if frames else None
        if cur_grid is not None and LAST_READING_GRID[0] is not None:
            if score_pair(LAST_READING_GRID[0], cur_grid) < READING_SAME_CUT:
                return out
        LAST_SINGLE[0] = time.time()
        LAST_READING_GRID[0] = cur_grid
        # 读字统一走高清（1920 封顶，小屏不放大，4K 缩到 1920），OCR 和图用同一张。
        scaled = full if full.width <= READING_WIDTH else resize_width(full, READING_WIDTH)
        words = ocr_read(scaled)
        # 确认层：有「≥8 字且含中文」的连续片段才算读字。
        # HUD 的血条/进度「190 / 388 (49%)」是纯数字符号、没有中文，会被这条挡掉；
        # 装备说明、事件文本、对话才是真读字。英文游戏暂时读字漏掉，中文场景够用。
        def _has_cjk(s):
            return any('\u4e00' <= c <= '\u9fff' for c in s)
        long_cjk = [w for w in words if len(w) >= 8 and _has_cjk(w)]
        if not long_cjk:
            return out  # 没成句的中文文本，不是读字（站定发呆 / 纯 HUD），不出单张
        OCR_TEXT[0] = "\n".join(words)
        out.append(("single", save_jpeg(scaled, "single")))
        return out
    # 画面在动：只发拼图。图 + 字才是给模型的那条数据——第二张全屏图不给，
    # 字已经在下面的 OCR 里了，多一张图只是白烧 token（快的场景要的是「发生了什么」）。
    out.append(("sheet", save_jpeg(compose(frames), "sheet")))
    # 读字按平方根挑帧：1→1、2→2、4→2、9→3、16→4，读的是每帧的读字版（1280 宽），
    # 不是拼图——拼图每格 399 宽字是糊的。这样「这段中间数字变了没」才看得出来。
    if out:
        try:
            OCR_TEXT[0] = read_frames_text(frames, full)
        except Exception:
            OCR_TEXT[0] = ""
    return out


def emit_change(frames, now, full=None):
    if not frames:
        return None
    # 视频线不逐帧去重：去了重 64 格就铺不满，看着像「中间空了一大截」。
    # 视频要的就是「这段时间里每一小段都留一格」，连续比省格子重要。
    shown = frames if STATE["mode"] == "video" else trim_redundant(frames)
    images = render_outputs(shown, full)
    if not images:
        return None
    base = shown[0]["t"]
    mode = STATE["mode"]
    title = foreground_title()
    # 视频模式不做游戏识别：前台是浏览器，硬拿游戏关键词/黑话去套，全是对不上的空话
    if mode == "video":
        game, pace, info = "", "", None
    else:
        game, pace, info = detect_game(title)
    game_info = None
    if info:
        note = game_note(info.get("name") or game or "")
        game_info = {
            "name": info.get("name", ""),
            "short_description": info.get("short_description", ""),
            "genres": info.get("genres", []),
            # 黑话和规则：模型能用的真术语。以前这两项从来没传进去过。
            "terms": (note or {}).get("黑话", []) or [],
            "rules": (note or {}).get("规则", []) or [],
            # 梗：社区的调侃说法，陪看时拿来接话用，不要求每句都使。
            "memes": (note or {}).get("梗", []) or [],
        }
    payload = {
        "event": "change",
        "path": images[0][1],
        "images": [{"kind": kind, "path": path} for kind, path in images],
        "score": round(max(frame["score"] for frame in frames), 4),
        "title": title,
        "game": game or "",
        "pace": pace or "",
        "game_info": game_info,
        "at": int(now * 1000),
        # 攒帧等了多久：第一帧画面变化到现在发出，这段纯是等帧+等冷却。
        # 宿主那边再从「收到事件」到「模型吐出字」记一段，两段加起来就是用户感觉到的延迟。
        "waitSec": round(now - base, 1),
        "mode": mode,
        "tier": STATE["tier"].get(mode, "balance"),
        "shape": effective_sheet_mode(),
        # 静止读字时 OCR 读出来的屏幕文字（可能带错字），宿主塞进提示词。
        "ocrText": OCR_TEXT[0],
        "sheet": len(images) > 0 and any(kind == "sheet" for kind, _ in images),
        "count": len(shown),
        "frames": [
            {"t": round(frame["t"] - base, 1), "score": round(frame["score"], 3)}
            for frame in shown
        ],
    }
    emit(payload)
    return payload


def quit_now():
    os._exit(0)


def read_commands():
    while True:
        line = sys.stdin.readline()
        if not line:
            quit_now()
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except Exception:
            continue
        op = message.get("op")
        if op == "quit":
            quit_now()
        if op == "reload-notes":
            # 面板「学黑话」入库后，重新加载 games-notes.json，让新黑话立刻可用。
            load_game_notes()
            emit({"event": "notes-reloaded"})
        if op == "config":
            auto = message.get("auto")
            if isinstance(auto, bool):
                STATE["auto"] = auto
            normalize = message.get("normalize")
            if isinstance(normalize, bool):
                STATE["normalize"] = normalize
            only = message.get("windowOnly")
            if isinstance(only, bool):
                STATE["windowOnly"] = only
            auto_fetch = message.get("autoFetch")
            if isinstance(auto_fetch, bool):
                STATE["autoFetch"] = auto_fetch
            capturable = message.get("hudCapturable")
            if isinstance(capturable, bool):
                STATE["hudCapturable"] = capturable
            match = message.get("windowMatch")
            if isinstance(match, str):
                STATE["windowMatch"] = match.strip()
                # 换窗口就得重新认游戏：_lastTitle 不清的话，新窗口跟旧标题一样
                # 就不会重新识别，面板一直挂着上一个游戏名。
                STATE["_lastTitle"] = None
            mode = message.get("mode")
            if isinstance(mode, str) and mode in MODES and mode != STATE["mode"]:
                STATE["mode"] = mode
                apply_preset()
            tier = message.get("tier")
            if isinstance(tier, str) and tier in TIERS and tier != STATE["tier"][STATE["mode"]]:
                STATE["tier"][STATE["mode"]] = tier
                apply_preset()
            shape = message.get("sheetMode")
            if isinstance(shape, str) and shape in ("sheet", "single", "both", ""):
                STATE["sheetMode"][STATE["mode"]] = shape
            for key in ("intervalMs", "threshold", "cooldownMs", "maxWidth", "floorSec", "silentMax"):
                value = message.get(key)
                if isinstance(value, (int, float)):
                    STATE[key] = float(value) if key in ("threshold", "floorSec", "silentMax") else int(value)
            STATE["intervalMs"] = max(400, min(60000, STATE["intervalMs"]))
            STATE["threshold"] = max(0.005, min(0.9, STATE["threshold"]))
            STATE["cooldownMs"] = max(5000, min(3600000, STATE["cooldownMs"]))
            STATE["maxWidth"] = max(320, min(2560, STATE["maxWidth"]))
            STATE["floorSec"] = max(5.0, min(1800.0, STATE["floorSec"]))
            STATE["silentMax"] = max(10.0, min(3600.0, STATE["silentMax"]))
            emit({"event": "config", **STATE})
        if op == "windows":
            emit({"event": "windows", "titles": list_windows()})
        if op == "recent":
            seconds = message.get("seconds")
            seconds = float(seconds) if isinstance(seconds, (int, float)) else 30.0
            seconds = max(5.0, min(180.0, seconds))
            cutoff = time.time() - seconds
            with FRAMES_LOCK:
                picked = [dict(f) for f in RECENT if f["t"] >= cutoff]
            if len(picked) > MAX_FRAMES:
                step = (len(picked) - 1) / float(MAX_FRAMES - 1)
                picked = [picked[min(len(picked) - 1, int(round(i * step)))] for i in range(MAX_FRAMES)]
            try:
                if not picked:
                    emit({"event": "recent", "path": "", "count": 0, "seconds": seconds})
                else:
                    base = picked[0]["t"]
                    for frame in picked:
                        frame["t"] = round(frame["t"] - base, 1)
                    path = save_jpeg(compose(picked), "recent")
                    emit(
                        {
                            "event": "recent",
                            "path": path,
                            "count": len(picked),
                            "seconds": seconds,
                            "title": foreground_title(),
                            "at": int(time.time() * 1000),
                        }
                    )
            except Exception as exc:
                emit({"event": "error", "message": "recent failed: %r" % (exc,)})
        if op == "resolve-game":
            # 面板答「这是/不是游戏」。title 必填；is_game 布尔；game_name 可选（空则用标题）。
            title = str(message.get("title") or "").strip()
            if title:
                resolve_unknown(title, message.get("is_game") is True, str(message.get("game_name") or ""))
                emit({"event": "resolved", "title": title})
        if op == "snap":
            try:
                # 手动「看一眼」优先向选定的那个窗口要它自己渲染的画面（PrintWindow）：
                # 游戏在后台、被 DSH 挡着、无边框全屏，向窗口要才拿得到；
                # 只按屏幕矩形截，截到的是盖在上面的那个窗口（通常是 DSH 自己），
                # 所以用户看到的就是「没切到游戏时截不到东西」。
                _match = str(STATE.get("windowMatch") or "").strip()
                image = None
                _wt = ""
                if _match:
                    hwnd, _wt = find_window_hwnd(_match)
                    if hwnd:
                        image = grab_window_direct(hwnd)
                if image is None:
                    if _match:
                        rect, _rt = find_window_rect(_match)
                        if rect is None:
                            rect = foreground_rect()
                        image = grab_rect(rect) if rect else grab_full()
                        _wt = _wt or _rt
                    else:
                        # 不限制窗口：抓整个屏幕，别只抓前台那块（前台常常是面板自己，
                        # 抓回来一片面板，看起来就像「没反应」）。
                        image = grab_full()
                        _wt = foreground_title()
                # 「看一眼」也走 OCR：用原图读字，文字随事件带过去。
                # 手动看一眼时画面上常是菜单/树/列表这种满屏小字，光给缩小的图模型读不动。
                OCR_TEXT[0] = "\n".join(ocr_read(image))
                path = save_full(image)
                emit(
                    {
                        "event": "snap",
                        "path": path,
                        "title": _wt or foreground_title(),
                        "at": int(time.time() * 1000),
                        "full": True,
                        "ocrText": OCR_TEXT[0],
                        }
                    )
            except Exception as exc:
                emit({"event": "error", "message": "snap failed: %r" % (exc,)})


def hotkey_thread():
    """全局热键 Ctrl+Alt+G：不管在哪个窗口，按下去就叫一次「看一眼」。

    面板上的按钮只有在 DSH 里才点得到；打游戏、全屏看片时它够不着，
    所以留一个哪儿都能按的键。
    """
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        MOD_ALT, MOD_CONTROL = 0x0001, 0x0002
        VK_G = 0x47
        if not user32.RegisterHotKey(None, 1, MOD_CONTROL | MOD_ALT, VK_G):
            return
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
            if msg.message == 0x0312:  # WM_HOTKEY
                emit({"event": "hotkey", "action": "look"})
    except Exception:
        pass


def main():
    if not claim_single_instance():
        # 别的会话已经在看着屏幕了，我这边安静退出，不跟它抢
        sys.exit(0)
    try:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    watcher = threading.Thread(target=read_commands, daemon=True)
    watcher.start()
    threading.Thread(target=hotkey_thread, daemon=True).start()

    load_game_db()
    load_game_notes()
    _load_game_state()
    emit({"event": "ready", **STATE})
    previous = None
    started = time.time()
    last_emit = 0.0
    last_frame_t = 0.0
    last_soft = time.time()
    last_move = started
    last_read = started
    local_since = started
    history = []
    moving_recent = []
    sample_log_count = 0

    while True:
        if not STATE["auto"]:
            # 开关关着的时候一张也不抓，屏幕完全不碰
            previous = None
            time.sleep(0.5)
            continue
        try:
            now = time.time()
            # 认游戏只认「盯着的那个窗口」，跟前台无关。
            # windowMatch 有值就认它，找不到就记空（面板显示没看到）；别悄悄退回前台——
            # 不然切回 DSH 时面板会显示认出了 DSH，像识别在乱跳。
            _match = str(STATE.get("windowMatch") or "").strip()
            if _match:
                _rect, _title = find_window_rect(_match)
                if not _title:
                    _title = ""
            else:
                _title = foreground_title()
            if _title != STATE.get("_lastTitle"):
                STATE["_lastTitle"] = _title
                # 换窗口就清掉短历史：上一窗口（比如 DSH）的旧帧会被拼图挑进去，
                # 看着就像「游戏里冒出别的界面」。新窗口从零开始攒。
                with FRAMES_LOCK:
                    BUFFER.clear()
                _g, _pace, _info = detect_game(_title)
                STATE["game"] = _g or ""
                STATE["pace"] = _pace or ""
                # 每次切窗口都告诉面板当前认到了什么——认不出也要发，
                # 否则面板会一直挂着上一个游戏的名字。
                emit({
                    "event": "game-detected",
                    "title": _title,
                    "game": _g or "",
                    "genres": (_info or {}).get("genres", []),
                    "from": "local" if _g else "none",
                })
                if not _g and _title:
                    # 只有「像游戏」才值得补库 / 问人；浏览器、编辑器这些直接跳过
                    _exe, _cls = foreground_exe_cls()
                    if is_likely_game(_exe, _cls):
                        # 自动抓百科补库受开关控制：有人不想让插件自己往外联网写数据
                        if STATE.get("autoFetch", True) and _title not in FETCH_TRIED:
                            FETCH_TRIED.add(_title)
                            _save_game_state()
                            threading.Thread(target=bg_fetch_game, args=(_title,), daemon=True).start()
                        # 抓百科没抓出东西（或需要用户确认），就发一个待确认事件，一个标题只发一次
                        if _title not in PENDING_SENT and _title not in DISMISSED:
                            PENDING_SENT.add(_title)
                            _save_game_state()
                            emit({
                                "event": "unknown-game",
                                "title": _title,
                                "exe": os.path.basename(_exe or ""),
                                "at": int(now * 1000),
                            })
            _round_t0 = time.time()
            _t0 = time.time()
            image = grab_for_state()
            _t_grab = time.time() - _t0
            if image is None:
                # 只盯窗口时前台不是那个窗口：不抓，也不留 previous 免得回来误判
                previous = None
                time.sleep(max(0.15, STATE["intervalMs"] / 1000.0))
                continue
            small, current, rows = to_grid(image)
            _t_grid = time.time() - _t0 - _t_grab
            # 视频线只裁字幕条、去重存缓存（拼多句字幕用），不存整张读字大图；
            # 游戏线才留 1280 宽的读字版（读装备/面板用）。
            big = None
            if STATE["mode"] == "video":
                try:
                    _strip = subtitle_strip(image, width=read_big_width(), bottom=0.15)
                    if _strip is not None:
                        from PIL import ImageChops, ImageStat
                        _dup = False
                        if SUBTITLE_STRIPS:
                            _last = SUBTITLE_STRIPS[-1][1]
                            if _last.size == _strip.size:
                                _d = ImageStat.Stat(ImageChops.difference(_last.convert("L"), _strip.convert("L"))).mean[0]
                                _dup = _d < 12.0
                        if not _dup:
                            SUBTITLE_STRIPS.append((now, _strip))
                            if len(SUBTITLE_STRIPS) > 8:
                                SUBTITLE_STRIPS.pop(0)
                except Exception:
                    pass
            else:
                big = image if image.width <= read_big_width() else resize_width(image, read_big_width())
            score = normalize_score(score_pair(previous, current), *row_window(rows))

            with FRAMES_LOCK:
                RECENT.append({"small": small, "t": now, "score": score})

            cut_abs = max(MIN_CUT, min(0.9, float(STATE["threshold"])))
            cooldown = float(STATE["cooldownMs"]) / 1000.0
            floor = float(STATE["floorSec"])

            # 画面动多快：最近几帧的平均差分。用它同时决定采样间隔和兜底留帧的疏密
            history.append(score)
            if len(history) > MOTION_WINDOW:
                history.pop(0)
            motion = sum(history) / len(history)
            # 持续度：最近 MOVING_WINDOW 帧里，多少帧「有变动」（占比）。打团是高低波动，不是连续，用占比不用连续数。
            moving_recent.append(1 if score >= MOVING_SCORE_CUT else 0)
            if len(moving_recent) > MOVING_WINDOW:
                moving_recent.pop(0)
            sample_log_count += 1
            if sample_log_count % 10 == 0:
                try:
                    with open(DEBUG_LOG, 'a', encoding='utf-8') as _f:
                        _f.write('t=%.1f score=%.4f ratio=%.2f\n' % (now - started, score, sum(moving_recent) / len(moving_recent) if moving_recent else 0))
                except Exception:
                    pass
            if score >= MOTION_STILL:
                last_move = now
            if score >= READ_MOTION_CUT:
                last_read = now
            STATE["motion"] = motion
            STATE["stillSec"] = now - last_read
            # 断崖检测（路 B 的开关）：画面一帧之间突增，像打开面板/切界面。
            # 断崖会让 stillSec 归零重算，记下「这次归零是断崖导致的」，读字只需稳住 2 秒；
            # 普通小动（score>=0.06 但不是突增）则抹掉这个标记，得老老实实静止满 5 秒。
            base_score = sum(history[:-1]) / max(1, len(history) - 1) if len(history) > 1 else score
            if score > base_score + READ_JUMP_DELTA and score > READ_JUMP_ABS:
                STATE["jumped"] = True
            elif score >= READ_MOTION_CUT:
                STATE["jumped"] = False

            # 每采一次就留一帧，攒成一条连续的短历史；发不发另说
            offer_frame(small, now - started, score, current, big, cut=bool(STATE.get("jumped")))

            # 变了才开口：变化管「说」，冷却管「闭嘴」，两件事分开算。
            # 面板上的「说一次」是 quiet，同时也在管闭嘴。
            picked = pick_sheet_frames()
            newest = picked[-1]["t"] if picked else -1.0
            if picked and newest > last_frame_t:
                is_video = STATE["mode"] == "video"
                interval_sec = float(STATE["intervalMs"]) / 1000.0
                if is_video:
                    quiet = min(cooldown, VIDEO_QUIET)
                else:
                    # 开口间隔不能快于抓屏间隔，否则画面还没更新就瞎说
                    quiet = max(cooldown, floor, interval_sec)
                if len(picked) > 1:
                    area, mean = diff_stats(picked[0].get("grid"), picked[-1].get("grid"))
                    cut = VIDEO_AREA_CUT if is_video else AREA_CUT
                    changed = area >= cut or mean >= HARD_CUT
                else:
                    changed = False
                # 强制看一眼不能早于开口间隔，否则「最短间隔」就成了摆设
                silent_max = max(float(STATE.get("silentMax") or 300.0), quiet)
                # 读字触发：路 A 静止 5 秒 / 路 B 断崖后稳住 2 秒（见 still_reading），
                # 画面没「大变」但此刻最需要一张能看清字的高清——不等 silent_max 那 300 秒。
                reading_due = (
                    not is_video
                    and still_reading()
                    and now - last_emit >= READING_GAP
                )
                # 切屏/加载：单帧变化冲到接近满，是切窗口/加载，不是游戏内容，别唤醒。
                not_switch = score < SWITCH_CUT
                # 「画面在动就闭嘴」那条砍了：跑图、赶路、过场，画面一直在动，
                # 那个判定会把正常陪看一起掐掉。少说话交给「最短开口」和提示词管。
                if not_switch and ((changed and now - last_emit >= quiet) or reading_due or now - last_emit >= silent_max):
                    if emit_change(picked, now, image) is not None:
                        last_emit = now
                        last_frame_t = newest
            previous = current
        except Exception as exc:
            emit({"event": "error", "message": "grab failed: %r" % (exc,)})
        _wait = adaptive_wait(STATE["intervalMs"] / 1000.0)
        if sample_log_count % 5 == 0:
            try:
                with open(os.path.join(OUT_DIR, "sense-timing.log"), "a", encoding="utf-8") as _f:
                    _f.write(json.dumps({
                        "t": round(time.time() - started, 1),
                        "score": round(score, 4) if 'score' in dir() else 0,
                        "grab": round(_t_grab, 3),
                        "grid": round(_t_grid, 3),
                        "wait": round(_wait, 3),
                        "round": round(time.time() - _round_t0, 3),
                        "motion": round(float(STATE.get("motion") or 0.0), 4),
                    }, ensure_ascii=False) + "\n")
            except Exception:
                pass
        time.sleep(_wait)


if __name__ == "__main__":
    main()
