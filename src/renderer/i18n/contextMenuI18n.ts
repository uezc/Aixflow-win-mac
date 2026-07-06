import type { AppLocale } from './settingsI18n';

export type ContextMenuStrings = {
  text: string;
  llm: string;
  textSplit: string;
  image: string;
  canvasTool: string;
  video: string;
  wanAnimate: string;
  heyGem: string;
  videoSplice: string;
  photoCollage: string;
  imageTo3d: string;
  character: string;
  audio: string;
  rvcTrain: string;
  audioTranscribe: string;
  imageFirstFrame: string;
  imageCurrentFrame: string;
  imageLastFrame: string;
  audioFromVideo: string;
  extractVocals: string;
  extractBackground: string;
  aiVoiceCover: string;
};

const zh: ContextMenuStrings = {
  text: '文本',
  llm: '大语言模型',
  textSplit: '文本拆分',
  image: '图片',
  canvasTool: '画板工具',
  video: '视频',
  wanAnimate: '视频换人',
  heyGem: 'HeyGem 数字人',
  videoSplice: '视频剪辑',
  photoCollage: '拼图',
  imageTo3d: '图片转 3D',
  character: '角色',
  audio: '声音',
  rvcTrain: 'RVC 音色训练',
  audioTranscribe: '语音转文字',
  imageFirstFrame: '图片（第一帧）',
  imageCurrentFrame: '图片(当前帧)',
  imageLastFrame: '图片（最后一帧）',
  audioFromVideo: '声音（从视频提取）',
  extractVocals: '提取人声',
  extractBackground: '提取背景音',
  aiVoiceCover: 'RVC 翻唱',
};

const en: ContextMenuStrings = {
  text: 'Text',
  llm: 'LLM',
  textSplit: 'Text split',
  image: 'Image',
  canvasTool: 'Canvas tools',
  video: 'Video',
  wanAnimate: 'WanAnimate',
  heyGem: 'HeyGem',
  videoSplice: 'Video edit',
  photoCollage: 'Photo collage',
  imageTo3d: 'Image to 3D',
  character: 'Character',
  audio: 'Audio',
  rvcTrain: 'RVC voice train',
  audioTranscribe: 'Speech to text',
  imageFirstFrame: 'Image (first frame)',
  imageCurrentFrame: 'Image (current frame)',
  imageLastFrame: 'Image (last frame)',
  audioFromVideo: 'Audio (from video)',
  extractVocals: 'Extract vocals',
  extractBackground: 'Extract music bed',
  aiVoiceCover: 'AI cover',
};

export function contextMenuT(locale: AppLocale): ContextMenuStrings {
  return locale === 'en' ? en : zh;
}

export function contextMenuLabelForType(locale: AppLocale, type: string): string {
  const t = contextMenuT(locale);
  const map: Record<string, keyof ContextMenuStrings> = {
    text: 'text',
    llm: 'llm',
    textSplit: 'textSplit',
    image: 'image',
    'canvas-tool': 'canvasTool',
    video: 'video',
    wanAnimate: 'wanAnimate',
    heyGem: 'heyGem',
    videoSplice: 'videoSplice',
    photoCollage: 'photoCollage',
    imageTo3d: 'imageTo3d',
    character: 'character',
    audio: 'audio',
    rvcTrain: 'rvcTrain',
    audioTranscribe: 'audioTranscribe',
    'image-first-frame': 'imageFirstFrame',
    'image-current-frame': 'imageCurrentFrame',
    'image-last-frame': 'imageLastFrame',
    'audio-extract-from-video': 'audioFromVideo',
    'audio-extract-vocals': 'extractVocals',
    'audio-extract-background': 'extractBackground',
    'audio-voice-cover': 'aiVoiceCover',
  };
  const key = map[type];
  return key ? t[key] : type;
}
