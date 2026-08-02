$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$candidates = @(
  'D:\Cursor\Cursor.exe',
  (Join-Path $env:LOCALAPPDATA 'Programs\Cursor\Cursor.exe')
)

$cursor = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $cursor) {
  Write-Host 'Cursor.exe not found in known locations.'
  exit 1
}

$shell = New-Object -ComObject WScript.Shell

$normal = $shell.CreateShortcut((Join-Path $desktop 'Cursor.lnk'))
$normal.TargetPath = $cursor
$normal.WorkingDirectory = Split-Path $cursor
$normal.IconLocation = "$cursor,0"
$normal.Description = 'Start Cursor'
$normal.Save()

$gpu = $shell.CreateShortcut((Join-Path $desktop 'Cursor (Disable GPU).lnk'))
$gpu.TargetPath = $cursor
$gpu.Arguments = '--disable-gpu'
$gpu.WorkingDirectory = Split-Path $cursor
$gpu.IconLocation = "$cursor,0"
$gpu.Description = 'Start Cursor with --disable-gpu'
$gpu.Save()

Write-Host "Cursor: $cursor"
Write-Host 'Created:'
Write-Host "  $(Join-Path $desktop 'Cursor.lnk')"
Write-Host "  $(Join-Path $desktop 'Cursor (Disable GPU).lnk')"
