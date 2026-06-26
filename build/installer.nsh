; 安装包名称与路径：默认安装到 Aixflow 文件夹（由 electron-builder 的 instFilesPre 实现）

; 升级/重装前：结束进程 + 清理 %TEMP% 下 NSIS 残留，降低解压 WinShell.dll「无法写入文件」概率
!macro customInit
  !insertmacro KillAixflowRelatedProcesses
  Sleep 2000
!macroend

; 覆盖 electron-builder 默认检测：写文件前强制结束进程树（含 ffmpeg/yt-dlp），避免应用内更新时「Aixflow 无法关闭」
!macro customCheckAppRunning
  Push $R0
  Push $R1
  StrCpy $R1 0
  ${Do}
    IntOp $R1 $R1 + 1
    !insertmacro KillAixflowRelatedProcesses
    Sleep 2000
    ${nsProcess::FindProcess} "Aixflow.exe" $R0
    ${If} $R0 <> 0
      ${Break}
    ${ElseIf} $R1 >= 8
      ${Break}
    ${EndIf}
  ${Loop}
  Pop $R1
  Pop $R0
!macroend

!macro KillAixflowRelatedProcesses
  nsExec::ExecToStack 'taskkill /F /IM Aixflow.exe /T'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /IM nexflow.exe /T'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /IM ffmpeg.exe /T'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /IM yt-dlp.exe /T'
  Pop $0
  Pop $1
  ; 结束可能卡住的同版本安装器（文件名随版本变化，用 PowerShell 按前缀匹配）
  nsExec::ExecToStack 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $$_.ProcessName -like ''Aixflow-Windows-Setup*'' } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
  Pop $1
  ; 清理 NSIS/nsis-web 临时目录（nst*.tmp / nsw*.tmp）
  nsExec::ExecToStack 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem $$env:TEMP -Directory -ErrorAction SilentlyContinue | Where-Object { $$_.Name -match ''^ns[tw]'' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue"'
  Pop $0
  Pop $1
!macroend

; 设置默认安装目录（64 位：C:\Program Files\Aixflow；32 位：C:\Program Files (x86)\Aixflow）
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Program Files\Aixflow"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Program Files\Aixflow"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Program Files (x86)\Aixflow"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Program Files (x86)\Aixflow"
!macroend

; 安装时：1) 静默安装 VC++ 运行库  2) 仅首次安装时重置激活与 API Key
!macro customInstall
  IfFileExists "$INSTDIR\resources\vc_redist.x64.exe" 0 +2
  ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /passive /norestart' $0
  IfFileExists "$APPDATA\nexflow\license.json" +7 0
  IfFileExists "$APPDATA\nexflow\nexflow-config.json" +7 0
  IfFileExists "$APPDATA\NEXFLOW\license.json" +7 0
  IfFileExists "$APPDATA\NEXFLOW\nexflow-config.json" +7 0
  Delete "$APPDATA\nexflow\license.json"
  Delete "$APPDATA\nexflow\nexflow-config.json"
  Delete "$APPDATA\NEXFLOW\license.json"
  Delete "$APPDATA\NEXFLOW\nexflow-config.json"
!macroend
