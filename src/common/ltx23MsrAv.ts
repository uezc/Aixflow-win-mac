/** LTX2.3-MSR 图像+声音（RunningHub AI App，PLUS 48G） */

export const LTX23_MSR_AV_MODEL_ID = 'ltx-2.3-msr-av' as const;

export const LTX23_MSR_AV_APP_ID = '2079203588018102273';

export const LTX23_MSR_AV_LABEL = 'LTX2.3-MSR 图像+声音';

/** 分镜图 → RH 工作流节点（最多 4 张） */
export const LTX23_MSR_AV_STORYBOARD_NODES = [
  { nodeId: '68', description: 'image1' },
  { nodeId: '70', description: 'image2' },
  { nodeId: '126', description: 'image3' },
  { nodeId: '127', description: 'image4' },
] as const;

export const LTX23_MSR_AV_SCENE_NODE = { nodeId: '23', description: 'image场景' } as const;
export const LTX23_MSR_AV_AUDIO_NODE = { nodeId: '78', description: 'audio' } as const;
export const LTX23_MSR_AV_PROMPT_NODE = { nodeId: '36', description: 'Prompt' } as const;

/** 宽 / 高 / 时长 / 帧率（RH 工作流 Int 节点） */
export const LTX23_MSR_AV_WIDTH_NODE = { nodeId: '33', description: '宽' } as const;
export const LTX23_MSR_AV_HEIGHT_NODE = { nodeId: '34', description: '高' } as const;
export const LTX23_MSR_AV_DURATION_NODE = { nodeId: '25', description: '时长' } as const;
export const LTX23_MSR_AV_FPS_NODE = { nodeId: '50', description: '帧率' } as const;

/** 与 RH 示例一致：默认帧率 16 */
export const LTX23_MSR_AV_DEFAULT_FPS = 16;

/**
 * 宽高换算。RH 示例为 1280×704（16:9）；短边用 704（可被 32 整除）。
 * UI 分辨率档位 720/1280 均映射到长边 1280（与纯图 MSR 一致）。
 */
export function ltx23MsrAvDimensions(
  aspectRatio: '16:9' | '9:16' | string | undefined,
  _resolution?: '720' | '1280' | '1920' | string | undefined,
): { width: number; height: number } {
  const ratio = aspectRatio === '9:16' ? '9:16' : '16:9';
  return ratio === '16:9' ? { width: 1280, height: 704 } : { width: 704, height: 1280 };
}

export function isLtx23MsrAvModel(model: string | undefined | null): boolean {
  return String(model ?? '').trim() === LTX23_MSR_AV_MODEL_ID;
}
