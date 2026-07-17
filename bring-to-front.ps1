Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W6 {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
    public const int SW_SHOW = 5;
    public const int SW_RESTORE = 9;
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    public struct RECT { public int L, T, R, B; }
}
"@

$procs = Get-Process electron -ErrorAction SilentlyContinue
$script:pidList = @{}
foreach($p in $procs) { $script:pidList[[int]$p.Id] = $true }

$script:found = @()
$cb = [W6+EnumProc]{
  param($h, $l)
  $wp = 0
  [W6]::GetWindowThreadProcessId($h, [ref]$wp) | Out-Null
  if($script:pidList.ContainsKey([int]$wp)) {
    $len = [W6]::GetWindowTextLength($h)
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [W6]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
    $r = New-Object W6+RECT
    [W6]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.R - $r.L
    $h2 = $r.B - $r.T
    if($w -gt 0 -and $h2 -gt 0) {
      $title = $sb.ToString()
      $script:found += [PSCustomObject]@{
        HWnd = $h
        Pid = $wp
        Title = $title
        W = $w
        H = $h2
        L = $r.L
        T = $r.T
        Visible = [W6]::IsWindowVisible($h)
      }
    }
  }
  return $true
}
[W6]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

# Bring "桌面计时器" and "桌面宠物" to front
foreach($w in $script:found) {
  if($w.Title -eq '桌面计时器' -or $w.Title -eq '桌面宠物') {
    Write-Host "Bringing to front: $($w.Title) hWnd=$($w.HWnd) at ($($w.L),$($w.T))"
    [W6]::ShowWindow($w.HWnd, [W6]::SW_RESTORE) | Out-Null
    [W6]::SetWindowPos($w.HWnd, [IntPtr]::Zero, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010) | Out-Null
  }
}
