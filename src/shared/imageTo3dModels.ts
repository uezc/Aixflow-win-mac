/** 图片转 3D：Hy3D 经典工作流（24G default） */
export const IMAGE_TO_3D_HY3D_APP_ID = '2059618241806430209';
/** 图片转 3D：Trellis2（App 2072903678922674177；Load Image 节点见 TRELLIS2_RH_IMAGE_NODE_ID） */
export const TRELLIS2_IMAGE_TO_3D_APP_ID = '2072903678922674177';
/**
 * Trellis2「Load Image with Transparency」节点（API nodeId=6，fieldName=image）
 */
export const TRELLIS2_RH_IMAGE_NODE_ID = '6';
export const TRELLIS2_RH_IMAGE_FIELD_DESCRIPTION = '上传图像';
/** Trellis2 Post Process 输出 base_color_texture 的节点（API results 中常见） */
export const TRELLIS2_POST_PROCESS_NODE_ID = '57';
export const TRELLIS2_POST_PROCESS_NODE_IDS = ['57', '452', '453'] as const;
/** Trellis2 Export Mesh（TrellisTextured_*.glb） */
export const TRELLIS2_EXPORT_MESH_NODE_ID = '53';
/** Trellis2 抠图预览 SaveImage（ComfyUI_*.png，非 UV 贴图） */
export const TRELLIS2_PREVIEW_IMAGE_NODE_ID = '48';
/** 面板是否显示 Trellis2（RH API 修复后可长期开启） */
export const TRELLIS2_IMAGE_TO_3D_UI_ENABLED = true;
export const HY3D_RH_IMAGE_NODE_ID = '13';

/** 节点 data.model / 面板选项值 */
export const IMAGE_TO_3D_MODEL_HY3D = 'image-to-3d';
export const IMAGE_TO_3D_MODEL_TRELLIS2 = 'trellis2';

export const DEFAULT_IMAGE_TO_3D_MODEL = IMAGE_TO_3D_MODEL_HY3D;

export type ImageTo3dModelId = typeof IMAGE_TO_3D_MODEL_HY3D | typeof IMAGE_TO_3D_MODEL_TRELLIS2;

export function resolveImageTo3dModelId(raw?: string | null): ImageTo3dModelId {
  const v = String(raw ?? '').trim();
  if (
    TRELLIS2_IMAGE_TO_3D_UI_ENABLED &&
    (v === IMAGE_TO_3D_MODEL_TRELLIS2 ||
      v === TRELLIS2_IMAGE_TO_3D_APP_ID ||
      v === 'image-to-3d-trellis2')
  ) {
    return IMAGE_TO_3D_MODEL_TRELLIS2;
  }
  return IMAGE_TO_3D_MODEL_HY3D;
}

export function getVisibleImageTo3dModelOptions(): typeof IMAGE_TO_3D_MODEL_OPTIONS {
  if (TRELLIS2_IMAGE_TO_3D_UI_ENABLED) return IMAGE_TO_3D_MODEL_OPTIONS;
  return IMAGE_TO_3D_MODEL_OPTIONS.filter((o) => o.value !== IMAGE_TO_3D_MODEL_TRELLIS2);
}

export function imageTo3dInstanceTypeForModel(modelId?: string | null): 'default' | 'plus' {
  return resolveImageTo3dModelId(modelId) === IMAGE_TO_3D_MODEL_TRELLIS2 ? 'plus' : 'default';
}

/** Trellis2 固定 Plus（48G）；Hy3D 用 default（24G） */
export function imageTo3dInstanceTypesToTryForModel(modelId?: string | null): ReadonlyArray<'default' | 'plus'> {
  return resolveImageTo3dModelId(modelId) === IMAGE_TO_3D_MODEL_TRELLIS2 ? ['plus'] : ['default'];
}

export function imageTo3dImageFieldDescriptionForModel(modelId?: string | null): string {
  return resolveImageTo3dModelId(modelId) === IMAGE_TO_3D_MODEL_TRELLIS2
    ? TRELLIS2_RH_IMAGE_FIELD_DESCRIPTION
    : 'image';
}

export function imageTo3dAppIdForModel(modelId?: string | null): string {
  return resolveImageTo3dModelId(modelId) === IMAGE_TO_3D_MODEL_TRELLIS2
    ? TRELLIS2_IMAGE_TO_3D_APP_ID
    : IMAGE_TO_3D_HY3D_APP_ID;
}

export function imageTo3dImageNodeIdForModel(modelId?: string | null): string {
  return resolveImageTo3dModelId(modelId) === IMAGE_TO_3D_MODEL_TRELLIS2
    ? TRELLIS2_RH_IMAGE_NODE_ID
    : HY3D_RH_IMAGE_NODE_ID;
}

/** Hy3D 典型耗时（秒）；Trellis2 网页/API 约 30s～数分钟 */
export const IMAGE_TO_3D_MIN_PLAUSIBLE_TASK_SEC = 120;
export const TRELLIS2_MIN_PLAUSIBLE_TASK_SEC = 20;
/** 低于此且连续多次 SUCCESS 仍无 results，才判定为「秒退」异常 */
export const IMAGE_TO_3D_FAST_FAIL_TASK_SEC = 12;

export function imageTo3dMinPlausibleTaskSecForModel(modelId?: string | null): number {
  return resolveImageTo3dModelId(modelId) === IMAGE_TO_3D_MODEL_TRELLIS2
    ? TRELLIS2_MIN_PLAUSIBLE_TASK_SEC
    : IMAGE_TO_3D_MIN_PLAUSIBLE_TASK_SEC;
}

export const IMAGE_TO_3D_MODEL_OPTIONS: ReadonlyArray<{
  value: ImageTo3dModelId;
  labelZh: string;
  labelEn: string;
  plus: boolean;
}> = [
  { value: IMAGE_TO_3D_MODEL_HY3D, labelZh: 'Hy3D', labelEn: 'Hy3D', plus: false },
  { value: IMAGE_TO_3D_MODEL_TRELLIS2, labelZh: 'Trellis2', labelEn: 'Trellis2', plus: true },
];
