#!/usr/bin/env bash
# 在 aixflow.com.cn 服务器上执行（需 root 或 sudo）
# 前提：已将 aixflow-alipay-backend.zip 上传到 /tmp/
#
#   sudo bash deploy-alipay-backend-on-server.sh
#
# 默认目录 /opt/aixflow/backend，保留现有 .env 与 .venv

set -euo pipefail

ZIP="${1:-/tmp/aixflow-alipay-backend.zip}"
TARGET="${AIXFLOW_BACKEND_DIR:-/opt/aixflow/backend}"
SERVICE="${AIXFLOW_ALIPAY_SERVICE:-aixflow-alipay}"

if [[ ! -f "$ZIP" ]]; then
  echo "找不到 $ZIP，请先把 npm run pack:alipay-backend 生成的 zip 上传到 /tmp/"
  exit 1
fi

if [[ ! -d "$TARGET" ]]; then
  echo "目标目录不存在: $TARGET"
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$TARGET/backup-$STAMP"
mkdir -p "$BACKUP"

echo "== 备份当前 py 到 $BACKUP =="
cp -a "$TARGET"/*.py "$BACKUP/" 2>/dev/null || true
cp -a "$TARGET"/requirements-alipay-test.txt "$BACKUP/" 2>/dev/null || true

echo "== 解压新代码到 $TARGET =="
unzip -o "$ZIP" -d "$TARGET"

if [[ -x "$TARGET/.venv/bin/pip" ]]; then
  echo "== 更新 Python 依赖 =="
  "$TARGET/.venv/bin/pip" install -q -r "$TARGET/requirements-alipay-test.txt"
fi

echo "== 重启 $SERVICE =="
if systemctl is-active --quiet "$SERVICE"; then
  systemctl restart "$SERVICE"
  systemctl status "$SERVICE" --no-pager -l | head -20
else
  echo "警告: 服务 $SERVICE 未运行，请手动: systemctl restart $SERVICE"
fi

echo ""
echo "== 验证套餐 API（本机 8000） =="
curl -fsS "http://127.0.0.1:8000/api/v1/alipay/packages" | head -c 400
echo ""
echo ""
echo "完成。请在浏览器打开: https://aixflow.com.cn/api/v1/alipay/packages"
echo "应包含 starter / popular / value / premium"
