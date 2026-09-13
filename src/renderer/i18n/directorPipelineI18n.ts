import type { AppLocale } from './settingsI18n';

export type DirectorPipelineStrings = {
  scriptTitle: string;
  scriptPlaceholder: string;
  directorTitle: string;
  modeScript: string;
  /** AI 短剧导演模式 */
  modeDrama: string;
  modeMv: string;
  phaseMusic: string;
  phaseStyle: string;
  phaseStory: string;
  phaseCast: string;
  phaseRatio: string;
  phaseVideos: string;
  /** MV 第 8 步：歌词 / 卡拉OK 字幕 */
  phaseKaraoke: string;
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
  /** 选角完成后进入场景 */
  nextStoryAfterCast: string;
  nextRatio: string;
  nextVideos: string;
  /** 视频生成后进入卡拉OK */
  nextKaraoke: string;
  generateThisVideo: string;
  generatingVideo: string;
  generatingStoryboard: string;
  generatingCharacter: string;
  generatingScene: string;
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
  /** 第 7 步剪辑预览：各镜成片 + 原曲入轨（文案同「剪辑预览」，素材是成片非分镜图） */
  previewVideosToSplice: string;
  previewVideosHint: string;
  confirmGenVideos: string;
  exportMv: string;
  /** 一键卡拉OK字幕 */
  karaokeSubtitles: string;
  karaokeNeedMusicLyrics: string;
  /**
   * 第 7→8 步：无可用成片（全失败/未生成）时仍可进入的确认文案。
   * 产品：不要静默拦住；说清风险后允许进入调歌词。
   */
  confirmEnterKaraokeWithoutVideos: string;
  /** 第 8 步：成片来源 */
  karaokeSourceTitle: string;
  karaokeImportCompose: string;
  karaokeImportComposeHint: string;
  karaokeImportComposeRunning: string;
  karaokeImportComposeFailed: string;
  karaokeUploadVideo: string;
  karaokeUploadVideoHint: string;
  karaokeUploadVideoRunning: string;
  karaokeUploadVideoFailed: string;
  karaokeUploadVideoTooLarge: string;
  karaokeVideoReady: string;
  karaokeVideoEmpty: string;
  karaokeClearVideo: string;
  karaokeClearVideoHint: string;
  karaokeOpenEditor: string;
  karaokeBurnedTitle: string;
  karaokeBurnedEmpty: string;
  /** 第8步识别语言一行说明 */
  karaokeAsrLanguageHint: string;
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
  /** 识别语言（AI识别 / 歌曲分析 / 卡拉OK） */
  musicAsrLanguage: string;
  musicAsrLanguageAuto: string;
  musicAsrLanguageZh: string;
  musicAsrLanguageYue: string;
  musicAsrLanguageHint: string;
  musicAsrLanguageYueTip: string;
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
  /** 歌曲名（开场字幕） */
  musicSongTitle: string;
  musicSongTitlePlaceholder: string;
  /** 作词人 */
  musicLyricist: string;
  /** 作曲人 */
  musicComposer: string;
  /** 作词/作曲空时默认署名 */
  musicCreditDefault: string;
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
  phaseKaraokeSub: string;
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
  castClearPrompt: string;
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
  /** 选角：按故事自动打开的组合提示 */
  castAutoOpenedHint: string;
  castComboSoloFemale: string;
  castComboSoloMale: string;
  castComboDuoMf: string;
  castComboDuoFf: string;
  castComboDuoMm: string;
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
  storyPlotBeatColLipsyncAction: string;
  storyPlotBeatColMood: string;
  storyPlotBeatRawEdit: string;
  storySectionWorldViewPh: string;
  storySectionRelationshipsPh: string;
  storySectionCharactersPh: string;
  storySectionScenesPh: string;
  storySectionPropsPh: string;
  storyAnalyzeBtn: string;
  storyGenerateOutlineBtn: string;
  storyConfirmOutlineBtn: string;
  storyOutlineConfirmedBadge: string;
  storyOutlinePendingBadge: string;
  storyOutlineTitle: string;
  storyOutlineHint: string;
  storyOutlinePlaceholder: string;
  /** 生成故事前：类型/风格/结局偏好 */
  storyPrefsHint: string;
  storyPrefsGenreLabel: string;
  storyPrefsToneLabel: string;
  storyPrefsEndingLabel: string;
  storyPrefsAutoOption: string;
  /** 尚未生成故事时的醒目提示 */
  storyPrefsThenGenerateHint: string;
  storyNeedOutline: string;
  storyNeedConfirmOutline: string;
  storyOutlineFailed: string;
  storyOutlineWriting: string;
  /** 剧本步：撰写剧本中提示 */
  storyScriptWriting: string;
  /** 撰写中点同一按钮取消等待；云端已发出的请求通常仍结算 */
  storyCancelChatHint: string;
  /** 客户端等待超时（约 2 分钟） */
  storyLlmTimeout: string;
  storyGenerateScriptBtn: string;
  /** 分析音乐 + 生成剧本 一次完成 */
  storyOneShotBtn: string;
  storyOneShotRunning: string;
  storyNeedLyricsOrTitle: string;
  storyNeedMusicAnalysis: string;
  storyAnalysisEmpty: string;
  storyAnalyzeFailed: string;
  storyScriptFailed: string;
  /** 短剧三步台：剧本解析 → 分镜导演 → 生成视频 */
  dramaConfirmShots: string;
  regenerateShots: string;
  batchGenerateStoryboardsToolbar: string;
  batchGenerateVideosToolbar: string;
  globalStyleLabel: string;
  globalStylePlaceholder: string;
  dramaFlowHint: string;
  dramaPhaseStory: string;
  dramaPhaseStorySub: string;
  dramaPhaseShots: string;
  dramaPhaseShotsSub: string;
  dramaPhaseAnalyze: string;
  dramaPhaseAnalyzeSub: string;
  dramaPhaseStoryboard: string;
  dramaPhaseStoryboardSub: string;
  dramaPhaseAssets: string;
  dramaPhaseAssetsSub: string;
  dramaPhaseVideo: string;
  dramaPhaseVideoSub: string;
  dramaAnalyzeHint: string;
  dramaAnalyzeLinkedScript: string;
  dramaAnalyzeBtn: string;
  dramaAnalyzeDoneSummary: string;
  dramaNextStoryboard: string;
  dramaNextAssets: string;
  dramaNextVideos: string;
  dramaGenerateOrUploadCharacter: string;
  dramaGenerateOrUploadScene: string;
  dramaGenerateOrUploadProp: string;
  dramaGenerateOrUploadCreature: string;
  dramaAddNew: string;
  dramaStatusPending: string;
  dramaStatusAnalyzeDone: string;
  dramaStatusAnalyzeAndShotsDone: string;
  dramaStorySourceLabel: string;
  dramaStorySourcePlaceholder: string;
  dramaStoryGenerate: string;
  dramaStoryNeedSource: string;
  dramaStoryGenerating: string;
  dramaStoryReadySummary: string;
  dramaStoryPlotPreview: string;
  dramaStoryScriptPreview: string;
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
  /** 视频/分镜步：从历史版本里选当前参考分镜图 */
  storyboardPickVersion: string;
  /** 视频步：从历史版本里选当前成片 */
  videoPickVersion: string;
  colStoryboard: string;
  colShotVideo: string;
  /** 视频生成表：参考分镜图列 */
  colRefStoryboard: string;
  /** 视频生成表：本镜绑定角色列 */
  colShotCast: string;
  /** 对口型旁：标明跟唱主体 */
  lipsyncCastSubject: string;
  needStoryboardsFirst: string;
  confirmSpawnWithoutAllStoryboards: string;
  /** 批量生视频：全部已有成片，无需再跑 */
  batchSpawnVideosAllReady: string;
  /** 一键生视频：同时进行中上限（超出排队） */
  mvVideoBatchCapped: string;
  /** Skill 改写进度 */
  videoSkillRewriteProgress: string;
  videoSkillRewriteWaveWait: string;
  videoSkillRewriteFailed: string;
  videoSkillRewriteBatchSummary: string;
  videoSkillRewriteGuideMissing: string;
  /** 视频步：Skill 改写用的大模型 */
  videoSkillModelHint: string;
  videoOptimizePrompt: string;
  videoOptimizePromptBusy: string;
  videoOptimizePromptBatch: string;
  videoRebuildPromptFromScript: string;
  videoRebuildPromptFromScriptBatch: string;
  videoRebuildPromptFromScriptHint: string;
  confirmRebuildPromptFromScriptBatch: string;
  videoRebuildPromptDone: string;
  videoPromptOriginal: string;
  videoPromptOptimized: string;
  videoPromptUseOriginal: string;
  videoPromptUseOptimized: string;
  videoPromptUsingOriginal: string;
  videoPromptUsingOptimized: string;
  videoPromptNoOptimized: string;
  videoPromptOptimizeNeedText: string;
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
  /** 第 7 步：成片悬停出声总开关 */
  videoHoverSoundLabel: string;
  videoHoverSoundHint: string;
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
  /** 云端转写未登录且余额够 */
  asrNeedLoginBalanceOk: string;
  /** 云端转写未登录 */
  asrNeedLogin: string;
  goLogin: string;
  asrBalanceInsufficient: string;
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
  /** 镜头变化：三档 */
  shotChangePaceLabel: string;
  shotChangePaceFast: string;
  shotChangePaceNormal: string;
  shotChangePaceSlow: string;
  shotChangePaceHint: string;
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
  assetsStepCreatures: string;
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
  /** 自定义风格参考图标题 */
  styleRefImageLabel: string;
  styleRefImageClear: string;
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
  /** 宠物 / 怪物等非人类生物 */
  creatures: string;
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
  /** 第 7 步成片格：拖入本地视频提示 */
  shotVideoDropHint: string;
  /** 第 7 步成片格：拖入非视频文件 */
  shotVideoDropUnsupported: string;
  generateOrUpload: string;
  generateThis: string;
  generateCategory: string;
  generateAllCharacters: string;
  generateAllScenes: string;
  generateAllProps: string;
  generateAllCreatures: string;
  /** MV 场景步：批量生成场景图 */
  batchGenerateSceneImages: string;
  /** 角色卡：隐藏链接提示（不展示正文） */
  characterLinkedHint: string;
  sceneLinkedHint: string;
  creditsSuffix: string;
  /** 无 OTS 云端价时禁止生成（弹窗仅提示登录） */
  otsPriceRequired: string;
  /** 批量生成视频按钮悬停价签；{n}=条数，{cost}=已含单位的总价（如 384元宝 / 384 credits） */
  batchVideoYuanbaoHover: string;
  /** 一键生成场景图按钮悬停价签；{n}=张数，{cost}=已含单位的总价 */
  batchSceneYuanbaoHover: string;
  /** 全部生成分镜图按钮悬停价签；{n}=张数，{cost}=已含单位的总价 */
  batchStoryboardYuanbaoHover: string;
  priceTooltip: string;
  assetsMonitor: string;
  missingAssetsHint: string;
  /** 短剧资产：含生物 */
  dramaMissingAssetsHint: string;
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
  /** 剧本已更新：单镜受控刷新提示词与素材匹配 */
  scriptPromptsStaleUpdate: string;
  scriptPromptsStaleHint: string;
  scriptPromptsStaleBanner: string;
  scriptPromptsUpdatedToast: string;
  scriptPromptsUpdateAllStale: string;
  colShotNo: string;
  colDuration: string;
  colDesc: string;
  /** 短剧导演本：画面动作（同画面描述列） */
  colAction: string;
  /** 确认镜头：角度+焦距合并列 */
  colAngleFocal: string;
  colAngle: string;
  /** 短剧：机位/角度 */
  colAngleCamera: string;
  colFocal: string;
  colShotSize: string;
  colLighting: string;
  /** 短剧导演本：情绪（同光影氛围列） */
  colMood: string;
  colDialogue: string;
  /** 短剧导演本：对白列（强调角色名:台词） */
  colDialogueSpeaker: string;
  colSfx: string;
  colCamera: string;
  colFinalPrompt: string;
  /** 短剧场次层 */
  colSceneNo: string;
  colIntExt: string;
  colDayNight: string;
  colLocation: string;
  colCastOn: string;
  /** 短剧制作层 */
  colProdNotes: string;
  colContinuity: string;
  colRefBind: string;
  layerScene: string;
  layerShot: string;
  layerProd: string;
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
  directorTitle: 'MV导演',
  modeScript: '剧本',
  modeDrama: '短剧',
  modeMv: 'MV',
  phaseMusic: '音乐上传/分析',
  phaseStyle: '风格选择',
  phaseStory: '脚本生成',
  phaseCast: '选角',
  phaseRatio: '画幅',
  phaseVideos: '视频生成',
  phaseKaraoke: '歌词/卡拉OK',
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
  afterPartialHintMv: '分镜生成→视频生成→卡拉OK',
  nextPrepareAssets: '下一步：准备资产',
  nextGenerateStoryboards: '下一步：生成分镜图',
  nextPreviewTimeline: '下一步：入剪辑轨预览',
  nextStyle: '下一步：风格选择',
  nextStory: '下一步：写剧本',
  nextCast: '下一步：选角色',
  nextStoryAfterCast: '下一步：风格选择',
  nextRatio: '下一步：选画幅',
  nextVideos: '下一步：视频生成',
  nextKaraoke: '下一步：歌词/卡拉OK',
  generateThisVideo: '生成视频',
  generatingVideo: '生成中…',
  generatingStoryboard: '分镜生成中…',
  generatingCharacter: '角色生成中…',
  generatingScene: '场景生成中…',
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
  previewVideosToSplice: '剪辑预览',
  previewVideosHint: '将各镜成片按镜头顺序铺到视频轨，原曲铺到音轨',
  confirmGenVideos: '确认生成视频并替换轨',
  exportMv: '导出 MV',
  karaokeSubtitles: '卡拉OK字幕',
  karaokeNeedMusicLyrics: '请先上传歌曲并填写歌词',
  confirmEnterKaraokeWithoutVideos:
    '当前没有可用成片（生成失败或尚未生成）。仍可进入第 8 步调整歌词时间轴；烧录到视频前请先上传成片，或完成剪辑预览导出。',
  karaokeSourceTitle: '成片来源',
  karaokeImportCompose: '导入合成成片',
  karaokeImportComposeHint: '从关联剪辑轨导出合成 MV 作为字幕底片',
  karaokeImportComposeRunning: '正在导出合成成片…',
  karaokeImportComposeFailed: '未能导入合成成片，请先完成剪辑预览导出或改用上传',
  karaokeUploadVideo: '上传本地成片',
  karaokeUploadVideoHint: '支持 MP4 / WEBM / MOV，单文件最大 800MB',
  karaokeUploadVideoRunning: '正在导入成片…',
  karaokeUploadVideoFailed: '导入成片失败，请重试或换用较小文件',
  karaokeUploadVideoTooLarge: '成片过大（最大 800MB），请压缩后再上传',
  karaokeVideoReady: '已选定成片',
  karaokeVideoEmpty: '尚未选定成片（可导入合成结果或上传）',
  karaokeClearVideo: '清除成片',
  karaokeClearVideoHint: '清除当前成片后可重新导入或上传',
  karaokeOpenEditor: '打开卡拉OK编辑器',
  karaokeBurnedTitle: '烧录结果',
  karaokeBurnedEmpty: '烧录完成后会挂回本步，并在画布生成视频节点',
  karaokeAsrLanguageHint: '字级对齐时传给云端 fun-asr（歌词以第 1 步为准）。',
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
  musicAsrLanguage: '识别语言',
  musicAsrLanguageAuto: '自动',
  musicAsrLanguageZh: '普通话',
  musicAsrLanguageYue: '粤语',
  musicAsrLanguageHint: 'AI识别与歌曲分析会传给云端 fun-asr；第8步卡拉OK默认跟随。',
  musicAsrLanguageYueTip:
    '局限：fun-asr 含粤语能力，但文件转写文档未正式列 yue；将尽量传 yue。不准时请用带时间戳的粤语 LRC。',
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
  musicSongTitle: '歌曲名',
  musicSongTitlePlaceholder: '填写歌曲名（开场居中显示）',
  musicLyricist: '作词人',
  musicComposer: '作曲人',
  musicCreditDefault: '致音',
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
  phaseStorySub: '先写故事与分段剧本',
  phaseStyleSub: '选择MV整体风格',
  phaseCastSub: '按剧本人物库选角',
  phaseMvScenesSub: '生成视觉素材',
  phaseShotsSub: '生成分镜图',
  phaseVideosSub: '生成MV视频',
  phaseKaraokeSub: '成片歌词字幕',
  phasePreviewSub: '导出或分享作品',
  musicDropFormats: '支持 MP3 / WAV / M4A，最大 80MB',
  musicConnectHint: '画布上的歌曲请把声音节点连到导演即可吸收',
  musicNeedFirst: '请先上传或接入音乐',
  musicAudioTooLarge: '音频文件不能超过 80MB',
  musicAudioTooLong: '音频时长不能超过 6 分钟',
  musicAudioBadFormat: '仅支持 MP3 / WAV / M4A',
  castHint: '先定主角人数与性别，再为每个主角选形象；性别跟槽位走，不必给素材库每张图单独标性别',
  castFromScriptCount: '剧本识别到 {n} 人',
  castSyncFromScript: '从剧本同步人物',
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
  castClearPrompt: '清空提示词',
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
  castAutoOpenedHint: '已按故事自动打开：{combo}（可自行修改）',
  castComboSoloFemale: '单个女主',
  castComboSoloMale: '单个男主',
  castComboDuoMf: '一男一女',
  castComboDuoFf: '两个女主',
  castComboDuoMm: '两个男主',
  scenesHint: '根据剧本场景库列出地点，再一键生成单张空场景参考图（不生成道具）',
  scenesSyncFromScript: '同步场景',
  scenesNeedScript: '请先在「剧本」步骤填写场景库（如：天台：……）',
  scenesFromScriptCount: '剧本识别到 {n} 个场景',
  storyHint: '流程：①选故事类型/风格/结局 → ②生成故事 → ③生成分段剧本。「参考生成」只影响故事；剧本按当前故事展开。',
  storyRefGenSwitchLabel: '参考生成',
  storyRefGenOnHint: '仅影响「生成故事」：优先按下方参考写故事；歌词与分析只调情绪。不影响「生成剧本」',
  storyManualHint: '已关闭参考生成：故事按歌词与歌曲分析生成。「生成剧本」直接用当前故事',
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
  storyPlotBeatColLipsyncAction: '对口型动作',
  storyPlotBeatColMood: '情绪',
  storyPlotBeatRawEdit: '编辑原始表格文本',
  storySectionWorldViewPh: '时空、氛围、视觉基调…',
  storySectionRelationshipsPh: '谁与谁、过往与当下…',
  storySectionCharactersPh: '一人一行：姓名：性别，年龄感，五官发型，服装，气质（可直接作生图 prompt）',
  storySectionScenesPh: '一景一行：短名：室内外 + 地点 + 光色 + 陈设（无人物空场景，供单张场景定妆）',
  storySectionPropsPh: '关键道具，可空…',
  storyAnalyzeBtn: 'AI 分析音乐',
  storyGenerateOutlineBtn: '生成故事',
  storyConfirmOutlineBtn: '确认故事',
  storyOutlineConfirmedBadge: '已确认',
  storyOutlinePendingBadge: '待确认',
  storyOutlineTitle: '故事',
  storyOutlineHint: '先选类型/风格/结局（可选「AI 自选」），生成故事后即可直接生成下方分段剧本',
  storyOutlinePlaceholder: '',
  storyPrefsHint: '生成前请选择短剧偏好；留空「AI 自选」则由模型根据歌词推断',
  storyPrefsGenreLabel: '类型',
  storyPrefsToneLabel: '风格',
  storyPrefsEndingLabel: '结局',
  storyPrefsAutoOption: 'AI 自选',
  storyPrefsThenGenerateHint: '选好类型/风格/结局后，请先点右上角「生成故事」——故事出来后才能确认并生成剧本',
  storyNeedOutline: '请先生成故事',
  storyNeedConfirmOutline: '请先确认故事，再生成分段剧本',
  storyOutlineFailed: '故事生成失败',
  storyOutlineWriting: '撰写故事中…',
  storyScriptWriting: '撰写剧本中…',
  storyCancelChatHint:
    '取消后界面立即恢复。请求若已发往云端，费用通常仍会结算（上游失败/超时会自动退回；成功但本地已取消则可能已扣费）',
  storyLlmTimeout:
    '大模型响应超时或网络中断。请检查网络后重试；段数很多时可先切「长镜」减少片段。上游失败会自动退费；若上游已成功则可能已扣费',
  storyGenerateScriptBtn: '生成剧本',
  storyOneShotBtn: '一键分析并生成剧本',
  storyOneShotRunning: '生成中…',
  storyNeedLyricsOrTitle: '请先在「音乐」步骤填写歌词或曲名',
  storyNeedMusicAnalysis: '请先在「音乐」步骤完成歌曲分析，分析结果会自动填入上方',
  storyAnalysisEmpty: '歌曲分析来自「音乐」步骤；若为空请返回上一步重新分析',
  storyAnalyzeFailed: '音乐分析失败',
  storyScriptFailed: '剧本生成失败',
  dramaConfirmShots: '确认镜头',
  regenerateShots: '重新生成',
  batchGenerateStoryboardsToolbar: '批量生成分镜',
  batchGenerateVideosToolbar: '批量生成视频',
  globalStyleLabel: '全局风格',
  globalStylePlaceholder: '描述全片视觉风格、画风、光影与色彩倾向…',
  dramaFlowHint: '流程：①剧本解析 → ②准备资产 → ③生成视频',
  dramaPhaseStory: '剧本解析',
  dramaPhaseStorySub: '吸收文本 → AI 分析',
  dramaPhaseShots: '分镜导演',
  dramaPhaseShotsSub: '核对镜头表与提示词',
  dramaPhaseAnalyze: '剧本分析',
  dramaPhaseAnalyzeSub: '吸收文本 → AI 分析 → 资产草稿',
  dramaPhaseStoryboard: '分镜导演',
  dramaPhaseStoryboardSub: '镜头表与视觉指令',
  dramaPhaseAssets: '参考图',
  dramaPhaseAssetsSub: '人物 / 场景 / 道具 / 生物 / 声音',
  dramaPhaseVideo: '生成视频',
  dramaPhaseVideoSub: '生成包 → MiniMax H3',
  dramaAnalyzeHint:
    '第一步：把左侧文本节点连进来，或直接粘贴剧本。点击「开始分析」后，会拆出角色、场景与分镜草案。',
  dramaAnalyzeLinkedScript: '已从连线文本节点吸收剧本，可直接分析或先编辑。',
  dramaAnalyzeBtn: '开始分析',
  dramaAnalyzeDoneSummary: '解析完成：角色 {cast} · 场景 {scenes} · 分镜 {shots}',
  dramaNextStoryboard: '下一步：分镜导演',
  dramaNextAssets: '下一步：准备资产',
  dramaNextVideos: '下一步：生成视频',
  dramaMissingAssetsHint: '检测到有 {c} 个角色、{s} 个场景、{p} 个道具、{b} 个生物没有视觉图，可手动上传或 AI 一键生成',
  dramaGenerateOrUploadCharacter: '生成或上传角色图',
  dramaGenerateOrUploadScene: '生成或上传场景图',
  dramaGenerateOrUploadProp: '生成或上传道具图',
  dramaGenerateOrUploadCreature: '生成或上传生物图',
  dramaAddNew: '新增',
  dramaStatusPending: '待解析剧本',
  dramaStatusAnalyzeDone: '已完成剧本解析',
  dramaStatusAnalyzeAndShotsDone: '已完成剧本解析及分镜生成',
  dramaStorySourceLabel: '小说 / 剧本草稿',
  dramaStorySourcePlaceholder:
    '粘贴剧本、小说或梗概。分析后得到角色、场景与分镜草案，再进入「分镜导演」核对镜头表。',
  dramaStoryGenerate: '开始分析',
  dramaStoryNeedSource: '请先连接文本节点或粘贴剧本草稿',
  dramaStoryGenerating: '正在分析剧本…',
  dramaStoryReadySummary: '已就绪：角色 {cast} · 场景 {scenes} · 分镜草案 {shots}',
  dramaStoryPlotPreview: '剧情分段表（草案）',
  dramaStoryScriptPreview: '剧本摘要',
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
  storyboardPickVersion: '选择分镜图',
  videoPickVersion: '选择成片',
  colStoryboard: '分镜图',
  colShotVideo: '成片',
  colRefStoryboard: '参考分镜图',
  colShotCast: '本镜角色',
  lipsyncCastSubject: '对口型：{name}',
  needStoryboardsFirst: '请先生成分镜图',
  confirmSpawnWithoutAllStoryboards: '仍有 {n} 镜缺少分镜图，仅对已生成的镜头生成视频？',
  batchSpawnVideosAllReady: '所有镜头已有成片，已跳过。如需重跑请点单镜「重新生成」。',
  mvVideoBatchCapped: '同时最多跑 {n} 条视频，已提交本批；剩余 {left} 条已排队，完成后自动继续。',
  videoSkillRewriteProgress: '正在优化提示词 {cur}/{total}…',
  videoSkillRewriteWaveWait: '已完成 {cur}/{total}，{sec} 秒后继续下一批…',
  videoSkillRewriteFailed: '镜{no} 提示词优化失败，已保留原版',
  videoSkillRewriteBatchSummary:
    '已优化 {ok} 镜。未完成 {fail} 镜（{nos}）。请再点「批量优化提示词」，或对未变绿的镜头点「优化提示词」。',
  videoSkillRewriteGuideMissing: '无法读取 MiniMax Skill 指南，请稍后重试',
  videoSkillModelHint: '用于手动优化 MiniMax Skill 提示词，与生成视频分开',
  videoOptimizePrompt: '优化提示词',
  videoOptimizePromptBusy: '优化中…',
  videoOptimizePromptBatch: '批量优化提示词',
  videoRebuildPromptFromScript: '更新提示词',
  videoRebuildPromptFromScriptBatch: '更新提示词',
  videoRebuildPromptFromScriptHint:
    '用当前剧本剧情表和镜头脚本重新拼出原版提示词，并清空优化稿。不重跑分镜图和成片。',
  confirmRebuildPromptFromScriptBatch:
    '将用剧本和镜头脚本重新拼出全部提示词，并清空当前优化稿。分镜图和成片不会重跑。确定？',
  videoRebuildPromptDone: '已更新提示词',
  videoPromptOriginal: '原版提示词',
  videoPromptOptimized: '优化后提示词',
  videoPromptUseOriginal: '使用原版',
  videoPromptUseOptimized: '使用优化稿',
  videoPromptUsingOriginal: '当前使用原版',
  videoPromptUsingOptimized: '当前使用优化稿',
  videoPromptNoOptimized: '尚未优化，请先点「优化提示词」',
  videoPromptOptimizeNeedText: '请先写好最终提示词再优化',
  confirmLipsyncGen:
    '即将用 LTX2.3 对口型生成 {n} 镜。\n每镜须同时传入：分镜图 + 歌曲片段 + 提示词。\n确认后才会开始生成；取消则不创建、不生成。\n\n{detail}',
  confirmLipsyncShotLine: '镜{no}：分镜{sb} · 歌曲片段{clip} · 提示词{prompt}',
  confirmLipsyncMissingTitle:
    '对口型所需材料不齐（须同时有分镜图、歌曲片段、提示词），请补齐后再生成：',
  confirmLipsyncPartialSkip: '其中 {n} 镜材料不齐将跳过。',
  lipsyncRecommend: '有 {n} 镜含对白，建议开启对口型（将自动裁剪对应歌曲片段）',
  lipsyncUse: '改用对口型',
  lipsyncRevert: '恢复原模型',
  lipsyncShotBadge: '对口型开：提示词要求跟唱口型 · 点击关闭后角色保持沉默、不要说话',
  lipsyncShotBadgeOff: '对口型关：提示词要求角色保持沉默、不要说话 · 点击开启',
  lipsyncShotBadgeClimax: '高潮对口型开：提示词要求跟唱口型 · 点击关闭后角色保持沉默、不要说话',
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
  videoHoverSoundLabel: '声音总开关',
  videoHoverSoundHint: '开启后，鼠标移到任意成片即可听到声音（同时只播一个）',
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
  asrNeedLoginBalanceOk: '云端转写需要登录，余额充足，是否前往登录？',
  asrNeedLogin: '云端转写需要登录，是否前往登录？',
  goLogin: '前往登录',
  asrBalanceInsufficient:
    '元宝不足，请充值',
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
  shotChangePaceLabel: '镜头变化',
  shotChangePaceFast: '快速 0.8s · 激烈',
  shotChangePaceNormal: '普通 1.2s · 叙事',
  shotChangePaceSlow: '慢速 2.0s · 抒情',
  shotChangePaceHint:
    '写入剧本/成片提示词的动作时轴切段密度：激烈更密、叙事适中、抒情更疏',
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
  assetsStepCreatures: '生成生物',
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
  styleCustomHint: '写光色/氛围描述；可上传或从画布选择参考图（只参考光色，画风固定真人写实）',
  styleLongPressHint: '点击选择 · 长按编辑提示词',
  stylePromptEditTitle: '编辑风格提示词',
  styleRefImageLabel: '风格参考图',
  styleRefImageClear: '清除参考图',
  stylePromptSave: '保存',
  stylePromptCancel: '取消',
  styleLibraryTitle: '艺术风格',
  styleLibraryTabSystem: '影视风格',
  styleLibraryTabMine: '我的风格',
  styleLibraryMineEmpty: '还没有自定义风格，点「自定义」创建',
  styleLibrarySelected: '已选：{name}',
  styleLibraryMore: '更多风格',
  characters: '角色',
  scenes: '场景',
  props: '道具',
  creatures: '生物',
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
  shotVideoDropHint: '拖入本地视频替换本镜成片（MP4 / MOV / WEBM）',
  shotVideoDropUnsupported: '仅支持视频文件（MP4 / MOV / WEBM 等）',
  generateThis: '生成',
  generateCategory: '生成本类',
  generateAllCharacters: '生成所有角色',
  generateAllScenes: '生成所有场景',
  generateAllProps: '生成所有道具',
  generateAllCreatures: '生成所有生物',
  batchGenerateSceneImages: '一键生成所有场景图',
  characterLinkedHint: '生成时自动附加真人写实四宫格（等大、无分界线；正文不显示）',
  sceneLinkedHint: '生成时自动附加单张场景约束：空场景、无文字、禁止九宫格拼贴（正文不显示）',
  creditsSuffix: '元宝',
  otsPriceRequired: '请登录',
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
  scriptPromptsStaleUpdate: '更新',
  scriptPromptsStaleHint: '剧本已更新：刷新本镜提示词与素材匹配（不重跑分镜图/成片；手改内容会保留）',
  scriptPromptsStaleBanner:
    '剧本已更新，{n} 镜提示词过期。可在编号下点「更新」，或「全部更新过期镜」（不重跑图/视频）',
  scriptPromptsUpdatedToast: '已更新提示词与素材匹配',
  scriptPromptsUpdateAllStale: '全部更新过期镜',
  colShotNo: '编号',
  colDuration: '时长',
  colDesc: '画面描述',
  colAction: '画面动作',
  colAngleFocal: '机位',
  colAngle: '镜头角度',
  colAngleCamera: '机位/角度',
  colFocal: '焦距',
  colShotSize: '景别',
  colLighting: '光影氛围',
  colMood: '情绪',
  colDialogue: '对白/旁白',
  colDialogueSpeaker: '对白',
  colSfx: '音效',
  colCamera: '运镜',
  colFinalPrompt: '最终提示词',
  colSceneNo: '场号',
  colIntExt: '内外景',
  colDayNight: '日夜',
  colLocation: '地点',
  colCastOn: '出场人物',
  colProdNotes: '服装/化妆/道具/特效',
  colContinuity: '连贯性',
  colRefBind: '参考图绑定',
  layerScene: '场次层',
  layerShot: '镜头层',
  layerProd: '制作层',
  aiReviseFinalPrompt: 'AI 调整',
  aiReviseFinalPromptOpinionPlaceholder: '局部：再近一点、光线更冷…｜整段：写「全部重写：…」可彻底重写',
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
  directorTitle: 'MV Director',
  modeScript: 'Script',
  modeDrama: 'Drama',
  modeMv: 'MV',
  phaseMusic: 'Music upload/analysis',
  phaseStyle: 'Style',
  phaseStory: 'Script',
  phaseCast: 'Cast',
  phaseRatio: 'Aspect',
  phaseVideos: 'Video gen',
  phaseKaraoke: 'Lyrics / Karaoke',
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
  afterPartialHintMv: 'Confirm shots → video table → karaoke',
  nextPrepareAssets: 'Next: Prepare assets',
  nextGenerateStoryboards: 'Next: Storyboard frames',
  nextPreviewTimeline: 'Next: Timeline preview',
  nextStyle: 'Next: Style selection',
  nextStory: 'Next: Story',
  nextCast: 'Next: Cast',
  nextStoryAfterCast: 'Next: Style selection',
  nextRatio: 'Next: Aspect ratio',
  nextVideos: 'Next: Video generation',
  nextKaraoke: 'Next: Lyrics / Karaoke',
  generateThisVideo: 'Generate video',
  generatingVideo: 'Generating…',
  generatingStoryboard: 'Generating storyboard…',
  generatingCharacter: 'Generating character…',
  generatingScene: 'Generating scene…',
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
  previewVideosToSplice: 'Timeline preview',
  previewVideosHint: 'Place finished shot videos on the video track and the song on the audio track',
  confirmGenVideos: 'Generate videos & replace clips',
  exportMv: 'Export MV',
  karaokeSubtitles: 'Karaoke subtitles',
  karaokeNeedMusicLyrics: 'Upload a song and lyrics first',
  confirmEnterKaraokeWithoutVideos:
    'No finished shot videos yet (failed or not generated). You can still open step 8 to edit lyrics timing; upload a video or finish timeline preview export before burning.',
  karaokeSourceTitle: 'MV source',
  karaokeImportCompose: 'Import composed MV',
  karaokeImportComposeHint: 'Export the linked timeline as the karaoke base video',
  karaokeImportComposeRunning: 'Exporting composed MV…',
  karaokeImportComposeFailed: 'Could not import composed MV — finish timeline preview export or upload a file',
  karaokeUploadVideo: 'Upload local video',
  karaokeUploadVideoHint: 'MP4 / WEBM / MOV, max 800MB',
  karaokeUploadVideoRunning: 'Importing video…',
  karaokeUploadVideoFailed: 'Failed to import video — retry or use a smaller file',
  karaokeUploadVideoTooLarge: 'Video too large (max 800MB). Compress and try again',
  karaokeVideoReady: 'Video selected',
  karaokeVideoEmpty: 'No video yet — import composed MV or upload',
  karaokeClearVideo: 'Clear video',
  karaokeClearVideoHint: 'Clear the current video so you can import or upload again',
  karaokeOpenEditor: 'Open karaoke editor',
  karaokeBurnedTitle: 'Burned result',
  karaokeBurnedEmpty: 'After burning, the result appears here and as a canvas video node',
  karaokeAsrLanguageHint: 'Sent to cloud fun-asr for word-level align (lyrics from step 1).',
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
  musicAsrLanguage: 'ASR language',
  musicAsrLanguageAuto: 'Auto',
  musicAsrLanguageZh: 'Mandarin',
  musicAsrLanguageYue: 'Cantonese',
  musicAsrLanguageHint:
    'Used by AI recognize and song analysis (fun-asr). Karaoke step 8 follows this by default.',
  musicAsrLanguageYueTip:
    'Limit: fun-asr covers Cantonese, but file-transcribe docs omit yue — we still send yue. Prefer timed Cantonese LRC if accuracy is poor.',
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
  musicSongTitle: 'Song title',
  musicSongTitlePlaceholder: 'Song title (opening credits)',
  musicLyricist: 'Lyricist',
  musicComposer: 'Composer',
  musicCreditDefault: '致音',
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
  phaseStorySub: 'Story & beat-sheet first',
  phaseStyleSub: 'Pick overall MV style',
  phaseCastSub: 'Cast from script characters',
  phaseMvScenesSub: 'Generate visual assets',
  phaseShotsSub: 'Generate storyboards',
  phaseVideosSub: 'Generate MV video',
  phaseKaraokeSub: 'Lyrics karaoke burn',
  phasePreviewSub: 'Export or share',
  musicDropFormats: 'MP3 / WAV / M4A, max 80MB',
  musicConnectHint: 'For canvas audio, connect the sound node to Director',
  musicNeedFirst: 'Upload or connect music first',
  musicAudioTooLarge: 'Audio must be 80MB or less',
  musicAudioTooLong: 'Audio must be 6 minutes or less',
  musicAudioBadFormat: 'Only MP3 / WAV / M4A are supported',
  castHint: 'Set lead count & gender first, then pick looks — gender follows the slot, no need to tag every library image',
  castFromScriptCount: '{n} from script',
  castSyncFromScript: 'Sync cast from script',
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
  castClearPrompt: 'Clear prompt',
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
  castAutoOpenedHint: 'Opened from story: {combo} (you can change this)',
  castComboSoloFemale: '1 female lead',
  castComboSoloMale: '1 male lead',
  castComboDuoMf: '1 male + 1 female',
  castComboDuoFf: '2 female leads',
  castComboDuoMm: '2 male leads',
  scenesHint: 'List locations from the script, then generate single empty scene plates (no props)',
  scenesSyncFromScript: 'Sync scenes',
  scenesNeedScript: 'Add a scene list in the Script step first (e.g. Rooftop: …)',
  scenesFromScriptCount: '{n} scenes from script',
  storyHint: 'Flow: ① Genre/tone/ending → ② Story → ③ Beat-sheet. Reference gen affects story only; script uses the current story.',
  storyRefGenSwitchLabel: 'Reference gen',
  storyRefGenOnHint: 'Affects Generate story only: prefer the reference below; lyrics/analysis color mood. Does not affect Generate script',
  storyManualHint: 'Reference gen off: story from lyrics & analysis. Generate script uses the current story directly',
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
  storyPlotBeatColLipsyncAction: 'Lipsync action',
  storyPlotBeatColMood: 'Mood',
  storyPlotBeatRawEdit: 'Edit raw table text',
  storySectionWorldViewPh: 'Time, place, mood, visual tone…',
  storySectionRelationshipsPh: 'Who knows whom, past vs present…',
  storySectionCharactersPh: 'One per line: Name: gender, age feel, hair/face, outfit, vibe (image prompt)',
  storySectionScenesPh: 'One per line: ShortName: indoor/outdoor + place + light + props (empty, no people)',
  storySectionPropsPh: 'Key props (optional)…',
  storyAnalyzeBtn: 'Analyze music',
  storyGenerateOutlineBtn: 'Generate story',
  storyConfirmOutlineBtn: 'Confirm story',
  storyOutlineConfirmedBadge: 'Confirmed',
  storyOutlinePendingBadge: 'Pending confirm',
  storyOutlineTitle: 'Story',
  storyOutlineHint: 'Pick genre/tone/ending (or Auto), generate the story, then generate the beat-sheet below',
  storyOutlinePlaceholder: '',
  storyPrefsHint: 'Choose short-drama prefs before generating; leave Auto to let the model infer from lyrics',
  storyPrefsGenreLabel: 'Genre',
  storyPrefsToneLabel: 'Tone',
  storyPrefsEndingLabel: 'Ending',
  storyPrefsAutoOption: 'Auto',
  storyPrefsThenGenerateHint:
    'After picking prefs, click Generate story (top-right) — then confirm and generate the script',
  storyNeedOutline: 'Generate the story first',
  storyNeedConfirmOutline: 'Confirm the story before generating the beat-sheet script',
  storyOutlineFailed: 'Story generation failed',
  storyOutlineWriting: 'Writing story…',
  storyScriptWriting: 'Writing script…',
  storyCancelChatHint:
    'Stops waiting in the UI. If the request already reached the cloud, the fee usually still applies (auto-refund only when upstream fails/times out; a successful upstream run may still be charged after local cancel)',
  storyLlmTimeout:
    'LLM timed out or the network dropped. Check the network and retry; for many segments switch to long clips first. Upstream failure auto-refunds; a successful upstream run may still be charged',
  storyGenerateScriptBtn: 'Generate script',
  storyOneShotBtn: 'Analyze & generate script',
  storyOneShotRunning: 'Generating…',
  storyNeedLyricsOrTitle: 'Add lyrics or a title in the Music step first',
  storyNeedMusicAnalysis: 'Finish song analysis in the Music step first — results fill the cards above',
  storyAnalysisEmpty: 'Song analysis comes from the Music step; go back and re-analyze if empty',
  storyAnalyzeFailed: 'Music analysis failed',
  storyScriptFailed: 'Script generation failed',
  dramaConfirmShots: 'Confirm shots',
  regenerateShots: 'Regenerate',
  batchGenerateStoryboardsToolbar: 'Batch storyboards',
  batchGenerateVideosToolbar: 'Batch videos',
  globalStyleLabel: 'Global style',
  globalStylePlaceholder: 'Describe look, lighting, palette for the whole piece…',
  dramaFlowHint: 'Flow: ① Script analysis → ② Prepare assets → ③ Generate video',
  dramaPhaseStory: 'Script analysis',
  dramaPhaseStorySub: 'Ingest text → AI analysis',
  dramaPhaseShots: 'Storyboard',
  dramaPhaseShotsSub: 'Review shot table & prompts',
  dramaPhaseAnalyze: 'Script analysis',
  dramaPhaseAnalyzeSub: 'Ingest text → AI analysis',
  dramaPhaseStoryboard: 'Storyboard',
  dramaPhaseStoryboardSub: 'Shot table & visual prompts',
  dramaPhaseAssets: 'Reference images',
  dramaPhaseAssetsSub: 'Cast / scenes / props / creatures / voices',
  dramaPhaseVideo: 'Generate video',
  dramaPhaseVideoSub: 'MiniMax H3 etc.',
  dramaAnalyzeHint:
    'Step 1: connect a text node or paste the script, then tap Analyze to extract cast, scenes and a shot draft.',
  dramaAnalyzeLinkedScript: 'Script absorbed from a linked text node — analyze or edit first.',
  dramaAnalyzeBtn: 'Analyze',
  dramaAnalyzeDoneSummary: 'Done: cast {cast} · scenes {scenes} · shots {shots}',
  dramaNextStoryboard: 'Next: Storyboard',
  dramaNextAssets: 'Next: Prepare assets',
  dramaNextVideos: 'Next: Generate video',
  dramaMissingAssetsHint:
    '{c} characters, {s} scenes, {p} props, {b} creatures have no image — upload manually or generate all with AI',
  dramaGenerateOrUploadCharacter: 'Generate or upload character',
  dramaGenerateOrUploadScene: 'Generate or upload scene',
  dramaGenerateOrUploadProp: 'Generate or upload prop',
  dramaGenerateOrUploadCreature: 'Generate or upload creature',
  dramaAddNew: 'Add',
  dramaStatusPending: 'Script pending',
  dramaStatusAnalyzeDone: 'Script analysis done',
  dramaStatusAnalyzeAndShotsDone: 'Script analysis & storyboard done',
  dramaStorySourceLabel: 'Novel / script draft',
  dramaStorySourcePlaceholder:
    'Paste a script, novel, or synopsis. Analysis fills cast, scenes and a shot draft; then open Storyboard to review.',
  dramaStoryGenerate: 'Analyze',
  dramaStoryNeedSource: 'Connect a text node or paste a script draft first',
  dramaStoryGenerating: 'Analyzing script…',
  dramaStoryReadySummary: 'Ready: cast {cast} · scenes {scenes} · shot draft {shots}',
  dramaStoryPlotPreview: 'Plot beat table (draft)',
  dramaStoryScriptPreview: 'Script summary',
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
  storyboardPickVersion: 'Choose storyboard',
  videoPickVersion: 'Choose video',
  colStoryboard: 'Storyboard',
  colShotVideo: 'Video',
  colRefStoryboard: 'Ref storyboard',
  colShotCast: 'Shot cast',
  lipsyncCastSubject: 'Lipsync: {name}',
  needStoryboardsFirst: 'Generate storyboard frames first',
  confirmSpawnWithoutAllStoryboards: '{n} shots lack storyboards. Generate video only for ready shots?',
  batchSpawnVideosAllReady:
    'All shots already have videos — skipped. Use per-shot Regenerate to rerun one.',
  mvVideoBatchCapped:
    'Up to {n} videos run at once. Submitted this wave; {left} queued and will continue automatically.',
  videoSkillRewriteProgress: 'Optimizing prompts {cur}/{total}…',
  videoSkillRewriteWaveWait: 'Finished {cur}/{total}. Next batch in {sec}s…',
  videoSkillRewriteFailed: 'Shot {no} prompt optimize failed; original kept',
  videoSkillRewriteBatchSummary:
    'Optimized {ok} shots. {fail} unfinished ({nos}). Run Batch optimize again, or Optimize on rows that are not green.',
  videoSkillRewriteGuideMissing: 'Could not load the MiniMax Skill guide. Try again later.',
  videoSkillModelHint: 'LLM used to optimize MiniMax Skill prompts (separate from video gen)',
  videoOptimizePrompt: 'Optimize prompt',
  videoOptimizePromptBusy: 'Optimizing…',
  videoOptimizePromptBatch: 'Optimize prompts',
  videoRebuildPromptFromScript: 'Update prompt',
  videoRebuildPromptFromScriptBatch: 'Update prompts',
  videoRebuildPromptFromScriptHint:
    'Rebuild original prompts from the current plot table and shot script, and clear optimized drafts. Does not rerun storyboards or videos.',
  confirmRebuildPromptFromScriptBatch:
    'This will rebuild all prompts from the plot and shot script, and clear current optimized drafts. Storyboards and videos will not be rerun. Continue?',
  videoRebuildPromptDone: 'Prompts updated',
  videoPromptOriginal: 'Original prompt',
  videoPromptOptimized: 'Optimized prompt',
  videoPromptUseOriginal: 'Use original',
  videoPromptUseOptimized: 'Use optimized',
  videoPromptUsingOriginal: 'Using original',
  videoPromptUsingOptimized: 'Using optimized',
  videoPromptNoOptimized: 'Not optimized yet — run Optimize prompt first',
  videoPromptOptimizeNeedText: 'Write the final prompt before optimizing',
  confirmLipsyncGen:
    'Generate {n} shot(s) with LTX2.3 lipsync.\nEach shot needs: storyboard + song clip + prompt.\nGeneration starts only after you confirm.\n\n{detail}',
  confirmLipsyncShotLine: 'Shot {no}: storyboard{sb} · clip{clip} · prompt{prompt}',
  confirmLipsyncMissingTitle:
    'Lipsync inputs incomplete (need storyboard + song clip + prompt). Fix these first:',
  confirmLipsyncPartialSkip: '{n} incomplete shot(s) will be skipped.',
  lipsyncRecommend: '{n} shots have dialogue — recommend LTX lipsync (auto-trims the matching song clip)',
  lipsyncUse: 'Use lipsync',
  lipsyncRevert: 'Restore model',
  lipsyncShotBadge: 'Lipsync on: prompt asks for singing lip-sync · click to keep characters silent, do not speak',
  lipsyncShotBadgeOff: 'Lipsync off: prompt requires characters remain silent, do not speak · click to enable',
  lipsyncShotBadgeClimax: 'Climax lipsync on: prompt asks for singing lip-sync · click to keep characters silent',
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
  videoHoverSoundLabel: 'Preview sound',
  videoHoverSoundHint: 'When on, hovering any shot video plays audio (one at a time)',
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
  asrNeedLoginBalanceOk:
    'Cloud transcription requires sign-in. Balance is sufficient — go to sign in?',
  asrNeedLogin: 'Cloud transcription requires sign-in. Go to sign in?',
  goLogin: 'Go to sign in',
  asrBalanceInsufficient:
    'Insufficient credits. Please recharge.',
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
  shotChangePaceLabel: 'Shot pacing',
  shotChangePaceFast: 'Fast 0.8s · Intense',
  shotChangePaceNormal: 'Normal 1.2s · Narrative',
  shotChangePaceSlow: 'Slow 2.0s · Lyrical',
  shotChangePaceHint:
    'Controls action-timeline beat density in script/video prompts',
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
  assetsStepCreatures: 'Creatures',
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
  styleCustomHint: 'Describe lighting/color mood; upload or pick a canvas image (light/color only; always photorealistic)',
  styleLongPressHint: 'Tap to select · Long-press to edit prompt',
  stylePromptEditTitle: 'Edit style prompt',
  styleRefImageLabel: 'Style reference',
  styleRefImageClear: 'Clear reference',
  stylePromptSave: 'Save',
  stylePromptCancel: 'Cancel',
  styleLibraryTitle: 'Art style',
  styleLibraryTabSystem: 'Cinematic',
  styleLibraryTabMine: 'My styles',
  styleLibraryMineEmpty: 'No custom styles yet. Tap Custom to create one.',
  styleLibrarySelected: 'Selected: {name}',
  styleLibraryMore: 'More styles',
  characters: 'Characters',
  scenes: 'Scenes',
  props: 'Props',
  creatures: 'Creatures',
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
  shotVideoDropHint: 'Drop a local video to fill this shot (MP4 / MOV / WEBM)',
  shotVideoDropUnsupported: 'Only video files are supported (MP4 / MOV / WEBM…)',
  generateThis: 'Generate',
  generateCategory: 'Generate category',
  generateAllCharacters: 'Generate all characters',
  generateAllScenes: 'Generate all scenes',
  generateAllProps: 'Generate all props',
  generateAllCreatures: 'Generate all creatures',
  batchGenerateSceneImages: 'Generate all scene images',
  characterLinkedHint: 'Photoreal 2×2 sheet auto-appended (equal cells, no gutters; hidden in text)',
  sceneLinkedHint: 'Single-scene rules auto-appended: empty set, no text, no nine-grid collage (hidden in text)',
  creditsSuffix: 'credits',
  otsPriceRequired: 'Please sign in',
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
  scriptPromptsStaleUpdate: 'Update',
  scriptPromptsStaleHint:
    'Script updated: refresh this shot’s prompts & asset match (won’t re-run storyboard/video; manual edits kept)',
  scriptPromptsStaleBanner:
    'Script updated — {n} shot(s) stale. Tap Update under the number, or Update all stale (no re-gen of images/videos)',
  scriptPromptsUpdatedToast: 'Prompts & asset match updated',
  scriptPromptsUpdateAllStale: 'Update all stale',
  colShotNo: 'No.',
  colDuration: 'Dur.',
  colDesc: 'Description',
  colAction: 'Action',
  colAngleFocal: 'Camera',
  colAngle: 'Angle',
  colAngleCamera: 'Angle',
  colFocal: 'Focal length',
  colShotSize: 'Size',
  colLighting: 'Lighting',
  colMood: 'Mood',
  colDialogue: 'Dialogue',
  colDialogueSpeaker: 'Dialogue',
  colSfx: 'SFX',
  colCamera: 'Move',
  colFinalPrompt: 'Final prompt',
  colSceneNo: 'Scene #',
  colIntExt: 'I/E',
  colDayNight: 'D/N',
  colLocation: 'Location',
  colCastOn: 'Cast',
  colProdNotes: 'Costume/Makeup/Props/VFX',
  colContinuity: 'Continuity',
  colRefBind: 'Ref bind',
  layerScene: 'Scene',
  layerShot: 'Shot',
  layerProd: 'Production',
  aiReviseFinalPrompt: 'AI revise',
  aiReviseFinalPromptOpinionPlaceholder:
    'Local: closer, cooler light… | Full rewrite: start with “rewrite all: …”',
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
