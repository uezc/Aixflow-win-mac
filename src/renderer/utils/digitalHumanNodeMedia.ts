/** 数字人源模块：双输出把手与媒体 URL 解析 */

export const DIGITAL_HUMAN_OUTPUT_VIDEO_HANDLE = 'output-video';
export const DIGITAL_HUMAN_OUTPUT_AUDIO_HANDLE = 'output-audio';

export function isDigitalHumanVideoOutputHandle(handleId?: string | null): boolean {
  const sh = (handleId || '').trim();
  return !sh || sh === DIGITAL_HUMAN_OUTPUT_VIDEO_HANDLE || sh === 'output';
}

export function isDigitalHumanAudioOutputHandle(handleId?: string | null): boolean {
  const sh = (handleId || '').trim();
  return sh === DIGITAL_HUMAN_OUTPUT_AUDIO_HANDLE || sh === 'output-audio';
}

export function pickDigitalHumanVideoUrl(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const str = (k: string) => (typeof data[k] === 'string' ? (data[k] as string).trim() : '');
  return str('outputVideo') || str('referenceVideoUrl') || str('originalVideoUrl');
}

export function pickDigitalHumanAudioUrl(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const str = (k: string) => (typeof data[k] === 'string' ? (data[k] as string).trim() : '');
  return str('referenceAudioUrl') || str('originalAudioUrl') || str('outputAudio');
}

export function isDigitalHumanConnectionDataValid(
  targetNodeType: string,
  sourceHandleId: string | null | undefined,
  data: Record<string, unknown> | undefined,
): boolean {
  const tgt = targetNodeType;
  if (isDigitalHumanAudioOutputHandle(sourceHandleId)) {
    if (!pickDigitalHumanAudioUrl(data)) return false;
    return tgt === 'audio' || tgt === 'heyGem' || tgt === 'videoSplice' || tgt === 'audioTranscribe';
  }
  if (isDigitalHumanVideoOutputHandle(sourceHandleId)) {
    if (!pickDigitalHumanVideoUrl(data)) return false;
    return (
      tgt === 'video' ||
      tgt === 'wanAnimate' ||
      tgt === 'heyGem' ||
      tgt === 'videoSplice' ||
      tgt === 'minimalistText' ||
      tgt === 'text' ||
      tgt === 'image' ||
      tgt === 'audio'
    );
  }
  return false;
}
