import type { AppLocale } from './settingsI18n';

export type ImageComparerStrings = {
  label: string;
  slotA: string;
  slotB: string;
  emptyHint: string;
  connectA: string;
  connectB: string;
  connectAHint: string;
  connectBHint: string;
  dragHint: string;
  fullscreen: string;
  closeFullscreen: string;
  zoomHint: string;
  aspectMismatch: string;
};

const zh: ImageComparerStrings = {
  label: '图片对比',
  slotA: 'A',
  slotB: 'B',
  emptyHint: '将两张同比例图片分别连到左侧 A、B 接口',
  connectA: '接入图片 A',
  connectB: '接入图片 B',
  connectAHint: '连接图片 A',
  connectBHint: '连接图片 B',
  dragHint: '拖动分割线对比',
  fullscreen: '全屏对比',
  closeFullscreen: '退出全屏',
  zoomHint: '滚轮缩放',
  aspectMismatch: 'A/B 比例不一致，已按 A 适配（object-contain）',
};

const en: ImageComparerStrings = {
  label: 'Image Compare',
  slotA: 'A',
  slotB: 'B',
  emptyHint: 'Connect two same-ratio images to A and B on the left',
  connectA: 'Image A input',
  connectB: 'Image B input',
  connectAHint: 'Connect image A',
  connectBHint: 'Connect image B',
  dragHint: 'Drag the divider to compare',
  fullscreen: 'Fullscreen compare',
  closeFullscreen: 'Exit fullscreen',
  zoomHint: 'Scroll to zoom',
  aspectMismatch: 'A/B aspect differs — fitted to A (object-contain)',
};

export function imageComparerT(locale: AppLocale): ImageComparerStrings {
  return locale === 'en' ? en : zh;
}
