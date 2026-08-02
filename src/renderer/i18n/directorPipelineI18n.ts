import type { AppLocale } from './settingsI18n';

export type DirectorPipelineStrings = {
  scriptTitle: string;
  scriptPlaceholder: string;
  directorTitle: string;
  modeScript: string;
  modeMv: string;
  phaseMusic: string;
  phaseStyle: string;
  phaseStory: string;
  phaseCast: string;
  phaseRatio: string;
  phaseVideos: string;
  phaseShots: string;
  phaseAssets: string;
  phaseMvScenes: string;
  phasePrompts: string;
  phaseStoryboards: string;
  phasePreview: string;
  /** 步骤条：第 n/total 步 */
  stepOfTotal: string;
  /** 步骤条副文案 */
  stepGuideHint: string;
  /** 音乐分段：收起波形网格 */
  musicPacksCollapse: string;
  /** 音乐分段：展开波形试听 */
  musicPacksExpand: string;
  /** 音乐步小白指引：上传 */
  guideMusicStepUpload: string;
  /** 音乐步小白指引：识别 */
  guideMusicStepDetect: string;
  /** 音乐步小白指引：下一步 */
  guideMusicStepNext: string;
  /** 底部主按钮：上传 */
  guideMusicCtaUpload: string;
  /** 底部主按钮：识别 */
  guideMusicCtaDetect: string;
  /** 小白指引提示 */
  guideMusicHint: string;
  /** 已完成可跳过识别 */
  guideMusicSkipDetect: string;
  shotsReady: string;
  assetsProgress: string;
  assetsStepProgress: string;
  promptsProgress: string;
  storyboardsProgress: string;
  afterPartialHint: string;
  afterPartialHintMv: string;
  nextPrepareAssets: string;
  nextGenerateStoryboards: string;
  nextPreviewTimeline: string;
  nextStyle: string;
  nextStory: string;
  nextCast: string;
  /** 选角完成后进入剧本 */
  nextStoryAfterCast: string;
  nextRatio: string;
  nextVideos: string;
  generateThisVideo: string;
  generatingVideo: string;
  generatingStoryboard: string;
  videosHint: string;
  nextScenes: string;
  nextMvScenes: string;
  nextShots: string;
  step1GenerateShots: string;
  step2PrepareAssets: string;
  step3ComposePrompts: string;
  step4GenerateStoryboards: string;
  step5SpawnVideos: string;
  previewToSplice: string;
  /** 剪辑预览：已生成视频 + 原曲入轨 */
  previewVideosToSplice: string;
  previewVideosHint: string;
  confirmGenVideos: string;
  exportMv: string;
  musicChipLabel: string;
  absorbedMusicEmpty: string;
  musicTitle: string;
  musicDuration: string;
  musicMood: string;
  musicSummary: string;
  musicLyrics: string;
  /** 清理歌词框中的歌名/词曲署名 */
  musicLyricsStripMeta: string;
  musicLyricsStripMetaDone: string;
  musicLyricsExtractRunning: string;
  musicLyricsExtractFailed: string;
  /** AI识别 / 歌曲分析进行中：取消 */
  musicJobCancel: string;
  musicLyricsPlaceholder: string;
  musicUploadAudio: string;
  musicUploadLyrics: string;
  musicReplaceAudio: string;
  musicClearAudio: string;
  musicDropHint: string;
  musicStep1: string;
  musicStep2: string;
  musicStep3: string;
  musicStep1Title: string;
  musicStep2Title: string;
  musicStep3Title: string;
  musicStep2Hint: string;
  musicAiAnalyzeTitle: string;
  musicAiAnalyzeIdle: string;
  musicAiAnalyzeDesc: string;
  musicAnalyzeSummaryEmpty: string;
  musicDimStructure: string;
  musicDimStructureSub: string;
  musicDimEmotion: string;
  musicDimEmotionSub: string;
  musicDimRhythm: string;
  musicDimRhythmSub: string;
  musicDimStyle: string;
  musicDimStyleSub: string;
  musicDimKeywords: string;
  musicDimKeywordsSub: string;
  musicRecommendDuration: string;
  phaseMusicSub: string;
  phaseStyleSub: string;
  phaseCastSub: string;
  phaseStorySub: string;
  phaseMvScenesSub: string;
  phaseShotsSub: string;
  phaseVideosSub: string;
  phasePreviewSub: string;
  musicDropFormats: string;
  musicConnectHint: string;
  musicNeedFirst: string;
  musicAudioTooLarge: string;
  musicAudioTooLong: string;
  musicAudioBadFormat: string;
  castHint: string;
  castFromScriptCount: string;
  castSyncFromScript: string;
  castNeedScriptCharacters: string;
  castEmptyHint: string;
  /** 确认镜头：本镜添加/选择角色 */
  castAddToShot: string;
  castPickForShot: string;
  /** 确认镜头：更换场景 */
  sceneReplaceShot: string;
  /** 确认镜头：更换角色 */
  castReplaceShot: string;
  /** 确认镜头：移除本镜角色 */
  castRemoveShot: string;
  /** 确认镜头：选空镜头（不绑角色） */
  castEmptyShotOption: string;
  /** 确认镜头：本镜未匹配到角色（空镜） */
  castEmptyShotHint: string;
  /** 确认镜头：无人声歌段不绑角色 */
  castInstrumentalNoCastHint: string;
  castGenerateOrCanvas: string;
  castPickArtwork: string;
  castArtworkTitle: string;
  castArtworkHint: string;
  castArtworkAssignTo: string;
  castNeedTargetFirst: string;
  /** 选角：上方「选择角色」区标题 */
  castSelectRoleTitle: string;
  /** 选角：角色 2 区标题 */
  castMoreLooksTitle: string;
  /** 选角：横滑末尾提示 */
  castCustomRole: string;
  castMoreRoles: string;
  castRoleIndex: string;
  castEditRole: string;
  castUploadRole: string;
  castRole2DisabledHint: string;
  /** 选角：主角人数与性别 */
  castLeadCountLabel: string;
  castLeadSolo: string;
  castLeadDuo: string;
  castLeadGenderLabel: string;
  castLeadGenderMale: string;
  castLeadGenderFemale: string;
  castLead1Label: string;
  castLead2Label: string;
  castNeedLeads: string;
  castLibraryGenderNote: string;
  scenesHint: string;
  scenesSyncFromScript: string;
  scenesNeedScript: string;
  scenesFromScriptCount: string;
  storyHint: string;
  /** 剧本步：参考生成开关标签 */
  storyRefGenSwitchLabel: string;
  /** 剧本步：参考生成开启说明 */
  storyRefGenOnHint: string;
  /** 剧本步：手动填写说明 */
  storyManualHint: string;
  /** 近景特写开关标签 */
  closeUpFramingSwitchLabel: string;
  /** 近景特写开说明 */
  closeUpFramingOnHint: string;
  /** 近景特写关说明 */
  closeUpFramingOffHint: string;
  /** 剧本步：参考内容标题 */
  storyReferenceLabel: string;
  /** 剧本步：参考内容占位 */
  storyReferencePlaceholder: string;
  storyPlaceholder: string;
  storyAnalyzeTitle: string;
  storyStyleTitle: string;
  storyEmotionsLabel: string;
  storyKeywordsLabel: string;
  storyScriptKeywordsLabel: string;
  storySectionPlot: string;
  storySectionWorldView: string;
  storySectionRelationships: string;
  storySectionCharacters: string;
  storySectionScenes: string;
  storySectionProps: string;
  storySectionPlotPh: string;
  /** 剧情明细表摘要：共 n 段，空镜 e，有人 c */
  storyPlotBeatSummary: string;
  storyPlotBeatColNo: string;
  storyPlotBeatColSection: string;
  storyPlotBeatColVocal: string;
  storyPlotBeatColCastType: string;
  storyPlotBeatColScene: string;
  storyPlotBeatColCast: string;
  storyPlotBeatColAngle: string;
  storyPlotBeatColFocal: string;
  storyPlotBeatColAction: string;
  storyPlotBeatColMood: string;
  storyPlotBeatRawEdit: string;
  storySectionWorldViewPh: string;
  storySectionRelationshipsPh: string;
  storySectionCharactersPh: string;
  storySectionScenesPh: string;
  storySectionPropsPh: string;
  storyAnalyzeBtn: string;
  storyGenerateScriptBtn: string;
  /** 分析音乐 + 生成剧本 一次完成 */
  storyOneShotBtn: string;
  storyOneShotRunning: string;
  storyNeedLyricsOrTitle: string;
  storyNeedMusicAnalysis: string;
  storyAnalysisEmpty: string;
  storyAnalyzeFailed: string;
  storyScriptFailed: string;
  storyAnalyzing: string;
  storyWriting: string;
  ratioHint: string;
  previewHint: string;
  previewNeedStoryboards: string;
  oneClickGenerateAssets: string;
  oneClickComposePrompts: string;
  oneClickGenerateStoryboards: string;
  generateThisStoryboard: string;
  /** 已有分镜图：重新生成 */
  regenerateStoryboard: string;
  colStoryboard: string;
  colShotVideo: string;
  /** 视频生成表：参考分镜图列 */
  colRefStoryboard: string;
  needStoryboardsFirst: string;
  confirmSpawnWithoutAllStoryboards: string;
  /** 对口型生成前确认 */
  confirmLipsyncGen: string;
  confirmLipsyncShotLine: string;
  confirmLipsyncMissingTitle: string;
  confirmLipsyncPartialSkip: string;
  lipsyncRecommend: string;
  lipsyncUse: string;
  lipsyncRevert: string;
  /** 单镜：推荐对口型（分镜图生视频） */
  lipsyncShotBadge: string;
  lipsyncShotBadgeOff: string;
  lipsyncShotBadgeClimax: string;
  /** 手动开对口型但脸不够近时的警告 */
  lipsyncShotBadgeFarWarning: string;
  /** 对口型开关短标签（表格内） */
  lipsyncToggleLabel: string;
  /** 确认镜头表：对口型列标题 */
  colLipsync: string;
  /** 确认镜头表：操作列 */
  colActions: string;
  /** 分镜空槽文案 */
  sbEmptyGenerateSlot: string;
  /** 对白列开启态短标签（设计稿「对白」） */
  dialoguePillLabel: string;
  /** 下载分镜图 */
  downloadStoryboard: string;
  /** 下载成片 */
  downloadShotVideo: string;
  videoMute: string;
  videoUnmute: string;
  colShotAudio: string;
  playShotAudio: string;
  shotAudioNeedMusic: string;
  lyricTimelineDetect: string;
  lyricTimelineRunning: string;
  lyricTimelineRunningSeparate: string;
  lyricTimelineRunningTranscribe: string;
  lyricTimelineRunningStyle: string;
  lyricTimelineHint: string;
  lyricTimelineReady: string;
  lyricTimelineFailed: string;
  lyricTimelineEmpty: string;
  lyricTimelineNeedEngine: string;
  lyricTimelineSeparateFallback: string;
  /** 已有时间轴时：用歌词框重新校准并按档位重切 */
  lyricTimelineRecalibrate: string;
  lyricTimelineRecalibrateNeed: string;
  /** 校准切段完成提示 */
  lyricTimelineRecalibrateDone: string;
  /** 识别后分段试听列表标题 */
  lyricTimelineSectionsTitle: string;
  lyricTimelineSectionPlay: string;
  lyricTimelineSectionNoText: string;
  lyricTimelineClear: string;
  lyricTimelineDeletePack: string;
  /** 紧凑分段列表说明 */
  musicPacksCompactHint: string;
  /** 切镜档位：长镜 10–15s */
  clipLengthModeLong: string;
  /** 切镜档位：短镜 4–6s */
  clipLengthModeShort: string;
  clipLengthModeHint: string;
  shotsConfirmSummaryModel: string;
  shotsConfirmSummaryModelDurations: string;
  shotsConfirmSummaryModelLipsync: string;
  shotsConfirmSummaryShots: string;
  shotsConfirmSummaryVocals: string;
  shotsConfirmSummaryNoTimeline: string;
  shotsConfirmSummaryLipsync: string;
  shotsConfirmSummaryLipsyncClimax: string;
  shotsConfirmApplyLipsync: string;
  /** 确认镜头：视频模型改到下一步再选 */
  shotsConfirmVideoModelLaterHint: string;
  shotAudioHasVocal: string;
  shotAudioInstrumental: string;
  shotAudioVocalUnknown: string;
  backToPrompts: string;
  assetsStepCharacters: string;
  assetsStepScenes: string;
  assetsStepProps: string;
  nextGenerateScenes: string;
  nextGenerateProps: string;
  generateCharactersBatch: string;
  generateScenesBatch: string;
  generatePropsBatch: string;
  backToCharacters: string;
  backToScenes: string;
  batchSpawnVideos: string;
  addShot: string;
  /** 在该行前插入空镜头 */
  insertShotBefore: string;
  /** 在该行后插入空镜头 */
  insertShotAfter: string;
  /** 删除该行镜头 */
  deleteShot: string;
  /** 编辑本镜歌曲起止时间 */
  editShotAudioRange: string;
  globalStyle: string;
  stylePreset: string;
  styleCustomHint: string;
  styleLongPressHint: string;
  stylePromptEditTitle: string;
  stylePromptSave: string;
  stylePromptCancel: string;
  /** 风格库标题 */
  styleLibraryTitle: string;
  styleLibraryTabSystem: string;
  styleLibraryTabMine: string;
  styleLibraryMineEmpty: string;
  styleLibrarySelected: string;
  styleLibraryMore: string;
  characters: string;
  scenes: string;
  props: string;
  addAsset: string;
  deleteAsset: string;
  pickFromCanvas: string;
  pickFromLibrary: string;
  pickFromCharacterLibrary: string;
  pickFromSceneLibrary: string;
  sourceMenuTitle: string;
  libraryPickTitleCharacter: string;
  libraryPickTitleScene: string;
  libraryPickEmpty: string;
  libraryPickLoading: string;
  uploadLocal: string;
  generateOrUpload: string;
  generateThis: string;
  generateCategory: string;
  /** MV 场景步：批量生成场景九宫格 */
  batchGenerateSceneImages: string;
  /** 角色卡：隐藏链接提示（不展示正文） */
  characterLinkedHint: string;
  sceneLinkedHint: string;
  creditsSuffix: string;
  /** 批量生成视频按钮悬停价签；{n}=条数，{cost}=已含单位的总价（如 384元宝 / 384 credits） */
  batchVideoYuanbaoHover: string;
  /** 一键生成场景图按钮悬停价签；{n}=张数，{cost}=已含单位的总价 */
  batchSceneYuanbaoHover: string;
  /** 全部生成分镜图按钮悬停价签；{n}=张数，{cost}=已含单位的总价 */
  batchStoryboardYuanbaoHover: string;
  priceTooltip: string;
  assetsMonitor: string;
  missingAssetsHint: string;
  batchModalTitle: string;
  selectedCount: string;
  generateN: string;
  modelLabel: string;
  /** 对话 / 写剧本 / 拆镜用的大语言模型 */
  chatModelLabel: string;
  videoBatchModelLabel: string;
  videoBatchLipsyncModelLabel: string;
  videoBatchDurationLabel: string;
  videoBatchRatioLabel: string;
  videoBatchResolutionLabel: string;
  /** 对口型清晰度（与视频清晰度分开选；文案与普通清晰度一致） */
  videoBatchLipsyncResolutionLabel: string;
  /** 视频生成顶栏：比例只读，沿用分镜图 */
  videoAspectFromStoryboard: string;
  /** 视频生成顶栏：时长跟镜头分析 */
  videoDurationFromShotHint: string;
  /** 行内：分析时长与模型档不一致时 */
  videoDurationSnapped: string;
  promptPlaceholder: string;
  intentTriggerLabel: string;
  generateShots: string;
  generateFailed: string;
  /** 卡死/强退后成片仍显示生成中 */
  videoGenInterrupted: string;
  generateNeedScript: string;
  generateNeedMusic: string;
  needShotsFirst: string;
  needAssetsFirst: string;
  pendingPrompt: string;
  viewPrompt: string;
  viewImage: string;
  colShotNo: string;
  colDuration: string;
  colDesc: string;
  /** 确认镜头：角度+焦距合并列 */
  colAngleFocal: string;
  colAngle: string;
  colFocal: string;
  colShotSize: string;
  colLighting: string;
  colDialogue: string;
  colSfx: string;
  colCamera: string;
  colFinalPrompt: string;
  /** 视频步：按意见 AI 改写当前镜最终提示词 */
  aiReviseFinalPrompt: string;
  aiReviseFinalPromptOpinionPlaceholder: string;
  aiReviseFinalPromptBusy: string;
  aiReviseFinalPromptNeedOpinion: string;
  aiReviseFinalPromptNeedPrompt: string;
  aiReviseFinalPromptFailed: string;
  aiReviseFinalPromptEmpty: string;
  /** 视频步：AI 调整意见云端实时听写 */
  aiReviseFinalPromptVoiceStart: string;
  aiReviseFinalPromptVoiceStop: string;
  aiReviseFinalPromptVoiceBusy: string;
  aiReviseFinalPromptMicDenied: string;
  colRefImages: string;
  pickShotRefImage: string;
  addShotRefImage: string;
  shotsDurationSummary: string;
  shotsDurationMatched: string;
  shotsDurationMismatch: string;
  shotsDurationAlign: string;
  colStyleRef: string;
  uploading: string;
  generating: string;
  backToShots: string;
  backToAssets: string;
  confirmGoAssets: string;
  confirmGoPrompts: string;
  scriptChipLabel: string;
  absorbedScript: string;
  absorbedScriptEmpty: string;
};

