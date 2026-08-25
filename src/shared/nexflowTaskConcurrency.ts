/** 客户端云端 AI 任务（生图 / 生视频 / 对口型 / LLM 等 ai:invoke）全局并发上限 */
export const NEXFLOW_MAX_TASK_CONCURRENCY = 5;

/**
 * 短剧/导演「提示词优化」并发上限（比总上限更严，避免多镜一点即跑打满 FC 导致 run-task 超时）
 */
export const NEXFLOW_MAX_LLM_SKILL_OPTIMIZE_CONCURRENCY = 2;
