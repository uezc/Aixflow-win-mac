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
  localCoverFree: string;
  localCoverFreeTitle: string;
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
  /** 已接入文本节点时的 @ 标签 */
  linkedTextTag: string;
  linkedTextTagTitle: string;
  /** 已接入参考音时的 @ 标签 */
  linkedRefAudioTag: string;
  linkedRefAudioTagTitle: string;
  /** 多路参考音：第 n 路标签兜底名（无文件名时） */
  linkedRefAudioTagN: (n: number) => string;
  linkedRefAudioTagTitleN: (n: number, max: number) => string;
  /** 多路参考音数量徽标，如 参考音 2/3 */
  linkedRefAudioCountBadge: (cur: number, max: number) => string;
  /** 已接入原曲时的 @ 标签 */
  linkedSourceSongTag: string;
  linkedSourceSongTagTitle: string;
  voiceTranscribing: string;
  speedLabel: (v: string) => string;
  speedAria: string;
  volumeLabel: (v: string) => string;
  volumeAria: string;
  pitchLabel: (v: string) => string;
  pitchAria: string;
  emotionNone: string;
  coverSourceSongLabel: string;
  coverReferenceLabel: string;
  coverRvcModelLabel: string;
  coverRvcModelPlaceholder: string;
  coverOutputModeLabel: string;
  coverOutputWithAccomp: string;
  coverOutputVocalsOnly: string;
  coverOutputModeTitle: string;
  coverPitchLabel: (v: string) => string;
  coverPitchTitle: string;
  coverIndexRateLabel: (pct: string) => string;
  coverIndexRateTitle: string;
  coverVocalMixLabel: (pct: string) => string;
  coverVocalMixTitle: string;
  coverAccompanimentMixLabel: (pct: string) => string;
  coverAccompanimentMixTitle: string;
  coverPitchRhLabel: (v: string) => string;
  coverRhVolumeLabel: (v: string) => string;
  coverHint: string;
  coverSlotConnected: string;
  coverSlotPending: string;
  coverMissingRefTitle: string;
  coverMissingSource: string;
  coverMissingModel: string;
  rvcTrainModelLabel: string;
  rvcTrainModelPlaceholder: string;
  rvcTrainAudioLabel: string;
  rvcTrainHint: string;
  generateRvcTrain: string;
  generatingRvcTrain: string;
  doubaoSpeakerLabel: string;
  doubaoSpeakerPlaceholder: string;
  doubaoImageLabel: string;
  doubaoImagePlaceholder: string;
  doubaoSelectImageTitle: string;
  doubaoSelectImageButton: string;
  doubaoFormatLabel: string;
  doubaoSampleRateLabel: string;
  doubaoSpeechRateLabel: (v: string) => string;
  doubaoLoudnessRateLabel: (v: string) => string;
  doubaoRefMutexHint: string;
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
  recordReferenceTitle: '按住录音，松开结束并保存（需麦克风授权）',
  recordReferenceAria: '按住录制参考音',
  recordReferenceButton: '录音',
  stopRecordingButton: '松开保存',
  micPermissionDenied: '无法使用麦克风：请在系统设置中允许本应用访问麦克风，或检查是否被其他程序占用。',
  micSaveFailed: '录音保存失败，请重试或改用「选择文件」。',
  recordTooShort: '录音过短，请按住麦克风稍后再松开。',
  recordModalTitle: '正在录制参考音',
  recordModalSubtitle: '按住麦克风录音，松开结束并保存',
  recordModalStop: '停止并保存',
  priceTitle: '单次生成预估消耗元宝（优先 nx_model_config 云端表）',
  creditsSuffix: '元宝',
  localCoverFree: '本地免费',
  localCoverFreeTitle: 'RVC 翻唱在本机运行，不消耗云端元宝',
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
  textContentPlaceholder: '输入要转换为语音的文本…（Enter 发送 · Shift+Enter 换行）',
  textInputTitle: '文本输入框',
  linkedTextTag: '文本',
  linkedTextTagTitle: '已接入文本节点',
  linkedRefAudioTag: '参考音',
  linkedRefAudioTagTitle: '已接入参考音频',
  linkedRefAudioTagN: (n) => `参考音${n}`,
  linkedRefAudioTagTitleN: (n, max) => `已接入第 ${n} 路参考音频（最多 ${max} 路）`,
  linkedRefAudioCountBadge: (cur, max) => `参考音 ${cur}/${max}`,
  linkedSourceSongTag: '原曲',
  linkedSourceSongTagTitle: '已接入原曲音频',
  voiceTranscribing: '正在将语音转为文字…',
  speedLabel: (v) => `语速: ${v}`,
  speedAria: '语速',
  volumeLabel: (v) => `音量: ${v}`,
  volumeAria: '音量',
  pitchLabel: (v) => `音调: ${v}`,
  pitchAria: '音调',
  emotionNone: '无',
  coverSourceSongLabel: '原曲',
  coverReferenceLabel: '参考音色',
  coverRvcModelLabel: 'RVC 模型',
  coverRvcModelPlaceholder: '如 my-voice/my-voice.pth',
  coverOutputModeLabel: '输出:',
  coverOutputWithAccomp: '带伴奏',
  coverOutputVocalsOnly: '纯人声',
  coverOutputModeTitle: '带伴奏=人声与伴奏混音；纯人声=不混回伴奏（Demucs 分离可能仍有少量残留，已尽量抑制）',
  coverPitchLabel: (v) => `音调: ${v}`,
  coverPitchTitle: '整体升/降调（半音），如男转女可试 +3~+5',
  coverIndexRateLabel: (pct) => `音色相似: ${pct}%`,
  coverIndexRateTitle: '越高越接近训练音色；过高可能发糊、抖动',
  coverVocalMixLabel: (pct) => `人声: ${pct}%`,
  coverVocalMixTitle: '混音时人声音量（0=无人声）',
  coverAccompanimentMixLabel: (pct) => `伴奏: ${pct}%`,
  coverAccompanimentMixTitle: '混音时伴奏音量（0=纯人声）',
  coverPitchRhLabel: (v) => `翻唱音调: ${v}`,
  coverRhVolumeLabel: (v) => `翻唱音量: ${v}`,
  coverHint: '本地 RVC 翻唱：从音色库选择 zip/pth 模型 + 原曲，输出含伴奏；首次使用需下载本地引擎（约 1.2GB）',
  coverSlotConnected: '已接入',
  coverSlotPending: '待接入',
  coverMissingRefTitle: '自训练翻唱需要训练参考音：音色库点铅笔编辑 → 上传「训练音频片段」（与训练 RVC 时用的干声相同）',
  coverMissingSource: 'RVC 翻唱需要原曲：请连接 audio 节点到本节点',
  coverMissingModel: 'RVC 翻唱需要模型：请连接 rvcTrain 节点或从音色库拖入音色',
  rvcTrainModelLabel: '模型名称',
  rvcTrainModelPlaceholder: '例如：周美丽声音',
  rvcTrainAudioLabel: '训练音频',
  rvcTrainHint: '从上游声音节点连入训练素材；填写模型名称后点击开始训练（无需台词，结果写入音色库）',
  generateRvcTrain: '开始训练',
  generatingRvcTrain: '训练中',
  doubaoSpeakerLabel: '音色ID',
  doubaoSpeakerPlaceholder: '可选，豆包音色或复刻音色 ID',
  doubaoImageLabel: '参考图',
  doubaoImagePlaceholder: '可选，粘贴 URL 或选择本地图片',
  doubaoSelectImageTitle: '选择本地参考图片',
  doubaoSelectImageButton: '选图',
  doubaoFormatLabel: '格式',
  doubaoSampleRateLabel: '采样率',
  doubaoSpeechRateLabel: (v) => `语速: ${v}`,
  doubaoLoudnessRateLabel: (v) => `音量: ${v}`,
  doubaoRefMutexHint: '音色ID、参考音、参考图三者只能选其一',
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
  recordReferenceTitle: 'Hold to record, release to save (microphone permission required)',
  recordReferenceAria: 'Hold to record reference audio',
  recordReferenceButton: 'Record',
  stopRecordingButton: 'Release to save',
  micPermissionDenied: 'Microphone unavailable. Allow this app in system settings, or check if another app is using the mic.',
  micSaveFailed: 'Could not save recording. Try again or use “Choose file”.',
  recordTooShort: 'Recording too short. Hold the mic a bit longer, then release.',
  recordModalTitle: 'Recording reference audio',
  recordModalSubtitle: 'Hold the mic to record, release to finish and save.',
  recordModalStop: 'Stop & save',
  priceTitle: 'Estimated credits per generation (nx_model_config)',
  creditsSuffix: 'credits',
  localCoverFree: 'Local free',
  localCoverFreeTitle: 'RVC cover runs locally; no cloud credits charged',
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
  textContentPlaceholder: 'Text to convert to speech… (Enter to send · Shift+Enter for newline)',
  textInputTitle: 'Text input',
  linkedTextTag: 'Text',
  linkedTextTagTitle: 'Linked text node',
  linkedRefAudioTag: 'Reference audio',
  linkedRefAudioTagTitle: 'Linked reference audio',
  linkedRefAudioTagN: (n) => `Ref audio ${n}`,
  linkedRefAudioTagTitleN: (n, max) => `Linked reference audio ${n} of ${max}`,
  linkedRefAudioCountBadge: (cur, max) => `Ref audio ${cur}/${max}`,
  linkedSourceSongTag: 'Source song',
  linkedSourceSongTagTitle: 'Linked source song',
  voiceTranscribing: 'Converting speech to text…',
  speedLabel: (v) => `Speed: ${v}`,
  speedAria: 'Speech speed',
  volumeLabel: (v) => `Volume: ${v}`,
  volumeAria: 'Volume',
  pitchLabel: (v) => `Pitch: ${v}`,
  pitchAria: 'Pitch',
  emotionNone: 'None',
  coverSourceSongLabel: 'Source song',
  coverReferenceLabel: 'Reference voice',
  coverRvcModelLabel: 'RVC model',
  coverRvcModelPlaceholder: 'e.g. my-voice/my-voice.pth',
  coverOutputModeLabel: 'Output:',
  coverOutputWithAccomp: 'With backing',
  coverOutputVocalsOnly: 'Vocals only',
  coverOutputModeTitle: 'With backing = mixed with instrumental; Vocals only = no mix-back (may retain slight separation bleed, suppressed when possible)',
  coverPitchLabel: (v) => `Pitch: ${v}`,
  coverPitchTitle: 'Semitone shift; try +3~+5 for male model on female vocals',
  coverIndexRateLabel: (pct) => `Likeness: ${pct}%`,
  coverIndexRateTitle: 'How close to the trained voice; too high may sound muddy',
  coverVocalMixLabel: (pct) => `Vocal: ${pct}%`,
  coverVocalMixTitle: 'Vocal level in final mix (0 = mute vocal)',
  coverAccompanimentMixLabel: (pct) => `Backing: ${pct}%`,
  coverAccompanimentMixTitle: 'Instrumental level in final mix (0 = vocals only)',
  coverPitchRhLabel: (v) => `Cover pitch: ${v}`,
  coverRhVolumeLabel: (v) => `Cover volume: ${v}`,
  coverHint: 'Local RVC cover: pick zip/pth from voice library + source song; output includes accompaniment. First run downloads ~1.2GB engine.',
  coverSlotConnected: 'Connected',
  coverSlotPending: 'Not connected',
  coverMissingRefTitle: 'Custom cover needs training reference audio — upload it in the voice library',
  coverMissingSource: 'RVC cover needs a source song — connect an audio node',
  coverMissingModel: 'RVC cover needs a model — connect rvcTrain or drag from voice library',
  rvcTrainModelLabel: 'Model name',
  rvcTrainModelPlaceholder: 'e.g. My Voice',
  rvcTrainAudioLabel: 'Training audio',
  rvcTrainHint: 'Connect training audio from an upstream node; set a model name and start (no script; saves to voice library)',
  generateRvcTrain: 'Train model',
  generatingRvcTrain: 'Training',
  doubaoSpeakerLabel: 'Speaker ID',
  doubaoSpeakerPlaceholder: 'Optional Doubao / clone speaker ID',
  doubaoImageLabel: 'Ref image',
  doubaoImagePlaceholder: 'Optional URL or local image',
  doubaoSelectImageTitle: 'Choose reference image',
  doubaoSelectImageButton: 'Image',
  doubaoFormatLabel: 'Format',
  doubaoSampleRateLabel: 'Sample rate',
  doubaoSpeechRateLabel: (v) => `Speech rate: ${v}`,
  doubaoLoudnessRateLabel: (v) => `Loudness: ${v}`,
  doubaoRefMutexHint: 'Use only one of: speaker ID, reference audio, or reference image',
};

export function audioInputPanelT(locale: AppLocale): AudioInputPanelStrings {
  return locale === 'en' ? en : zh;
}
