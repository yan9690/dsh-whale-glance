param([string]$File)
# 用 MCI 播 mp3：后台进程里 SoundPlayer / MediaPlayer 都哑，只有 mciSendString 出声。
# 单独放成脚本文件，避开 -Command 里 Add-Type 引号转义踩坑。
if (-not $File -or -not (Test-Path -LiteralPath $File)) { exit 2 }

# ---- speak gate ----------------------------------------------------------
# voice_say (say.mjs) and this script both talk through the same speaker.
# say.mjs drops a sidecar "<mp3>.txt" with the spoken text; both sides share
# one state file so the same line is never spoken twice and two different
# lines never overlap (the later one waits for the earlier to finish).
$gateDir = Join-Path $env:USERPROFILE '.dsh\voice-out'
$gateFile = Join-Path $gateDir 'speak-state.json'
$gateText = ''
$side = "$File.txt"
if (Test-Path -LiteralPath $side) {
  try { $gateText = [string]((Get-Content -LiteralPath $side -Raw -Encoding UTF8 | ConvertFrom-Json).text) } catch { $gateText = '' }
}
if ($gateText) {
  $flat = $gateText -replace '\s', ''
  if ($flat.Length -gt 40) { $flat = $flat.Substring(0, 40) }
  $est = 900 + 260 * $gateText.Length
  for ($try = 0; $try -lt 2; $try++) {
    $now = [int64]((([datetime]::UtcNow) - [datetime]'1970-01-01').TotalMilliseconds)
    $st = $null
    if (Test-Path -LiteralPath $gateFile) {
      try { $st = Get-Content -LiteralPath $gateFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $st = $null }
    }
    if ($st -and [string]$st.key -eq $flat -and ($now - [int64]$st.at) -lt 20000 -and [string]$st.src -ne 'yuguang') {
      exit 0
    }
    if ($st -and [int64]$st.until -gt $now) {
      $wait = [Math]::Min([int64]$st.until - $now, 15000)
      Start-Sleep -Milliseconds $wait
      continue
    }
    $state = @{ key = $flat; at = $now; until = $now + $est; src = 'yuguang' } | ConvertTo-Json -Compress
    if (-not (Test-Path -LiteralPath $gateDir)) { New-Item -ItemType Directory -Force -Path $gateDir | Out-Null }
    try { Set-Content -LiteralPath $gateFile -Value $state -Encoding UTF8 } catch { }
    break
  }
}
# ---- /speak gate ---------------------------------------------------------

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
