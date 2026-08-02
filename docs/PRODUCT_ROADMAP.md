# Aixflow 产品优化与升级路线图（待办记录）

> 记录日期：2026-06-30；ASR 听写接入：2026-07-31  
> 状态：**流式语音输入（百炼实时 ASR）已接入 P0**；其余项仍为规划  
> 目的：统一「安装包瘦身 + 云端素材 + 新功能」方向，供 Mac/Windows 开发与发版对照。

---

## 总目标

| 方向 | 说明 |
|------|------|
| **安装包变小** | 少打本地大文件，升级更快、OSS 流量更可控 |
| **素材可热更新** | 数字人 / 角色 / 场景 / 片头 可在 OSS 改，用户无需重装 |
| **输入体验升级** | 语音输入改为云端流式，接近微信「边说边出字」 |
| **创作闭环** | 热点洞察 → 文案 → 成片 → 多平台发布（远期） |

---

## 一、语音输入（流式 ASR）

### 现状（2026-07-31）

- **打字/听写**：LLM 输入框、文本节点麦克风 → FC `POST /asr/realtime-session` 签发票据 → 主进程连百炼 WebSocket（默认 `fun-asr-realtime`）→ 边说边出字；密钥仅在 FC  
- **MV 歌词时间线**：整曲上传 OSS → FC `POST /asr/file-transcribe` → 百炼 `fun-asr` 异步录音识别（句级时间戳）；**不再依赖本地 Whisper**  
- **长音频转写节点 / 文本批转**：仍可用本地 Whisper（按需下载）

### 目标（已完成 P0）

- **微信式流式输入**：按住说话，文字实时进输入框，松手完成  
- 使用 **阿里云百炼 / DashScope 实时语音识别**（Fun-ASR-Realtime WebSocket）

### 商业化（可选）

- 语音输入作为 **付费权限**（如 ¥9.9/月 或 Pro 会员包含），未开通则麦克风引导购买  
- 不对用户按句 micro-billing；后台按阿里云语音时长结算（10～100 用户量级成本通常很低）

### 依赖

- 阿里云百炼开通 + `DASHSCOPE_API_KEY`（FC 环境变量）
- FC `POST /asr/realtime-session` 签发会话；`POST /asr/file-transcribe` 异步文件转写；AccessKey / API Key 不下发渲染进程
- 客户端已配置 `HK_FC_ENDPOINT` / `ALIYUN_FC_TOKEN` 并登录
- 文件转写：函数执行超时建议 ≥ 600s（FC 内轮询百炼任务）

---

## 二、素材库 OSS 化（角色 / 场景 / 数字人）

### 现状

- `default-asset-library`（角色+场景+3D）：~**434MB** 打进安装包  
- `default-digital-human-library`：~**93MB**（10 条视频，部分已进 Git）  
- 增删素材需 sync → rebuild → 发新版安装包

### 目标

```
OSS
└── library/
    ├── manifest.json          # version / updatedAt / 条目列表 / URL / hash
    ├── characters/ ...
    ├── scenes/ ...
    ├── character-3d/ ...
    └── digital-human/ ...
```

- 客户端启动或打开素材库：**拉 manifest → 对比本地版本 → 增量下载**  
- 缓存目录：`%APPDATA%/NEXFLOW/`（与现有 userData 一致）  
- 新用户：联网首次同步；可选保留 **1～2 条内置种子** 作离线兜底

### 收益

- 安装包预计可 **少 ~500MB+**  
- 你在 OSS 后台加素材 / 改 manifest → **用户下次打开即见**，无需发安装包

### 参考

- 官网 showcase 已是「OSS JSON + 媒体」模式，可复用思路

---

## 三、片头动画（Splash）OSS 化

### 现状

- `splash-videos/片头.mp4` ~**102MB** 在安装包内  
- 换片头需重新 build + upload 整包

### 目标

- 片头 mp4、bgm、logo 放 OSS，manifest 带 `version`  
- 启动时：本地有且 version 一致则直接用；否则后台下载后播放  
- 换片头 = **只改 OSS**，不发新版（或仅发 stub 小更新）

### 收益

- 安装包再 **~100MB**  
- 运营可随时换品牌片头

---

## 四、安装包瘦身与升级策略（建议）

### 当前大包构成（1.6.3 量级）

