#!/usr/bin/env bash
# 上线三连验证（在服务器或本机对公网域名执行）
# 用法：PAY_BASE=https://pay.aixflow.ai ./scripts/verify-production-alipay.sh

set -euo pipefail
BASE="${PAY_BASE:-https://pay.aixflow.ai}"
BASE="${BASE%/}"

echo "== 1) HTTPS packages =="
curl -fsS "${BASE}/api/v1/alipay/packages" | head -c 200
echo ""
echo ""

echo "== 2) SSE stream (5s, 应有 connected / keepalive) =="
curl -fsS -N -m 5 "${BASE}/api/v1/alipay/events/stream?out_trade_no=LAUNCH-PROBE" || true
echo ""
echo ""

echo "== 3) notify 路径可达（POST 无签名应 failure，说明路由通） =="
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/v1/alipay/notify" -d "test=1")
echo "HTTP ${code} (200/400/500 均表示 nginx→uvicorn 通；勿期望 success)"
echo ""
echo "Done. 真支付后检查日志: notify_received + signature_verified"
