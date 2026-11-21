"""「只盯窗口」放宽的两个判据：_is_player_like / _media_foreground。

不从 sense.py 整份 import（那份要装 mss、PIL，还会建目录、摸系统窗口），
只把这两个函数和那个常量从源码里抠出来执行——验的是真代码，不是复制的一份。
"""
import ast
import pathlib
import sys

SENSE = pathlib.Path(__file__).resolve().parent.parent / "helper" / "sense.py"
src = SENSE.read_text(encoding="utf-8")
tree = ast.parse(src)

wanted_funcs = ("_is_player_like", "_media_foreground")
keep = []
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in wanted_funcs:
        keep.append(node)
    elif isinstance(node, ast.Assign) and any(
        isinstance(t, ast.Name) and t.id == "_WINDOW_PLAYER_HINTS" for t in node.targets
    ):
        keep.append(node)

missing = [name for name in wanted_funcs if not any(
    isinstance(n, ast.FunctionDef) and n.name == name for n in keep)]
if missing:
    print(f"FAIL  源码里找不到：{missing}")
    sys.exit(1)

ns = {}
exec(compile(ast.Module(body=keep, type_ignores=[]), "<sense>", "exec"), ns)
is_player_like = ns["_is_player_like"]
media_fg = ns["_media_foreground"]

ok = []
bad = []


def check(name, cond, extra=""):
    (ok if cond else bad).append(f"{name}{' → ' + extra if extra else ''}")


# ---- 她这台机器上的真实窗口名（11-22 实测那条） ----
check("画中画标题算播放器", is_player_like("画中画 — Mozilla Firefox"))
check("PotPlayer 标题算播放器", is_player_like("PotPlayer 64"))
check("Chrome 标签算播放器", is_player_like("某某番 第3集 - Google Chrome"))
check("VLC 算播放器", is_player_like("vlc 3.0.20"))
check("大写也认", is_player_like("PIP — FIREFOX"))
check("首尾空格不影响", is_player_like("  画中画 — Mozilla Firefox  "))

# ---- 具体的番名/站点名不算（这种就该守前台） ----
check("番名不算播放器", not is_player_like("咒术回战"))
check("字幕组名不算", not is_player_like("桜都字幕组"))
check("Ficket 这种站点名不算", not is_player_like("Ficket"))
check("空窗口名不算", not is_player_like(""))
check("None 不算", not is_player_like(None))
check("纯空白不算", not is_player_like("   "))

# ---- 前台标题 ----
check("前台是播放器", media_fg("画中画 — Mozilla Firefox"))
check("前台是浏览器", media_fg("Bilibili - Microsoft Edge"))
check("前台是 EDA 不算", not media_fg("嘉立创EDA - 专业版"))
check("前台是 DSH 不算", not media_fg("DeepSeek Harness"))
check("前台空不算", not media_fg(""))

# ---- 危险误判：文件名/游戏名里带 edge 字样 ----
# 这条不要求实现做到，只记录当前行为，改了实现就看得见差异
check("备注：含 edge 的怪标题会被当成播放器", media_fg("Knowledge Edge") is True)

print(f"通过 {len(ok)} 项")
for line in ok:
    print("  PASS  " + line)
if bad:
    print(f"\n失败 {len(bad)} 项")
    for line in bad:
        print("  FAIL  " + line)
    sys.exit(1)
