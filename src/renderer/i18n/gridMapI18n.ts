import type { AppLocale } from './settingsI18n';

export type GridMapStrings = {
  nodeLabel: string;
  ratioLabel: string;
  gridLabel: string;
  gridOption: (cols: number, rows: number) => string;
  /** 空格主操作：从画布点选图片模块 */
  pickFromCanvas: string;
  synthesize: string;
  synthesizeTitle: string;
  clearCell: string;
  clearAll: string;
  exportLabel: string;
  needImages: string;
  synthesizeFailed: string;
  pickImage: string;
  /** ratioLabel 如 9:16 / 3:4，与当前格子可视比例一致 */
  cropHint: (ratioLabel: string) => string;
  cropCancel: string;
  cropConfirm: string;
  cropConfirming: string;
  cropFailed: string;
};

const zh: GridMapStrings = {
  nodeLabel: '宫格图',
  ratioLabel: '比例',
  gridLabel: '网格',
  gridOption: (cols, rows) => `${cols}x${rows}`,
  pickFromCanvas: '画布中选择',
  synthesize: '合成图片',
  synthesizeTitle: '将宫格中的图片合并成一张，并放到右侧',
  clearCell: '清空选中格',
  clearAll: '清空全部格子',
  exportLabel: '宫格合成',
  needImages: '请先向格子中放入至少一张图片',
  synthesizeFailed: '宫格合成失败',
  pickImage: '选择图片',
  cropHint: (ratioLabel) => `拖动调整 ${ratioLabel} 取景，点 ✓ 确认`,
  cropCancel: '取消',
  cropConfirm: '确认',
  cropConfirming: '处理中…',
  cropFailed: '裁剪失败，请重试',
};

const en: GridMapStrings = {
  nodeLabel: 'Grid map',
  ratioLabel: 'Ratio',
  gridLabel: 'Grid',
  gridOption: (cols, rows) => `${cols}x${rows}`,
  pickFromCanvas: 'Select from canvas',
  synthesize: 'Merge',
  synthesizeTitle: 'Merge grid images into one and place it on the right',
  clearCell: 'Clear selected cell',
  clearAll: 'Clear all cells',
  exportLabel: 'Grid compose',
  needImages: 'Add at least one image to the grid first',
  synthesizeFailed: 'Failed to compose grid',
  pickImage: 'Choose image',
  cropHint: (ratioLabel) => `Drag to frame ${ratioLabel}, then tap ✓`,
  cropCancel: 'Cancel',
  cropConfirm: 'Confirm',
  cropConfirming: 'Working…',
  cropFailed: 'Crop failed, please retry',
};

export function gridMapT(locale: AppLocale): GridMapStrings {
  return locale === 'en' ? en : zh;
}
