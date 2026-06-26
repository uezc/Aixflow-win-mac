# 在 video-gpu-test 分支启用 GPU 硬解实验（勿在 main 运行）
$indexPath = Join-Path $PSScriptRoot "..\src\main\index.ts"
$content = Get-Content $indexPath -Raw
$old = @"
// 【解决黑屏】保留 disableHardwareAcceleration；允许软件光栅化以便在无 GPU 时仍能出图
app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-software-rasterizer'); // 注释后允许软件光栅化，解决黑屏
app.disableHardwareAcceleration();
"@
$new = @"
// 【video-gpu-test 实验】恢复 GPU/硬解；黑屏则 git checkout main 回退
// app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-software-rasterizer');
// app.disableHardwareAcceleration();
"@
if ($content -notmatch [regex]::Escape("app.commandLine.appendSwitch('disable-gpu')")) {
  Write-Host "index.ts 已是 GPU 实验配置或结构已变，请手动对照 docs/video-playback-gpu-test.md"
  exit 1
}
$content = $content.Replace($old, $new)
Set-Content -Path $indexPath -Value $content -NoNewline
Write-Host "已启用 video-gpu-test GPU 配置。请完全重启 Electron 后测试。"
