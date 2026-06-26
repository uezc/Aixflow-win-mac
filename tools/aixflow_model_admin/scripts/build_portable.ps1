# Build a self-contained "software-like" folder: embeddable Python + deps + app.
# Output: tools/aixflow_model_admin/dist_portable/NEXFLOW-Model-Admin/
# Requires: Windows x64, PowerShell 5+, network (first run).
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_portable.ps1
#         powershell ... -File scripts\build_portable.ps1 -PythonVersion 3.12.8

param(
    [string]$PythonVersion = "3.12.8",
    [string]$OutName = "NEXFLOW-Model-Admin",
    [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AdminRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CacheRoot = Join-Path $AdminRoot ".build_portable_cache"
$OutRoot = Join-Path $AdminRoot "dist_portable"
$DistDir = Join-Path $OutRoot $OutName
$PythonDir = Join-Path $DistDir "python"
$AppDir = Join-Path $DistDir "app"

$EmbedZipName = "python-$PythonVersion-embed-amd64.zip"
$EmbedUrl = "https://www.python.org/ftp/python/$PythonVersion/$EmbedZipName"
$EmbedZipPath = Join-Path $CacheRoot $EmbedZipName
$GetPipPath = Join-Path $CacheRoot "get-pip.py"
$GetPipUrl = "https://bootstrap.pypa.io/get-pip.py"

function Write-Step($msg) { Write-Host "[build_portable] $msg" -ForegroundColor Cyan }

New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null

if (-not $SkipDownload -or -not (Test-Path $EmbedZipPath)) {
    Write-Step "Downloading $EmbedUrl"
    New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
    Invoke-WebRequest -Uri $EmbedUrl -OutFile $EmbedZipPath -UseBasicParsing
}

if (-not $SkipDownload -or -not (Test-Path $GetPipPath)) {
    Write-Step "Downloading get-pip.py"
    Invoke-WebRequest -Uri $GetPipUrl -OutFile $GetPipPath -UseBasicParsing
}

Write-Step "Preparing $DistDir"
if (Test-Path $DistDir) {
    Remove-Item -LiteralPath $DistDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $PythonDir | Out-Null
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

Write-Step "Extracting embeddable Python"
Expand-Archive -LiteralPath $EmbedZipPath -DestinationPath $PythonDir -Force

$pthFiles = Get-ChildItem -Path $PythonDir -Filter "*._pth" -File
if (-not $pthFiles) {
    throw "No *._pth found after extracting embeddable Python."
}
$pth = $pthFiles[0]
# Do NOT use (Get-Content ... -TotalCount 1)[0]: a single-line file returns a [string],
# and [0] is the first *character* ("p" from "python312.zip") — breaks encodings import.
$pyZip = Get-ChildItem -Path $PythonDir -Filter "python*.zip" -File | Select-Object -First 1
if (-not $pyZip) {
    throw "No python*.zip in embed directory (stdlib archive missing)."
}
$zipLine = $pyZip.Name
$pthLines = @(
    $zipLine
    "."
    "Lib\site-packages"
    ""
    "import site"
)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($pth.FullName, $pthLines, $utf8NoBom)

$libSite = Join-Path $PythonDir "Lib\site-packages"
New-Item -ItemType Directory -Force -Path $libSite | Out-Null

$pyExe = Join-Path $PythonDir "python.exe"
if (-not (Test-Path $pyExe)) {
    throw "python.exe not found under $PythonDir"
}

function Invoke-EmbedPython {
    param(
        [Parameter(Mandatory = $true)][string]$PythonExe,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $savedHome = $env:PYTHONHOME
    $savedPath = $env:PYTHONPATH
    try {
        Remove-Item Env:\PYTHONHOME -ErrorAction SilentlyContinue
        Remove-Item Env:\PYTHONPATH -ErrorAction SilentlyContinue
        # Inside functions, & + $LASTEXITCODE is unreliable in PS 5.1; $null -ne 0 is $true and falsely fails.
        $proc = Start-Process -FilePath $PythonExe -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
            -Wait -PassThru -NoNewWindow
        $code = $proc.ExitCode
        if ($null -eq $code) { return 1 }
        return [int]$code
    }
    finally {
        if ($null -ne $savedHome -and $savedHome -ne "") { $env:PYTHONHOME = $savedHome }
        else { Remove-Item Env:\PYTHONHOME -ErrorAction SilentlyContinue }
        if ($null -ne $savedPath -and $savedPath -ne "") { $env:PYTHONPATH = $savedPath }
        else { Remove-Item Env:\PYTHONPATH -ErrorAction SilentlyContinue }
    }
}

Write-Step "Installing pip"
$exit = Invoke-EmbedPython -PythonExe $pyExe -WorkingDirectory $PythonDir -Arguments @($GetPipPath, "--no-warn-script-location")
if ($exit -ne 0) { throw "get-pip failed (exit $exit). See messages above." }

Write-Step "Upgrading pip & installing requirements (may take several minutes)"
$exit = Invoke-EmbedPython -PythonExe $pyExe -WorkingDirectory $PythonDir -Arguments @("-m", "pip", "install", "--upgrade", "pip")
if ($exit -ne 0) { throw "pip upgrade failed (exit $exit)" }

# Embeddable + get-pip has no setuptools; pywebview pulls proxy_tools (sdist) which needs setuptools.build_meta.
Write-Step "Installing setuptools & wheel (required to build sdist deps)"
$exit = Invoke-EmbedPython -PythonExe $pyExe -WorkingDirectory $PythonDir -Arguments @("-m", "pip", "install", "setuptools", "wheel")
if ($exit -ne 0) { throw "setuptools/wheel install failed (exit $exit)" }

$req1 = Join-Path $AdminRoot "requirements.txt"
$req2 = Join-Path $AdminRoot "requirements-desktop.txt"
$exit = Invoke-EmbedPython -PythonExe $pyExe -WorkingDirectory $PythonDir -Arguments @("-m", "pip", "install", "-r", $req1, "-r", $req2)
if ($exit -ne 0) { throw "pip install failed (exit $exit)" }

Write-Step "Copying application files"
Copy-Item -LiteralPath (Join-Path $AdminRoot "app.py") -Destination (Join-Path $AppDir "app.py") -Force
Copy-Item -LiteralPath (Join-Path $AdminRoot "launch_desktop.py") -Destination (Join-Path $AppDir "launch_desktop.py") -Force
$streamlitDst = Join-Path $AppDir ".streamlit"
New-Item -ItemType Directory -Force -Path $streamlitDst | Out-Null
Copy-Item -LiteralPath (Join-Path $AdminRoot ".streamlit\secrets.toml.example") -Destination (Join-Path $streamlitDst "secrets.toml.example") -Force

$builtAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$verLines = @(
    "NEXFLOW Model Admin (portable)",
    "Built: $builtAt",
    "Python embed: $PythonVersion",
    "",
    "First run: copy secrets.toml.example to .streamlit/secrets.toml in the app folder and edit.",
    "Launch: double-click START-with-console.bat (same folder as python/ and app/)."
)
Set-Content -LiteralPath (Join-Path $DistDir "README_PORTABLE.txt") -Value $verLines -Encoding UTF8

$consoleBat = Join-Path $DistDir "START-with-console.bat"
$batLines = @(
    '@echo off',
    'chcp 65001 >nul',
    'set "ROOT=%~dp0"',
    'if not exist "%ROOT%python\python.exe" (',
    '  echo [错误] 找不到便携 Python，请把本 bat 放在 NEXFLOW-Model-Admin 根目录（与 python、app 同级）。',
    '  pause',
    '  exit /b 1',
    ')',
    'cd /d "%ROOT%app"',
    '"%ROOT%python\python.exe" "%ROOT%app\launch_desktop.py"',
    'echo.',
    'echo 进程已结束，退出码: %ERRORLEVEL%',
    'pause'
)
Set-Content -LiteralPath $consoleBat -Value $batLines -Encoding ASCII

Write-Step "Done."
Write-Host ""
Write-Host "  Output: $DistDir" -ForegroundColor Green
Write-Host "  Run:    double-click START-with-console.bat" -ForegroundColor Green
Write-Host "  Zip the whole folder to distribute (no Python install on target PC)." -ForegroundColor DarkGray
Write-Host ""
