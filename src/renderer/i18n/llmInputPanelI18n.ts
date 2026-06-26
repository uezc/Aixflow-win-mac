import type { AppLocale } from './settingsI18n';

export type LlmInputPanelStrings = {
  saveButton: string;
  selectPersona: string;
  selectPersonaTitle: string;
  deletePersonaTitle: string;
  videoAnalysisBadge: string;
  reverseModelLabel: string;
  chooseReverseModelTitle: string;
  gpt4oOptionLabel: string;
  reversePriceTooltip: string;
  runPriceTooltip: string;
  noPricingReverseModelTitle: string;
  noPricingYet: string;
  creditsSuffix: string;
  run: string;
  runImageReverse: string;
  runVideoAnalysis: string;
  confirmDeleteTitle: string;
  confirmDeleteBody: (name: string) => string;
  cancel: string;
  confirmDelete: string;
  savePersonaLabel: string;
  savePersonaPlaceholder: string;
  ok: string;
  systemPersonaLabel: string;
  systemPersonaInputTitle: string;
  voiceTranscribing: string;
  placeholderSystemPersona: string;
  placeholderImageReverse: string;
  placeholderVideoAnalysis: string;
  userInputLabel: string;
  userInputPlaceholder: string;
  userInputLockedPlaceholder: string;
  quickTagScriptRewrite: string;
  quickTagCharacterReplace: string;
  quickTagCharacterAnalysis: string;
  /** 用户输入旁徽章（反推模式下该区域通常隐藏，保留以备用） */
  imageSourceBadge: string;
};

const zh: LlmInputPanelStrings = {
  saveButton: '保存',
  selectPersona: '选择人设',
  selectPersonaTitle: '选择人设',
  deletePersonaTitle: '删除人设',
  videoAnalysisBadge: '视频分析',
  reverseModelLabel: '反推模型:',
  chooseReverseModelTitle: '选择图像反推模型',
  gpt4oOptionLabel: 'GPT 4o (可改人设提示词)',
  reversePriceTooltip:
    '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity（优先 nx_model_config）',
  runPriceTooltip:
    '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity（单次运行，优先 nx_model_config）',
  noPricingReverseModelTitle: '该反推模型暂无定价表',
  noPricingYet: '暂未定价',
  creditsSuffix: '元宝',
  run: '运行',
  runImageReverse: '图像反推',
  runVideoAnalysis: '视频分析',
  confirmDeleteTitle: '确认删除',
  confirmDeleteBody: (name) => `确定要删除人设 "${name}" 吗？此操作无法撤销。`,
  cancel: '取消',
  confirmDelete: '确认删除',
  savePersonaLabel: '输入人设名称',
  savePersonaPlaceholder: '输入人设名称...',
  ok: '确定',
  systemPersonaLabel: '系统人设提示词',
  systemPersonaInputTitle: '系统人设提示词输入',
  voiceTranscribing: '正在将语音转为文字…',
  placeholderSystemPersona: '在这里输入系统人设提示词……',
  placeholderImageReverse: '这张图片有什么？',
  placeholderVideoAnalysis: '这个视频有什么内容？',
  userInputLabel: '用户输入',
  userInputPlaceholder: '输入用户提示词...',
  userInputLockedPlaceholder: '来自文本模块的提示词（已锁定）',
  quickTagScriptRewrite: '剧本改写',
  quickTagCharacterReplace: '角色替换',
  quickTagCharacterAnalysis: '人物分析',
  imageSourceBadge: '【图片】',
};

const en: LlmInputPanelStrings = {
  saveButton: 'Save',
  selectPersona: 'Select persona',
  selectPersonaTitle: 'Select persona',
  deletePersonaTitle: 'Delete persona',
  videoAnalysisBadge: 'Video analysis',
  reverseModelLabel: 'Caption model:',
  chooseReverseModelTitle: 'Choose image caption model',
  gpt4oOptionLabel: 'GPT-4o (supports system persona)',
  reversePriceTooltip:
    'Estimated credits = base_price × multiplier × yuanbao_rate × Quantity (nx_model_config preferred)',
  runPriceTooltip:
    'Estimated credits = base_price × multiplier × yuanbao_rate × Quantity (per run, nx_model_config preferred)',
  noPricingReverseModelTitle: 'No pricing table for this caption model',
  noPricingYet: 'Not priced',
  creditsSuffix: 'credits',
  run: 'Run',
  runImageReverse: 'Image caption',
  runVideoAnalysis: 'Video analysis',
  confirmDeleteTitle: 'Delete persona',
  confirmDeleteBody: (name) =>
    `Delete persona "${name}"? This cannot be undone.`,
  cancel: 'Cancel',
  confirmDelete: 'Delete',
  savePersonaLabel: 'Persona name',
  savePersonaPlaceholder: 'Enter persona name…',
  ok: 'OK',
  systemPersonaLabel: 'System persona prompt',
  systemPersonaInputTitle: 'System persona prompt',
  voiceTranscribing: 'Converting speech to text…',
  placeholderSystemPersona: 'Enter system persona prompt…',
  placeholderImageReverse: 'Describe this image…',
  placeholderVideoAnalysis: 'Describe this video…',
  userInputLabel: 'User input',
  userInputPlaceholder: 'Enter user prompt…',
  userInputLockedPlaceholder: 'Prompt from text node (locked)',
  quickTagScriptRewrite: 'Script rewrite',
  quickTagCharacterReplace: 'Character replace',
  quickTagCharacterAnalysis: 'Character analysis',
  imageSourceBadge: '[Image]',
};

export function llmInputPanelT(locale: AppLocale): LlmInputPanelStrings {
  return locale === 'en' ? en : zh;
}
