# Phase 8 Audit Report（短）

**范围**：只读扫描 · **未改**任何业务 / Phase5–7 / RH API 代码  
**产物**：`PHASE8_BUSINESS_MIGRATION_MATRIX.md`

## 结论

现网 RH 业务 **100%** 走 legacy：

`/tasks/create`（默认预扣 → `pending`）→ `/run-task` 提交 RH → **客户端** `/query` 轮询。

Phase 5→7 云端链（`queued→claimed→charged→dispatch→provider_task_id→poll→settle`）在 FC **已实现**，但：

- 客户端 **从不**传 `execution_mode=queue`
- 任务 **无** `provider_forward_json`
- 业务 **未**进入 Claim / Charge / Dispatch

两条链路 **未合流**；Phase7 对管线任务的 run-task 双提交拦截，对现网主路径 **几乎打不中**。

## 覆盖业务

| 业务 | 已迁移？ |
|------|----------|
| MV Director | 否（本地 pump=5） |
| AI Short Drama | 否 |
| Image / Video / Batch | 否 |
| Audio / RH AI Apps / 上传 | 否（上传非任务生命周期） |

## 最高风险（迁移前必须处理）

1. 双轨并行 → **重复 RH 提交 / 双扣费**  
2. 本地并发 5 vs 云端 CAS 双轨  
3. create 超时跳过预扣后的 `billing=charge` 旁路  

## 下一步

等你确认 Migration Matrix 后，再进入 Phase 8 **业务迁移编码**（本轮不做）。

---

*Phase 8 Audit · 2026-09-03*
