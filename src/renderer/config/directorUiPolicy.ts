/**
 * 设为 true 时隐藏「导演 / MV 导演台」新增入口（右键菜单、拖线创建、handleMenuSelect）。
 * storyboardScript / script（分镜脚本、剧本节点）始终不在添加菜单中，且由 Workspace 禁止新建。
 */
export const HIDE_DIRECTOR_STAGE_UI = false;

/**
 * 导演节点顶部「剧本 | MV」模式切换：隐藏未完成的「剧本」模式页，强制走 MV。
 * 不影响 MV 向导内「写剧本」等步骤；@文本 chip 仍按原逻辑（非 MV 时显示）。
 */
export const HIDE_DIRECTOR_SCRIPT_MODE_UI = true;
