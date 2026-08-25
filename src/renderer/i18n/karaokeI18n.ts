import type { AppLocale } from './settingsI18n';

export type KaraokeI18nStrings = {
  title: string;
  subtitle: string;
  sourceLyrics: string;
  sourceAudio: string;
  sourceVideo: string;
  sourceTiming: string;
  timingLrc: string;
  timingSegments: string;
  timingAsr: string;
  timingAsrWords: string;
  timingNone: string;
  /** 纯歌词按时长均分的临时字级（可再跑云端对齐） */
  timingProvisional: string;
  timingInterpolatedHint: string;
  timingAsrWordsHint: string;
  /** 字级 ASR 后仍可微调偏移的提示 */
  timingAsrWordsOffsetTip: string;
  /** 部分句弱对齐 / 漏句插值提示 */
  timingWeakAlignmentHint: string;
  /** 字级微调面板 */
  charTimingSection: string;
  charTimingHint: string;
  charTimingSelectCurrent: string;
  charTimingWeakOnly: string;
  charTimingNoLines: string;
  charTimingLineStart: string;
  charTimingLineEnd: string;
  charTimingCharStart: string;
  charTimingCharEnd: string;
  charTimingQualityWeak: string;
  charTimingQualityInterpolated: string;
  charTimingQualityManual: string;
  charTimingQualityAsr: string;
  charTimingSeekLine: string;
  charTimingSeekChar: string;
  charTimingNoAsrNeeded: string;
  /** 预览点选 / 字级时间条 */
  charTimingPreviewHint: string;
  charTimingBarLabel: string;
  /** 双行交替：上轨（A / 偶数句） */
  charTimingTrackA: string;
  /** 双行交替：下轨（B / 奇数句） */
  charTimingTrackB: string;
  /** 双行：右键单字可放到上/下轨提示（保留键，供文案引用） */
  charTimingDualTrackHint: string;
  charTimingSelected: string;
  charTimingDragBarHint: string;
  charTimingBarPan: string;
  charTimingWeakDot: string;
  /** 字轨加字（旧间隙「+」文案，现作通用插入） */
  charTimingInsertPlus: string;
  /** 字轨加字：输入框占位 */
  charTimingInsertPlaceholder: string;
  /** 字轨删字 */
  charTimingDeleteChar: string;
  /** 字轨空白右键：在时间序中插入一整句（后续句奇偶翻轨） */
  charTimingCtxInsertSentence: string;
  /** 字轨空白右键：添加字（单行/双行同一项） */
  charTimingCtxInsert: string;
  /** 字块右键（双行）：放到上轨 */
  charTimingCtxAddUpper: string;
  /** 字块右键（双行）：放到下轨 */
  charTimingCtxAddLower: string;
  /** 字块右键：在前面插入 */
  charTimingCtxInsertBefore: string;
  /** 字块右键：在后面插入 */
  charTimingCtxInsertAfter: string;
  /** 空字轨占位提示 */
  charTimingEmptyHint: string;
  /** ASR 成功但未产出字级 */
  asrEmptyResult: string;
  /** 字级识别失败（有音频时必须字级，不可用均分糊弄） */
  asrWordLevelFailed: string;
  /** FC 未返回扣费字段 */
  asrBillingMissing: string;
  /** 成功扣费提示 */
  asrChargedHint: (cost: number) => string;
  /** ASR 失败但已有本地估算时间轴（仅无音频兜底提示；有音频时不应当作完成） */
  asrFailedKeepLocal: string;
  /** 未登录且余额够：确认后跳登录 */
  asrNeedLoginBalanceOk: string;
  /** 未登录（余额未知/未登录）：确认后跳登录 */
  asrNeedLogin: string;
  /** 前往登录按钮 */
  goLogin: string;
  /** 余额不足提示 */
  asrBalanceInsufficient: string;
  /** 有音频时使用均分兜底的醒目警告（默认不自动当作完成） */
  timingProvisionalWarning: string;
  globalOffset: string;
  globalOffsetHint: string;
  /** 开唱前倒计时点 */
  countdownSection: string;
  countdownEnabled: string;
  countdownHint: string;
  styleSection: string;
  /** 字号/描边/颜色/坐标等（默认收起） */
  advancedSettings: string;
  styleLayout: string;
  layoutSingle: string;
  layoutDual: string;
  layoutDualHint: string;
  stylePosition: string;
  positionBottom: string;
  positionMiddle: string;
  positionTop: string;
  /** 恢复歌词/开场位置与样式默认 */
  restoreStyleDefaults: string;
  /** 间奏清屏间隙（秒；写入 style.interludeClearGapSec） */
  interludeClearGap: string;
  interludeClearGapHint: string;
  /** 再入倒计时间隙（秒；写入 style.countdownReentryGapSec） */
  countdownReentryGap: string;
  countdownReentryGapHint: string;
  /** 提前显词 / lead-in 窗上限（秒；写入 style.countdownLeadInMaxSec） */
  countdownLeadInMax: string;
  countdownLeadInMaxHint: string;
  /** 倒计时蓝点大小（开场 / 再入；写入 style.countdown.size） */
  countdownDotSize: string;
  countdownDotSizeHint: string;
  /** 倒计时点水平间距（圆心距；写入 style.countdown.spacing） */
  countdownDotSpacing: string;
  countdownDotSpacingHint: string;
  /** 预览拖动单点提示 */
  countdownDotDragHint: string;
  styleFontSize: string;
  /** 开场曲名字号 */
  openingTitleFontSize: string;
  /** 开场作词/作曲字号 */
  openingCreditFontSize: string;
  /** 正歌未唱描边粗细（outline） */
  styleUnsungOutlineWidth: string;
  /** 正歌已唱描边粗细（sungOutlineWidth） */
  styleSungOutlineWidth: string;
  /** 开场曲名描边粗细 */
  styleTitleOutline: string;
  /** 开场作词/作曲描边粗细 */
  styleCreditOutline: string;
  /** 描边粗细提示 */
  styleOutlineHint: string;
  /** 句间渐隐时长（秒） */
  lineFadeOutSec: string;
  styleFont: string;
  styleFontCustom: string;
  styleFontCustomPlaceholder: string;
  styleFontFallbackHint: string;
  styleSungColor: string;
  styleUnsungColor: string;
  /** 正歌未唱描边色（outlineColor） */
  styleUnsungOutlineColor: string;
  /** 正歌已唱描边色（sungOutlineColor） */
  styleSungOutlineColor: string;
  styleRoleColorMale: string;
  styleRoleColorFemale: string;
  styleRoleColorChorus: string;
  styleColorHint: string;
  styleHint: string;
  dragHint: string;
  /** 开场曲名/作词/作曲拖位置提示 */
  dragOpeningHint: string;
  posLabelA: string;
  posLabelB: string;
  /** 开场/歌词坐标短标签（样式区实时显示） */
  posCoordTitle: string;
  posCoordLyricist: string;
  posCoordComposer: string;
  posCoordCountdown: string;
  posCoordLyricA: string;
  posCoordLyricB: string;
  previewSection: string;
  previewNoVideo: string;
  previewAudioOnly: string;
  previewNoMedia: string;
  previewResolvingVideo: string;
  previewPlay: string;
  previewPause: string;
  previewHint: string;
  /** 未生成字级时间轴时的醒目提示 */
  previewNeedTiming: string;
  /** 预览全屏（CSS 浮层） */
  previewFullscreen: string;
  previewExitFullscreen: string;
  /** 预览开场曲名/作词作曲（烧录始终写入） */
  previewOpeningCredits: string;
  previewOpeningCreditsHint: string;
  openingLyricistPrefix: string;
  openingComposerPrefix: string;
  /** 预览/烧录音源 */
  audioSourceSection: string;
  audioSourceVideo: string;
  audioSourceSong: string;
  audioSourceHint: string;
  audioSourceVideoUnavailable: string;
  audioSourceSongUnavailable: string;
  /** 成片来源（上传 / 导入合成） */
  videoSourceSection: string;
  uploadLocalVideo: string;
  uploadLocalVideoHint: string;
  uploadLocalVideoRunning: string;
  importComposeVideo: string;
  importComposeVideoHint: string;
  importComposeVideoRunning: string;
  clearVideo: string;
  clearVideoHint: string;
  videoReady: string;
  videoEmptyHint: string;
  needSongAudio: string;
  /** 识别语言 */
  asrLanguageSection: string;
  asrLanguageAuto: string;
  asrLanguageZh: string;
  asrLanguageYue: string;
  asrLanguageHint: string;
  /** 选粤语时的局限说明 */
  asrLanguageYueTip: string;
  generateTiming: string;
  generating: string;
  /** 元宝单位（价签旁） */
  creditsSuffix: string;
  /** 字级时间轴按次价签悬停说明 */
  generateTimingPriceTitle: string;
  asrRunning: string;
  /** 云端 ASR 心跳（已等待秒数，避免像假死） */
  asrRunningElapsed: (sec: number) => string;
  /** 云端 ASR 较长等待提示 */
  asrRunningLongHint: string;
  /** 内嵌字体后台加载中（不阻塞编辑） */
  fontsLoadingHint: string;
  /** 强制重跑字级成功：已重新生成 · N 字 · 字级 ASR */
  timingRegenerated: (n: number) => string;
  burnToNode: string;
  burning: string;
  /** 录制预览导出（方案1） */
  recordPreviewExport: string;
  recordPreviewHint: string;
  recordPreviewRunning: string;
  recordPreviewProgress: (frame: number, total: number, percent: number) => string;
  recordPreviewFinalizing: (percent: number) => string;
  successRecordPreview: string;
  /** 录制预览进度卡片标题 */
  recordPreviewTitle: string;
  recordPreviewApiMissing: string;
  /** 方案 A：预览级 CSS 烧录进行中 */
  previewComposeRunning: string;
  previewComposeProgress: (frame: number, total: number, percent: number) => string;
  /** 合成进度（含 ETA / 办公本降帧说明） */
  previewComposeProgressDetail: (opts: {
    frame: number;
    total: number;
    percent: number;
    fps?: number;
    etaSeconds?: number | null;
    lowSpec?: boolean;
  }) => string;
  previewComposeFinalizing: (percent: number) => string;
  previewComposeNoOverlay: string;
  successPreviewCompose: string;
  previewComposeFallbackAss: (reason: string) => string;
  successBurnViaAssFallback: (reason: string) => string;
  /** 内存 / 崩溃后的友好提示 */
  previewComposeOomHint: string;
  /** ASS 稳定烧录进行中 */
  burnQualityStableRunning: string;
  successBurnStable: string;
  /** @deprecated UI 已移除 ASS 勾选 */
  burnEngineAssFast: string;
  /** 方案 A 预览级说明（按钮/兼容） */
  burnEnginePreview: string;
  /** 合成说明：固定方案 A */
  burnEngineHint: string;
  /** @deprecated UI 已移除 ASS 勾选 */
  burnEngineAssHint: string;
  /** 预览级合成悬停说明 */
  burnEnginePreviewHint: string;
  /** 方案 A IPC 未加载（需完全退出后重开） */
  burnEngineApiMissing: string;
  /** @deprecated UI 已移除 ASS */
  burnEngineAssFallback: string;
  /** @deprecated UI 已改为手动挡位；保留文案兼容 */
  burnEngineLowSpecHint: string;
  /** @deprecated */
  burnEngineLowSpecDisabled: string;
  /** @deprecated UI 已移除「流畅优先」勾选 */
  burnPreferSmooth: string;
  burnPreferSmoothHint: string;
  /** 合成质量/帧率挡位选择 */
  burnQualityLabel: string;
  burnQualityHint: string;
  burnQualityStable: string;
  burnQualityStableDesc: string;
  burnQualityFast: string;
  burnQualityFastDesc: string;
  burnQualityStandard: string;
  burnQualityStandardDesc: string;
  burnQualitySmooth: string;
  burnQualitySmoothDesc: string;
  burnQualityHq: string;
  burnQualityHqDesc: string;
  /** 低配机选流畅/高清时的提示 */
  burnQualityLowSpecWarn: string;
  /** 确认开始合成 */
  burnQualityStart: string;
  close: string;
  cancel: string;
  closeAria: string;
  cancelled: string;
  burnTimeout: string;
  closeCancelsBurn: string;
  needLyrics: string;
  needAudioForAsr: string;
  needVideo: string;
  noApi: string;
  successBurn: string;
  failed: string;
  charsReady: (n: number) => string;
  fromDirector: string;
  fromVideoNode: string;
};

