import type { AppLocale } from './settingsI18n';

/** API value → display label */
const VOICE_LABELS: Record<string, { zh: string; en: string }> = {
  Wise_Woman: { zh: '智慧女性', en: 'Wise woman' },
  Friendly_Person: { zh: '友好的人', en: 'Friendly' },
  Inspirational_girl: { zh: '励志女孩', en: 'Inspirational girl' },
  Deep_Voice_Man: { zh: '深沉男声', en: 'Deep male' },
  Calm_Woman: { zh: '冷静女性', en: 'Calm woman' },
  Casual_Guy: { zh: '随性男孩', en: 'Casual guy' },
  Lively_Girl: { zh: '活泼女孩', en: 'Lively girl' },
  Patient_Man: { zh: '耐心男性', en: 'Patient man' },
  Young_Knight: { zh: '年轻骑士', en: 'Young knight' },
  Determined_Man: { zh: '坚定男性', en: 'Determined man' },
  Lovely_Girl: { zh: '可爱女孩', en: 'Lovely girl' },
  Decent_Boy: { zh: '体面男孩', en: 'Decent boy' },
  Imposing_Manner: { zh: '威严风格', en: 'Imposing' },
  Elegant_Man: { zh: '优雅男性', en: 'Elegant man' },
  Abbess: { zh: '女修道院长', en: 'Abbess' },
  Sweet_Girl_2: { zh: '甜美女孩', en: 'Sweet girl' },
  Exuberant_Girl: { zh: '热情女孩', en: 'Exuberant girl' },
};

const EMOTION_LABELS: Record<string, { zh: string; en: string }> = {
  happy: { zh: '开心', en: 'Happy' },
  sad: { zh: '悲伤', en: 'Sad' },
  angry: { zh: '愤怒', en: 'Angry' },
  fearful: { zh: '恐惧', en: 'Fearful' },
  disgusted: { zh: '厌恶', en: 'Disgusted' },
  surprised: { zh: '惊讶', en: 'Surprised' },
  neutral: { zh: '中性', en: 'Neutral' },
};

export function audioVoiceDisplayLabel(locale: AppLocale, value: string): string {
  const row = VOICE_LABELS[value];
  if (!row) return value;
  return locale === 'en' ? row.en : row.zh;
}

export function audioEmotionDisplayLabel(locale: AppLocale, value: string): string {
  const row = EMOTION_LABELS[value];
  if (!row) return value;
  return locale === 'en' ? row.en : row.zh;
}

export type AudioInputPanelStrings = {
  modelLabel: string;
  chooseModelTitle: string;
  chooseModelAria: string;
  voiceLabel: string;
  chooseVoiceTitle: string;
  chooseVoiceAria: string;
  emotionLabel: string;
  referenceAudioLabel: string;
  referenceAudioPlaceholder: string;
  referenceAudioTitle: string;
  referenceAudioAria: string;
  selectFileTitle: string;
  selectFileAria: string;
  selectFileButton: string;
  /** Index-TTS：麦克风录制参考音 */
  recordReferenceTitle: string;
  recordReferenceAria: string;
  recordReferenceButton: string;
  stopRecordingButton: string;
  micPermissionDenied: string;
  micSaveFailed: string;
  recordTooShort: string;
  /** 录音中波形弹窗 */
  recordModalTitle: string;
  recordModalSubtitle: string;
  recordModalStop: string;
  priceTitle: string;
  creditsSuffix: string;
  noPricingTitle: string;
  noPricingYet: string;
  generateAudioTitle: string;
  generating: string;
  generateAudio: string;
  songNameLabel: string;
  songNamePlaceholder: string;
  styleDescLabel: string;
  styleDescPlaceholder: string;
  lyricsLabel: string;
  lyricsPlaceholder: string;
  textContentLabel: string;
  textContentPlaceholder: string;
  textInputTitle: string;
  voiceTranscribing: string;
  speedLabel: (v: string) => string;
  speedAria: string;
  volumeLabel: (v: string) => string;
  volumeAria: string;
  pitchLabel: (v: string) => string;
  pitchAria: string;
  emotionNone: string;
};

