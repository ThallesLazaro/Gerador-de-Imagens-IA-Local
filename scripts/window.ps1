param(
  [Parameter(Mandatory=$true)][int]$Columns,
  [Parameter(Mandatory=$true)][int]$Rows
)

$ErrorActionPreference = 'SilentlyContinue'
$Columns = [Math]::Max(40, $Columns)
$Rows = [Math]::Max(8, $Rows)

# 1) Windows Terminal / hosts modernos:
# CSI 8 ; rows ; columns t pede ao host para redimensionar a area visivel.
# O modo VT e habilitado explicitamente para funcionar tambem no Windows PowerShell 5.1.
try {
  if (-not ('GeradorConsole.VT' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace GeradorConsole {
  public static class VT {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
  }
}
'@
  }
  $stdout = [GeradorConsole.VT]::GetStdHandle(-11)
  [uint32]$mode = 0
  if ([GeradorConsole.VT]::GetConsoleMode($stdout, [ref]$mode)) {
    [void][GeradorConsole.VT]::SetConsoleMode($stdout, ($mode -bor 0x0004))
  }
  $esc = [char]27
  [Console]::Write(("{0}[8;{1};{2}t" -f $esc, $Rows, $Columns))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 40
} catch {}

# 2) Console Host classico: ajusta tamanho logico de janela e buffer.
try {
  $raw = $Host.UI.RawUI
  $largest = $raw.MaxPhysicalWindowSize
  $cols = [Math]::Min($Columns, [Math]::Max(1, $largest.Width))
  $rows = [Math]::Min($Rows, [Math]::Max(1, $largest.Height))
  $newWindow = New-Object System.Management.Automation.Host.Size($cols, $rows)

  if ($raw.WindowSize.Width -gt $cols -or $raw.WindowSize.Height -gt $rows) {
    $raw.WindowSize = $newWindow
  }

  $bufferWidth = [Math]::Max($cols, $raw.WindowSize.Width)
  $bufferHeight = [Math]::Max($rows, $raw.WindowSize.Height)
  $raw.BufferSize = New-Object System.Management.Automation.Host.Size($bufferWidth, $bufferHeight)
  $raw.WindowSize = $newWindow
} catch {}

# 3) Fallback Win32: altera fisicamente a janela visivel do Console Host.
try {
  if (-not ('GeradorConsole.Native' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace GeradorConsole {
  public static class Native {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CONSOLE_FONT_INFOEX {
      public uint cbSize;
      public uint nFont;
      public short FontWidth;
      public short FontHeight;
      public int FontFamily;
      public int FontWeight;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string FaceName;
    }
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool GetCurrentConsoleFontEx(IntPtr hConsoleOutput, bool bMaximumWindow, ref CONSOLE_FONT_INFOEX info);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  }
}
'@
  }

  $hwnd = [GeradorConsole.Native]::GetConsoleWindow()
  if ($hwnd -ne [IntPtr]::Zero -and [GeradorConsole.Native]::IsWindowVisible($hwnd)) {
    $out = [GeradorConsole.Native]::GetStdHandle(-11)
    $font = New-Object GeradorConsole.Native+CONSOLE_FONT_INFOEX
    $font.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($font)
    [void][GeradorConsole.Native]::GetCurrentConsoleFontEx($out, $false, [ref]$font)

    $wr = New-Object GeradorConsole.Native+RECT
    $cr = New-Object GeradorConsole.Native+RECT
    [void][GeradorConsole.Native]::GetWindowRect($hwnd, [ref]$wr)
    [void][GeradorConsole.Native]::GetClientRect($hwnd, [ref]$cr)

    $nonClientW = [Math]::Max(0, ($wr.Right-$wr.Left) - ($cr.Right-$cr.Left))
    $nonClientH = [Math]::Max(0, ($wr.Bottom-$wr.Top) - ($cr.Bottom-$cr.Top))
    $fontW = [Math]::Max(6, [int]$font.FontWidth)
    $fontH = [Math]::Max(10, [int]$font.FontHeight)
    $pixelW = ($Columns * $fontW) + $nonClientW + 8
    $pixelH = ($Rows * $fontH) + $nonClientH + 8

    # SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE
    [void][GeradorConsole.Native]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, $pixelW, $pixelH, 0x0017)
  }
} catch {}
