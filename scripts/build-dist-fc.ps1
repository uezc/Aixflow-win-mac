# NEXFLOW: build dist_fc for Aliyun FC deploy; optional aixflow-final.zip
# From repo root: powershell -ExecutionPolicy Bypass -File scripts/build-dist-fc.ps1
# With zip: .\scripts\build-dist-fc.ps1 -Zip

param(
    [switch]$Zip
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "package.json"))) {
    $root = (Get-Location).Path
}
$src = Join-Path $root "demo\aliyun-fc-init-user"
$dst = Join-Path $root "dist_fc"

if (-not (Test-Path $src)) {
    Write-Error "Source not found: $src"
}

Write-Host "[build-dist-fc] Clean + create $dst"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Path $dst | Out-Null

# index.mjs needs ./lib/* (db-tablestore, aixflow-admin-oss, cors-admin-headers, ...) and ./pricing/*
Copy-Item (Join-Path $src "index.mjs") $dst
Copy-Item (Join-Path $src "package.json") $dst
if (Test-Path (Join-Path $src "package-lock.json")) {
    Copy-Item (Join-Path $src "package-lock.json") $dst
}
Write-Host "[build-dist-fc] Copy node_modules..."
Copy-Item (Join-Path $src "node_modules") (Join-Path $dst "node_modules") -Recurse
Write-Host "[build-dist-fc] Copy lib..."
Copy-Item (Join-Path $src "lib") (Join-Path $dst "lib") -Recurse
Write-Host "[build-dist-fc] Copy pricing from repo root (canonical, required for /code/pricing/price_calculator.mjs)..."
Copy-Item (Join-Path $root "pricing") (Join-Path $dst "pricing") -Recurse

Write-Host "[build-dist-fc] Done. Contents:"
Get-ChildItem $dst -Name

if ($Zip) {
    $zipPath = Join-Path $root "aixflow-final.zip"
    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    # Zip root: index.mjs, lib/, pricing/, node_modules/, ... (no dist_fc folder name)
    Compress-Archive -Path (Join-Path $dst "*") -DestinationPath $zipPath -Force
    Write-Host "[build-dist-fc] Created: $zipPath"
}
