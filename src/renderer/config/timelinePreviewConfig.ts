/**
 * 时间轴预览配置：音频波形等
 * 禁用后使用占位条，避免显存/内存压力导致渲染进程崩溃
 * 视频轨素材条已改为胶片填充（TimelineClipFilmstrip），不依赖本开关
 */
export const TIMELINE_PREVIEW_ENABLED = false;

/**
 * 旧版「仅首帧」素材条；视频轨已改用 TimelineClipFilmstrip，此开关仅影响遗留 VideoThumbnailStrip
 */
export const TIMELINE_FIRST_FRAME_ENABLED = false;
