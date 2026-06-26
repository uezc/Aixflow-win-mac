import type { AppLocale } from './settingsI18n';

export type AudioNodeChromeStrings = {
  connectedLine1: string;
  connectLine1: string;
  connectedLine2: string;
  connectLine2: string;
  trimButtonTitle: string;
  trimButton: string;
  trimModalTitle: string;
  trimModalHint: string;
  trimRangeLabel: (a: string, b: string) => string;
  cancel: string;
  confirm: string;
  trimming: string;
};

const zh: AudioNodeChromeStrings = {
  connectedLine1: '已连接文本',
  connectLine1: '请连接文本节点',
  connectedLine2: '点击节点配置参数并生成',
  connectLine2: '或点击节点输入文本',
  trimButtonTitle: '裁剪音频片段',
  trimButton: '裁剪',
  trimModalTitle: '音频裁剪',
  trimModalHint: '拖拽进度条上的前后指针选择裁剪区间，点击轨道可跳转播放位置',
  trimRangeLabel: (a, b) => `裁剪: ${a} - ${b}`,
  cancel: '取消',
  confirm: '确认',
  trimming: '裁剪中...',
};

const en: AudioNodeChromeStrings = {
  connectedLine1: 'Text connected',
  connectLine1: 'Connect a text node',
  connectedLine2: 'Open the node to configure and generate',
  connectLine2: 'Or click the node to type text',
  trimButtonTitle: 'Trim audio',
  trimButton: 'Trim',
  trimModalTitle: 'Trim audio',
  trimModalHint: 'Drag the handles to set range; click the track to seek',
  trimRangeLabel: (a, b) => `Trim: ${a} – ${b}`,
  cancel: 'Cancel',
  confirm: 'Apply',
  trimming: 'Trimming…',
};

export function audioNodeChromeT(locale: AppLocale): AudioNodeChromeStrings {
  return locale === 'en' ? en : zh;
}
