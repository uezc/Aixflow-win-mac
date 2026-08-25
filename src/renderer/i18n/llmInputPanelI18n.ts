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
  /** 人设区麦克风：按住说话 */
  voiceStartTitle: string;
  /** 人设区麦克风：松开结束 */
  voiceStopTitle: string;
  placeholderSystemPersona: string;
  placeholderImageReverse: string;
  placeholderVideoAnalysis: string;
  userInputLabel: string;
  userInputPlaceholder: string;
  userInputLockedPlaceholder: string;
  quickTagScriptRewrite: string;
  quickTagCharacterReplace: string;
  quickTagCharacterAnalysis: string;
  quickTagSceneAnalysis: string;
  quickTagStoryboard: string;
  /** 用户输入旁徽章（反推模式下该区域通常隐藏，保留以备用） */
  imageSourceBadge: string;
  /** 普通对话：模型下拉标签 */
  chatModelLabel: string;
  /** 普通对话：发送按钮 */
  send: string;
  /** 运行中：点此取消生成 */
  cancelGenerating: string;
  /** 展开人设区 */
  expandPersona: string;
  /** 收起人设区 */
  collapsePersona: string;
  /** 聊天模型选项展示名 */
  chatModelGpt35: string;
  chatModelGpt4o: string;
  chatModelGpt56Terra: string;
};

const zh: LlmInputPanelStrings = {
  saveButton: '保存',
  selectPersona: '选择人设',
  selectPersonaTitle: '选择人设',
  deletePersonaTitle: '删除人设',
  videoAnalysisBadge: '视频分析',
  reverseModelLabel: '反推模型:',
  chooseReverseModelTitle: '选择图像反推模型',
  gpt4oOptionLabel: '大语言模型-5.6',
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
  voiceTranscribing: '正在实时听写…',
  voiceStartTitle: '按住说话',
  voiceStopTitle: '松开结束',
  placeholderSystemPersona: '在这里输入系统人设提示词……',
  placeholderImageReverse: '这张图片有什么？',
  placeholderVideoAnalysis: '这个视频有什么内容？',
  userInputLabel: '用户输入',
  userInputPlaceholder: '输入提示词开始创作 (Enter 生成, Shift+Enter 换行)',
  userInputLockedPlaceholder: '来自文本模块的提示词（已锁定）',
  quickTagScriptRewrite: '剧本改写',
  quickTagCharacterReplace: '角色替换',
  quickTagCharacterAnalysis: '人物分析',
  quickTagSceneAnalysis: '场景分析',
  quickTagStoryboard: '分镜脚本',
  imageSourceBadge: '【图片】',
  chatModelLabel: '模型',
  send: '发送',
  cancelGenerating: '取消生成',
  expandPersona: '人设',
  collapsePersona: '收起人设',
  chatModelGpt35: '大语言模型-3.5',
  chatModelGpt4o: '大语言模型-4o',
  chatModelGpt56Terra: '大语言模型-5.6',
};

const en: LlmInputPanelStrings = {
  saveButton: 'Save',
  selectPersona: 'Select persona',
  selectPersonaTitle: 'Select persona',
  deletePersonaTitle: 'Delete persona',
  videoAnalysisBadge: 'Video analysis',
  reverseModelLabel: 'Caption model:',
  chooseReverseModelTitle: 'Choose image caption model',
  gpt4oOptionLabel: 'LLM-5.6',
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
  voiceTranscribing: 'Live dictation…',
  voiceStartTitle: 'Hold to talk',
  voiceStopTitle: 'Release to finish',
  placeholderSystemPersona: 'Enter system persona prompt…',
  placeholderImageReverse: 'Describe this image…',
  placeholderVideoAnalysis: 'Describe this video…',
  userInputLabel: 'User input',
  userInputPlaceholder: 'Enter a prompt to start (Enter to generate, Shift+Enter for newline)',
  userInputLockedPlaceholder: 'Prompt from text node (locked)',
  quickTagScriptRewrite: 'Script rewrite',
  quickTagCharacterReplace: 'Character replace',
  quickTagCharacterAnalysis: 'Character analysis',
  quickTagSceneAnalysis: 'Scene analysis',
  quickTagStoryboard: 'Storyboard Script',
  imageSourceBadge: '[Image]',
  chatModelLabel: 'Model',
  send: 'Send',
  cancelGenerating: 'Cancel generation',
  expandPersona: 'Persona',
  collapsePersona: 'Hide persona',
  chatModelGpt35: 'GPT-3.5',
  chatModelGpt4o: 'GPT-4o',
  chatModelGpt56Terra: 'LLM-5.6',
};

export function llmInputPanelT(locale: AppLocale): LlmInputPanelStrings {
  return locale === 'en' ? en : zh;
}
