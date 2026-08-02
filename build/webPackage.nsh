; Aixflow nsis-web：主包下载进度 UI（覆盖 app-builder-lib 默认 webPackage.nsh）
; - 使用 build/x86-unicode/INetC.dll（≥1.0.5.7）修复 >2GB 负百分比
; - 隐藏 InstFiles 原生进度条，避免与 INetC 进度条叠成「幽灵条」
; - 标题勿用 PowerShell HEAD 拼体积（nsExec/引号/%20 易把 ParserError 灌进 caption）
; - 进度文案用半角括号，避免 INetC % 格式串错位
; - 主源失败后回退另一区域 OSS（香港 ↔ 北京）
; ShowWindow: 0=SW_HIDE, 5=SW_SHOW

!ifndef AIXFLOW_OSS_HK_UPLOADS
  !define AIXFLOW_OSS_HK_UPLOADS "https://nexflow-temp-images.oss-cn-hongkong.aliyuncs.com/aixflow%20uploads"
!endif
!ifndef AIXFLOW_OSS_BJ_UPLOADS
  !define AIXFLOW_OSS_BJ_UPLOADS "https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/aixflow%20uploads"
!endif

!macro AixflowHideNativeInstProgress
  Push $R7
  Push $R8
  Push $R9
  FindWindow $R7 "#32770" "" $HWNDPARENT
  ${if} $R7 != 0
    ; 1004 = 原生进度条（下载阶段为空框，易被看成残留）
    GetDlgItem $R8 $R7 1004
    ${if} $R8 != 0
      ShowWindow $R8 0
    ${endif}
    ; 下载期间只保留 INetC 自带「取消」，隐藏底部重复取消
    GetDlgItem $R9 $HWNDPARENT 2
    ${if} $R9 != 0
      ShowWindow $R9 0
    ${endif}
  ${endif}
  Pop $R9
  Pop $R8
  Pop $R7
!macroend

!macro AixflowShowNativeInstProgress
  Push $R7
  Push $R8
  Push $R9
  FindWindow $R7 "#32770" "" $HWNDPARENT
  ${if} $R7 != 0
    GetDlgItem $R8 $R7 1004
    ${if} $R8 != 0
      ShowWindow $R8 5
    ${endif}
    GetDlgItem $R9 $HWNDPARENT 2
    ${if} $R9 != 0
      ShowWindow $R9 5
    ${endif}
  ${endif}
  Pop $R9
  Pop $R8
  Pop $R7
!macroend

