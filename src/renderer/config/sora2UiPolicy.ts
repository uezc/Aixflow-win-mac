/**
 * Sora2 官方下架后：前端不再展示 Sora2 视频模型，以及基于 Sora 管线「从视频创建角色」的底部面板。
 * 旧工程节点 data 里仍可能含 sora-2 / sora-2-pro，渲染与发起任务时会归一到替代默认模型。
 */
export const HIDE_SORA2_AND_SORA_CHARACTER_UI = true;

/** 新建视频节点 / 文生视频 / 隐藏 Sora 时的默认模型 */
export const DEFAULT_VIDEO_MODEL_REPLACING_SORA2 = 'rhart-video-x' as const;
