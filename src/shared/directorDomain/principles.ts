/**
 * AIXFLOW AI短剧导演台 — 产品原则（Domain 级，不可弱化）
 *
 * 最高原则：
 * AIXFLOW AI短剧导演台不是 Prompt 编辑器，也不是简单视频生成器。
 * 它是：Bible 管规则 → Asset 管资源 → Beat 管剧情 → Shot 管导演决策
 *      → GenerationPackage 管模型执行输入 → Adapter 连接视频引擎。
 * MiniMax H3 是当前视频执行引擎，不是 Domain 核心数据模型。
 *
 * ---------------------------------------------------------------------------
 * 「缺失信息」vs「允许 AI 自由发挥」必须严格区分：
 *
 * 允许 AI：
 * - 分析剧本、识别人物/场景/道具/声音角色
 * - 建立 Beat、生成初版 Shot / 导演字段
 * - 推荐资产、生成参考图/声音资产（经用户确认流程）
 * - 检查依赖、组装 GenerationPackage、适配器映射
 * - 在导演未锁定时，建议镜头运动 / 优化动作措辞（不改变剧情事实）
 *
 * 不允许 AI：
 * - 自动创造缺失人物 / 场景 / 关键道具
 * - 自动改变人物身份、核心脸型、LOCK 服装、已锁场景结构
 * - 自动添加剧本不存在的重要剧情
 * - 因 Prompt 缺信息而让视频模型自行发明上述事实
 *
 * 若生成所需关键资产不存在 → Dependency = BLOCKED，禁止调用视频引擎猜。
 *
 * Voice Dependency 支持 REQUIRED | OPTIONAL | POST_PRODUCTION | NOT_APPLICABLE，
 * 不得把「声音身份」永久硬绑到 H3 视频生成。
 *
 * final_prompt / adapter_prompt_cache 不是业务 Source of Truth；
 * 真相是：资产引用 + Bible 锁 + Shot 导演指令 → GenerationPackage → Adapter。
 */

export const DRAMA_PRODUCT_PRINCIPLES_DOC = `
AIXFLOW AI Short Drama Director — Domain principles (do not weaken).
Missing facts must BLOCK generation; AI must not invent locked identity/appearance/scene/prop.
Prompt is Adapter execution expression only; GenerationPackage (+ asset refs + locks) is SoT.
` as const;

/** Shot 生成契约版本（与 schemaVersion 并存） */
export const DIRECTOR_DOMAIN_CONTRACT_VERSION = 'shot-contract.v1' as const;
