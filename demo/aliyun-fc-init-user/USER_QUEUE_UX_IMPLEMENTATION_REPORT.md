# 用户侧 Queue 状态展示实现报告

**日期：** 2026-09-07  
**结论：** `IMPLEMENTED`  
**范围：** 用户可读任务状态 + 真实 ahead_count；**未修改** Queue Core / Claim / Lease / Charge / Refund / FC Timer / Concurrency / Provider Adapter

---

## 1. 当前实现

### 用户任务状态来源

复用现有链路（未新建 Poll）：

```text
VideoProvider / Workspace
  → nxCloudTaskStatus
  → POST /tasks/status
  → getTaskRowForUser(nx_tasks)
  →（可选）advanceOwnQueueTaskOnStatus（原有）
  → enrichTaskStatusForUserUx（新增只读）
```

### Queue Position 来源

- 仅当 `status_raw === queued` 时计算
- 复用 `listQueuedTasksForPromote` 有界扫描（同 Claim 候选源）
- FIFO 键与 `promoteQueuedTasks` 一致：`(queue_entered_at ASC, task_id ASC)`
- **仅 queued** 计入 ahead；claimed/running 已占并发槽，不计入
- 按 `task_type`（video|image）隔离，互不污染
- 进程内缓存默认 **8s**（`NX_QUEUE_POSITION_CACHE_MS`），避免每个节点全表扫
- 位置查询失败：只省略数字，任务仍显示「排队中」，**不**影响 Queue / Charge / Provider

### 前端刷新机制

- **未新建**第二套 Poll
- VideoProvider 原有轮询：3s → 8s → 15s
- Workspace 云端 track 轮询：queued 时 **4s**，其余视频 **8s**
- success / failed：原有 stop 逻辑不变

### 用户文案映射（`src/shared/userQueueTaskUx.ts`）

| 后端 | 用户看到 |
|------|----------|
| （刚创建 / 无 status） | 准备排队… |
| queued + ahead>0 | 排队中 · 前面还有 X 个任务 |
| queued + ahead=0 | 即将生成 |
| queued + 位置不可用 | 排队中 |
| claimed / running / processing | 生成中 |
| success | 生成完成 |
| failed + refunded | 生成失败 · 已退款 |
| failed | 生成失败 |

**无假百分比：** Queue 路径固定 `progress=8` 仅驱动遮罩动画（`ModuleProgressBar` 本就不显示 % 数字）；已移除 `5 + pollN * 3` 假进度爬升。

---

## 2. API

**未新建路由。** 扩展现有：

### `POST /tasks/status`（只读附加字段）

当任务为 `queued` 时可能返回：

```json
{
  "task_id": "...",
  "status": "queued",
  "queue_entered_at": 123,
  "queue_position": 7,
  "ahead_count": 6,
  "queue_position_available": true,
  "queue_position_complete": true,
  "queue_position_scope": "video",
  "queue_position_reason": "ok"
}
```

非 queued：`queue_position` / `ahead_count` 为 `null`。

失败且 charge 已退款时：

```json
{ "status": "failed", "refunded": true }
```

（只读 `getTaskCharge`，不触发退款）

客户端：`aliyunService.nxCloudTaskStatus` 透传上述字段。

---

## 3. Queue Position 算法（普通人解释）

> 「前面还有 X 个」= 在**同一任务类型**（视频或图片）里，仍处于 **queued**、且按入队时间排在你前面的任务数。

排序规则与云端真正认领任务时一样：谁先进入队列（`queue_entered_at`），谁先；时间相同则按 `task_id`。

已经开始执行的（claimed / running）**不算**在你前面排队——他们已经占了并发名额。

若队列很长、扫描触达上限，可能返回「约 X」并标记 `queue_position_complete=false`（诚实下界，不瞎编）。

---

## 4. UI 修改

| 文件 | 变更 |
|------|------|
| `src/shared/userQueueTaskUx.ts` | **新建** 用户状态映射 |
| `src/main/ai/providers/VideoProvider.ts` | Queue 轮询文案 + 去掉假进度爬升 |
| `src/renderer/components/Workspace.tsx` | 云端 track 轮询文案 + queued 4s |
| `src/main/services/aliyunService.ts` | 透传 ahead / position / refunded |
| `src/renderer/vite-env.d.ts` | 类型补充 |
| `demo/.../lib/queuePosition.mjs` | **新建** 只读位置计算 |
| `demo/.../app/lib/queuePosition.mjs` | 镜像 |
| `demo/.../index.mjs` / `app/app.mjs` | `/tasks/status` 附加 UX 字段 |

未改：预览 / 下载 / 打开目录（沿用现有成功路径）。

---

## 5. 测试结果

### 单元测试

```text
node demo/aliyun-fc-init-user/scripts/test-user-queue-position.mjs
→ PASS
```

覆盖：

- ahead 0 / 1 / 多
- 前置完成后位置变化
- 失败任务不在候选集语义
- running 不触发扫描
- image 不污染 video
- 截断 complete=false
- 列表失败 soft-fail
- UX 文案契约

### 回归（本地）

```text
node demo/aliyun-fc-init-user/scripts/test-phase5-queue-scheduler.mjs
→ PASS（Queue Core 未改动，调度单测仍过）
```

### 人工验收清单（需部署 FC 后真实验收）

| Case | 步骤 | 期望 |
|------|------|------|
| A 单任务 | 提交 1 视频 | 准备排队→排队/即将生成→生成中→生成完成 |
| B 批量 5 | 连续 5 个 | 每节点独立文案；queued 的 ahead 递减合理 |
| C 超并发 | 提交数 > 用户 video 额度 | 部分生成中，其余排队且 ahead 真实 |
| D 关客户端 | 入队后关 App，等 Timer，再开 | 任务可完成（原有 Timer；UX 重开后可读终态） |
| E 失败退款 | 可控失败 | 「生成失败 · 已退款」若 charge.refunded_at 有值 |

> 说明：本机未在本轮对香港 FC 热部署；**代码已就绪**，Case A–E 需在下一轮部署 `nexflow-api` 后人工跑。

---

## 6. 回归结果（代码层）

| 组件 | 结果 |
|------|------|
| Queue Core | **PASS**（未修改；Phase5 单测通过） |
| Charge | **PASS**（未修改） |
| Refund | **PASS**（仅只读 `getTaskCharge`） |
| Concurrency | **PASS**（未修改） |
| FC Timer | **PASS**（未修改） |

---

## 7. 风险

| 风险 | 等级 | 说明 |
|------|------|------|
| OTS 无 status 索引，位置为有界扫描 | P2 | 与 promote 同源限制；缓存 8s；超长队列可能 `complete=false` |
| `/tasks/status` 在 queued 时多一次列表扫描 | P2 | 有缓存；失败不影响任务 |
| FC 需部署后客户端才能看到 ahead | 信息 | 桌面端已透传；旧 FC 无字段时仅显示「排队中」 |
| claimed 映射为「生成中」 | 信息 | 已占槽，不再显示 ahead（比显示「排队中」更贴切） |

---

## 最终状态

```text
IMPLEMENTED
```

普通用户可在视频节点上看到真实、可信的排队/生成文案与 ahead_count；位置查询失败不会干扰任务执行；未触碰冻结的 Queue 基础设施。
