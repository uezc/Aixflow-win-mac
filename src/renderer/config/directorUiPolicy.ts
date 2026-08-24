/**
 * 设为 true 时隐藏「MV导演 / AI短剧」全部新增入口（右键菜单、拖线创建、handleMenuSelect）。
 * storyboardScript / script（分镜脚本、剧本节点）始终不在添加菜单中，且由 Workspace 禁止新建。
 * MV 与短剧为两个独立画布节点类型（director / directorDrama），不再同模块内切换。
 */
export const HIDE_DIRECTOR_STAGE_UI = false;

/**
 * 设为 true 时仅隐藏「AI短剧」新增入口（右键菜单、拖线创建、handleMenuSelect）。
 * 已有工程中的 directorDrama 节点仍可打开；MV 导演（director）不受影响。
 */
export const HIDE_DIRECTOR_DRAMA_UI = false;

/**
 * @deprecated 短剧与 MV 已拆成独立节点，模式切换 UI 已移除；保留常量以免旧 import 报错。
 */
export const HIDE_DIRECTOR_SCRIPT_MODE_UI = true;
