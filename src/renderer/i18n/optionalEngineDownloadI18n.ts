import type { AppLocale } from './settingsI18n';

export type OptionalEngineDownloadStrings = {
  whisperTitle: string;
  rvcTitle: string;
  whisperMessage: (sizeHint: string) => string;
  rvcMessage: (sizeHint: string) => string;
  confirmDownload: string;
  cancel: string;
};

const zh: OptionalEngineDownloadStrings = {
  whisperTitle: '下载语音转写引擎',
  rvcTitle: '下载 RVC 引擎',
  whisperMessage: (sizeHint) =>
    `首次使用语音转文字需要联网下载本地引擎${sizeHint ? `（${sizeHint}）` : ''}。下载期间可在画布顶部查看进度，画布仍可正常操作。\n\n是否现在开始下载？`,
  rvcMessage: (sizeHint) =>
    `首次使用 RVC 翻唱需要联网下载本地引擎${sizeHint ? `（${sizeHint}）` : ''}。下载期间可在画布顶部查看进度，画布仍可正常操作。\n\n是否现在开始下载？`,
  confirmDownload: '开始下载',
  cancel: '取消',
};

const en: OptionalEngineDownloadStrings = {
  whisperTitle: 'Download speech-to-text engine',
  rvcTitle: 'Download RVC engine',
  whisperMessage: (sizeHint) =>
    `Speech-to-text requires a one-time online download${sizeHint ? ` (${sizeHint})` : ''}. Progress appears at the top of the canvas; you can keep working while it downloads.\n\nDownload now?`,
  rvcMessage: (sizeHint) =>
    `RVC voice cover requires a one-time online download${sizeHint ? ` (${sizeHint})` : ''}. Progress appears at the top of the canvas; you can keep working while it downloads.\n\nDownload now?`,
  confirmDownload: 'Download',
  cancel: 'Cancel',
};

export function optionalEngineDownloadT(locale: AppLocale | string): OptionalEngineDownloadStrings {
  return locale === 'en' ? en : zh;
}
