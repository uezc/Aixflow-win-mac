import { scaleModulePx } from '../utils/moduleDisplayScale';

/** 图片转 3D 主预览区固定 16:9（与 ComfyUI 3D 预览条类似） */
export const IMAGE_TO_3D_ASPECT = 16 / 9;
export const IMAGE_TO_3D_WIDTH = scaleModulePx(480);
export const IMAGE_TO_3D_HEIGHT = Math.round(IMAGE_TO_3D_WIDTH / IMAGE_TO_3D_ASPECT);

/** 与模型子资产库一致的取景：完整纳入预览框，避免 closeup 裁切 */
export const IMAGE_TO_3D_PREVIEW_CAMERA_FRAMING = 'fit' as const;