!macro downloadApplicationFiles
  Var /GLOBAL packageUrl
  Var /GLOBAL packageUrlPrimary
  Var /GLOBAL packageUrlAlt
  Var /GLOBAL packageArch
  Var /GLOBAL packageDlCaption
  Var /GLOBAL packageFileName
  Var /GLOBAL packageTriedAlt

  StrCpy $packageUrl "${APP_PACKAGE_URL}"
  StrCpy $packageArch "${APP_PACKAGE_URL}"
  StrCpy $packageUrlAlt ""
  StrCpy $packageFileName ""
  StrCpy $packageTriedAlt "0"
  ; 固定标题：勿把外部命令输出拼进 caption（曾出现「表达式中缺少右 )」）
  StrCpy $packageDlCaption "正在下载 Aixflow 安装包"

  !ifdef APP_PACKAGE_URL_IS_INCOMPLETE
    !ifdef APP_64_NAME
      !ifdef APP_32_NAME
	    	!ifdef APP_ARM64_NAME
	  		  ${if} ${IsNativeARM64}
	          StrCpy $packageUrl "$packageUrl/${APP_ARM64_NAME}"
	          StrCpy $packageFileName "${APP_ARM64_NAME}"
	        ${elseif} ${IsNativeAMD64}
	          StrCpy $packageUrl "$packageUrl/${APP_64_NAME}"
	          StrCpy $packageFileName "${APP_64_NAME}"
	        ${else}
	          StrCpy $packageUrl "$packageUrl/${APP_32_NAME}"
	          StrCpy $packageFileName "${APP_32_NAME}"
	        ${endif}
		    !else
	        ${if} ${IsNativeAMD64}
	          StrCpy $packageUrl "$packageUrl/${APP_64_NAME}"
	          StrCpy $packageFileName "${APP_64_NAME}"
	        ${else}
	          StrCpy $packageUrl "$packageUrl/${APP_32_NAME}"
	          StrCpy $packageFileName "${APP_32_NAME}"
	        ${endif}
	     	!endif
      !else
        StrCpy $packageUrl "$packageUrl/${APP_64_NAME}"
        StrCpy $packageFileName "${APP_64_NAME}"
      !endif
    !else
      StrCpy $packageUrl "$packageUrl/${APP_32_NAME}"
      StrCpy $packageFileName "${APP_32_NAME}"
    !endif
  !endif

  StrCpy $packageUrlPrimary "$packageUrl"

  ${if} ${IsNativeARM64}
    StrCpy $packageArch "ARM64"
  ${elseif} ${IsNativeAMD64}
    StrCpy $packageArch "64"
  ${else}
    StrCpy $packageArch "32"
  ${endif}

  ; 备用镜像：与 publish.url（通常香港）相对的另一区域；文件名与主源相同
  ${if} $packageFileName != ""
    Push $R0
    StrCpy $R0 "${AIXFLOW_OSS_BJ_UPLOADS}/$packageFileName"
    ${if} $packageUrl == $R0
      StrCpy $packageUrlAlt "${AIXFLOW_OSS_HK_UPLOADS}/$packageFileName"
    ${else}
      StrCpy $packageUrlAlt "${AIXFLOW_OSS_BJ_UPLOADS}/$packageFileName"
    ${endif}
    Pop $R0
  ${endif}

  DetailPrint "正在下载 Aixflow 安装包，请保持网络畅通…"

  download:
  !insertmacro AixflowHideNativeInstProgress
  ; /TRANSLATE 参数顺序（嵌入式对话框）：
  ;   downloading, connecting, second, minute, hour, plural, progress, remaining
  ; progress 格式参数顺序：已下载kB, 百分比, 总量kB, 速度整数, 速度一位小数
  ; INetC ≥1.0.5.7 会对 >2GB 做缩放后再 MulDiv，百分比落在 0–100
  ; 文案使用半角 () 与 %%，避免全角括号导致格式错位
  inetc::get /USERAGENT "electron-builder (Mozilla)" /HEADER "X-Arch: $packageArch" /RESUME "" \
    /CAPTION "$packageDlCaption" \
    /CANCELTEXT "取消" \
    /TRANSLATE "正在下载 %s" "正在连接服务器..." "秒" "分钟" "小时" "" \
      "已下载 %d kB (%d%%) / 共 %d kB · %d.%01d kB/s" \
      "(剩余约 %d %s%s)" \
    "$packageUrl" "$PLUGINSDIR\package.7z" /END
  Pop $0

  ${if} $0 == "Cancelled"
    !insertmacro AixflowShowNativeInstProgress
    Quit
  ${endif}

  ${if} $0 != "OK"
    # try without proxy
    DetailPrint "下载中断 ($0)，尝试直连（无代理）…"
    inetc::get /NOPROXY /USERAGENT "electron-builder (Mozilla)" /HEADER "X-Arch: $packageArch" /RESUME "" \
      /CAPTION "$packageDlCaption" \
      /CANCELTEXT "取消" \
      /TRANSLATE "正在下载 %s" "正在连接服务器..." "秒" "分钟" "小时" "" \
        "已下载 %d kB (%d%%) / 共 %d kB · %d.%01d kB/s" \
        "(剩余约 %d %s%s)" \
      "$packageUrl" "$PLUGINSDIR\package.7z" /END
    Pop $0
  ${endif}

  ${if} $0 == "Cancelled"
    !insertmacro AixflowShowNativeInstProgress
    Quit
  ${endif}

  ; 主源仍失败：切换香港/北京镜像再试（大包中断常见于跨区链路）
  ${if} $0 != "OK"
  ${andif} $packageTriedAlt == "0"
  ${andif} $packageUrlAlt != ""
  ${andif} $packageUrlAlt != $packageUrl
    DetailPrint "切换镜像源重试…"
    StrCpy $packageUrl "$packageUrlAlt"
    StrCpy $packageTriedAlt "1"
    Goto download
  ${endif}

  !insertmacro AixflowShowNativeInstProgress

  ${if} $0 == "Cancelled"
    quit
  ${elseif} $0 != "OK"
    Messagebox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法下载安装包（状态: $0）。$\r$\n$\r$\n地址: $packageUrl$\r$\n$\r$\n请检查网络后点「重试」；若多次失败，可改用官网离线安装包。" IDRETRY download_retry
    Quit
  ${endif}

  StrCpy $packageFile "$PLUGINSDIR\package.7z"
  DetailPrint "安装包下载完成，正在解压…"
  Goto download_done

  download_retry:
  StrCpy $packageUrl "$packageUrlPrimary"
  StrCpy $packageTriedAlt "0"
  Goto download

  download_done:
!macroend
