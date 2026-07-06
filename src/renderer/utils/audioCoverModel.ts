/** RVC 翻唱：RVC 模型 + 原曲（RunningHub ai-app/2073040724471406593，PLUS 实例） */
import {
  deriveRvcCoverModelPath,
  normalizeExplicitRvcCoverModelPath,
} from '../../shared/rvcVoiceCoverUtils';

export {
  deriveRvcCoverModelPath,
  isRvcCoverPathHintOnly,
  normalizeExplicitRvcCoverModelPath,
  buildRhRvcCoverModelNodeField,
  normalizeRvcCoverOutputMode,
  clampCoverPitch,
  clampCoverIndexRate,
  clampCoverVocalMixPct,
  clampCoverAccompanimentMixPct,
  resolveCoverAccompanimentMixPct,
} from '../../shared/rvcVoiceCoverUtils';

export type { RvcCoverOutputMode } from '../../shared/rvcVoiceCoverUtils';

export { isRhRvcPresetModelPath, RH_RVC_PRESET_MODEL_PATHS, RH_RVC_COVER_CUSTOM_MODEL_BLOCKED_MSG } from '../../shared/rhRvcPresetModels';

export const AI_VOICE_COVER_MODEL_ID = 'ai-voice-cover';

export const RH_RVC_VOICE_COVER_APP_ID = '2073040724471406593';

/** RH Load RVC Model 节点 */
export const RH_RVC_COVER_MODEL_NODE_ID = '1';
/** RH Load Audio 节点 */
export const RH_RVC_COVER_AUDIO_NODE_ID = '2';

export function isAudioCoverModel(model: string | undefined | null): boolean {
  return String(model ?? '').trim() === AI_VOICE_COVER_MODEL_ID;
}

export function resolveRvcCoverModelPath(data?: {
  rvcCoverModelName?: string;
  rvcTrainModelName?: string;
  title?: string;
} | null): string {
  const explicit = normalizeExplicitRvcCoverModelPath(data?.rvcCoverModelName || '');
  if (explicit) return explicit;
  const model = (data?.rvcTrainModelName || '').trim();
  if (model) return deriveRvcCoverModelPath(model);
  return '';
}

/** 节点 data 上是否已有 RVC 模型（来自 rvcTrain 连线 / 训练昵称 / 音色库） */
export function hasRvcCoverModelOnNodeData(existingData?: Record<string, unknown>): boolean {
  const d = existingData || {};
  if (String(d.libraryRvcVoiceId ?? '').trim()) return true;
  if (String(d.rvcTrainModelName ?? '').trim()) return true;
  if (String(d.outputModelUrl ?? '').trim() && String(d.rvcTrainModelName ?? '').trim()) return true;
  return !!resolveRvcCoverModelPath(
    d as { rvcCoverModelName?: string; rvcTrainModelName?: string; title?: string },
  );
}