const zh: KaraokeI18nStrings = {
  title: '一键卡拉OK字幕',
  subtitle: '复用导演台歌曲/歌词/成片，生成字级高亮字幕并烧录',
  sourceLyrics: '歌词来源',
  sourceAudio: '原曲音频',
  sourceVideo: '成片视频',
  sourceTiming: '时间轴',
  timingLrc: 'LRC 行级 → 句内插值（估算）',
  timingSegments: '句级 ASR → 句内匀速插值（估算）',
  timingAsr: '云端句级校准 → 句内匀速插值（估算）',
  timingAsrWords: '字级 ASR（真实节奏）',
  timingNone: '待生成',
  timingProvisional: '歌词均分（估算）',
  timingInterpolatedHint:
    '当前为估算时间轴（非字级 ASR）：前奏也可能填字，节奏不准。有音频时请重新「生成字级时间轴」，须云端 fun-asr 字级成功。',
  timingAsrWordsHint:
    '已用 fun-asr 字/词级时间戳映射到歌词，逐字起止尽量保留唱腔时长；前奏空白已保留。',
  timingAsrWordsOffsetTip: '字级 ASR 后仍可能有误差，可用下方「全局偏移」微调整轨对齐。',
  timingWeakAlignmentHint: '部分句弱对齐，可在预览点字或下方时间条微调',
  charTimingSection: '字级微调',
  charTimingHint:
    '可在预览上点字选中，或用下方通用字幕轨道拖块改时序。整曲铺在同一条时间轴上（不是一句一个格子）。拉长某字或后移时，后面的字会自动涟漪后移；改完即生效，无需再跑全量 ASR。',
  charTimingSelectCurrent: '选当前播放句',
  charTimingWeakOnly: '仅弱对齐',
  charTimingNoLines: '暂无可调歌词行',
  charTimingLineStart: '行起（秒）',
  charTimingLineEnd: '行止（秒）',
  charTimingCharStart: '起',
  charTimingCharEnd: '止',
  charTimingQualityWeak: '弱对齐',
  charTimingQualityInterpolated: '插值',
  charTimingQualityManual: '已手调',
  charTimingQualityAsr: 'ASR',
  charTimingSeekLine: '跳到此句',
  charTimingSeekChar: '跳到此字',
  charTimingNoAsrNeeded: '局部调字不需要重跑 ASR',
  charTimingPreviewHint:
    '点预览上的字可选中并跳到该字试听；拖动整句调位置（写入坐标）。双击可改整句歌词（回写第1步）。下方是整曲通用轨道：在空白处拖框可选中多个字并整体平移；Shift+点击加减选；拖到另一条轨可切换上下轨。字轨空白处右键「添加句子」（后续句自动换上下轨）；右键单字可在前/后插入，双行还可放到上/下轨；选中后 Delete 删除。',
  charTimingBarLabel: '字幕轨道',
  charTimingTrackA: '上轨',
  charTimingTrackB: '下轨',
  charTimingDualTrackHint: '双行：框选后拖到另一条轨，或右键「放到上轨 / 放到下轨」',
  charTimingSelected: '已选',
  charTimingDragBarHint:
    '整曲通用轨道 · 拖空白框选 · 多选后整体平移 · 拖到另一轨切换 · 右键空白添加句子（后续句自动换上下轨） · 右键字块前/后插入 · Delete 删字 · 双击改整句 · Ctrl+滚轮缩放',
  charTimingBarPan: '拖动平移视口（不改字时序）；Ctrl+滚轮缩放',
  charTimingWeakDot: '弱对齐',
  charTimingInsertPlus: '插入字',
  charTimingInsertPlaceholder: '输入歌词，回车确认',
  charTimingDeleteChar: '删除此字',
  charTimingCtxInsertSentence: '添加句子',
  charTimingCtxInsert: '添加歌词',
  charTimingCtxAddUpper: '放到上轨',
  charTimingCtxAddLower: '放到下轨',
  charTimingCtxInsertBefore: '在前面插入',
  charTimingCtxInsertAfter: '在后面插入',
  charTimingEmptyHint: '右键空白处添加句子，拖空白框选',
  asrEmptyResult: '云端转写未返回可用字级时间轴，请检查音频或稍后重试',
  asrWordLevelFailed:
    '字级识别失败，请检查登录/余额/FC。有音频时必须 fun-asr 字级（enable_words），不能用歌词均分代替。',
  asrBillingMissing:
    '未扣费：云端未返回 charged/cost。请上传含计费的 FC 包（demo/aliyun-fc-init-user/nexflow-fc.zip）后重试。',
  asrChargedHint: (cost: number) => `已扣 ${Math.max(0, Math.round(Number(cost) || 0))} 元宝`,
  asrFailedKeepLocal:
    '云端字级对齐失败。下方若仍显示「歌词均分」仅为临时估算，请修复后重新生成，勿当作完成。',
  asrNeedLoginBalanceOk: '云端转写需要登录，余额充足，是否前往登录？',
  asrNeedLogin: '云端转写需要登录，是否前往登录？',
  goLogin: '前往登录',
  asrBalanceInsufficient:
    '余额不足\n\n您的账户余额不足以完成此次操作，请前往设置页面充值后再试。',
  timingProvisionalWarning:
    '⚠ 歌词均分（估算）：从 0 匀速铺开，前奏会提前填字。有音频时请重新生成字级时间轴。',
  globalOffset: '全局偏移（秒）',
  globalOffsetHint: '整轨提前/延后；字级 ASR 后仍可微调偏移以对准唱腔',
  countdownSection: '开唱倒计时点',
  countdownEnabled: '显示倒计时蓝点',
  countdownHint: '倒计时蓝点暂关闭（预览与烧录均不显示）',
  styleSection: '字幕样式',
  advancedSettings: '高级设置',
  styleLayout: '显示方式',
  layoutSingle: '单行',
  layoutDual: '双行交替',
  layoutDualHint:
    '奇数句用位置 A（左对齐）、偶数句用位置 B（右对齐），经典 KTV。A/B 各自只占一行（不换行）；过长句自动缩小字号。可在预览上分别拖动。',
  stylePosition: '位置预设',
  positionBottom: '底部',
  positionMiddle: '中部',
  positionTop: '顶部',
  restoreStyleDefaults: '恢复默认',
  interludeClearGap: '间奏清屏间隙（秒）',
  interludeClearGapHint:
    '相邻可唱行空隙大于此值则清屏、不提前挂下一句（默认 10，范围 1～10）。「恢复默认」还原。',
  countdownReentryGap: '再入倒计时间隙（秒）',
  countdownReentryGapHint:
    '空隙≥此值才可能出再入蓝点并提前显词（全曲最多 1 次；默认 10，范围 3～15，且≥清屏间隙）。',
  countdownLeadInMax: '提前显词提前量（秒）',
  countdownLeadInMaxHint:
    '开场/再入蓝点与提前显词窗上限（默认 7；可用间隙不足时自动压缩 hold/扣点）。范围 2～15。',
  countdownDotSize: '倒计时点大小',
  countdownDotSizeHint: '开场/间奏再入蓝点尺寸；预览与烧录 ASS 同步（默认 146，最大 300）',
  countdownDotSpacing: '倒计时点间距',
  countdownDotSpacingHint:
    '相邻蓝点中心水平距离；拖整组时间距不变，仅由本滑条调节。开场与再入共用。',
  countdownDotDragHint:
    '拖任意蓝点即可整组平移（保持间距）；右侧调大小/间距。「恢复默认」重置组位置',
  styleFontSize: '字号',
  openingTitleFontSize: '曲名字号',
  openingCreditFontSize: '作词作曲字号',
  styleUnsungOutlineWidth: '未唱描边粗细',
  styleSungOutlineWidth: '已唱白描边粗细',
  styleTitleOutline: '曲名描边',
  styleCreditOutline: '作词作曲描边',
  styleOutlineHint:
    '0～8（ASS Outline）。正歌：未唱/未扫半边用「未唱描边」；已唱/已扫半边用「已唱白描边」。0=该侧无边。曲名/署名另计。旧工程无已唱粗细时缺省 7。',
  lineFadeOutSec: '句间渐隐',
  styleFont: '字体',
  styleFontCustom: '自定义字体名',
  styleFontCustomPlaceholder: '输入系统字体名，如 Microsoft YaHei',
  styleFontFallbackHint:
    '默认「微软雅黑」（样片风格建议黑体）；系统未安装时回退黑体。圆体等仍可选手动切换。',
  styleSungColor: '已唱高亮色',
  styleUnsungColor: '未唱颜色',
  styleUnsungOutlineColor: '未唱描边色',
  styleSungOutlineColor: '已唱白描边色',
  styleRoleColorMale: '男',
  styleRoleColorFemale: '女',
  styleRoleColorChorus: '合',
  styleColorHint:
    '填色：未唱白字；已唱用男/女/合角色色（无标记用男色）从左扫到右。描边：未唱/未扫半边用未唱描边色；已唱/已扫半边用已唱白描边。开场曲名蓝边与此无关。',
  styleHint:
    '调好位置/字号/字体/颜色后，直接点「合成到视频」即可。固定方案 A（预览级 CSS）：与预览同款半扫（左白边右黑边）。若填字不准可再点「字幕生成」。',
  dragHint:
    '单击选字；拖动字幕调位置（超过约 6px 才移动，与双击改词不冲突）；下方时间条改字级起止。坐标写入样式，烧录/ASS 一致',
  dragOpeningHint: '拖动开场曲名 / 作词 / 作曲调整位置（松手写入样式；「恢复默认」可重置）',
  posLabelA: '位置 A（上/首行）',
  posLabelB: '位置 B（下/次行）',
  posCoordTitle: '曲名',
  posCoordLyricist: '作词',
  posCoordComposer: '作曲',
  posCoordCountdown: '倒计时点',
  posCoordLyricA: '歌词 A',
  posCoordLyricB: '歌词 B',
  previewSection: '成片预览',
  previewNoVideo: '暂无成片视频，仍可在此预览字幕位置与样式',
  previewAudioOnly: '暂无成片，正在用原曲音频对轴（黑底叠字幕）',
  previewNoMedia: '暂无成片与原曲音频，仍可拖动预览字幕位置与样式',
  previewResolvingVideo: '正在从剪辑预览导出成片以便预览…',
  previewPlay: '播放',
  previewPause: '暂停',
  previewHint:
    '左侧可播放预览：高亮为逐字渐进填充（非整字跳变）；单行不换行，过长或靠边会自动缩小/改锚点。调节样式后即可烧录。',
  previewNeedTiming: '请先「字幕生成」后即可播放实时填字',
  previewFullscreen: '全屏',
  previewExitFullscreen: '退出全屏',
  previewOpeningCredits: '预览开场曲名',
  previewOpeningCreditsHint:
    '叠层显示曲名与作词/作曲；曲名署名在开唱前 7 秒窗口开始前渐隐完毕。开唱前 7 秒先亮 4 点（前 3 秒全亮，其后每秒渐隐熄 1 个；不足则先缩短保持段再整体压缩）于左侧歌词行上方倒计时，并提前显示首句白字，真正开唱再扫字。烧录 ASS 一致（空则署名「致音」）。每句歌词上方不再出倒计时点。',
  openingLyricistPrefix: '作詞：',
  openingComposerPrefix: '作曲：',
  audioSourceSection: '声音来源',
  audioSourceVideo: '成片声音',
  audioSourceSong: '原曲声音',
  audioSourceHint:
    '预览与烧录共用：成片声音保留视频音轨；原曲声音用导演台第 1 步上传的歌曲（画面仍用成片）。',
  audioSourceVideoUnavailable: '暂无成片，无法使用成片音轨',
  audioSourceSongUnavailable: '暂无原曲音频（请先在导演台上传歌曲）',
  videoSourceSection: '成片来源',
  uploadLocalVideo: '上传本地成片',
  uploadLocalVideoHint: '支持 MP4 / WEBM / MOV，单文件最大 800MB',
  uploadLocalVideoRunning: '正在导入成片…',
  importComposeVideo: '导入合成成片',
  importComposeVideoHint: '从关联剪辑轨导出合成 MV 作为字幕底片',
  importComposeVideoRunning: '正在导出合成成片…',
  clearVideo: '清除成片',
  clearVideoHint: '移除当前预览成片（可重新上传或导入）',
  videoReady: '已选定成片',
  videoEmptyHint: '尚未选定成片，请上传本地成片或导入合成成片',
  needSongAudio: '已选「原曲声音」，但缺少原曲音频',
  asrLanguageSection: '识别语言',
  asrLanguageAuto: '自动',
  asrLanguageZh: '普通话',
  asrLanguageYue: '粤语',
  asrLanguageHint: '生成字级时间轴时传给云端 fun-asr；粤语歌请选「粤语」后重新生成。',
  asrLanguageYueTip:
    '局限：fun-asr 能力含粤语（中文方言），但文件转写文档未正式列出独立语种码 yue，将尽量传 yue。歌唱场景仍可能不准——建议粘贴带时间戳的粤语 LRC 后再生成。',
  generateTiming: '字幕生成',
  generating: '生成中…',
  creditsSuffix: '元宝',
  generateTimingPriceTitle: '云端 fun-asr 字级对齐按次扣费（与 FC /asr/file-transcribe 一致）',
  asrRunning: '云端转写对齐中…',
  asrRunningElapsed: (sec) =>
    `云端转写对齐中…已等待 ${Math.max(0, Math.floor(sec))} 秒（上传/排队中，请勿关闭）`,
  asrRunningLongHint:
    '仍在等待云端结果。长音频或网络慢时可能需数分钟；超过约 10 分钟可取消后缩短音频再试。',
  fontsLoadingHint: '正在加载内嵌字幕字体…',
  timingRegenerated: (n) => `已重新生成 · ${n} 字 · 字级 ASR`,
  burnToNode: '合成到视频',
  burning: '烧录中…',
  recordPreviewExport: '录制预览导出',
  recordPreviewHint:
    '原片全分辨率作主输入，只渲染透明歌词叠层后 ffmpeg overlay；无词段不 seek、不复用烂帧。片尾自动停止不重播；优先硬编。进度分「渲染叠层 / 封装」。改主进程后请完全退出 Electron 再开。',
  recordPreviewRunning: '正在录制预览（原片+叠层）…',
  recordPreviewProgress: (frame, total, percent) =>
    `渲染叠层：${frame}/${total}（${percent}%）`,
  recordPreviewFinalizing: (percent) => `录制预览：封装叠加（${percent}%）…`,
  successRecordPreview: '已按原片+叠层导出并添加到画布',
  recordPreviewTitle: '录制预览导出中…',
  recordPreviewApiMissing:
    '录制预览 API 未加载。请完全退出 Electron → npm run build:main → 再开后重试。',
  previewComposeRunning: '合成中：正在烧录字幕到视频…',
  previewComposeProgress: (frame, total, percent) =>
    `合成中：字幕帧 ${frame}/${total}（${percent}%）`,
  previewComposeProgressDetail: ({ frame, total, percent, fps, etaSeconds, lowSpec }) => {
    const eta =
      etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0
        ? etaSeconds >= 60
          ? `约 ${Math.ceil(etaSeconds / 60)} 分钟`
          : `约 ${Math.ceil(etaSeconds)} 秒`
        : null;
    const mode = lowSpec
      ? `办公本加速 ${fps || 24}fps`
      : fps
        ? `${fps}fps`
        : '';
    const bits = [
      `合成到视频：字幕帧 ${frame}/${total}（${percent}%）`,
      mode,
      eta ? `预计剩余 ${eta}` : null,
    ].filter(Boolean);
    return bits.join(' · ');
  },
  previewComposeFinalizing: (percent) => `合成中：正在叠加到视频（${percent}%）…`,
  previewComposeNoOverlay: '找不到字幕预览层，无法抓帧',
  successPreviewCompose: '已按方案 A（预览半扫）合成并添加到画布',
  previewComposeFallbackAss: (reason) =>
    `预览级半扫失败，正在改用稳定模式（ASS 滤镜）…\n（${String(reason || '').slice(0, 160)}）`,
  successBurnViaAssFallback: (reason) =>
    `已用稳定模式（ASS 滤镜）烧录入库。扫字效果与预览半扫会略有差别。${
      reason ? `\n半扫失败原因：${String(reason).slice(0, 160)}` : ''
    }`,
  previewComposeOomHint:
    '方案 A 失败（内存或渲染异常）。可改选「稳定」挡位，或完全退出后重开再合成。',
  burnQualityStableRunning: '稳定模式：正在用 ASS 滤镜烧录字幕（不抓帧）…',
  successBurnStable: '已用稳定模式（ASS 滤镜）合成并添加到画布',
  burnEngineAssFast: '（已移除）ASS 快速烧录',
  burnEnginePreview: '方案 A · 预览级半扫',
  burnEngineHint:
    '默认同预览半扫（离屏抓帧）。安装包或办公本建议选「稳定」：ffmpeg 直接烧 ASS，不走画面管道，不易出现 write EOF。半扫失败也会自动改用稳定模式。',
  burnEngineAssHint: '（已移除）方案 C ASS 不再作为合成选项。',
  burnEnginePreviewHint:
    '方案 A：隐藏窗只渲字幕层（未唱描边；已唱半边白描边+填色 wipe），raw 帧 capture 后 ffmpeg 叠加。合成前可选帧率挡位。',
  burnEngineApiMissing:
    '方案 A API 未加载（karaokeCssBurn）。请完全退出 Electron → npm run build:main（或 electron:dev）→ 再开后重烧。',
  burnEngineAssFallback: '（已移除）ASS KaraokeWipe + \\kf',
  burnEngineLowSpecHint:
    '办公本建议选「快速」或「标准」；高挡位可能较慢，进度会显示预计剩余时间。',
  burnEngineLowSpecDisabled:
    '合成固定方案 A；可在弹窗手动选择帧率。请完全退出 Electron 后重开再试。',
  burnPreferSmooth: '（已移除）流畅优先',
  burnPreferSmoothHint:
    '请在合成弹窗选择帧率挡位。静止/间奏段仍跳过重复抓帧。',
  burnQualityLabel: '帧率 / 质量',
  burnQualityHint: '选定后开始合成；下次默认记住本次选择。安装包或反复失败请选「稳定」。',
  burnQualityStable: '稳定',
  burnQualityStableDesc: 'ASS 滤镜直烧 · 不抓帧、不走管道，效果与预览半扫略有差别',
  burnQualityFast: '快速',
  burnQualityFastDesc: '16fps · 办公本友好，完成更快',
  burnQualityStandard: '标准',
  burnQualityStandardDesc: '平衡速度与流畅',
  burnQualitySmooth: '流畅',
  burnQualitySmoothDesc: '更顺滑，耗时略增',
  burnQualityHq: '高清流畅',
  burnQualityHqDesc: '限片源，适合高性能机',
  burnQualityLowSpecWarn:
    '当前设备偏办公本/低配，选流畅或高清可能明显变慢。',
  burnQualityStart: '开始合成',
  close: '关闭',
  cancel: '取消',
  closeAria: '关闭编辑器',
  cancelled: '已取消',
  burnTimeout: '烧录超时。办公本可先缩短成片或关闭其它占用 GPU/CPU 的程序后重试',
  closeCancelsBurn: '关闭将取消进行中的烧录',
  needLyrics: '需要歌词文本（请先在导演台粘贴歌词或 LRC）',
  needAudioForAsr: '无时间轴时需要原曲音频以调用转写',
  needVideo: '需要成片视频。请上传本地成片，或导入合成成片 / 导出剪辑预览。',
  noApi: '卡拉OK功能不可用（主进程未就绪）',
  successBurn: '已烧录并添加到画布',
  failed: '操作失败',
  charsReady: (n) => `已就绪 ${n} 字`,
  fromDirector: '导演台',
  fromVideoNode: '视频模块',
};

