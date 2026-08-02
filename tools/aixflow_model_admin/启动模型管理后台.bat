@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请安装 Python 3.10+ 并勾选「添加到 PATH」。
    pause
    exit /b 1
)

python -c "import streamlit" >nul 2>&1
if errorlevel 1 (
    echo [提示] 正在安装 streamlit / tablestore / pandas ...
    python -m pip install -r "%~dp0requirements.txt"
    if errorlevel 1 (
        echo [错误] 依赖安装失败。
        pause
        exit /b 1
    )
)

echo [提示] 默认端口 9510。内嵌窗口需先执行: pip install -r requirements-desktop.txt
echo.

python "%~dp0launch_desktop.py"
if errorlevel 1 pause
endlocal
