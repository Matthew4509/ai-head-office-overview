# Desktop shortcut and "Start with Windows" for the office. Run by the office (lib/platform/windows.js) with fixed arguments.
#   -Where desktop|startup   -Action status|create|remove   [-Folder <dir>]  (Folder: tests only, instead of the real one)
# The Startup shortcut passes "quiet": the office starts at sign-in without opening its window.
param([string]$Where = 'desktop', [string]$Action = 'status', [string]$Folder = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$app = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))   # lib\platform\windows -> the office folder
$dir = if ($Folder) { $Folder } elseif ($Where -eq 'startup') { [Environment]::GetFolderPath('Startup') } else { [Environment]::GetFolderPath('Desktop') }
$lnk = Join-Path $dir 'AI Head Office Overview.lnk'
switch ($Action) {
  'create' {
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = Join-Path $app 'start.cmd'
    $s.Arguments = if ($Where -eq 'startup') { 'quiet' } else { '' }
    $s.WorkingDirectory = $app
    $s.IconLocation = (Join-Path $app 'office\public\app.ico') + ',0'
    $s.WindowStyle = 7   # minimised: the console the office runs in
    $s.Description = 'AI Head Office Overview: your projects, local copies and audits'
    $s.Save()
  }
  'remove' { if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force } }
}
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ where = $Where; path = $lnk; exists = (Test-Path -LiteralPath $lnk) })
