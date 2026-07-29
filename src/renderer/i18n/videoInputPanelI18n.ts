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
  heyGemInputLabel: 'HeyGem 数字人',
  heyGemNoPromptHint: '连接参考视频与驱动音频即可生成，无需填写提示词（Plus 48G 显存）。',
  heyGemVideoConnected: '✓ 已连接参考视频',
  heyGemVideoNeedConnect: '⚠ 请连接参考视频节点',
  heyGemAudioConnected: '✓ 已连接驱动音频',
  heyGemAudioNeedConnect: '⚠ 请连接音频节点',
  heyGemSlotVideoLabel: '参考视频',
  heyGemSlotAudioLabel: '驱动音频',
  heyGemSlotConnected: '已接入',
  heyGemSlotPending: '待接入',
  placeholderVideoPrompt:
    '请输入视频提示词，例如：一只小狗在草地上奔跑，镜头缓慢移动，电影级灯光...',
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
  // 对口型内部档位仍为 720/1280/1920，展示为真实成片观感档
  resStandard: '480p',
  resHD: '720p',
  resUHD: '1080p',
  resStandard720p: '720p',
  resHD1280: '1280',
  resUHD1920: '1920',
  secSuffix: (n) => `${n}s`,
  titleLtxLipsyncResolution: 'LTX2.3 对口型分辨率（展示为真实成片观感）',
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
  heyGemInputLabel: 'HeyGem digital human',
  heyGemNoPromptHint: 'Connect reference video and driving audio — no prompt required (Plus 48G VRAM).',
  heyGemVideoConnected: '✓ Reference video connected',
  heyGemVideoNeedConnect: '⚠ Connect a reference video node',
  heyGemAudioConnected: '✓ Driving audio connected',
  heyGemAudioNeedConnect: '⚠ Connect an audio node',
  heyGemSlotVideoLabel: 'Reference video',
  heyGemSlotAudioLabel: 'Driving audio',
  heyGemSlotConnected: 'Connected',
  heyGemSlotPending: 'Not connected',
  placeholderVideoPrompt:
    'Describe the video, e.g. A puppy running on grass, slow camera move, cinematic lighting...',
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
  // Lipsync internal tiers stay 720/1280/1920; labels show effective look
  resStandard: '480p',
  resHD: '720p',
  resUHD: '1080p',
  resStandard720p: '720p',
  resHD1280: '1280',
  resUHD1920: '1920',
  secSuffix: (n) => `${n}s`,
  titleLtxLipsyncResolution: 'LTX2.3 lip-sync resolution (effective look)',
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
};

export function videoInputPanelT(locale: AppLocale): VideoInputPanelStrings {
  return locale === 'en' ? en : zh;
}
