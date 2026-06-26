@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo Building portable NEXFLOW Model Admin (embeddable Python + Streamlit)...
echo This may take 5-15 minutes on first run.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_portable.ps1" %*
if errorlevel 1 (
  echo.
  echo [失败] 见上方 PowerShell 报错。
  pause
  exit /b 1
)
echo.
pause