const en: KaraokeI18nStrings = {
  title: 'Karaoke Subtitles',
  subtitle: 'Reuse song / lyrics / MV from Director — word-level highlight burn-in',
  sourceLyrics: 'Lyrics',
  sourceAudio: 'Song audio',
  sourceVideo: 'MV video',
  sourceTiming: 'Timing',
  timingLrc: 'LRC line → in-line interpolate (estimate)',
  timingSegments: 'Sentence ASR → uniform interpolate (estimate)',
  timingAsr: 'Cloud sentence calibrate → interpolate (estimate)',
  timingAsrWords: 'Word-level ASR (real timing)',
  timingNone: 'Pending',
  timingProvisional: 'Lyrics spread (estimate)',
  timingInterpolatedHint:
    'Estimated timing (not word-level ASR): fill may start in the intro. With audio, regenerate via cloud fun-asr word timestamps.',
  timingAsrWordsHint:
    'Mapped from fun-asr word timestamps — per-char start/end keep singing duration; intro gap preserved.',
  timingAsrWordsOffsetTip:
    'Word-level ASR can still drift — use Global offset below to fine-tune the whole track.',
  timingWeakAlignmentHint:
    'Some lines are weakly aligned — click preview chars or drag the timeline below',
  charTimingSection: 'Char timing',
  charTimingHint:
    'Click a preview char or drag the full-song lyric track below. Lyrics sit on one timeline by time (not one cell per line). Lengthening or shifting a char ripples later chars forward. No full ASR after local fixes.',
  charTimingSelectCurrent: 'Select current line',
  charTimingWeakOnly: 'Weak only',
  charTimingNoLines: 'No editable lyric lines',
  charTimingLineStart: 'Line start (s)',
  charTimingLineEnd: 'Line end (s)',
  charTimingCharStart: 'Start',
  charTimingCharEnd: 'End',
  charTimingQualityWeak: 'Weak',
  charTimingQualityInterpolated: 'Interpolated',
  charTimingQualityManual: 'Manual',
  charTimingQualityAsr: 'ASR',
  charTimingSeekLine: 'Seek to line',
  charTimingSeekChar: 'Seek to char',
  charTimingNoAsrNeeded: 'Local char edits do not need ASR again',
  charTimingPreviewHint:
    'Click a preview char to select and seek; drag the line to move position. Double-click to edit the line. The bottom bar is a full-song lyric track: drag empty area to box-select, then move as a group; Shift-click to add/remove; drag onto the other lane to switch tracks. Right-click empty to add a sentence (later lines swap tracks); right-click a char to insert before/after (dual: move to upper/lower). Delete removes the selection.',
  charTimingBarLabel: 'Lyric track',
  charTimingTrackA: 'Upper',
  charTimingTrackB: 'Lower',
  charTimingDualTrackHint: 'Dual: box-select then drag to the other lane, or right-click Move to upper/lower track',
  charTimingSelected: 'Selected',
  charTimingDragBarHint:
    'Full-song lyric track · drag empty to box-select · move selection as a group · drag to the other lane to switch · right-click empty to add a sentence (later lines swap tracks) · right-click char to insert · Delete to remove · double-click to edit line · Ctrl+wheel zoom',
  charTimingBarPan: 'Drag to pan viewport (timing unchanged); Ctrl+wheel to zoom',
  charTimingWeakDot: 'Weak',
  charTimingInsertPlus: 'Insert character',
  charTimingInsertPlaceholder: 'Type lyrics, Enter to confirm',
  charTimingDeleteChar: 'Delete this character',
  charTimingCtxInsertSentence: 'Add sentence',
  charTimingCtxInsert: 'Add lyrics',
  charTimingCtxAddUpper: 'Move to upper track',
  charTimingCtxAddLower: 'Move to lower track',
  charTimingCtxInsertBefore: 'Insert before',
  charTimingCtxInsertAfter: 'Insert after',
  charTimingEmptyHint: 'Right-click empty area to add a sentence; drag to box-select',
  asrEmptyResult: 'Cloud ASR returned no usable word timing — check audio or retry later',
  asrWordLevelFailed:
    'Word-level ASR failed — check login / balance / FC. With audio, fun-asr enable_words is required; lyric spread is not a substitute.',
  asrBillingMissing:
    'Not charged: cloud response missing charged/cost. Upload the billing FC package (demo/aliyun-fc-init-user/nexflow-fc.zip) and retry.',
  asrChargedHint: (cost: number) => `Charged ${Math.max(0, Math.round(Number(cost) || 0))} Yuanbao`,
  asrFailedKeepLocal:
    'Cloud word-level align failed. Any “lyrics spread” below is temporary only — fix and regenerate; do not treat as done.',
  asrNeedLoginBalanceOk:
    'Cloud transcription requires sign-in. Balance is sufficient — go to sign in?',
  asrNeedLogin: 'Cloud transcription requires sign-in. Go to sign in?',
  goLogin: 'Go to sign in',
  asrBalanceInsufficient:
    'Insufficient balance\n\nYour account balance is not enough for this action. Please top up in Settings and try again.',
  timingProvisionalWarning:
    '⚠ Lyrics spread (estimate): fills from 0, including intro. With audio, regenerate word-level timing.',
  globalOffset: 'Global offset (sec)',
  globalOffsetHint: 'Shift all lines earlier/later — still useful after word-level ASR',
  countdownSection: 'Lead-in countdown dots',
  countdownEnabled: 'Show blue countdown dots',
  countdownHint:
    'Lead-in countdown dots temporarily disabled (hidden in preview and burn)',
  styleSection: 'Subtitle style',
  advancedSettings: 'Advanced',
  styleLayout: 'Layout',
  layoutSingle: 'Single line',
  layoutDual: 'Dual alternate',
  layoutDualHint:
    'Odd lines use A (left-aligned), even lines use B (right-aligned) — classic KTV. Each slot stays one line (no wrap); long lines auto-shrink. Drag each on the preview.',
  stylePosition: 'Position preset',
  positionBottom: 'Bottom',
  positionMiddle: 'Middle',
  positionTop: 'Top',
  restoreStyleDefaults: 'Restore defaults',
  interludeClearGap: 'Interlude clear gap (sec)',
  interludeClearGapHint:
    'Gaps longer than this clear the screen (no early next line). Default 10; range 1–10. Restore defaults resets.',
  countdownReentryGap: 'Re-entry countdown gap (sec)',
  countdownReentryGapHint:
    'Gaps ≥ this may show re-entry dots + early lyrics (max once per song). Default 10; range 3–15, and ≥ clear gap.',
  countdownLeadInMax: 'Early lyric lead-in (sec)',
  countdownLeadInMaxHint:
    'Max opening/re-entry countdown + early-lyric window (default 7; shorter gaps compress). Range 2–15.',
  countdownDotSize: 'Countdown dot size',
  countdownDotSizeHint:
    'Opening / re-entry blue dots; preview matches burn-in ASS (default 146, max 300)',
  countdownDotSpacing: 'Countdown dot spacing',
  countdownDotSpacingHint:
    'Horizontal center distance; group drag keeps spacing — only this slider changes it. Shared by opening and re-entry.',
  countdownDotDragHint:
    'Drag any blue dot to move the whole group (spacing kept); size/spacing sliders on the right. Restore defaults resets group position.',
  styleFontSize: 'Font size',
  openingTitleFontSize: 'Title size',
  openingCreditFontSize: 'Credits size',
  styleUnsungOutlineWidth: 'Unsung outline',
  styleSungOutlineWidth: 'Sung white outline',
  styleTitleOutline: 'Title outline',
  styleCreditOutline: 'Credit outline',
  styleOutlineHint:
    '0–8 (ASS Outline). Lyrics: unsung/unscanned half uses unsung outline; sung/scanned half uses sung white outline. 0 = no outline on that side. Title/credits separate. Legacy projects without sung width default to 7.',
  lineFadeOutSec: 'Line fade-out',
  styleFont: 'Font',
  styleFontCustom: 'Custom font name',
  styleFontCustomPlaceholder: 'System font name, e.g. Microsoft YaHei',
  styleFontFallbackHint:
    'Default “Microsoft YaHei” (sample-style sans); falls back to SimHei if missing. Round fonts remain selectable.',
  styleSungColor: 'Sung highlight',
  styleUnsungColor: 'Unsung color',
  styleUnsungOutlineColor: 'Unsung outline color',
  styleSungOutlineColor: 'Sung white outline',
  styleRoleColorMale: 'Male',
  styleRoleColorFemale: 'Female',
  styleRoleColorChorus: 'Chorus',
  styleColorHint:
    'Fill: unsung white; sung uses male/female/chorus (else male) wiping left→right. Outline: unsung/unscanned half uses unsung outline color; sung/scanned half uses sung white outline. Opening title blue edge is unrelated.',
  styleHint:
    'Adjust position / size / font / colors, then Compose to Video. Fixed Plan A (preview-grade CSS): half-wipe matches preview (white edge left / black edge right). If fill is off, re-run Generate Subtitles.',
  dragHint:
    'Click to select a char; drag subtitles to move (after ~6px, so double-click edit still works); use the mini timeline for char timing. Positions are saved and match burn / ASS',
  dragOpeningHint: 'Drag opening title / lyricist / composer to reposition (saved on release; Restore defaults resets)',
  posLabelA: 'Pos A (upper)',
  posLabelB: 'Pos B (lower)',
  posCoordTitle: 'Title',
  posCoordLyricist: 'Lyricist',
  posCoordComposer: 'Composer',
  posCoordCountdown: 'Countdown',
  posCoordLyricA: 'Lyric A',
  posCoordLyricB: 'Lyric B',
  previewSection: 'Preview',
  previewNoVideo: 'No MV yet — subtitle position and style still preview here',
  previewAudioOnly: 'No MV — playing song audio on black with subtitles for sync',
  previewNoMedia: 'No MV or song audio — drag to preview subtitle position and style',
  previewResolvingVideo: 'Exporting MV from edit preview for playback…',
  previewPlay: 'Play',
  previewPause: 'Pause',
  previewHint:
    'Left panel: progressive karaoke wipe (not whole-char jumps); single line no wrap; long/edge lines auto-shrink or re-anchor. Then Burn.',
  previewNeedTiming: 'Run Generate Subtitles first to play live karaoke fill',
  previewFullscreen: 'Fullscreen',
  previewExitFullscreen: 'Exit fullscreen',
  previewOpeningCredits: 'Preview opening credits',
  previewOpeningCreditsHint:
    'Overlay title + credits; they fade out before the 7s lead-in. In that window, 4 blue dots above Line A stay lit for 3s, then fade out one per second (short intros compress hold first, then the extinguish interval); the first lyric appears white; wipe starts at first vocal. Burn-in ASS matches (empty credits → 致音). Per-line lyric countdown stays off.',
  openingLyricistPrefix: 'Lyricist: ',
  openingComposerPrefix: 'Composer: ',
  audioSourceSection: 'Audio source',
  audioSourceVideo: 'MV audio',
  audioSourceSong: 'Song audio',
  audioSourceHint:
    'Applies to preview and burn: MV audio keeps the video track; song audio uses the Director step-1 upload (picture still from the MV).',
  audioSourceVideoUnavailable: 'No MV video — cannot use MV audio',
  audioSourceSongUnavailable: 'No song audio (upload in Director first)',
  videoSourceSection: 'MV source',
  uploadLocalVideo: 'Upload local video',
  uploadLocalVideoHint: 'MP4 / WEBM / MOV, max 800MB',
  uploadLocalVideoRunning: 'Importing video…',
  importComposeVideo: 'Import composed MV',
  importComposeVideoHint: 'Export the linked timeline as the karaoke base video',
  importComposeVideoRunning: 'Exporting composed MV…',
  clearVideo: 'Clear video',
  clearVideoHint: 'Remove current preview video (upload or import again)',
  videoReady: 'Video selected',
  videoEmptyHint: 'No video yet — upload a local file or import composed MV',
  needSongAudio: 'Song audio selected, but song file is missing',
  asrLanguageSection: 'ASR language',
  asrLanguageAuto: 'Auto',
  asrLanguageZh: 'Mandarin',
  asrLanguageYue: 'Cantonese',
  asrLanguageHint:
    'Sent to cloud fun-asr when building word timing. For Cantonese songs, pick Cantonese and regenerate.',
  asrLanguageYueTip:
    'Limit: fun-asr covers Cantonese as a Chinese dialect, but the file-transcribe docs do not list a dedicated yue hint — we still send yue. Singing may still drift; paste timed Cantonese LRC when possible.',
  generateTiming: 'Generate Subtitles',
  generating: 'Working…',
  creditsSuffix: 'credits',
  generateTimingPriceTitle:
    'Cloud fun-asr word align — charged per run (same as FC /asr/file-transcribe)',
  asrRunning: 'Cloud ASR aligning…',
  asrRunningElapsed: (sec) =>
    `Cloud ASR aligning… ${Math.max(0, Math.floor(sec))}s elapsed (upload/queue — keep open)`,
  asrRunningLongHint:
    'Still waiting on the cloud. Long audio or slow networks can take several minutes; after ~10 min cancel and retry with a shorter clip.',
  fontsLoadingHint: 'Loading embedded subtitle font…',
  timingRegenerated: (n) => `Regenerated · ${n} chars · word-level ASR`,
  burnToNode: 'Compose to Video',
  burning: 'Burning…',
  recordPreviewExport: 'Record Preview Export',
  recordPreviewHint:
    'Source video at full resolution + transparent lyric overlay via ffmpeg (HW encode). No seek/reuse on lyric-free segments. Stops at end (no loop). Quit Electron fully after main rebuild.',
  recordPreviewRunning: 'Recording preview (source + overlay)…',
  recordPreviewProgress: (frame, total, percent) =>
    `Rendering overlay: ${frame}/${total} (${percent}%)`,
  recordPreviewFinalizing: (percent) => `Record preview: mux/overlay (${percent}%)…`,
  successRecordPreview: 'Source+overlay export added to canvas',
  recordPreviewTitle: 'Record preview export…',
  recordPreviewApiMissing:
    'Preview-record API missing. Fully quit Electron → npm run build:main → relaunch.',
  previewComposeRunning: 'Composing: burning subtitles into video…',
  previewComposeProgress: (frame, total, percent) =>
    `Composing: subtitle frame ${frame}/${total} (${percent}%)`,
  previewComposeProgressDetail: ({ frame, total, percent, fps, etaSeconds, lowSpec }) => {
    const eta =
      etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds > 0
        ? etaSeconds >= 60
          ? `~${Math.ceil(etaSeconds / 60)} min left`
          : `~${Math.ceil(etaSeconds)}s left`
        : null;
    const mode = lowSpec
      ? `office ${fps || 24}fps`
      : fps
        ? `${fps}fps`
        : '';
    const bits = [
      `Compose to video: subtitle frame ${frame}/${total} (${percent}%)`,
      mode,
      eta,
    ].filter(Boolean);
    return bits.join(' · ');
  },
  previewComposeFinalizing: (percent) => `Composing: overlaying (${percent}%)…`,
  previewComposeNoOverlay: 'Subtitle overlay not found for capture',
  successPreviewCompose: 'Composed with Plan A (preview half-wipe) and added to canvas',
  previewComposeFallbackAss: (reason) =>
    `Preview half-wipe failed — switching to stable ASS burn…\n(${String(reason || '').slice(0, 160)})`,
  successBurnViaAssFallback: (reason) =>
    `Burned with stable ASS filter. Wipe look may differ slightly from preview.${
      reason ? `\nHalf-wipe error: ${String(reason).slice(0, 160)}` : ''
    }`,
  previewComposeOomHint:
    'Plan A failed (memory/renderer). Try the Stable tier, or fully quit Electron and retry.',
  burnQualityStableRunning: 'Stable mode: burning subtitles with ASS filter (no frame capture)…',
  successBurnStable: 'Composed with stable ASS filter and added to canvas',
  burnEngineAssFast: '(removed) ASS fast burn',
  burnEnginePreview: 'Plan A · preview half-wipe',
  burnEngineHint:
    'Default matches preview half-wipe (offscreen capture). For installers or office PCs, pick Stable: ffmpeg burns ASS without a frame pipe, so write EOF is unlikely. Half-wipe failures also fall back to Stable.',
  burnEngineAssHint: '(removed) Plan C ASS is no longer a compose option.',
  burnEnginePreviewHint:
    'Plan A: hidden window renders subtitle layer only (unsung outline; white outline + fill wipe on sung half), raw-frame capture → ffmpeg. Choose FPS tier before compose.',
  burnEngineApiMissing:
    'Plan A API missing (karaokeCssBurn). Fully quit Electron → npm run build:main (or electron:dev) → reopen, then re-burn.',
  burnEngineAssFallback: '(removed) ASS KaraokeWipe + \\kf',
  burnEngineLowSpecHint:
    'On office/low-spec PCs prefer Fast or Standard; higher tiers may be slow. Progress shows ETA.',
  burnEngineLowSpecDisabled:
    'Compose uses Plan A; pick FPS manually in the dialog. Fully quit Electron and retry.',
  burnPreferSmooth: '(removed) Prefer smooth',
  burnPreferSmoothHint:
    'Pick a frame-rate tier in the compose dialog. Static/interlude frames still skip re-capture.',
  burnQualityLabel: 'Frame rate / quality',
  burnQualityHint: 'Starts after you confirm; your last choice is remembered. Use Stable if the installer keeps failing.',
  burnQualityStable: 'Stable',
  burnQualityStableDesc: 'ASS filter burn · no capture/pipe; wipe may differ slightly from preview',
  burnQualityFast: 'Fast',
  burnQualityFastDesc: '16fps · office-friendly, finishes sooner',
  burnQualityStandard: 'Standard',
  burnQualityStandardDesc: 'Balanced speed and motion',
  burnQualitySmooth: 'Smooth',
  burnQualitySmoothDesc: 'Smoother, slightly longer',
  burnQualityHq: 'HQ Smooth',
  burnQualityHqDesc: 'Follow source; for fast PCs',
  burnQualityLowSpecWarn:
    'This device looks office/low-spec — Smooth or HQ may be much slower.',
  burnQualityStart: 'Start compose',
  close: 'Close',
  cancel: 'Cancel',
  closeAria: 'Close editor',
  cancelled: 'Cancelled',
  burnTimeout:
    'Burn timed out. On office PCs, shorten the clip or close other GPU/CPU-heavy apps, then retry',
  closeCancelsBurn: 'Closing will cancel the burn in progress',
  needLyrics: 'Lyrics required (paste in Director first)',
  needAudioForAsr: 'Song audio required for ASR when no timing exists',
  needVideo: 'MV video required. Upload a local file, or import composed MV / export timeline preview.',
  noApi: 'Karaoke is unavailable (main process not ready)',
  successBurn: 'Burned and added to canvas',
  failed: 'Failed',
  charsReady: (n) => `${n} chars ready`,
  fromDirector: 'Director',
  fromVideoNode: 'Video node',
};

export function karaokeT(locale: AppLocale): KaraokeI18nStrings {
  return locale === 'en' ? en : zh;
}