const zh: DirectorPipelineStrings = {
  scriptTitle: '剧本',
  scriptPlaceholder: '在此粘贴或编写剧本正文…',
  directorTitle: '导演',
  modeScript: '剧本',
  modeMv: 'MV',
  phaseMusic: '音乐上传/分析',
  phaseStyle: '风格选择',
  phaseStory: '脚本生成',
  phaseCast: '选角',
  phaseRatio: '画幅',
  phaseVideos: '视频生成',
  phaseShots: '分镜生成',
  phaseAssets: '准备资产',
  phaseMvScenes: '场景配置',
  phasePrompts: '合成提示词',
  phaseStoryboards: '生成分镜图',
  phasePreview: '导出&分享',
  stepOfTotal: '第 {n}/{total} 步',
  stepGuideHint: '点击步骤可跳转',
  musicPacksCollapse: '收起波形',
  musicPacksExpand: '展开波形试听',
  guideMusicStepUpload: '上传歌曲',
  guideMusicStepDetect: '歌曲分析',
  guideMusicStepNext: '选风格',
  guideMusicCtaUpload: '第一步：上传歌曲',
  guideMusicCtaDetect: '开始 AI 分析',
  guideMusicHint: '跟着底部大按钮按顺序点即可',
  guideMusicSkipDetect: '跳过，直接选风格',
  shotsReady: '{n} 个镜头已就绪',
  assetsProgress: '{ready}/{total} 已生成，剩余 {left}',
  assetsStepProgress: '{step} {ready}/{total}',
  promptsProgress: '{ready}/{total} 已合成',
  storyboardsProgress: '{ready}/{total} 已生成，剩余 {left}',
  afterPartialHint: '分镜图就绪后可批量生成视频',
  afterPartialHintMv: '分镜生成→视频生成→剪辑预览',
  nextPrepareAssets: '下一步：准备资产',
  nextGenerateStoryboards: '下一步：生成分镜图',
  nextPreviewTimeline: '下一步：入剪辑轨预览',
  nextStyle: '下一步：风格选择',
  nextStory: '下一步：写剧本',
  nextCast: '下一步：选角色',
  nextStoryAfterCast: '下一步：写剧本',
  nextRatio: '下一步：选画幅',
  nextVideos: '下一步：视频生成',
  generateThisVideo: '生成视频',
  generatingVideo: '生成中…',
  generatingStoryboard: '分镜生成中…',
  videosHint: '以下字段来自分镜生成：画面描述、分镜图、歌曲片段、运镜、景别、光影氛围与最终提示词',
  nextScenes: '下一步：场景参考',
  nextMvScenes: '下一步：场景图',
  nextShots: '下一步：分镜生成',
  step1GenerateShots: '第一步：生成镜头表',
  step2PrepareAssets: '第二步：准备资产',
  step3ComposePrompts: '第三步：合成提示词',
  step4GenerateStoryboards: '第四步：生成分镜图',
  step5SpawnVideos: '第五步：批量生成视频',
  previewToSplice: '剪辑预览',
  previewVideosToSplice: '视频合成',
  previewVideosHint: '将已生成的视频按镜头顺序铺到视频轨，原曲铺到音轨',
  confirmGenVideos: '确认生成视频并替换轨',
  exportMv: '导出 MV',
  musicChipLabel: '音乐',
  absorbedMusicEmpty: '连接音频节点以吸收音乐，或填写情绪/主题',
  musicTitle: '曲名',
  musicDuration: '时长（秒）',
  musicMood: '情绪/主题',
  musicSummary: '分析摘要',
  musicLyrics: '歌词',
  musicLyricsStripMeta: 'AI识别',
  musicLyricsStripMetaDone: '已填入歌词正文',
  musicLyricsExtractRunning: '正在识别歌词…',
  musicLyricsExtractFailed: '识别歌词失败',
  musicJobCancel: '取消',
  musicLyricsPlaceholder: '可粘贴歌词，或点击「AI识别」',
  musicUploadAudio: '上传歌曲音频',
  musicUploadLyrics: '上传歌词文件',
  musicReplaceAudio: '更换音频',
  musicClearAudio: '清除音频',
  musicDropHint: '上传音乐',
  musicStep1: '第一步',
  musicStep2: '第二步',
  musicStep3: '第三步',
  musicStep1Title: '第一步：上传歌曲',
  musicStep2Title: '第二步：填入歌词',
  musicStep3Title: '第三步：歌曲分析',
  musicStep2Hint: '上传歌曲后可自动填入歌词',
  musicAiAnalyzeTitle: 'AI 分析',
  musicAiAnalyzeIdle: '上传歌曲后自动分析',
  musicAiAnalyzeDesc: 'AI 将分析歌曲结构、情绪、节奏等信息，为您生成最佳 MV 方案',
  musicAnalyzeSummaryEmpty: '点击「歌曲分析」生成总结。',
  musicDimStructure: '歌曲结构',
  musicDimStructureSub: '分析段落与节奏',
  musicDimEmotion: '情绪曲线',
  musicDimEmotionSub: '识别情绪变化',
  musicDimRhythm: '节奏变化',
  musicDimRhythmSub: '检测节拍与速度',
  musicDimStyle: '风格推荐',
  musicDimStyleSub: '匹配视觉风格',
  musicDimKeywords: '关键词',
  musicDimKeywordsSub: '提取歌词关键词',
  musicRecommendDuration: '推荐时长',
  phaseMusicSub: '选择或上传音乐',
  phaseStyleSub: '选择MV整体风格',
  phaseCastSub: '选择人物角色',
  phaseStorySub: 'AI生成分镜脚本',
  phaseMvScenesSub: '生成视觉素材',
  phaseShotsSub: '生成分镜图',
  phaseVideosSub: '生成MV视频',
  phasePreviewSub: '导出或分享作品',
  musicDropFormats: '支持 MP3 / WAV / M4A，最大 30MB',
  musicConnectHint: '画布上的歌曲请把声音节点连到导演即可吸收',
  musicNeedFirst: '请先上传或接入音乐',
  musicAudioTooLarge: '音频文件不能超过 30MB',
  musicAudioTooLong: '音频时长不能超过 6 分钟',
  musicAudioBadFormat: '仅支持 MP3 / WAV / M4A',
  castHint: '先定主角人数与性别，再为每个主角选形象；性别跟槽位走，不必给素材库每张图单独标性别',
  castFromScriptCount: '剧本识别到 {n} 人',
  castSyncFromScript: '从剧本同步配角',
  castNeedScriptCharacters: '请先生成剧本人物库，或在本步先锁定主角',
  castEmptyHint: '请选择主角人数与性别，将自动创建主角卡',
  castAddToShot: '添加角色',
  castPickForShot: '选择角色',
  sceneReplaceShot: '更换场景',
  castReplaceShot: '更换角色',
  castRemoveShot: '移除角色',
  castEmptyShotOption: '空镜头（无人物）',
  castEmptyShotHint: '提示词未写人物 · 不传角色图',
  castInstrumentalNoCastHint: '无人声也可有人物：背影/行走/跟拍等',
  castGenerateOrCanvas: '下方选形象 / 生成 / 上传',
  castPickArtwork: '选择形象',
  castArtworkTitle: '选择形象',
  castArtworkHint: '先点上方角色卡，再点下方形象',
  castArtworkAssignTo: '正在为「{name}」选择形象',
  castNeedTargetFirst: '请先选择或创建主角卡',
  castSelectRoleTitle: '角色 1',
  castMoreLooksTitle: '角色 2',
  castCustomRole: '自定义角色',
  castMoreRoles: '更多角色',
  castRoleIndex: '角色 {n}',
  castEditRole: '编辑',
  castUploadRole: '上传',
  castRole2DisabledHint: '勾选启用角色 2',
  castLeadCountLabel: '主角人数',
  castLeadSolo: '1 个主角',
  castLeadDuo: '2 个主角',
  castLeadGenderLabel: '性别',
  castLeadGenderMale: '男',
  castLeadGenderFemale: '女',
  castLead1Label: '主角 1',
  castLead2Label: '主角 2',
  castNeedLeads: '请先选定主角人数与性别',
  castLibraryGenderNote: '从资产库选图时无需预先标性别：图放进男主/女主槽即视为该性别',
  scenesHint: '根据剧本场景库列出地点，再一键生成九宫格空场景参考图（不生成道具）',
  scenesSyncFromScript: '同步场景',
  scenesNeedScript: '请先在「剧本」步骤填写场景库（如：天台：……）',
  scenesFromScriptCount: '剧本识别到 {n} 个场景',
  storyHint: '开启「参考生成」可填参考并由 AI 写剧本；关闭则自行填写。剧本宜有短剧情节，并穿插旁侧唱歌跳舞等 MV 表演感',
  storyRefGenSwitchLabel: '参考生成',
  storyRefGenOnHint: '根据下方参考内容生成剧本（可留空，仍会按歌词与歌曲分析生成）',
  storyManualHint: '已关闭参考生成：请在下方分节中自行编写剧本',
  closeUpFramingSwitchLabel: '近景特写',
  closeUpFramingOnHint: '开：有人镜仅特写（脸贴镜头），禁止半身、禁止全身；空镜仍按场景公式',
  closeUpFramingOffHint: '关：不限景别与运镜（全身/半身/近景等均可）',
  storyReferenceLabel: '参考',
  storyReferencePlaceholder: '粘贴或简述剧情参考、人物关系、想要的场景与表演点（旁侧唱歌/跳舞等）…',
  storyPlaceholder: '按分节编辑：剧情规划 → 世界观 → 人物关系 → 人物库 / 场景库 / 道具库',
  storyAnalyzeTitle: '分析总结',
  storyStyleTitle: '曲风与风格',
  storyEmotionsLabel: '主要情绪',
  storyKeywordsLabel: '关键词',
  storyScriptKeywordsLabel: '剧本关键词',
  storySectionPlot: '剧情规划（分段明细表）',
  storySectionWorldView: '世界观',
  storySectionRelationships: '人物关系',
  storySectionCharacters: '人物库',
  storySectionScenes: '场景库',
  storySectionProps: '道具库',
  storySectionPlotPh:
    '段号|曲式段|人声|画面类型|场景|出场角色|镜头角度|焦距|动作与画面|情绪\n1|前奏|无人声|空镜|石庭院|—|高机俯瞰|24mm空间感|暖阳扫过石桌，无人物|建置\n2|主歌|有人声|有人|石庭院|男主|过肩窥视|35mm纪实|男主中近景望向远方…|思念',
  storyPlotBeatSummary: '共 {n} 段 · 空镜 {empty} · 有人 {cast}',
  storyPlotBeatColNo: '段号',
  storyPlotBeatColSection: '曲式段',
  storyPlotBeatColVocal: '人声',
  storyPlotBeatColCastType: '画面类型',
  storyPlotBeatColScene: '场景',
  storyPlotBeatColCast: '出场角色',
  storyPlotBeatColAngle: '镜头角度',
  storyPlotBeatColFocal: '焦距',
  storyPlotBeatColAction: '动作与画面',
  storyPlotBeatColMood: '情绪',
  storyPlotBeatRawEdit: '编辑原始表格文本',
  storySectionWorldViewPh: '时空、氛围、视觉基调…',
  storySectionRelationshipsPh: '谁与谁、过往与当下…',
  storySectionCharactersPh: '一人一行：姓名：性别，年龄感，五官发型，服装，气质（可直接作生图 prompt）',
  storySectionScenesPh: '一景一行：短名：室内外 + 地点 + 光色 + 陈设（无人物空场景，供九宫格）',
  storySectionPropsPh: '关键道具，可空…',
  storyAnalyzeBtn: 'AI 分析音乐',
  storyGenerateScriptBtn: '生成剧本',
  storyOneShotBtn: '一键分析并生成剧本',
  storyOneShotRunning: '生成中…',
  storyNeedLyricsOrTitle: '请先在「音乐」步骤填写歌词或曲名',
  storyNeedMusicAnalysis: '请先在「音乐」步骤完成歌曲分析，分析结果会自动填入上方',
  storyAnalysisEmpty: '歌曲分析来自「音乐」步骤；若为空请返回上一步重新分析',
  storyAnalyzeFailed: '音乐分析失败',
  storyScriptFailed: '剧本生成失败',
  storyAnalyzing: '分析中…',
  storyWriting: '撰写中…',
  ratioHint: '锁定画幅后，分镜图与视频将统一使用',
  previewHint: '分镜图按建议时长铺在视频轨，原曲在音轨，可先 scrub 听歌对节奏',
  previewNeedStoryboards: '请先生成分镜图再入轨预览',
  oneClickGenerateAssets: '一键生成所有资产',
  oneClickComposePrompts: '一键合成全部提示词',
  oneClickGenerateStoryboards: '全部分镜生成',
  generateThisStoryboard: '生成',
  regenerateStoryboard: '重新生成',
  colStoryboard: '分镜图',
  colShotVideo: '成片',
  colRefStoryboard: '参考分镜图',
  needStoryboardsFirst: '请先生成分镜图',
  confirmSpawnWithoutAllStoryboards: '仍有 {n} 镜缺少分镜图，仅对已生成的镜头生成视频？',
  confirmLipsyncGen:
    '即将用 LTX2.3 对口型生成 {n} 镜。\n每镜须同时传入：分镜图 + 歌曲片段 + 提示词。\n确认后才会开始生成；取消则不创建、不生成。\n\n{detail}',
  confirmLipsyncShotLine: '镜{no}：分镜{sb} · 歌曲片段{clip} · 提示词{prompt}',
  confirmLipsyncMissingTitle:
    '对口型所需材料不齐（须同时有分镜图、歌曲片段、提示词），请补齐后再生成：',
  confirmLipsyncPartialSkip: '其中 {n} 镜材料不齐将跳过。',
  lipsyncRecommend: '有 {n} 镜含对白，建议开启对口型（将自动裁剪对应歌曲片段）',
  lipsyncUse: '改用对口型',
  lipsyncRevert: '恢复原模型',
  lipsyncShotBadge: '推荐对口型（特写脸近 + 有台词）· 点击可关闭',
  lipsyncShotBadgeOff: '未推荐对口型 · 点击可开启（需特写脸近且有台词）',
  lipsyncShotBadgeClimax: '高潮优先对口型（特写脸近+台词+高潮）· 点击可关闭',
  lipsyncShotBadgeFarWarning: '警告：脸可能不够近，对口型易崩 · 仍可强制开启',
  lipsyncToggleLabel: '对口型',
  colLipsync: '对白/旁白',
  colActions: '操作',
  sbEmptyGenerateSlot: '+ 生成分镜图',
  dialoguePillLabel: '对白',
  downloadStoryboard: '下载分镜图',
  downloadShotVideo: '下载成片',
  videoMute: '静音',
  videoUnmute: '开启声音',
  colShotAudio: '音频片段',
  playShotAudio: '试听本镜',
  shotAudioNeedMusic: '请先接入歌曲',
  lyricTimelineDetect: '歌曲分析',
  lyricTimelineRunning: '分析中…',
  lyricTimelineRunningSeparate: '分离人声…',
  lyricTimelineRunningTranscribe: '云端转写…',
  lyricTimelineRunningStyle: '风格分析…',
  lyricTimelineHint: '先分析歌曲，再按歌词切段',
  lyricTimelineReady: '{packs} 镜',
  lyricTimelineFailed: '歌曲分析失败',
  lyricTimelineEmpty: '未识别到可用片段',
  lyricTimelineNeedEngine: '当前环境不支持云端歌词转写。请登录账号后重试，或完全退出后重新运行应用（需重建主进程）',
  lyricTimelineSeparateFallback: '人声分离不可用，已改用整曲识别（精度可能下降）',
  lyricTimelineRecalibrate: '按歌词切段',
  lyricTimelineRecalibrateNeed: '请先完成歌曲分析',
  lyricTimelineRecalibrateDone: '已切段：约 {packs} 镜',
  lyricTimelineSectionsTitle: '按歌词分段',
  lyricTimelineSectionPlay: '试听',
  lyricTimelineSectionNoText: '',
  lyricTimelineClear: '清除分析',
  lyricTimelineDeletePack: '删除此段',
  musicPacksCompactHint: '',
  clipLengthModeLong: '长镜 10–15s',
  clipLengthModeShort: '短镜 4–6s',
  clipLengthModeHint:
    '短镜严格 4/5/6（含纯音乐）；两句间隔较大则拆段；长镜 10/15 贴歌词小句',
  shotsConfirmSummaryModel: '视频模型',
  shotsConfirmSummaryModelDurations: '支持时长 {durs}',
  shotsConfirmSummaryModelLipsync: '对口型：成片跟音频片段时长（就近计费档）',
  shotsConfirmSummaryShots: '共 {n} 镜',
  shotsConfirmSummaryVocals: '有人声 {v} · 间奏/无人声 {i}',
  shotsConfirmSummaryNoTimeline: '尚未在第一步完成歌曲分析，将按时长均切；回第一步点蓝色分析按钮即可',
  shotsConfirmSummaryLipsync: '建议对口型 {n} 镜',
  shotsConfirmSummaryLipsyncClimax: '其中高潮优先 {c} 镜',
  shotsConfirmApplyLipsync: '按规则推荐对口型',
  shotsConfirmVideoModelLaterHint: '视频模型与默认时长请在「视频生成」步选择',
  shotAudioHasVocal: '有人声',
  shotAudioInstrumental: '无人声',
  shotAudioVocalUnknown: '未识别',
  backToPrompts: '返回提示词',
  assetsStepCharacters: '生成角色',
  assetsStepScenes: '生成场景',
  assetsStepProps: '生成道具',
  nextGenerateScenes: '下一步：生成场景',
  nextGenerateProps: '下一步：生成道具',
  generateCharactersBatch: '一键生成角色',
  generateScenesBatch: '一键生成场景',
  generatePropsBatch: '一键生成道具',
  backToCharacters: '返回角色',
  backToScenes: '返回场景',
  batchSpawnVideos: '批量生成视频',
  addShot: '+ 添加镜头',
  insertShotBefore: '在上方插入空行',
  insertShotAfter: '在下方插入空行',
  deleteShot: '删除此镜头',
  editShotAudioRange: '编辑音频起止时间',
  globalStyle: '全篇风格',
  stylePreset: '风格',
  styleCustomHint: '点击风格参考图选择；选中图将作为全片风格参考',
  styleLongPressHint: '点击选择 · 长按编辑提示词',
  stylePromptEditTitle: '编辑风格提示词',
  stylePromptSave: '保存',
  stylePromptCancel: '取消',
  styleLibraryTitle: '艺术风格',
  styleLibraryTabSystem: '系统风格',
  styleLibraryTabMine: '我的风格',
  styleLibraryMineEmpty: '还没有自定义风格，点「自定义」创建',
  styleLibrarySelected: '已选：{name}',
  styleLibraryMore: '更多风格',
  characters: '角色',
  scenes: '场景',
  props: '道具',
  addAsset: '添加',
  deleteAsset: '删除',
  generateOrUpload: '生成或上传参考图',
  pickFromCanvas: '画布选择',
  pickFromLibrary: '资产库',
  pickFromCharacterLibrary: '角色库选择',
  pickFromSceneLibrary: '场景库选择',
  sourceMenuTitle: '导入参考图',
  libraryPickTitleCharacter: '从角色库选择',
  libraryPickTitleScene: '从场景库选择',
  libraryPickEmpty: '资产库暂无可用项',
  libraryPickLoading: '加载中…',
  uploadLocal: '电脑上传',
  generateThis: '生成',
  generateCategory: '生成本类',
  batchGenerateSceneImages: '一键生成所有场景图',
  characterLinkedHint: '生成时自动附加真人写实四宫格（等大、无分界线；正文不显示）',
  sceneLinkedHint: '生成时自动附加九宫格通用约束：等大分格、无间隙、无文字、空场景（正文不显示）',
  creditsSuffix: '元宝',
  batchVideoYuanbaoHover: '{n}个视频共{cost}',
  batchSceneYuanbaoHover: '{n}个场景图共{cost}',
  batchStoryboardYuanbaoHover: '{n}个分镜图共{cost}',
  priceTooltip: '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity（优先 nx_model_config）',
  assetsMonitor: '角色 {cReady}/{cTotal} · 场景 {sReady}/{sTotal} · 道具 {pReady}/{pTotal}',
  missingAssetsHint: '检测到 {c} 个角色、{s} 个场景、{p} 个道具尚无参考图。可手动上传或 AI 批量生成。',
  batchModalTitle: '一键生成所有资产',
  selectedCount: '已选 {n}/{total}',
  generateN: '生成({n})',
  modelLabel: '模型',
  chatModelLabel: '大语言模型',
  videoBatchModelLabel: '视频模型',
  videoBatchLipsyncModelLabel: '对口型模型',
  videoBatchDurationLabel: '时长',
  videoBatchRatioLabel: '比例',
  videoBatchResolutionLabel: '清晰度',
  videoBatchLipsyncResolutionLabel: '清晰度',
  videoAspectFromStoryboard: '比例（同分镜图）',
  videoDurationFromShotHint: '时长按镜头分析；模型不支持时取最接近档',
  videoDurationSnapped: '{shot}→{model}',
  promptPlaceholder: '补充导演意图、风格或镜头数（可选）',
  intentTriggerLabel: '补充导演意图、风格或镜头数（可选）',
  generateShots: '生成镜头表',
  generateFailed: '生成失败',
  videoGenInterrupted: '生成中断（应用退出），若平台已出片请点重新生成或从任务列表取回',
  generateNeedScript: '请先提供剧本正文',
  generateNeedMusic: '请先接入音乐并填写情绪/主题或补充意图',
  needShotsFirst: '请先添加镜头',
  needAssetsFirst: '请先准备资产',
  pendingPrompt: '待生成提示词',
  viewPrompt: '查看提示词',
  viewImage: '点击放大查看',
  colShotNo: '镜号',
  colDuration: '时长',
  colDesc: '画面描述',
  colAngleFocal: '机位',
  colAngle: '镜头角度',
  colFocal: '焦距',
  colShotSize: '景别',
  colLighting: '光影氛围',
  colDialogue: '对白/旁白',
  colSfx: '音效',
  colCamera: '运镜',
  colFinalPrompt: '最终提示词',
  aiReviseFinalPrompt: 'AI 调整',
  aiReviseFinalPromptOpinionPlaceholder: '例如：再近一点、光线更冷、去掉文字、女主看镜头…',
  aiReviseFinalPromptBusy: '改写中…',
  aiReviseFinalPromptNeedOpinion: '请先填写调整意见',
  aiReviseFinalPromptNeedPrompt: '当前最终提示词为空，请先填写或生成',
  aiReviseFinalPromptFailed: 'AI 调整最终提示词失败',
  aiReviseFinalPromptEmpty: '模型未返回有效提示词，请重试或缩短意见',
  aiReviseFinalPromptVoiceStart: '按住说话',
  aiReviseFinalPromptVoiceStop: '松开结束',
  aiReviseFinalPromptVoiceBusy: '正在实时听写…',
  aiReviseFinalPromptMicDenied:
    '无法使用麦克风：请在系统设置中允许本应用访问麦克风，或检查是否被其他程序占用。',
  colRefImages: '参考图',
  pickShotRefImage: '选择参考图',
  addShotRefImage: '添加',
  shotsDurationSummary: '镜头总时长 {sum}s · 歌曲 {music}s',
  shotsDurationMatched: '已对齐',
  shotsDurationMismatch: '未对齐',
  shotsDurationAlign: '对齐歌曲时长',
  colStyleRef: '风格',
  uploading: '上传中…',
  generating: '生成中…',
  backToShots: '返回镜头',
  backToAssets: '返回资产',
  confirmGoAssets: '将根据当前镜头表抽取角色/场景/道具，是否继续？',
  confirmGoPrompts: '仍有资产缺少参考图，确定进入合成提示词？',
  scriptChipLabel: '文本',
  absorbedScript: '已吸收剧本',
  absorbedScriptEmpty: '连接剧本/文本节点以吸收正文，或在下方补充说明后生成',
};

