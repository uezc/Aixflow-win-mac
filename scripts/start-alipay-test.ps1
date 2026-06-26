# 启动支付宝联调 API（端口 8000），日志写入 backend/uvicorn-alipay.log
$ErrorActionPreference = "Stop"
$Backend = (Resolve-Path (Join-Path $PSScriptRoot "..\backend")).Path
$Python = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Host "未找到 $Python，请先: cd backend; python -m venv .venv; pip install -r requirements-alipay-test.txt"
    exit 1
}
if (-not (Test-Path (Join-Path $Backend ".env"))) {
    Write-Host "未找到 backend\.env，请先运行: cd backend; .\.venv\Scripts\python.exe generate_env.py"
    exit 1
}

Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }

Start-Sleep -Milliseconds 500
$log = Join-Path $Backend "uvicorn-alipay.log"
$argList = "-m uvicorn alipay_test:app --host 127.0.0.1 --port 8000"
Start-Process -FilePath $Python `
    -ArgumentList $argList `
    -WorkingDirectory $Backend `
    -WindowStyle Hidden `
    -RedirectStandardOutput $log `
    -RedirectStandardError "${log}.err"

Start-Sleep -Seconds 2
& $Python (Join-Path $Backend "verify_alipay_env.py")
Write-Host ""
Write-Host "测试下单: http://127.0.0.1:8000/api/v1/alipay/test_pay"
Write-Host "日志文件: $log"
Write-Host "cpolar 需保持「aixflow test」隧道 active，指向 localhost:8000"
