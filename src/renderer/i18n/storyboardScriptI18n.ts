import type { AppLocale } from './settingsI18n';

export type StoryboardScriptStrings = {
  moduleTitle: string;
  mediaModeImage: string;
  mediaModeVideo: string;
  viewList: string;
  viewCard: string;
  emptyTitle: string;
  emptyHint: string;
  promptPlaceholder: string;
  send: string;
  modelLabel: string;
  generating: string;
  exportCsv: string;
  exportJson: string;
  spawnImages: string;
  selectRows: string;
  clearSelection: string;
  objectsCount: (n: number) => string;
  generateFailed: string;
  generateNeedInput: string;
  spawnNeedSelection: string;
  spawnDone: (n: number) => string;
};

const zh: StoryboardScriptStrings = {
  moduleTitle: '分镜脚本',
  mediaModeImage: '图像提示词',
  mediaModeVideo: '视频提示词',
  viewList: '列表视图',
  viewCard: '卡片视图',
  emptyTitle: '暂无分镜脚本数据',
  emptyHint: '选中节点后，在提示词栏输入剧情或文案即可生成',
  promptPlaceholder: '输入剧情、文案或分镜要求',
  send: '发送',
  modelLabel: '模型',
  generating: '生成中…',
  exportCsv: '导出 CSV',
  exportJson: '导出 JSON',
  spawnImages: '选中行生图',
  selectRows: '多选',
  clearSelection: '清除选择',
  objectsCount: (n) => `${n} 镜`,
  generateFailed: '分镜脚本生成失败',
  generateNeedInput: '请输入剧情文案，或连入图片/视频参考',
  spawnNeedSelection: '请先勾选要生成图片的分镜行',
  spawnDone: (n) => `已创建 ${n} 个图片节点`,
};

const en: StoryboardScriptStrings = {
  moduleTitle: 'Storyboard Script',
  mediaModeImage: 'Image prompts',
  mediaModeVideo: 'Video prompts',
  viewList: 'List',
  viewCard: 'Cards',
  emptyTitle: 'No storyboard yet',
  emptyHint: 'Select this node and enter a plot in the prompt bar to generate',
  promptPlaceholder: 'Enter plot, copy, or storyboard requirements',
  send: 'Send',
  modelLabel: 'Model',
  generating: 'Generating…',
  exportCsv: 'Export CSV',
  exportJson: 'Export JSON',
  spawnImages: 'Spawn images',
  selectRows: 'Multi-select',
  clearSelection: 'Clear selection',
  objectsCount: (n) => `${n} shots`,
  generateFailed: 'Storyboard generation failed',
  generateNeedInput: 'Enter a plot, or connect image/video references',
  spawnNeedSelection: 'Select storyboard rows to spawn images',
  spawnDone: (n) => `Created ${n} image node(s)`,
};

export function storyboardScriptT(locale: AppLocale): StoryboardScriptStrings {
  return locale === 'en' ? en : zh;
}