const en: DirectorPipelineStrings = {
  scriptTitle: 'Script',
  scriptPlaceholder: 'Paste or write the screenplay here…',
  directorTitle: 'Director',
  modeScript: 'Script',
  modeMv: 'MV',
  phaseMusic: 'Music upload/analysis',
  phaseStyle: 'Style',
  phaseStory: 'Script',
  phaseCast: 'Cast',
  phaseRatio: 'Aspect',
  phaseVideos: 'Video gen',
  phaseShots: 'Storyboard gen',
  phaseAssets: 'Prepare assets',
  phaseMvScenes: 'Scenes',
  phasePrompts: 'Compose prompts',
  phaseStoryboards: 'Storyboard frames',
  phasePreview: 'Export & share',
  stepOfTotal: 'Step {n}/{total}',
  stepGuideHint: 'Click a step to jump',
  musicPacksCollapse: 'Hide waveforms',
  musicPacksExpand: 'Show waveforms',
  guideMusicStepUpload: 'Upload',
  guideMusicStepDetect: 'Analyze',
  guideMusicStepNext: 'Style',
  guideMusicCtaUpload: 'Step 1: Upload song',
  guideMusicCtaDetect: 'Step 2: Analyze song',
  guideMusicHint: 'Follow the big button at the bottom in order',
  guideMusicSkipDetect: 'Skip, go to style',
  shotsReady: '{n} shots ready',
  assetsProgress: '{ready}/{total} generated, {left} left',
  assetsStepProgress: '{step} {ready}/{total}',
  promptsProgress: '{ready}/{total} composed',
  storyboardsProgress: '{ready}/{total} ready, {left} left',
  afterPartialHint: 'Batch video after storyboards are ready',
  afterPartialHintMv: 'Confirm shots → video table → timeline preview',
  nextPrepareAssets: 'Next: Prepare assets',
  nextGenerateStoryboards: 'Next: Storyboard frames',
  nextPreviewTimeline: 'Next: Timeline preview',
  nextStyle: 'Next: Style selection',
  nextStory: 'Next: Story',
  nextCast: 'Next: Cast',
  nextStoryAfterCast: 'Next: Story',
  nextRatio: 'Next: Aspect ratio',
  nextVideos: 'Next: Video generation',
  generateThisVideo: 'Generate video',
  generatingVideo: 'Generating…',
  generatingStoryboard: 'Generating storyboard…',
  videosHint:
    'Carried from confirm shots: description, storyboard, song clip, camera, framing, lighting, and final prompt',
  nextScenes: 'Next: Scene refs',
  nextMvScenes: 'Next: Scene maps',
  nextShots: 'Next: Storyboard gen',
  step1GenerateShots: 'Step 1: Generate shot list',
  step2PrepareAssets: 'Step 2: Prepare assets',
  step3ComposePrompts: 'Step 3: Compose prompts',
  step4GenerateStoryboards: 'Step 4: Generate storyboards',
  step5SpawnVideos: 'Step 5: Spawn videos',
  previewToSplice: 'Timeline preview',
  previewVideosToSplice: 'Compose video',
  previewVideosHint: 'Place generated videos on the video track and the song on the audio track',
  confirmGenVideos: 'Generate videos & replace clips',
  exportMv: 'Export MV',
  musicChipLabel: 'Music',
  absorbedMusicEmpty: 'Connect an audio node, or fill mood/theme',
  musicTitle: 'Title',
  musicDuration: 'Duration (sec)',
  musicMood: 'Mood / theme',
  musicSummary: 'Analysis summary',
  musicLyrics: 'Lyrics',
  musicLyricsStripMeta: 'AI recognize',
  musicLyricsStripMetaDone: 'Lyrics filled in',
  musicLyricsExtractRunning: 'Recognizing lyrics…',
  musicLyricsExtractFailed: 'Failed to recognize lyrics',
  musicJobCancel: 'Cancel',
  musicLyricsPlaceholder: 'Paste lyrics, or tap AI recognize',
  musicUploadAudio: 'Upload audio',
  musicUploadLyrics: 'Upload lyrics file',
  musicReplaceAudio: 'Replace audio',
  musicClearAudio: 'Clear audio',
  musicDropHint: 'Upload music',
  musicStep1: 'Step 1',
  musicStep2: 'Step 2',
  musicStep3: 'Step 3',
  musicStep1Title: 'Step 1: Upload song',
  musicStep2Title: 'Step 2: Fill in lyrics',
  musicStep3Title: 'Step 3: Song analysis',
  musicStep2Hint: 'Lyrics can be filled in after upload',
  musicAiAnalyzeTitle: 'AI analysis',
  musicAiAnalyzeIdle: 'Analyze automatically after upload',
  musicAiAnalyzeDesc: 'AI analyzes structure, mood, and rhythm to plan your MV',
  musicAnalyzeSummaryEmpty: 'Tap Song analysis to fill this card.',
  musicDimStructure: 'Structure',
  musicDimStructureSub: 'Sections & rhythm',
  musicDimEmotion: 'Emotion',
  musicDimEmotionSub: 'Mood changes',
  musicDimRhythm: 'Rhythm',
  musicDimRhythmSub: 'Beat & tempo',
  musicDimStyle: 'Style',
  musicDimStyleSub: 'Visual match',
  musicDimKeywords: 'Keywords',
  musicDimKeywordsSub: 'From lyrics',
  musicRecommendDuration: 'Suggested length',
  phaseMusicSub: 'Select or upload music',
  phaseStyleSub: 'Pick overall MV style',
  phaseCastSub: 'Pick characters',
  phaseStorySub: 'AI storyboard script',
  phaseMvScenesSub: 'Generate visual assets',
  phaseShotsSub: 'Generate storyboards',
  phaseVideosSub: 'Generate MV video',
  phasePreviewSub: 'Export or share',
  musicDropFormats: 'MP3 / WAV / M4A, max 30MB',
  musicConnectHint: 'For canvas audio, connect the sound node to Director',
  musicNeedFirst: 'Upload or connect music first',
  musicAudioTooLarge: 'Audio must be 30MB or less',
  musicAudioTooLong: 'Audio must be 6 minutes or less',
  musicAudioBadFormat: 'Only MP3 / WAV / M4A are supported',
  castHint: 'Set lead count & gender first, then pick looks — gender follows the slot, no need to tag every library image',
  castFromScriptCount: '{n} from script',
  castSyncFromScript: 'Sync supporting cast',
  castNeedScriptCharacters: 'Generate the script cast list first, or lock leads here',
  castEmptyHint: 'Choose lead count & gender to create lead cards',
  castAddToShot: 'Add cast',
  castPickForShot: 'Pick cast',
  sceneReplaceShot: 'Replace scene',
  castReplaceShot: 'Replace cast',
  castRemoveShot: 'Remove cast',
  castEmptyShotOption: 'Empty shot (no cast)',
  castEmptyShotHint: 'No people in prompt · no cast refs',
  castInstrumentalNoCastHint: 'No vocals can still show cast: back view / walk / follow',
  castGenerateOrCanvas: 'Pick look / Generate / Upload',
  castPickArtwork: 'Pick look',
  castArtworkTitle: 'Choose a look',
  castArtworkHint: 'Tap a cast card above, then pick below',
  castArtworkAssignTo: 'Assigning look to “{name}”',
  castNeedTargetFirst: 'Select or create a lead card first',
  castSelectRoleTitle: 'Lead 1',
  castMoreLooksTitle: 'Lead 2',
  castCustomRole: 'Custom',
  castMoreRoles: 'More looks',
  castRoleIndex: 'Cast {n}',
  castEditRole: 'Edit',
  castUploadRole: 'Upload',
  castRole2DisabledHint: 'Check to enable Lead 2',
  castLeadCountLabel: 'Leads',
  castLeadSolo: '1 lead',
  castLeadDuo: '2 leads',
  castLeadGenderLabel: 'Gender',
  castLeadGenderMale: 'Male',
  castLeadGenderFemale: 'Female',
  castLead1Label: 'Lead 1',
  castLead2Label: 'Lead 2',
  castNeedLeads: 'Set lead count and gender first',
  castLibraryGenderNote: 'Library images need no gender tag — placing into a male/female lead slot sets gender',
  scenesHint: 'List locations from the script, then generate 9-grid empty scene maps (no props)',
  scenesSyncFromScript: 'Sync scenes',
  scenesNeedScript: 'Add a scene list in the Script step first (e.g. Rooftop: …)',
  scenesFromScriptCount: '{n} scenes from script',
  storyHint: 'Turn on Reference gen to draft from notes; off = write the script yourself. Keep a short-drama arc with MV singing/dancing moments',
  storyRefGenSwitchLabel: 'Reference gen',
  storyRefGenOnHint: 'Generate from the reference below (optional — lyrics & analysis still apply)',
  storyManualHint: 'Reference gen is off — edit the sections below yourself',
  closeUpFramingSwitchLabel: 'Close-up',
  closeUpFramingOnHint: 'On: people shots = close-up only (no half/full body); empty shots still use scene formula',
  closeUpFramingOffHint: 'Off: any framing / camera move allowed',
  storyReferenceLabel: 'Reference',
  storyReferencePlaceholder: 'Paste or sketch plot, relationships, scenes, and performance beats (singing/dancing)…',
  storyPlaceholder: 'Edit by section: plot → world → relationships → cast / scenes / props',
  storyAnalyzeTitle: 'Analysis summary',
  storyStyleTitle: 'Song style',
  storyEmotionsLabel: 'Main emotions',
  storyKeywordsLabel: 'Keywords',
  storyScriptKeywordsLabel: 'Script keywords',
  storySectionPlot: 'Plot (beat sheet)',
  storySectionWorldView: 'World view',
  storySectionRelationships: 'Relationships',
  storySectionCharacters: 'Characters',
  storySectionScenes: 'Scenes',
  storySectionProps: 'Props',
  storySectionPlotPh:
    'No|Section|Vocal|Shot type|Scene|Cast|Angle|Focal|Action|Mood\n1|Intro|No vocal|Empty|Courtyard|—|High overhead|24mm spatial|Sunlight on stone table, no people|Setup\n2|Verse|Vocal|Cast|Courtyard|Lead|OTS peek|35mm documentary|Lead mid-close looks afar…|Longing',
  storyPlotBeatSummary: '{n} beats · empty {empty} · with cast {cast}',
  storyPlotBeatColNo: 'No',
  storyPlotBeatColSection: 'Section',
  storyPlotBeatColVocal: 'Vocal',
  storyPlotBeatColCastType: 'Shot type',
  storyPlotBeatColScene: 'Scene',
  storyPlotBeatColCast: 'Cast',
  storyPlotBeatColAngle: 'Angle',
  storyPlotBeatColFocal: 'Focal length',
  storyPlotBeatColAction: 'Action',
  storyPlotBeatColMood: 'Mood',
  storyPlotBeatRawEdit: 'Edit raw table text',
  storySectionWorldViewPh: 'Time, place, mood, visual tone…',
  storySectionRelationshipsPh: 'Who knows whom, past vs present…',
  storySectionCharactersPh: 'One per line: Name: gender, age feel, hair/face, outfit, vibe (image prompt)',
  storySectionScenesPh: 'One per line: ShortName: indoor/outdoor + place + light + props (empty, no people)',
  storySectionPropsPh: 'Key props (optional)…',
  storyAnalyzeBtn: 'Analyze music',
  storyGenerateScriptBtn: 'Generate script',
  storyOneShotBtn: 'Analyze & generate script',
  storyOneShotRunning: 'Generating…',
  storyNeedLyricsOrTitle: 'Add lyrics or a title in the Music step first',
  storyNeedMusicAnalysis: 'Finish song analysis in the Music step first — results fill the cards above',
  storyAnalysisEmpty: 'Song analysis comes from the Music step; go back and re-analyze if empty',
  storyAnalyzeFailed: 'Music analysis failed',
  storyScriptFailed: 'Script generation failed',
  storyAnalyzing: 'Analyzing…',
  storyWriting: 'Writing…',
  ratioHint: 'Aspect ratio locks storyboard frames and video output',
  previewHint: 'Storyboards on the video track, song on the audio track — scrub to check rhythm',
  previewNeedStoryboards: 'Generate storyboard frames before timeline preview',
  oneClickGenerateAssets: 'Generate all assets',
  oneClickComposePrompts: 'Compose all prompts',
  oneClickGenerateStoryboards: 'Generate all storyboards',
  generateThisStoryboard: 'Gen',
  regenerateStoryboard: 'Regenerate',
  colStoryboard: 'Storyboard',
  colShotVideo: 'Video',
  colRefStoryboard: 'Ref storyboard',
  needStoryboardsFirst: 'Generate storyboard frames first',
  confirmSpawnWithoutAllStoryboards: '{n} shots lack storyboards. Generate video only for ready shots?',
  confirmLipsyncGen:
    'Generate {n} shot(s) with LTX2.3 lipsync.\nEach shot needs: storyboard + song clip + prompt.\nGeneration starts only after you confirm.\n\n{detail}',
  confirmLipsyncShotLine: 'Shot {no}: storyboard{sb} · clip{clip} · prompt{prompt}',
  confirmLipsyncMissingTitle:
    'Lipsync inputs incomplete (need storyboard + song clip + prompt). Fix these first:',
  confirmLipsyncPartialSkip: '{n} incomplete shot(s) will be skipped.',
  lipsyncRecommend: '{n} shots have dialogue — recommend LTX lipsync (auto-trims the matching song clip)',
  lipsyncUse: 'Use lipsync',
  lipsyncRevert: 'Restore model',
  lipsyncShotBadge: 'Recommend lipsync (close-up face + dialogue) · click to turn off',
  lipsyncShotBadgeOff: 'Lipsync not recommended · enable if close-up face and dialogue',
  lipsyncShotBadgeClimax: 'Climax-priority lipsync (close-up + dialogue + climax) · click to turn off',
  lipsyncShotBadgeFarWarning: 'Warning: face may be too far for lipsync · force-enable anyway',
  lipsyncToggleLabel: 'Lipsync',
  colLipsync: 'Dialogue',
  colActions: 'Actions',
  sbEmptyGenerateSlot: '+ Storyboard',
  dialoguePillLabel: 'Dialogue',
  downloadStoryboard: 'Download storyboard',
  downloadShotVideo: 'Download video',
  videoMute: 'Mute',
  videoUnmute: 'Unmute',
  colShotAudio: 'Audio clip',
  playShotAudio: 'Play clip',
  shotAudioNeedMusic: 'Connect a song first',
  lyricTimelineDetect: 'Analyze song',
  lyricTimelineRunning: 'Analyzing…',
  lyricTimelineRunningSeparate: 'Separating…',
  lyricTimelineRunningTranscribe: 'Cloud transcription…',
  lyricTimelineRunningStyle: 'Style analysis…',
  lyricTimelineHint: 'Analyze first, then cut by lyrics',
  lyricTimelineReady: '{packs} shots',
  lyricTimelineFailed: 'Song analysis failed',
  lyricTimelineEmpty: 'No usable segments found',
  lyricTimelineNeedEngine:
    'Cloud lyric transcription is unavailable. Sign in and retry, or fully quit and relaunch the app (rebuild main process)',
  lyricTimelineSeparateFallback: 'Vocal separation unavailable; using full mix (may be less accurate)',
  lyricTimelineRecalibrate: 'Cut by lyrics',
  lyricTimelineRecalibrateNeed: 'Analyze the song first',
  lyricTimelineRecalibrateDone: 'Cut done: ~{packs} shots',
  lyricTimelineSectionsTitle: 'Cut by lyrics',
  lyricTimelineSectionPlay: 'Play',
  lyricTimelineSectionNoText: '',
  lyricTimelineClear: 'Clear analysis',
  lyricTimelineDeletePack: 'Delete section',
  musicPacksCompactHint: '',
  clipLengthModeLong: 'Long 10–15s',
  clipLengthModeShort: 'Short 4–6s',
  clipLengthModeHint:
    'Short is strict 4/5/6 (incl. instrumental); split on larger gaps between lines; long uses 10/15',
  shotsConfirmSummaryModel: 'Video model',
  shotsConfirmSummaryModelDurations: 'Supported durations {durs}',
  shotsConfirmSummaryModelLipsync: 'Lipsync: output follows audio clip length (nearest billing tier)',
  shotsConfirmSummaryShots: '{n} shots',
  shotsConfirmSummaryVocals: 'Vocals {v} · Instrumental {i}',
  shotsConfirmSummaryNoTimeline:
    'Song analysis not done in Step 1 — clips may be even-split. Go back and tap the blue analyze button',
  shotsConfirmSummaryLipsync: 'Recommend lipsync for {n} shots',
  shotsConfirmSummaryLipsyncClimax: 'incl. {c} climax-priority',
  shotsConfirmApplyLipsync: 'Apply lipsync by rules',
  shotsConfirmVideoModelLaterHint: 'Pick video model & default duration in the Video step',
  shotAudioHasVocal: 'Vocals',
  shotAudioInstrumental: 'No vocals',
  shotAudioVocalUnknown: 'Unknown',
  backToPrompts: 'Back to prompts',
  assetsStepCharacters: 'Characters',
  assetsStepScenes: 'Scenes',
  assetsStepProps: 'Props',
  nextGenerateScenes: 'Next: Scenes',
  nextGenerateProps: 'Next: Props',
  generateCharactersBatch: 'Generate characters',
  generateScenesBatch: 'Generate scenes',
  generatePropsBatch: 'Generate props',
  backToCharacters: 'Back to characters',
  backToScenes: 'Back to scenes',
  batchSpawnVideos: 'Batch generate videos',
  addShot: '+ Add shot',
  insertShotBefore: 'Insert empty row above',
  insertShotAfter: 'Insert empty row below',
  deleteShot: 'Delete this shot',
  editShotAudioRange: 'Edit audio start/end',
  globalStyle: 'Global style',
  stylePreset: 'Style',
  styleCustomHint: 'Tap a style reference to select; it becomes the global style ref',
  styleLongPressHint: 'Tap to select · Long-press to edit prompt',
  stylePromptEditTitle: 'Edit style prompt',
  stylePromptSave: 'Save',
  stylePromptCancel: 'Cancel',
  styleLibraryTitle: 'Art style',
  styleLibraryTabSystem: 'System',
  styleLibraryTabMine: 'My styles',
  styleLibraryMineEmpty: 'No custom styles yet. Tap Custom to create one.',
  styleLibrarySelected: 'Selected: {name}',
  styleLibraryMore: 'More styles',
  characters: 'Characters',
  scenes: 'Scenes',
  props: 'Props',
  addAsset: 'Add',
  deleteAsset: 'Delete',
  generateOrUpload: 'Generate or upload',
  pickFromCanvas: 'From canvas',
  pickFromLibrary: 'Library',
  pickFromCharacterLibrary: 'Character library',
  pickFromSceneLibrary: 'Scene library',
  sourceMenuTitle: 'Import reference',
  libraryPickTitleCharacter: 'Pick from character library',
  libraryPickTitleScene: 'Pick from scene library',
  libraryPickEmpty: 'No items in library',
  libraryPickLoading: 'Loading…',
  uploadLocal: 'Upload',
  generateThis: 'Generate',
  generateCategory: 'Generate category',
  batchGenerateSceneImages: 'Generate all scene images',
  characterLinkedHint: 'Photoreal 2×2 sheet auto-appended (equal cells, no gutters; hidden in text)',
  sceneLinkedHint: '9-grid rules auto-appended: equal cells, no gaps, no text, empty set (hidden in text)',
  creditsSuffix: 'credits',
  batchVideoYuanbaoHover: '{n} videos for {cost}',
  batchSceneYuanbaoHover: '{n} scene images for {cost}',
  batchStoryboardYuanbaoHover: '{n} storyboards for {cost}',
  priceTooltip: 'Estimated credits = base_price×multiplier×yuanbao_rate×Quantity (nx_model_config first)',
  assetsMonitor: 'Chars {cReady}/{cTotal} · Scenes {sReady}/{sTotal} · Props {pReady}/{pTotal}',
  missingAssetsHint: '{c} characters, {s} scenes, {p} props lack reference images. Upload or batch-generate.',
  batchModalTitle: 'Generate all assets',
  selectedCount: 'Selected {n}/{total}',
  generateN: 'Generate ({n})',
  modelLabel: 'Model',
  chatModelLabel: 'LLM',
  videoBatchModelLabel: 'Video model',
  videoBatchLipsyncModelLabel: 'Lipsync model',
  videoBatchDurationLabel: 'Duration',
  videoBatchRatioLabel: 'Ratio',
  videoBatchResolutionLabel: 'Clarity',
  videoBatchLipsyncResolutionLabel: 'Clarity',
  videoAspectFromStoryboard: 'Ratio (same as storyboard)',
  videoDurationFromShotHint: 'Duration from shot analysis; nearest model option if unsupported',
  videoDurationSnapped: '{shot}→{model}',
  promptPlaceholder: 'Optional directing notes, style, or shot count',
  intentTriggerLabel: 'Optional directing notes, style, or shot count',
  generateShots: 'Generate shots',
  generateFailed: 'Generation failed',
  videoGenInterrupted:
    'Interrupted (app quit). If the platform finished, regenerate or recover from the task list',
  generateNeedScript: 'Please provide a script first',
  generateNeedMusic: 'Connect music and add mood/theme or notes first',
  needShotsFirst: 'Add shots first',
  needAssetsFirst: 'Prepare assets first',
  pendingPrompt: 'Pending prompt',
  viewPrompt: 'View prompt',
  viewImage: 'Click to enlarge',
  colShotNo: 'No.',
  colDuration: 'Dur.',
  colDesc: 'Description',
  colAngleFocal: 'Camera',
  colAngle: 'Angle',
  colFocal: 'Focal length',
  colShotSize: 'Size',
  colLighting: 'Lighting',
  colDialogue: 'Dialogue',
  colSfx: 'SFX',
  colCamera: 'Camera',
  colFinalPrompt: 'Final prompt',
  aiReviseFinalPrompt: 'AI revise',
  aiReviseFinalPromptOpinionPlaceholder:
    'e.g. closer shot, cooler light, remove text, heroine looks at camera…',
  aiReviseFinalPromptBusy: 'Revising…',
  aiReviseFinalPromptNeedOpinion: 'Enter a revision note first',
  aiReviseFinalPromptNeedPrompt: 'Final prompt is empty — fill or generate it first',
  aiReviseFinalPromptFailed: 'Failed to revise final prompt',
  aiReviseFinalPromptEmpty: 'Model returned no usable prompt — retry or shorten the note',
  aiReviseFinalPromptVoiceStart: 'Hold to talk',
  aiReviseFinalPromptVoiceStop: 'Release to finish',
  aiReviseFinalPromptVoiceBusy: 'Live dictation…',
  aiReviseFinalPromptMicDenied:
    'Microphone unavailable. Allow this app in system settings, or check if another app is using the mic.',
  colRefImages: 'Refs',

  pickShotRefImage: 'Pick reference',
  addShotRefImage: 'Add',
  shotsDurationSummary: 'Shots total {sum}s · Song {music}s',
  shotsDurationMatched: 'Matched',
  shotsDurationMismatch: 'Mismatch',
  shotsDurationAlign: 'Align to song',
  colStyleRef: 'Style',
  uploading: 'Uploading…',
  generating: 'Generating…',
  backToShots: 'Back to shots',
  backToAssets: 'Back to assets',
  confirmGoAssets: 'Extract characters/scenes/props from current shots?',
  confirmGoPrompts: 'Some assets still lack images. Continue to compose prompts?',
  scriptChipLabel: 'Text',
  absorbedScript: 'Absorbed script',
  absorbedScriptEmpty: 'Connect a script/text node to absorb content, or add notes below then generate',
};

export function directorPipelineT(locale: AppLocale): DirectorPipelineStrings {
  return locale === 'en' ? en : zh;
}

export function fillDirectorI18n(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? ''));
}
