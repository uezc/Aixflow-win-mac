import type { AppLocale } from './settingsI18n';

export type VideoInputPanelStrings = {
  modelLabel: string;
  chooseModelTitle: string;
  aspectRatioLabel: string;
  chooseAspectTitle: string;
  aspect169Landscape: string;
  aspect916Portrait: string;
  aspect11Square: string;
  aspectAdaptive: string;
  durationLabel: string;
  durationChooseTitle: string;
  durationFixed8s: string;
  /** 全能视频V3.1-pro 首尾帧（海外） */
  modelRhartV31ProSe: string;
  modelRhartV31ProSeTitle: string;
  resolutionLabel: string;
  shotLabel: string;
  shotTitle: string;
  shotSingle: string;
  shotMulti: string;
  modeLabel: string;
  klingModeLabel: string;
  keepRefVideoAudio: string;
  genAudio: string;
  genAudioTitle: string;
  guidanceLabel: string;
  guidanceTitle: string;
  soundLabel: string;
  soundTitle: string;
  sora2ChannelTitle: string;
  sora2Plugin: string;
  sora2Core: string;
  refImagesTitle: (cur: number, max: number) => string;
  refImagesBadge: (cur: number, max: number) => string;
  priceTooltip: string;
  creditsSuffix: string;
  noPricingYet: string;
  noPricingTableTitle: string;
  promptVideoDesc: string;
  promptAction: string;
  refImageColumn: string;
  audioConnected: string;
  audioNeedConnect: string;
  /** Seedance Mini：参考音可选 */
  audioRefOptional: string;
  /** WanAnimate 角色替换：无需提示词 */
  wanAnimateInputLabel: string;
  wanAnimateNoPromptHint: string;
  wanAnimateVideoConnected: string;
  wanAnimateVideoNeedConnect: string;
  wanAnimateImageNeedConnect: string;
  wanAnimateSlotRefImageLabel: string;
  /** HeyGem 数字人：参考视频 + 驱动音频 */
  heyGemInputLabel: string;
  heyGemNoPromptHint: string;
  heyGemVideoConnected: string;
  heyGemVideoNeedConnect: string;
  heyGemAudioConnected: string;
  heyGemAudioNeedConnect: string;
  heyGemSlotVideoLabel: string;
  heyGemSlotAudioLabel: string;
  heyGemSlotConnected: string;
  heyGemSlotPending: string;
  /** HeyGem 一体化：模块内上传 / 画布选 / 台词配音 */
  heyGemUploadVideo: string;
  heyGemPickFromCanvas: string;
  heyGemPickFromLibrary: string;
  heyGemClearVideo: string;
  heyGemScriptLabel: string;
  heyGemScriptPlaceholder: string;
  heyGemTtsModelLabel: string;
  heyGemOneClickDub: string;
  heyGemDubbing: string;
  heyGemCloneAudioLabel: string;
  heyGemCloneAudioUpload: string;
  heyGemCloneAudioClear: string;
  heyGemCloneAudioHint: string;
  heyGemUploadDriveAudio: string;
  heyGemLibraryEmpty: string;
  heyGemLibraryPickTitle: string;
  heyGemNeedRefVideo: string;
  heyGemNeedScript: string;
  heyGemNeedCloneAudio: string;
  heyGemDubSuccess: string;
  heyGemDubFailed: string;
  /** 设计稿：① 参考视频 / ② 台词与声音 / 生成按钮 */
  heyGemStepRefVideo: string;
  heyGemStepRefVideoHint: string;
  heyGemClickUploadRefVideo: string;
  heyGemUploadFormatsHint: string;
  heyGemStepScriptVoice: string;
  heyGemScriptCharCount: (cur: number, max: number) => string;
  heyGemVoiceModelLabel: string;
  heyGemTtsModelHint: string;
  heyGemGenerateButton: string;
  heyGemGenerating: string;
  heyGemNeedScriptOrAudio: string;
  placeholderVideoPrompt: string;
  voiceTranscribing: string;
  defaultLipsyncAction: string;
  refImageThumbTitle: (n: number) => string;
  refImageThumbAlt: (n: number) => string;
  appendImageSubject: (n: number) => string;
  /** Seedance 多模态：点击参考图插入 @图片N */
  seedanceRefImageThumbTitle: (n: number) => string;
  appendSeedanceImageTag: (n: number) => string;
  modeLipsync: string;
  modeImageToVideo: string;
  modeMultimodalVideo: string;
  modeSeedanceMini: string;
  modeTextToVideo: string;
  initializing: string;
  generatingVideo: string;
  /** LTX / generic resolution tiers */
  resStandard: string;
  resHD: string;
  resUHD: string;
  resStandard720p: string;
  resHD1280: string;
  resUHD1920: string;
  secSuffix: (n: string | number) => string;
  titleLtxLipsyncResolution: string;
  titleLtxI2vDuration: string;
  titleLtxI2vResolution: string;
  titleLtxT2vDuration: string;
  titleLtxT2vResolution: string;
  titleLtxT2vAspect: string;
  titleRhartGDuration: string;
  titleHailuoDuration: string;
  titleKlingO1Duration: string;
  titleKlingO1Mode: string;
  titleVeoResolution: string;
  titleVeoDuration: string;
  titleOutputResolution: string;
  titleWanI2vResolution: string;
  titleWanFlashDuration: string;
  /** WanAnimate 角色替换：输出宽高（工作流 150/151） */
  titleWanAnimateResolution: string;
  /** WanAnimate：片段档位（工作流 node 250，与 RH 示例 5/8/10 一致） */
  titleWanAnimateClip: string;
  titleSeedanceResolution: string;
  titleSeedanceDuration: string;
  titleSeedanceRatio: string;
  optOnlyOneImage: string;
  /** 在线视频页 URL 导入（yt-dlp） */
  bilibiliUrlPlaceholder: string;
  bilibiliGrabButton: string;
  bilibiliGrabTitle: string;
  bilibiliNeedUrl: string;
  bilibiliFetchingProgress: string;
  bilibiliGrabFailedTitle: string;
  bilibiliNotSupportedBuild: string;
  bilibiliModalTitle: string;
  bilibiliModalCancel: string;
  bilibiliModalConfirm: string;
  /** YouTube 网络不可达时的简短引导弹窗 */
  grabProxyGuideTitle: string;
  grabProxyGuideOk: string;
  /** RunningHub 视频去水印（参考视频连线时去上游素材水印） */
  videoWatermarkButton: string;
  videoWatermarkTitle: string;
  videoWatermarkNotSupported: string;
  videoWatermarkNeedVideo: string;
  videoWatermarkFailed: string;
  videoWatermarkPriceTitle: string;
  /** 视频深度转换（仅图标；结果落到右侧新模块） */
  videoDepthConvertTitle: string;
  videoDepthConvertNotSupported: string;
  videoDepthConvertNeedVideo: string;
  videoDepthConvertFailed: string;
  videoDepthConvertPriceTitle: string;
  videoDepthConvertProgress: (credits: string) => string;
  /** 视频去字幕/水印（顶栏图标；结果落到右侧新模块） */
  videoSubtitleWatermarkTitle: string;
  videoSubtitleWatermarkNotSupported: string;
  videoSubtitleWatermarkNeedVideo: string;
  videoSubtitleWatermarkFailed: string;
  videoSubtitleWatermarkPriceTitle: string;
  videoSubtitleWatermarkProgress: (credits: string) => string;
  /** 画布节点内视频：原生全屏在 transform 下失效，用自定义入口 */
  previewVideoFullscreen: string;
  previewVideoExitFullscreen: string;
  /** 视频拆帧：按间隔导出静帧到画布 */
  videoFrameSplitButton: string;
  videoFrameSplitHoverHint: string;
  videoFrameSplitInterval: (sec: number) => string;
  videoFrameSplitNeedVideo: string;
  videoFrameSplitNotSupported: string;
  videoFrameSplitPreparingLocal: string;
  videoFrameSplitNoDuration: string;
  videoFrameSplitTooMany: (max: number, count: number) => string;
  videoFrameSplitProgress: (done: number, total: number) => string;
  videoFrameSplitFailed: string;
  videoFrameSplitNodeLabel: (timeSec: number) => string;
  /** 播放条截取当前画面 → 右侧图片模块 */
  videoCaptureFrameTitle: string;
  videoCaptureFrameNotSupported: string;
  videoCaptureFrameFailed: string;
  videoCaptureFrameNodeLabel: (timeSec: number) => string;
  /** 视频画面空间裁剪（类似图片裁剪，非时间轴截取） */
  videoSpatialCropButton: string;
  videoSpatialCropTitle: string;
  videoSpatialCropHint: string;
  videoSpatialCropConfirm: string;
  videoSpatialCropConfirming: string;
  videoSpatialCropCancel: string;
  videoSpatialCropNeedVideo: string;
  videoSpatialCropNotSupported: string;
  videoSpatialCropFailed: string;
  /** 色度抠像（绿幕） */
  videoChromaKeyButton: string;
  videoChromaKeyTitle: string;
  videoChromaKeyGreen: string;
  videoChromaKeyPick: string;
  videoChromaKeySimilarity: string;
  videoChromaKeyBlend: string;
  videoChromaKeyConfirm: string;
  videoChromaKeyConfirming: string;
  videoChromaKeyCancel: string;
  videoChromaKeyNeedVideo: string;
  videoChromaKeyNotSupported: string;
  videoChromaKeyFailed: string;
  videoChromaKeyNodeLabel: string;
  /** 智能抠像（阿里云一键人像，无鼠标点选） */
  videoSmartMattingButton: string;
  videoSmartMattingTitle: string;
  videoSmartMattingHint: string;
  videoSmartMattingRunning: string;
  videoSmartMattingNeedVideo: string;
  videoSmartMattingNotSupported: string;
  videoSmartMattingFailed: string;
  videoSmartMattingNodeLabel: string;
  /** 悬停价：有时长时「约 N 元宝（按秒计费）」 */
  videoSmartMattingPriceLabel: (credits: string) => string;
  /** 悬停价：时长未知时的兜底文案 */
  videoSmartMattingPriceFallback: string;
  videoSmartMattingPriceTitle: string;
};

