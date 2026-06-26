#!/usr/bin/env bash
# 在临时目录拼出与 FC 一致的扁平结构后执行：
#   zip -r aixflow-backend.zip index.mjs package.json lib pricing node_modules
# 依赖：zip、bash；仓库根执行或任意 cwd 均可（脚本定位仓库根）

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEMO="$ROOT/demo/aliyun-fc-init-user"
PRICING="$ROOT/pricing"

for f in price_calculator.mjs cost_table.mjs markup_table.mjs price_tiers.mjs videoBillingSku.mjs videoBillingCloud.mjs; do
  test -f "$PRICING/$f" || { echo "missing pricing/$f"; exit 1; }
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp "$DEMO/index.mjs" "$DEMO/package.json" "$STAGE/"
cp -r "$DEMO/lib" "$DEMO/node_modules" "$STAGE/"
cp -r "$PRICING" "$STAGE/pricing"

cd "$STAGE"
zip -r "$ROOT/aixflow-backend.zip" index.mjs package.json lib pricing node_modules
echo "[pack-aixflow-backend] OK $ROOT/aixflow-backend.zip"
