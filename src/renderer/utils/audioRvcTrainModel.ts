/** RVC 音色模型训练（RunningHub ai-app/2072990640429953025，PLUS 48G 实例） */
export const RVC_VOICE_TRAIN_MODEL_ID = 'rvc-voice-train';

export const RH_RVC_VOICE_TRAIN_APP_ID = '2072990640429953025';

/** Load Audio 节点 */
export const RH_RVC_TRAIN_AUDIO_NODE_ID = '5';
/** 模型名称 String 节点 */
export const RH_RVC_TRAIN_NAME_NODE_ID = '6';

export function isRvcTrainModel(model: string | undefined | null): boolean {
  return String(model ?? '').trim() === RVC_VOICE_TRAIN_MODEL_ID;
}
