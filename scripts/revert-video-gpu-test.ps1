# 从 video-gpu-test 实验恢复 main 默认 GPU 禁用
$indexPath = Join-Path $PSScriptRoot "..\src\main\index.ts"
$content = Get-Content $indexPath -Raw
$old = @"
// 【video-gpu-test 实验】恢复 GPU/硬解；黑屏则 git checkout main 回退
// app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-software-rasterizer');
// app.disableHardwareAcceleration();
"@
$new = @"
// 【解决黑屏】保留 disableHardwareAcceleration；允许软件光栅化以便在无 GPU 时仍能出图
app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-software-rasterizer'); // 注释后允许软件光栅化，解决黑屏
app.disableHardwareAcceleration();
"@
if ($content -notmatch 'video-gpu-test 实验') {
  Write-Host "index.ts 已是 main 默认配置"
  exit 0
}
$content = $content.Replace($old, $new)
Set-Content -Path $indexPath -Value $content -NoNewline
Write-Host "已恢复 main 默认 GPU 禁用配置。"