const zh: VideoInputPanelStrings = {
  modelLabel: '模型:',
  chooseModelTitle: '选择模型',
  aspectRatioLabel: '比例:',
  chooseAspectTitle: '选择输出比例',
  aspect169Landscape: '16:9',
  aspect916Portrait: '9:16',
  aspect11Square: '1:1',
  aspectAdaptive: '自适应',
  durationLabel: '时长:',
  durationChooseTitle: '选择视频时长',
  durationFixed8s: '8s',
  modelRhartV31ProSe: '全能视频V3.1-pro-首尾帧生视频',
  modelRhartV31ProSeTitle:
    '首尾帧；海外站；首帧必填、尾帧可选；时长仅 8s；比例 16:9/9:16；分辨率 720p/1080p/4k',
  resolutionLabel: '分辨率:',
  shotLabel: '镜头:',
  shotTitle: '单镜头 / 多镜头',
  shotSingle: '单镜头',
  shotMulti: '多镜头',
  modeLabel: '模式:',
  klingModeLabel: '模式:',
  keepRefVideoAudio: '保留参考视频原声',
  genAudio: '生成音频',
  genAudioTitle: '生成带音频的视频',
  guidanceLabel: '自由度:',
  guidanceTitle: '生成视频的自由度，值越大与提示词相关性越强',
  soundLabel: '声音',
  soundTitle: '生成视频时是否同时生成声音',
  sora2ChannelTitle: 'Sora2 算力渠道',
  sora2Plugin: '插件',
  sora2Core: '核心',
  refImagesTitle: (cur, max) => `参考图数量/最多支持几张图：${cur}/${max}`,
  refImagesBadge: (cur, max) => `参考图 ${cur}/${max}`,
  priceTooltip:
    '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity；视频 Quantity 为秒数（整条 SKU 行则为 1）',
  creditsSuffix: '元宝',
  noPricingYet: '暂未定价',
  noPricingTableTitle: '该模型或参数暂无定价表',
  promptVideoDesc: '提示词（视频描述）',
  promptAction: '动作提示词',
  refImageColumn: '参考图',
  audioConnected: '✓ 已连接音频',
  audioNeedConnect: '⚠ 请连接音频节点',
  audioRefOptional: '可连接参考音',
  wanAnimateInputLabel: '角色替换',
  wanAnimateNoPromptHint: '使用角色参考图 + 参考视频即可生成，无需填写提示词。',
  wanAnimateVideoConnected: '✓ 已连接参考视频',
  wanAnimateVideoNeedConnect: '⚠ 请连接参考视频节点',
  wanAnimateImageNeedConnect: '⚠ 请连接 1 张角色参考图',
  wanAnimateSlotRefImageLabel: '角色参考图',
  heyGemInputLabel: '数字人',
  heyGemNoPromptHint: '在模块内设置参考视频与驱动音频即可生成，无需填写提示词（Plus 48G 显存）。',
  heyGemVideoConnected: '✓ 已设置参考视频',
  heyGemVideoNeedConnect: '⚠ 请上传或选择参考视频',
  heyGemAudioConnected: '✓ 已设置驱动音频',
  heyGemAudioNeedConnect: '⚠ 请一键配音或上传驱动音频',
  heyGemSlotVideoLabel: '参考视频',
  heyGemSlotAudioLabel: '驱动音频',
  heyGemSlotConnected: '已就绪',
  heyGemSlotPending: '待设置',
  heyGemUploadVideo: '本机上传',
  heyGemPickFromCanvas: '画布选择',
  heyGemPickFromLibrary: '数字人库',
  heyGemClearVideo: '清除视频',
  heyGemScriptLabel: '台词',
  heyGemScriptPlaceholder: '请输入或粘贴您想要数字人说的台词...',
  heyGemTtsModelLabel: '配音模型',
  heyGemOneClickDub: '一键配音',
  heyGemDubbing: '配音中…',
  heyGemCloneAudioLabel: '克隆参考音',
  heyGemCloneAudioUpload: '上传参考音',
  heyGemCloneAudioClear: '清除',
  heyGemCloneAudioHint: 'Index-TTS 需参考音；默认从参考视频自动抽音',
  heyGemUploadDriveAudio: '上传驱动音频',
  heyGemLibraryEmpty: '数字人库暂无条目',
  heyGemLibraryPickTitle: '从数字人库选择参考视频',
  heyGemNeedRefVideo: '请先设置参考视频',
  heyGemNeedScript: '请先填写台词',
  heyGemNeedCloneAudio: '语音克隆需要参考音：请确保参考视频含人声，生成时将自动从视频抽音',
  heyGemDubSuccess: '配音完成，已写入驱动音频',
  heyGemDubFailed: '配音失败',
  heyGemStepRefVideo: '参考视频',
  heyGemStepRefVideoHint: '上传参考视频，数字人将基于视频形象生成',
  heyGemClickUploadRefVideo: '电脑上传',
  heyGemUploadFormatsHint: '支持 MP4、MOV 格式，大小不超过 500MB',
  heyGemStepScriptVoice: '台词与声音',
  heyGemScriptCharCount: (cur, max) => `${cur} / ${max}`,
  heyGemVoiceModelLabel: '声音模型',
  heyGemTtsModelHint: '高质量语音合成模型，支持多种语言和音色',
  heyGemGenerateButton: '生成数字人视频',
  heyGemGenerating: '生成中…',
  heyGemNeedScriptOrAudio: '请填写台词（将自动配音）或上传驱动音频',
  placeholderVideoPrompt:
    '请输入视频提示词，例如：一只小狗在草地上奔跑…（Enter 发送 · Shift+Enter 换行）',
  voiceTranscribing: '正在将语音转为文字…',
  defaultLipsyncAction:
    '人物正面朝向镜头讲话/演唱，嘴巴清晰可见，可有少量手势，禁止转身背对镜头',
  refImageThumbTitle: (n) => `参考图 ${n}`,
  refImageThumbAlt: (n) => `参考图 ${n}`,
  appendImageSubject: (n) => `图${n}主体`,
  seedanceRefImageThumbTitle: (n) => `参考图 ${n}，点击插入 @图片${n}`,
  appendSeedanceImageTag: (n) => `@图片${n}`,
  modeLipsync: '对口型',
  modeImageToVideo: '图生视频',
  modeMultimodalVideo: '多模态视频（文/图）',
  modeSeedanceMini: '多模态视频（文/图/音）',
  modeTextToVideo: '文生视频',
  initializing: '正在初始化...',
  generatingVideo: '正在生成视频...',
  // 对口型与 LTX 图生同档：720/1280/1920，展示为 720p/1280/1920
  resStandard: '720p',
  resHD: '1280',
  resUHD: '1920',
  resStandard720p: '720p',
  resHD1280: '1280',
  resUHD1920: '1920',
  secSuffix: (n) => `${n}s`,
  titleLtxLipsyncResolution: 'LTX2.3 对口型分辨率',
  titleLtxI2vDuration: 'LTX2.3 图生视频时长',
  titleLtxI2vResolution: 'LTX2.3 图生视频分辨率',
  titleLtxT2vDuration: 'LTX2.3 文生视频时长',
  titleLtxT2vResolution: 'LTX2.3 文生视频分辨率',
  titleLtxT2vAspect: 'LTX2.3 文生视频比例',
  titleRhartGDuration: '全能视频G 时长',
  titleHailuoDuration: '海螺-02 时长',
  titleKlingO1Duration: '可灵o1 时长',
  titleKlingO1Mode: '可灵o1 模式',
  titleVeoResolution: 'Veo 3.1 Pro 分辨率',
  titleVeoDuration: 'Veo 3.1 Pro 时长',
  titleOutputResolution: '输出分辨率',
  titleWanI2vResolution: '图生视频输出分辨率',
  titleWanFlashDuration: '2-15 秒',
  titleWanAnimateResolution: 'WanAnimate 输出尺寸',
  titleWanAnimateClip: 'WanAnimate 片段档位',
  titleSeedanceResolution: 'Seedance 输出分辨率',
  titleSeedanceDuration: 'Seedance 视频时长',
  titleSeedanceRatio: 'Seedance 画面比例',
  optOnlyOneImage: '仅支持 1 张图',
  bilibiliUrlPlaceholder: '粘贴视频URL',
  bilibiliGrabButton: '导入在线视频',
  /** 详细说明保留在 .env.example / 文档；界面仅简短提示 */
  bilibiliGrabTitle:
    '本机 yt-dlp 下载到画布（不经阿里云/FC/OSS）。YouTube 自适应网络；可选 NX_YTDLP_USE_PROXY；Cookie：NX_BILIBILI_COOKIES、NX_YOUTUBE_COOKIES',
  bilibiliNeedUrl: '请先粘贴视频 URL',
  bilibiliFetchingProgress: '正在导入在线视频…',
  bilibiliGrabFailedTitle: '导入在线视频失败',
  bilibiliNotSupportedBuild: '当前环境不支持导入在线视频',
  bilibiliModalTitle: '导入在线视频',
  bilibiliModalCancel: '取消',
  bilibiliModalConfirm: '确认',
  grabProxyGuideTitle: '导入在线视频遇到网络限制',
  grabProxyGuideOk: '我知道了',
  videoWatermarkButton: '视频去水印',
  videoWatermarkTitle:
    '用上一视频模块连线传入的画面去水印（或本模块自有视频）；去水印后的结果保存在当前模块（不改写上游节点）',
  videoWatermarkNotSupported: '当前环境不支持视频去水印',
  videoWatermarkNeedVideo: '请先连接视频模块或本模块已有视频后再试',
  videoWatermarkFailed: '视频去水印失败',
  videoWatermarkPriceTitle: '单次预估元宝以 nx_model_config 中 RunningHub 应用 ID 2049450731266121729 为准',
  videoDepthConvertTitle: '视频深度转换',
  videoDepthConvertNotSupported: '当前环境不支持视频深度转换',
  videoDepthConvertNeedVideo: '请先连接视频模块或本模块已有视频后再试',
  videoDepthConvertFailed: '视频深度转换失败',
  videoDepthConvertPriceTitle: '单次预估元宝以 nx_model_config 中 RunningHub 应用 ID 2082392424818757633 为准',
  videoDepthConvertProgress: (c) => `视频深度转换中…（约 ${c} 元宝）`,
  videoSubtitleWatermarkTitle: '视频去字幕/水印',
  videoSubtitleWatermarkNotSupported: '当前环境不支持视频去字幕/水印',
  videoSubtitleWatermarkNeedVideo: '请先连接视频模块或本模块已有视频后再试',
  videoSubtitleWatermarkFailed: '视频去字幕/水印失败',
  videoSubtitleWatermarkPriceTitle: '单次预估元宝以 nx_model_config 中 RunningHub 应用 ID 2082682378039943169 为准',
  videoSubtitleWatermarkProgress: (c) => `视频去字幕/水印中…（约 ${c} 元宝）`,
  previewVideoFullscreen: '全屏观看',
  previewVideoExitFullscreen: '退出全屏',
  videoFrameSplitButton: '视频拆帧',
  videoFrameSplitHoverHint: '点击或悬停，选择拆帧间隔（秒）',
  videoFrameSplitInterval: (sec) => `每 ${sec} 秒一帧`,
  videoFrameSplitNeedVideo: '请先上传或生成视频后再拆帧',
  videoFrameSplitNotSupported: '当前环境不支持视频拆帧',
  videoFrameSplitPreparingLocal: '正在下载视频到本地以便拆帧…',
  videoFrameSplitNoDuration: '无法读取视频时长，请等待视频加载完成后再试',
  videoFrameSplitTooMany: (max, count) =>
    `拆帧数量过多（${count} 张），请增大间隔；单次最多 ${max} 张`,
  videoFrameSplitProgress: (done, total) =>
    total > 0 ? `正在拆帧 ${done}/${total}…` : '正在准备拆帧…',
  videoFrameSplitFailed: '视频拆帧失败',
  videoFrameSplitNodeLabel: (timeSec) => `拆帧 ${timeSec}s`,
  videoCaptureFrameTitle: '截取当前画面',
  videoCaptureFrameNotSupported: '当前环境不支持截取画面',
  videoCaptureFrameFailed: '截取画面失败',
  videoCaptureFrameNodeLabel: (timeSec) => `截帧 ${Number(timeSec).toFixed(2)}s`,
  videoSpatialCropButton: '画面裁剪',
  videoSpatialCropTitle: '画面裁剪',
  videoSpatialCropHint: '拖动选框或四角调整保留区域，确认后按选区裁剪整段视频并生成右侧新模块（原视频不变）',
  videoSpatialCropConfirm: '确认裁剪',
  videoSpatialCropConfirming: '裁剪中…',
  videoSpatialCropCancel: '取消',
  videoSpatialCropNeedVideo: '请先上传或生成视频后再裁剪画面',
  videoSpatialCropNotSupported: '当前环境不支持画面裁剪',
  videoSpatialCropFailed: '画面裁剪失败',
  videoChromaKeyButton: '色度抠像',
  videoChromaKeyTitle: '色度抠像',
  videoChromaKeyGreen: '绿幕',
  videoChromaKeyPick: '吸色',
  videoChromaKeySimilarity: '相似度',
  videoChromaKeyBlend: '边缘',
  videoChromaKeyConfirm: '确认抠像',
  videoChromaKeyConfirming: '色度抠像中…',
  videoChromaKeyCancel: '取消',
  videoChromaKeyNeedVideo: '请先上传或生成视频后再色度抠像',
  videoChromaKeyNotSupported: '当前环境不支持色度抠像，请重启应用',
  videoChromaKeyFailed: '色度抠像失败',
  videoChromaKeyNodeLabel: '色度抠像',
  videoSmartMattingButton: '智能抠像',
  videoSmartMattingTitle: '智能抠像（人像自动，无需点选；按秒计费）',
  videoSmartMattingHint: '自动识别人像并生成透明背景视频，无需鼠标点选；按时长秒级计费',
  videoSmartMattingRunning: '智能抠像中…',
  videoSmartMattingNeedVideo: '请先上传或生成视频后再智能抠像',
  videoSmartMattingNotSupported: '当前环境不支持智能抠像，请重启应用',
  videoSmartMattingFailed: '智能抠像失败',
  videoSmartMattingNodeLabel: '智能抠像',
  videoSmartMattingPriceLabel: (c) => `约 ${c} 元宝（按秒计费）`,
  videoSmartMattingPriceFallback: '价格按视频时长计算',
  videoSmartMattingPriceTitle:
    '预估元宝按秒计费：优先 nx_model_config「viapi-segment-video-body」（元/分钟），否则本地 20 元宝/分钟',
};

