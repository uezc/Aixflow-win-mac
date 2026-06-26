# 支付宝联调测试（本地 + cpolar）

## 我已在本机准备好的部分

- `backend/alipay_test.py`：测试下单 `GET /api/v1/alipay/test_pay`、异步通知 `POST /api/v1/alipay/notify`
- `backend/.env`：`ALIPAY_APP_ID=202106159656144`，`ALIPAY_NOTIFY_URL` 对齐 cpolar `https://2cecc588.r23.cpolar.top`
- `scripts/start-alipay-test.ps1`：启动 8000 端口服务
- `backend/verify_alipay_env.py`：检查密钥能否加载

## 你必须手动完成的部分

### 1. 确认密钥属于应用 `202106159656144`

若密钥是**旧应用**生成的，付不了款或验签失败。请在开放平台该应用下重新配置 RSA2，并更新 `.env`：

```powershell
cd D:\NEXFLOW\backend
.\.venv\Scripts\python.exe generate_env.py
```

按提示输入 AppID、**应用私钥**、**支付宝公钥**（不是应用公钥）。

### 2. 支付宝开放平台（网页应用 202106159656144）

1. **开发设置** → 接口加签：**RSA2**，已上传**应用公钥**
2. 复制 **支付宝公钥** 到 `.env` 的 `ALIPAY_PUBLIC_KEY`
3. **产品绑定**：已开通 **电脑网站支付**
4. **网关地址**（异步通知）填（与 `.env` 完全一致）：

   `https://2cecc588.r23.cpolar.top/api/v1/alipay/notify`

### 3. cpolar

1. 打开 http://localhost:9200 ，隧道 **aixflow test**（或 payflow test）状态为 **active**
2. 本地端口必须是 **8000**
3. 若公网 HTTPS 地址变了，改 `backend/.env` 的 `ALIPAY_NOTIFY_URL` 和开放平台网关

### 4. 发起 0.01 元测试

```powershell
cd D:\NEXFLOW
.\scripts\start-alipay-test.ps1
```

浏览器打开：**http://127.0.0.1:8000/api/v1/alipay/test_pay**

复制 JSON 里的 `pay_url` 到新标签页，用支付宝付款。

### 5. 看结果

| 现象 | 处理 |
|------|------|
| `verify_alipay_env.py` 报 FAIL | 运行 `generate_env.py` 或 `generate_env.py --fix` 重填密钥 |
| 能打开收银台，付完款 | 正常 |
| 终端/`uvicorn-alipay.log` 有 `[alipay notify]` 且 `success` | 异步通知 + 验签成功 |
| 付款成功但没有 notify | 检查 cpolar、网关 URL |
| 下单报 invalid-app-id / 签名错误 | AppID 与密钥必须同一应用 |

## 下一步（联调通过后）

notify 验签通过后会调用 FC `settleAlipayOrder` 自动入账元宝。详见 **`docs/ALIPAY_RECHARGE.md`**。

须先：建表 `nx_orders`、配置 `backend/.env` 中 FC 变量、重新部署 FC。
