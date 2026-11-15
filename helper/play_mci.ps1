param([string]$File)
# 用 MCI 播 mp3：后台进程里 SoundPlayer / MediaPlayer 都哑，只有 mciSendString 出声。
# 单独放成脚本文件，避开 -Command 里 Add-Type 引号转义踩坑。
if (-not $File -or -not (Test-Path -LiteralPath $File)) { exit 2 }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MCI {
  [DllImport("winmm.dll", CharSet=CharSet.Unicode)]
  public static extern int mciSendString(string cmd, string ret, int retLen, IntPtr hwnd);
}
"@
$null = [MCI]::mciSendString("open `"$File`" type mpegvideo alias yg", $null, 0, [IntPtr]::Zero)
# 按音频实际时长等，不写死 6 秒（短句多等、长句被截）
$len = New-Object System.Text.StringBuilder 256
$null = [MCI]::mciSendString("status yg length", $len, 256, [IntPtr]::Zero)
$ms = 0
$null = [int]::TryParse($len.ToString(), [ref]$ms)
if ($ms -le 0) { $ms = 6000 }
$null = [MCI]::mciSendString("play yg", $null, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds ($ms + 300)
$null = [MCI]::mciSendString("close yg", $null, 0, [IntPtr]::Zero)