| 组件 | 约大小 | 建议 |
|------|--------|------|
| Whisper medium | 1.47 GB | 移除或改 tiny/base + 可选下载 |
| 默认素材库 | 434 MB | → OSS 远程库 |
| Demucs | 154 MB | 保留或「首次用人声分离时下载」 |
| 片头 mp4 | 102 MB | → OSS |
| 数字人库 | 93 MB | → OSS |
| FFmpeg / 程序本体 | 必需 | 保留 |

**瘦身后在线安装 stub 仍 ~1MB；7z 负载有望从 ~2.3GB 降到 ~1GB 以内（视 Demucs/Whisper 策略而定）。**

### 升级体验优化建议

1. **继续 nsis-web 在线安装**：用户只下 stub，大负载走 OSS（已在用）  
2. **electron-updater + latest.yml**：增量仍有限，主要靠 **7z 体积变小**  
3. **应用内「资源包版本」**：manifest 与 App version 解耦，素材更新不触发整 App 升级  
4. **可选组件按需下载**：Whisper / Demucs 在设置里「首次使用再下」  
5. **Mac 同策略**：素材与片头不走 Git 大文件，统一 OSS manifest

---

## 五、热点洞察（新功能 · 待细化）

### 产品设想

- 聚合 **抖音 / TikTok 等** 平台当前热门：话题、视频、文案  
- 一览式看板：热点列表 + 可编辑 **文案/脚本草稿**  
- 帮助作者：选题 → 写稿 → 进入现有画布工作流  

### 待想清楚

- [ ] 数据来源：官方 API / 第三方数据服务 / 爬虫（合规与稳定性）  
- [ ] 更新频率：小时级 / 日级  
- [ ] 与画布联动：热点一键生成「文本节点」或 LLM 人设提示  
- [ ] 是否付费功能、是否消耗元宝  

### 阶段建议

- **MVP**：手动导入或单一平台 RSS/榜单 + 本地列表 + 导出 txt  
- **V2**：定时拉取 + 分类标签 + 与 LLM 节点联动  

---

## 六、创作完成后多平台发布（新功能 · 远期）

### 产品设想

- 成片 / 图文完成后，**一键分发** 到抖音、快手、小红书、B 站、TikTok 等  
- 与各平台开放平台 API 对接（需企业资质、审核）

### 难点

- 各平台 **OAuth、上传 API、格式规范** 不统一  
- 审核、版权、账号绑定  
- 建议 **分平台逐个接**，不要一开始「全平台」

### 阶段建议

- **MVP**：导出 + 复制标题/标签 + 打开平台上传页（半自动）  
- **V2**：接 1～2 个主平台 API（如抖音开放平台）  
- **V3**：排期发布、多账号管理  

---

## 建议实施顺序（优先级）

| 阶段 | 项 | 理由 |
|------|-----|------|
| **P0** | 流式语音输入（阿里云 ASR） | 体验提升大 + 可减 ~1.5GB 安装包 |
| **P1** | 素材库 OSS + manifest 同步 | 减 ~500MB，运营可热更新素材 |
| **P1** | 片头 OSS 化 | 减 ~100MB，换片头不发版 |
| **P2** | 语音输入付费权限 + FC 鉴权 | 成本与商业化 |
| **P2** | Demucs / Whisper 按需下载 | 进一步瘦身 |
| **P3** | 热点洞察 MVP | 新功能，需单独调研数据源 |
| **P4** | 多平台一键发布 | 依赖平台 API 与合规 |

---

## 架构原则（后续开发统一遵守）

1. **安装包 = 程序 + 小配置**；大媒体默认走 OSS  
2. **manifest 驱动**：`version` / `updatedAt` / 文件 hash，客户端只 sync diff  
3. **Token 经 FC 签发**，不把云厂商 AK 打进客户端  
4. **App 版本与资源版本分离**，素材更新不必 bump 安装包 version  

---

## 相关文档与代码（现状）

- 默认资产库注入：`src/main/utils/defaultAssetLibrary.ts`  
- 默认数字人库：`src/main/utils/defaultDigitalHumanLibrary.ts`  
- 本地 Whisper 转写：`src/main/services/localResourceManager.ts` → `transcribeSpeechFromAudioUrl`  
- 官网 showcase OSS：`demo/aliyun-fc-init-user/lib/aixflow-admin-oss.mjs`  
- 安装包体积说明：见对话记录 / `npm run electron:build` 产物分析  

---

*本文档随讨论更新；实施某条时请在此标记状态或链到 PR。*