const en: VideoInputPanelStrings = {
  modelLabel: 'Model:',
  chooseModelTitle: 'Choose model',
  aspectRatioLabel: 'Aspect:',
  chooseAspectTitle: 'Choose aspect ratio',
  aspect169Landscape: '16:9',
  aspect916Portrait: '9:16',
  aspect11Square: '1:1',
  aspectAdaptive: 'Adaptive',
  durationLabel: 'Duration:',
  durationChooseTitle: 'Video duration',
  durationFixed8s: '8s',
  modelRhartV31ProSe: 'All-in-One Video V3.1-pro (Start–End)',
  modelRhartV31ProSeTitle:
    'Start–end frames; overseas; first frame required, last optional; 8s only; 16:9/9:16; 720p/1080p/4k',
  resolutionLabel: 'Resolution:',
  shotLabel: 'Shots:',
  shotTitle: 'Single / multi shot',
  shotSingle: 'Single',
  shotMulti: 'Multi',
  modeLabel: 'Mode:',
  klingModeLabel: 'Mode:',
  keepRefVideoAudio: 'Keep reference video audio',
  genAudio: 'Generate audio',
  genAudioTitle: 'Generate video with audio',
  guidanceLabel: 'Guidance:',
  guidanceTitle: 'How closely the video follows the prompt (higher = stronger adherence)',
  soundLabel: 'Sound',
  soundTitle: 'Generate sound with the video',
  sora2ChannelTitle: 'Sora2 compute route',
  sora2Plugin: 'Plugin',
  sora2Core: 'Core',
  refImagesTitle: (cur, max) => `Reference images: ${cur} / ${max} max`,
  refImagesBadge: (cur, max) => `Refs ${cur}/${max}`,
  priceTooltip: 'Estimated credits from pricing table (duration may multiply quantity).',
  creditsSuffix: 'credits',
  noPricingYet: 'No price',
  noPricingTableTitle: 'No pricing row for this model or parameters',
  promptVideoDesc: 'Prompt (video description)',
  promptAction: 'Action prompt',
  refImageColumn: 'References',
  audioConnected: '✓ Audio connected',
  audioNeedConnect: '⚠ Connect an audio node',
  audioRefOptional: 'Optional reference audio',
  wanAnimateInputLabel: 'Character replace',
  wanAnimateNoPromptHint: 'Use a character reference image and reference video — no prompt required.',
  wanAnimateVideoConnected: '✓ Reference video connected',
  wanAnimateVideoNeedConnect: '⚠ Connect a reference video node',
  wanAnimateImageNeedConnect: '⚠ Connect 1 character reference image',
  wanAnimateSlotRefImageLabel: 'Character reference',
  heyGemInputLabel: 'HeyGem',
  heyGemNoPromptHint: 'Set reference video and driving audio in this module — no prompt required (Plus 48G VRAM).',
  heyGemVideoConnected: '✓ Reference video ready',
  heyGemVideoNeedConnect: '⚠ Upload or pick a reference video',
  heyGemAudioConnected: '✓ Driving audio ready',
  heyGemAudioNeedConnect: '⚠ Dub from script or upload driving audio',
  heyGemSlotVideoLabel: 'Reference video',
  heyGemSlotAudioLabel: 'Driving audio',
  heyGemSlotConnected: 'Ready',
  heyGemSlotPending: 'Not set',
  heyGemUploadVideo: 'Upload',
  heyGemPickFromCanvas: 'From canvas',
  heyGemPickFromLibrary: 'Library',
  heyGemClearVideo: 'Clear video',
  heyGemScriptLabel: 'Script',
  heyGemScriptPlaceholder: 'Enter the lines for the digital human…',
  heyGemTtsModelLabel: 'TTS model',
  heyGemOneClickDub: 'One-click dub',
  heyGemDubbing: 'Dubbing…',
  heyGemCloneAudioLabel: 'Clone voice',
  heyGemCloneAudioUpload: 'Upload ref audio',
  heyGemCloneAudioClear: 'Clear',
  heyGemCloneAudioHint: 'Index-TTS needs a voice sample; audio is extracted from the reference video by default',
  heyGemUploadDriveAudio: 'Upload driving audio',
  heyGemLibraryEmpty: 'No digital humans in library',
  heyGemLibraryPickTitle: 'Pick reference video from library',
  heyGemNeedRefVideo: 'Set a reference video first',
  heyGemNeedScript: 'Enter a script first',
  heyGemNeedCloneAudio: 'Voice clone needs a sample: use a reference video with speech so audio can be extracted',
  heyGemDubSuccess: 'Dubbing done — written to driving audio',
  heyGemDubFailed: 'Dubbing failed',
  heyGemStepRefVideo: 'Reference video',
  heyGemStepRefVideoHint: 'Upload a reference video; the digital human is based on its appearance',
  heyGemClickUploadRefVideo: 'Upload from computer',
  heyGemUploadFormatsHint: 'MP4, MOV supported, max 500MB',
  heyGemStepScriptVoice: 'Script & voice',
  heyGemScriptCharCount: (cur, max) => `${cur} / ${max}`,
  heyGemVoiceModelLabel: 'Voice model',
  heyGemTtsModelHint: 'High-quality TTS with multi-language and voice styles',
  heyGemGenerateButton: 'Generate digital human video',
  heyGemGenerating: 'Generating…',
  heyGemNeedScriptOrAudio: 'Enter a script (auto-dub) or upload driving audio',
  placeholderVideoPrompt:
    'Describe the video, e.g. A puppy running on grass… (Enter to send · Shift+Enter for newline)',
  voiceTranscribing: 'Converting speech to text…',
  defaultLipsyncAction:
    'Person facing the camera speaking/singing with mouth clearly visible; light gestures ok; no turning away',
  refImageThumbTitle: (n) => `Reference ${n}`,
  refImageThumbAlt: (n) => `Reference ${n}`,
  appendImageSubject: (n) => `Image ${n} subject`,
  seedanceRefImageThumbTitle: (n) => `Reference ${n}, click to insert @Image${n}`,
  appendSeedanceImageTag: (n) => `@Image${n}`,
  modeLipsync: 'Lip-sync',
  modeImageToVideo: 'Image to video',
  modeMultimodalVideo: 'Multimodal video (text/image)',
  modeSeedanceMini: 'Multimodal video (text/image/audio)',
  modeTextToVideo: 'Text to video',
  initializing: 'Initializing…',
  generatingVideo: 'Generating video…',
  // Lipsync uses same API tiers as LTX i2v: 720/1280/1920, shown as 720p/1280/1920
  resStandard: '720p',
  resHD: '1280',
  resUHD: '1920',
  resStandard720p: '720p',
  resHD1280: '1280',
  resUHD1920: '1920',
  secSuffix: (n) => `${n}s`,
  titleLtxLipsyncResolution: 'LTX2.3 lip-sync resolution',
  titleLtxI2vDuration: 'LTX2.3 image-to-video duration',
  titleLtxI2vResolution: 'LTX2.3 image-to-video resolution',
  titleLtxT2vDuration: 'LTX2.3 text-to-video duration',
  titleLtxT2vResolution: 'LTX2.3 text-to-video resolution',
  titleLtxT2vAspect: 'LTX2.3 text-to-video aspect',
  titleRhartGDuration: 'Video G duration',
  titleHailuoDuration: 'Hailuo duration',
  titleKlingO1Duration: 'Kling O1 duration',
  titleKlingO1Mode: 'Kling O1 mode',
  titleVeoResolution: 'Veo 3.1 Pro resolution',
  titleVeoDuration: 'Veo 3.1 Pro duration',
  titleOutputResolution: 'Output resolution',
  titleWanI2vResolution: 'Image-to-video resolution',
  titleWanFlashDuration: '2–15 seconds',
  titleWanAnimateResolution: 'WanAnimate output size',
  titleWanAnimateClip: 'WanAnimate clip tier',
  titleSeedanceResolution: 'Seedance output resolution',
  titleSeedanceDuration: 'Seedance video duration',
  titleSeedanceRatio: 'Seedance aspect ratio',
  optOnlyOneImage: '1 image only',
  bilibiliUrlPlaceholder: 'Paste video URL',
  bilibiliGrabButton: 'Import online video',
  bilibiliGrabTitle:
    'Local yt-dlp only—no FC/OSS. YouTube uses adaptive networking; optional NX_YTDLP_USE_PROXY. Cookies: NX_BILIBILI_COOKIES, NX_YOUTUBE_COOKIES',
  bilibiliNeedUrl: 'Paste a video URL first',
  bilibiliFetchingProgress: 'Importing online video…',
  bilibiliGrabFailedTitle: 'Online video import failed',
  bilibiliNotSupportedBuild: 'Online video import is not available in this build',
  bilibiliModalTitle: 'Import online video',
  bilibiliModalCancel: 'Cancel',
  bilibiliModalConfirm: 'Confirm',
  grabProxyGuideTitle: 'Online video import blocked by network',
  grabProxyGuideOk: 'OK',
  videoWatermarkButton: 'Remove video watermark',
  videoWatermarkTitle:
    'Use the upstream connected video (or this clip) for watermark removal; the result stays on this node (upstream unchanged)',
  videoWatermarkNotSupported: 'Video watermark removal is not available in this build',
  videoWatermarkNeedVideo: 'Connect a video module or add a video here first',
  videoWatermarkFailed: 'Video watermark removal failed',
  videoWatermarkPriceTitle: 'Estimated credits per run: nx_model_config row for app ID 2049450731266121729',
  videoDepthConvertTitle: 'Video depth conversion',
  videoDepthConvertNotSupported: 'Video depth conversion is not available in this build',
  videoDepthConvertNeedVideo: 'Connect a video module or add a video here first',
  videoDepthConvertFailed: 'Video depth conversion failed',
  videoDepthConvertPriceTitle: 'Estimated credits per run: nx_model_config row for app ID 2082392424818757633',
  videoDepthConvertProgress: (c) => `Converting video depth… (~${c} credits)`,
  videoSubtitleWatermarkTitle: 'Remove subtitles / watermark',
  videoSubtitleWatermarkNotSupported: 'Subtitle/watermark removal is not available in this build',
  videoSubtitleWatermarkNeedVideo: 'Connect a video module or add a video here first',
  videoSubtitleWatermarkFailed: 'Subtitle/watermark removal failed',
  videoSubtitleWatermarkPriceTitle: 'Estimated credits per run: nx_model_config row for app ID 2082682378039943169',
  videoSubtitleWatermarkProgress: (c) => `Removing subtitles/watermark… (~${c} credits)`,
  previewVideoFullscreen: 'Fullscreen',
  previewVideoExitFullscreen: 'Exit fullscreen',
  videoFrameSplitButton: 'Extract frames',
  videoFrameSplitHoverHint: 'Click or hover to choose interval (seconds)',
  videoFrameSplitInterval: (sec) => `Every ${sec}s`,
  videoFrameSplitNeedVideo: 'Add or generate a video before extracting frames',
  videoFrameSplitNotSupported: 'Frame extraction is not available in this build',
  videoFrameSplitPreparingLocal: 'Downloading video locally for frame extraction…',
  videoFrameSplitNoDuration: 'Could not read video duration — wait for the video to load and try again',
  videoFrameSplitTooMany: (max, count) =>
    `Too many frames (${count}). Use a longer interval; max ${max} per run`,
  videoFrameSplitProgress: (done, total) =>
    total > 0 ? `Extracting frames ${done}/${total}…` : 'Preparing frame extraction…',
  videoFrameSplitFailed: 'Frame extraction failed',
  videoFrameSplitNodeLabel: (timeSec) => `Frame ${timeSec}s`,
  videoCaptureFrameTitle: 'Capture current frame',
  videoCaptureFrameNotSupported: 'Frame capture is not available in this build',
  videoCaptureFrameFailed: 'Failed to capture frame',
  videoCaptureFrameNodeLabel: (timeSec) => `Capture ${Number(timeSec).toFixed(2)}s`,
  videoSpatialCropButton: 'Crop frame',
  videoSpatialCropTitle: 'Crop frame',
  videoSpatialCropHint:
    'Drag the box or corners to keep a region; confirm exports a new cropped module on the right (original stays unchanged)',
  videoSpatialCropConfirm: 'Crop',
  videoSpatialCropConfirming: 'Cropping…',
  videoSpatialCropCancel: 'Cancel',
  videoSpatialCropNeedVideo: 'Add or generate a video before cropping',
  videoSpatialCropNotSupported: 'Frame crop is not available in this build',
  videoSpatialCropFailed: 'Frame crop failed',
  videoChromaKeyButton: 'Chroma key',
  videoChromaKeyTitle: 'Chroma key',
  videoChromaKeyGreen: 'Green',
  videoChromaKeyPick: 'Eyedropper',
  videoChromaKeySimilarity: 'Similarity',
  videoChromaKeyBlend: 'Edge',
  videoChromaKeyConfirm: 'Apply key',
  videoChromaKeyConfirming: 'Keying…',
  videoChromaKeyCancel: 'Cancel',
  videoChromaKeyNeedVideo: 'Add or generate a video before chroma key',
  videoChromaKeyNotSupported: 'Chroma key is not available in this build — please restart the app',
  videoChromaKeyFailed: 'Chroma key failed',
  videoChromaKeyNodeLabel: 'Chroma key',
  videoSmartMattingButton: 'AI matting',
  videoSmartMattingTitle: 'AI portrait matting (automatic, no click; billed per second)',
  videoSmartMattingHint: 'Auto-detect people and export a transparent video — no click selection; billed by duration in seconds',
  videoSmartMattingRunning: 'AI matting…',
  videoSmartMattingNeedVideo: 'Add or generate a video before AI matting',
  videoSmartMattingNotSupported: 'AI matting is not available in this build — please restart the app',
  videoSmartMattingFailed: 'AI matting failed',
  videoSmartMattingNodeLabel: 'AI matting',
  videoSmartMattingPriceLabel: (c) => `About ${c} credits (billed per second)`,
  videoSmartMattingPriceFallback: 'Price is based on video duration',
  videoSmartMattingPriceTitle:
    'Estimated credits billed per second: prefer nx_model_config「viapi-segment-video-body」(CNY/min), else local 20 credits/min',
};

export function videoInputPanelT(locale: AppLocale): VideoInputPanelStrings {
  return locale === 'en' ? en : zh;
}
