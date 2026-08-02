import type { SourceMode } from './schema.js';
import {
  STORYBOARD_SCRIPT_IMAGE_SYSTEM_PROMPT,
  STORYBOARD_SCRIPT_IMAGE_USER_PROMPT_TEMPLATE,
  STORYBOARD_SCRIPT_MULTIMODAL_PROMPT_TEMPLATE,
  STORYBOARD_SCRIPT_TEXT_ONLY_SYSTEM_PROMPT,
  STORYBOARD_SCRIPT_TEXT_ONLY_USER_PROMPT_TEMPLATE,
  STORYBOARD_SCRIPT_VIDEO_SYSTEM_PROMPT,
  STORYBOARD_SCRIPT_VIDEO_USER_PROMPT_TEMPLATE,
} from './prompts.js';

const PLACEHOLDER_PATTERN =
  /\{\{?\s*([^|{}]+?)(?:\s*\|\|?\s*([^}]+))?\s*\}\}?/g;

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, rawKey: string, rawDefault?: string) => {
    const key = rawKey.trim();
    const value = String(vars[key] ?? '').trim();
    if (value) return value;
    return String(rawDefault ?? '').trim();
  });
}

export function resolveSourceMode({
  imageCount = 0,
  videoCount = 0,
}: {
  imageCount?: number;
  videoCount?: number;
}): SourceMode {
  const images = Math.max(0, Number(imageCount) || 0);
  const videos = Math.max(0, Number(videoCount) || 0);

  if (images === 0 && videos === 0) return 'text';
  if (images > 0 && videos === 0) return 'image';
  if (videos > 0 && images === 0) return 'video';
  return 'multimodal';
}

function buildImageReferenceText(imageLabels?: string[]): string {
  const labels = (imageLabels ?? []).map((item) => String(item || '').trim()).filter(Boolean);
  return labels.length > 0 ? labels.join('、') : '';
}

function buildVideoReferenceText(videoLabels?: string[]): string {
  const labels = (videoLabels ?? []).map((item) => String(item || '').trim()).filter(Boolean);
  return labels.length > 0 ? labels.join('、') : '';
}

export interface BuildStoryboardScriptMessagesInput {
  userText?: string;
  imageLabels?: string[];
  videoLabels?: string[];
  videoFrameSummary?: string;
  sourceMode?: SourceMode;
}

export interface BuildStoryboardScriptMessagesResult {
  sourceMode: SourceMode;
  systemPrompt: string;
  userPrompt: string;
}

export function buildStoryboardScriptMessages(
  input: BuildStoryboardScriptMessagesInput,
): BuildStoryboardScriptMessagesResult {
  const userText = String(input.userText ?? '').trim();
  const imageLabels = input.imageLabels ?? [];
  const videoLabels = input.videoLabels ?? [];
  const videoFrameSummary = String(input.videoFrameSummary ?? '').trim();
  const sourceMode =
    input.sourceMode ??
    resolveSourceMode({ imageCount: imageLabels.length, videoCount: videoLabels.length });

  switch (sourceMode) {
    case 'text':
      return {
        sourceMode,
        systemPrompt: STORYBOARD_SCRIPT_TEXT_ONLY_SYSTEM_PROMPT,
        userPrompt: fillTemplate(STORYBOARD_SCRIPT_TEXT_ONLY_USER_PROMPT_TEMPLATE, {
          用户输入: userText,
        }),
      };
    case 'image':
      return {
        sourceMode,
        systemPrompt: STORYBOARD_SCRIPT_IMAGE_SYSTEM_PROMPT,
        userPrompt: fillTemplate(STORYBOARD_SCRIPT_IMAGE_USER_PROMPT_TEMPLATE, {
          用户输入: userText,
          参考图片: buildImageReferenceText(imageLabels),
        }),
      };
    case 'video':
      return {
        sourceMode,
        systemPrompt: STORYBOARD_SCRIPT_VIDEO_SYSTEM_PROMPT,
        userPrompt: fillTemplate(STORYBOARD_SCRIPT_VIDEO_USER_PROMPT_TEMPLATE, {
          用户输入: userText,
          参考视频: buildVideoReferenceText(videoLabels),
          视频切片参考: videoFrameSummary,
        }),
      };
    case 'multimodal':
    default:
      return {
        sourceMode: 'multimodal',
        systemPrompt: '',
        userPrompt: fillTemplate(STORYBOARD_SCRIPT_MULTIMODAL_PROMPT_TEMPLATE, {
          用户输入: userText,
        }),
      };
  }
}
