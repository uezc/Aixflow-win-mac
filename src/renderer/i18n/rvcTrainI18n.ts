import type { AppLocale } from './settingsI18n';

export type RvcTrainStrings = {
  moduleTitle: string;
  trainAudioLabel: string;
  trainAudioPreview: string;
  trainAudioPreviewEmpty: string;
  slotConnected: string;
  slotPending: string;
  modelNameLabel: string;
  modelNamePlaceholder: string;
  startTrain: string;
  training: string;
  trainedBadge: string;
  packageReady: string;
  packageHint: string;
  noModelName: string;
  noTrainAudio: string;
  avatarLabel: string;
  uploadAvatarLocal: string;
  pickAvatarFromCanvas: string;
  clearAvatar: string;
  avatarHint: string;
  nodeNicknamePlaceholder: string;
  creditsSuffix: string;
  priceTitle: string;
  noPricingYet: string;
};

const zh: RvcTrainStrings = {
  moduleTitle: 'RVC 音色训练',
  trainAudioLabel: '训练音频',
  trainAudioPreview: '试听训练音频',
  trainAudioPreviewEmpty: '暂无训练音频',
  slotConnected: '已接入',
  slotPending: '待连接',
  modelNameLabel: '模型名称',
  modelNamePlaceholder: '例如 my-voice-01',
  startTrain: '开始训练',
  training: '训练中…',
  trainedBadge: '已训练',
  packageReady: '模型包已就绪',
  packageHint: 'zip 模型包，请在左侧音色库管理',
  noModelName: '请填写模型名称',
  noTrainAudio: '请连接训练音频',
  avatarLabel: '音色头像',
  uploadAvatarLocal: '电脑上传',
  pickAvatarFromCanvas: '画布选择',
  clearAvatar: '清除头像',
  avatarHint: '可选，训练完成后写入音色库卡片',
  nodeNicknamePlaceholder: '输入昵称',
  creditsSuffix: '元宝',
  priceTitle: '本次训练消耗',
  noPricingYet: '暂无定价',
};

const en: RvcTrainStrings = {
  moduleTitle: 'RVC Voice Train',
  trainAudioLabel: 'Training audio',
  trainAudioPreview: 'Preview training audio',
  trainAudioPreviewEmpty: 'No training audio',
  slotConnected: 'Connected',
  slotPending: 'Connect audio',
  modelNameLabel: 'Model name',
  modelNamePlaceholder: 'e.g. my-voice-01',
  startTrain: 'Start training',
  training: 'Training…',
  trainedBadge: 'Trained',
  packageReady: 'Model package ready',
  packageHint: 'Zip package — manage in voice library',
  noModelName: 'Enter a model name',
  noTrainAudio: 'Connect training audio',
  avatarLabel: 'Voice avatar',
  uploadAvatarLocal: 'Upload from computer',
  pickAvatarFromCanvas: 'Pick from canvas',
  clearAvatar: 'Clear avatar',
  avatarHint: 'Optional — saved to voice library card after training',
  nodeNicknamePlaceholder: 'Enter nickname',
  creditsSuffix: 'credits',
  priceTitle: 'Training cost',
  noPricingYet: 'No pricing',
};

export function rvcTrainT(locale: AppLocale): RvcTrainStrings {
  return locale === 'en' ? en : zh;
}
