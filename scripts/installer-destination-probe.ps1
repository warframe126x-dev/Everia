# Exercise the real assisted directory page, without pre-creating its destination.
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
if (Test-Path $Destination) { throw 'The interactive destination fixture already exists.' }
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class InstallerUI {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, Callback cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string text);
  public static string Text(IntPtr h) { var s=new StringBuilder(2048); GetWindowText(h,s,s.Capacity); return s.ToString(); }
  public static IntPtr DirectoryEdit(IntPtr h) {
    IntPtr result=IntPtr.Zero;
    EnumChildWindows(h, (child,p) => { var s=new StringBuilder(128); GetClassName(child,s,s.Capacity);
      if(s.ToString()=="Edit" && IsWindowVisible(child) && Text(child).Contains(":\\")) result=child;
      return true; }, IntPtr.Zero);
    return result;
  }
}
'@
$process = Start-Process -FilePath $Installer -ArgumentList '/currentuser' -PassThru
$submitted = $false
$deadline = (Get-Date).AddSeconds(180)
try {
  while ((Get-Date) -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) { break }
    $window = $process.MainWindowHandle
    if ($window -ne [IntPtr]::Zero) {
      $edit = [InstallerUI]::DirectoryEdit($window)
      if (-not $submitted -and $edit -ne [IntPtr]::Zero) {
        [void][InstallerUI]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $Destination)
        if ([InstallerUI]::Text($edit) -ne $Destination) { throw 'Directory page did not accept the selected path.' }
        $submitted = $true
      }
      $next = [InstallerUI]::GetDlgItem($window, 1)
      $caption = [InstallerUI]::Text($next) -replace '&',''
      if ([InstallerUI]::IsWindowEnabled($next) -and $caption -match '^(Next|Install|Finish)') {
        if ($caption -match '^Install' -and -not $submitted) { throw 'Installer bypassed the directory page.' }
        [void][InstallerUI]::SendMessage($next, 0x00F5, [IntPtr]::Zero, $null)
      }
    }
    Start-Sleep -Milliseconds 400
  }
  if (-not $process.HasExited) { throw 'Assisted installer did not finish within the deadline.' }
  if ($process.ExitCode -ne 0) { throw "Assisted installer exited $($process.ExitCode)." }
  if (-not $submitted -or -not (Test-Path (Join-Path $Destination 'Everia.exe'))) {
    throw 'Assisted installer did not create and populate the selected new directory.'
  }
  @{ destination=$Destination; initiallyAbsent=$true; directoryPageSubmitted=$submitted; installed=$true } | ConvertTo-Json -Compress
} finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
