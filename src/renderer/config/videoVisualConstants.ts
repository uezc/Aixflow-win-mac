/**
 * 视频视觉策略滞后参数
 * 视觉优先级最高，复刻 RunningHub 零闪烁效果
 */

/** 离开视口后延迟 unmount video，避免快速缩放时频繁挂载/卸载导致闪烁 */
export const VIEWPORT_UNMOUNT_DELAY_MS = 400;

/** 缩放/拖拽结束后延迟解锁，300ms 后才触发解码器重新分配 */
export const ZERO_FLICKER_INTERACTION_UNLOCK_MS = 300;

/** LOD 阈值滞后区间，减少缩放时 far/mid/near 频繁切换 */
export const LOD_HYSTERESIS_EXTRA = 0.06;

/** far placeholder 滞后，避免缩放时 placeholder↔图像 频繁切换 */
export const FAR_PLACEHOLDER_HYSTERESIS_EXTRA = 0.03;

/** RunningHub 策略：视口四轴冗余缓冲区（flow 坐标 px），只有完全离开此范围才 unmount */
export const VIEWPORT_REDUNDANT_PADDING = 1000;

/** LOD 滞后区间 ±0.1，防止缩放临界点闪烁 */
export const LOD_HYSTERESIS_LARGE = 0.1;