const zh: AudioInputPanelStrings = {
  modelLabel: '模型:',
  chooseModelTitle: '选择音频模型',
  chooseModelAria: '选择音频模型',
  voiceLabel: '声音:',
  chooseVoiceTitle: '选择声音',
  chooseVoiceAria: '选择声音',
  emotionLabel: '情感:',
  referenceAudioLabel: '参考音:',
  referenceAudioPlaceholder: '粘贴 URL 或点击右侧选择本地文件',
  referenceAudioTitle: '参考音：粘贴公网 URL 或选择本地音频文件',
  referenceAudioAria: '参考音 URL 或本地路径',
  selectFileTitle: '选择本地参考音文件（MP3/WAV 等）',
  selectFileAria: '选择参考音文件',
  selectFileButton: '选择文件',
  recordReferenceTitle: '使用麦克风录制参考音（需授权），再次点击停止并保存',
  recordReferenceAria: '录制参考音',
  recordReferenceButton: '录音',
  stopRecordingButton: '停止',
  micPermissionDenied: '无法使用麦克风：请在系统设置中允许本应用访问麦克风，或检查是否被其他程序占用。',
  micSaveFailed: '录音保存失败，请重试或改用「选择文件」。',
  recordTooShort: '录音过短，请重新录制。',
  recordModalTitle: '正在录制参考音',
  recordModalSubtitle: '实时音量波形（点击停止或下方按钮结束并保存）',
  recordModalStop: '停止并保存',
  priceTitle: '单次生成预估消耗元宝（优先 nx_model_config 云端表）',
  creditsSuffix: '元宝',
  noPricingTitle: '该模型暂无定价表',
  noPricingYet: '暂未定价',
  generateAudioTitle: '生成音频',
  generating: '生成中',
  generateAudio: '生成音频',
  songNameLabel: '歌曲名',
  songNamePlaceholder: '例如：告白气球',
  styleDescLabel: '风格描述',
  styleDescPlaceholder: '例如：流行音乐，男声，90年代歌曲，慢速',
  lyricsLabel: '歌词',
  lyricsPlaceholder: '写入完整歌词...',
  textContentLabel: '文本内容',
  textContentPlaceholder: '输入要转换为语音的文本...',
  textInputTitle: '文本输入框',
  voiceTranscribing: '正在将语音转为文字…',
  speedLabel: (v) => `语速: ${v}`,
  speedAria: '语速',
  volumeLabel: (v) => `音量: ${v}`,
  volumeAria: '音量',
  pitchLabel: (v) => `音调: ${v}`,
  pitchAria: '音调',
  emotionNone: '无',
};

const en: AudioInputPanelStrings = {
  modelLabel: 'Model:',
  chooseModelTitle: 'Choose audio model',
  chooseModelAria: 'Choose audio model',
  voiceLabel: 'Voice:',
  chooseVoiceTitle: 'Choose voice',
  chooseVoiceAria: 'Choose voice',
  emotionLabel: 'Emotion:',
  referenceAudioLabel: 'Reference:',
  referenceAudioPlaceholder: 'Paste URL or pick a local file',
  referenceAudioTitle: 'Reference audio: URL or local file',
  referenceAudioAria: 'Reference audio',
  selectFileTitle: 'Choose local audio (MP3/WAV, etc.)',
  selectFileAria: 'Choose reference file',
  selectFileButton: 'Choose file',
  recordReferenceTitle: 'Record reference with microphone (permission required). Click again to stop and save.',
  recordReferenceAria: 'Record reference audio',
  recordReferenceButton: 'Record',
  stopRecordingButton: 'Stop',
  micPermissionDenied: 'Microphone unavailable. Allow this app in system settings, or check if another app is using the mic.',
  micSaveFailed: 'Could not save recording. Try again or use “Choose file”.',
  recordTooShort: 'Recording too short. Please try again.',
  recordModalTitle: 'Recording reference audio',
  recordModalSubtitle: 'Live waveform — click Stop or the button below to finish and save.',
  recordModalStop: 'Stop & save',
  priceTitle: 'Estimated credits per generation (nx_model_config)',
  creditsSuffix: 'credits',
  noPricingTitle: 'No pricing for this model',
  noPricingYet: 'Not priced',
  generateAudioTitle: 'Generate audio',
  generating: 'Generating…',
  generateAudio: 'Generate audio',
  songNameLabel: 'Song title',
  songNamePlaceholder: 'e.g. My song',
  styleDescLabel: 'Style',
  styleDescPlaceholder: 'e.g. Pop, male vocal, slow',
  lyricsLabel: 'Lyrics',
  lyricsPlaceholder: 'Full lyrics…',
  textContentLabel: 'Text',
  textContentPlaceholder: 'Text to convert to speech…',
  textInputTitle: 'Text input',
  voiceTranscribing: 'Converting speech to text…',
  speedLabel: (v) => `Speed: ${v}`,
  speedAria: 'Speech speed',
  volumeLabel: (v) => `Volume: ${v}`,
  volumeAria: 'Volume',
  pitchLabel: (v) => `Pitch: ${v}`,
  pitchAria: 'Pitch',
  emotionNone: 'None',
};

export function audioInputPanelT(locale: AppLocale): AudioInputPanelStrings {
  return locale === 'en' ? en : zh;
}
