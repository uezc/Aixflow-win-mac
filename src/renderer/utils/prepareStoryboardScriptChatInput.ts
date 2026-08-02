import {
  buildImageLabels,
  buildStoryboardScriptMessages,
  buildStoryboardVideoFrameReferenceSummary,
  buildVideoLabels,
  resolveSourceMode,
  type SourceMode,
  type StoryboardVideoFrameRef,
} from '../../shared/storyboardScript';

export type StoryboardPreparedChatInput = {
  sourceMode: SourceMode;
  systemPrompt: string;
  userPrompt: string;
  chatImageUrls: string[];
  imageLabels: string[];
  videoLabels: string[];
  videoFrameSummary: string;
  warnings: string[];
};

/**
 * 优先走主进程 prepareStoryboardScript；preload 未重建时回退到渲染进程组装（仍可调用现有模型）。
 */
export async function prepareStoryboardScriptChatInput(opts: {
  promptText: string;
  imageUrls?: string[];
  videoUrls?: string[];
  projectId?: string;
  maxKeyframesPerVideo?: number;
}): Promise<StoryboardPreparedChatInput> {
  const api = window.electronAPI?.prepareStoryboardScript;
  if (typeof api === 'function') {
    return api(opts);
  }

  const promptText = String(opts.promptText || '').trim();
  const imageUrls = (opts.imageUrls || []).map((u) => String(u || '').trim()).filter(Boolean);
  const videoUrls = (opts.videoUrls || []).map((u) => String(u || '').trim()).filter(Boolean);
  const maxKf = Math.max(1, Math.min(12, Math.floor(Number(opts.maxKeyframesPerVideo) || 6)));
  const warnings: string[] = ['PREPARE_FALLBACK_RENDERER'];

  const chatImageUrls: string[] = [...imageUrls];
  const frameRefs: StoryboardVideoFrameRef[] = [];

  const extract = window.electronAPI?.smartExtractVideoClips;
  if (videoUrls.length > 0 && typeof extract === 'function') {
    for (let vi = 0; vi < videoUrls.length; vi++) {
      const videoUrl = videoUrls[vi]!;
      const videoLabel = `@视频${vi + 1}`;
      try {
        const res = await extract(opts.projectId, videoUrl, {
          mode: 'balanced',
          maxClips: maxKf,
          output: 'keyframes',
        });
        const kfs = res.keyframes || [];
        for (let ki = 0; ki < kfs.length; ki++) {
          const kf = kfs[ki]!;
          const imgUrl = String(kf.imageUrl || '').trim();
          if (!imgUrl) continue;
          chatImageUrls.push(imgUrl);
          const t0 = Number(kf.timeSec) || 0;
          const t1 = ki + 1 < kfs.length ? Number(kfs[ki + 1]!.timeSec) || t0 + 1 : t0 + 1;
          frameRefs.push({
            imageLabel: `@图片${chatImageUrls.length}`,
            videoLabel,
            startSec: t0,
            endSec: Math.max(t0 + 0.3, t1),
          });
        }
      } catch (e) {
        warnings.push(
          `VIDEO_FRAME_FAILED:${videoLabel}:${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  } else if (videoUrls.length > 0) {
    warnings.push('VIDEO_FRAME_SKIPPED_NO_EXTRACT_API');
  }

  const imageLabels = buildImageLabels(chatImageUrls.length);
  const videoLabels = buildVideoLabels(videoUrls.length);
  const videoFrameSummary = buildStoryboardVideoFrameReferenceSummary(frameRefs);

  let sourceMode = resolveSourceMode({
    imageCount: imageUrls.length + frameRefs.length,
    videoCount: videoUrls.length,
  });
  if (imageUrls.length > 0 && videoUrls.length > 0) sourceMode = 'multimodal';
  else if (videoUrls.length > 0 && frameRefs.length > 0) sourceMode = 'video';
  else if (imageUrls.length > 0 || frameRefs.length > 0) sourceMode = 'image';
  else sourceMode = 'text';

  const { systemPrompt, userPrompt } = buildStoryboardScriptMessages({
    userText: promptText,
    imageLabels: imageLabels.length ? imageLabels : buildImageLabels(1),
    videoLabels,
    videoFrameSummary,
    sourceMode,
  });

  return {
    sourceMode,
    systemPrompt,
    userPrompt,
    chatImageUrls,
    imageLabels,
    videoLabels,
    videoFrameSummary,
    warnings,
  };
}
