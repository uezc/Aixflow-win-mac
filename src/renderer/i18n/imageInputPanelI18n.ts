import type { AppLocale } from './settingsI18n';

const ZH_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

export type ImageInputPanelStrings = {
  modelLabel: string;
  ratioLabel: string;
  resolutionLabel: string;
  chooseModelTitle: string;
  chooseAspectTitle: string;
  chooseResolutionTitle: string;
  refImagesCount: (n: number) => string;
  maxRefImages: (n: number) => string;
  maxRefImagesTitle: (n: number) => string;
  priceTooltip: string;
  creditsSuffix: string;
  noPricingYet: string;
  noPricingTitle: string;
  modeTooltipI2I: (n: number) => string;
  modeTooltipT2I: string;
  runI2I: string;
  runT2I: string;
  processingI2I: string;
  processingT2I: string;
  enlargeButton: string;
  enlargeTitle: string;
  chooseEnlargeSlotTitle: string;
  enlargeSlot: (indexZeroBased: number) => string;
  /** 九宫格多角度：详细九视角英文模板 */
  tagNineGridMultiAngle: string;
  tagNineGridMultiAnglePrompt: string;
  tagCinematic: string;
  /** 四视图角色表（原「三视图」位） */
  tagThreeView: string;
  /** 点击「角色四视图」填入的完整提示词 */
  tagThreeViewPrompt: string;
  /** 3D 场景 → 360° 全景（等距柱状）快捷提示词按钮 */
  tagScene3d: string;
  /** 上拉框标题 / 菜单项 */
  tagScene3dMenuTitle: string;
  tagScene3dMenuApply: string;
  tagScene3dMenuHint: string;
  /** 点击「场景转换360图」填入的模板（含 {scene_type} 等占位符，由用户自行替换） */
  tagScene3dPrompt: string;
  placeholderPrompt: string;
  titlePromptInput: string;
  refImagesColumnTitle: string;
  appendImageSubject: (indexZeroBased: number) => string;
  refThumbTitle: (n: number) => string;
  refThumbAlt: (n: number) => string;
  initializingModel: string;
  generatingImage: string;
  voiceTranscribing: string;
  voiceStartTitle: string;
  voiceStopTitle: string;
};

const zh: ImageInputPanelStrings = {
  modelLabel: '模型:',
  ratioLabel: '比例:',
  resolutionLabel: '分辨率:',
  chooseModelTitle: '选择模型',
  chooseAspectTitle: '选择比例',
  chooseResolutionTitle: '选择分辨率',
  refImagesCount: (n) => `参考图 ${n} 张`,
  maxRefImages: (n) => `最多 ${n} 张`,
  maxRefImagesTitle: (n) => `当前模型最多支持 ${n} 张参考图`,
  priceTooltip: '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity（表列 + 张数，默认 Quantity=1）',
  creditsSuffix: '元宝',
  noPricingYet: '暂未定价',
  noPricingTitle: '该模型或参数暂无定价表',
  modeTooltipI2I: (n) => `图生图模式（${n}张参考图）`,
  modeTooltipT2I: '文生图模式',
  runI2I: '图生图',
  runT2I: '文生图',
  processingI2I: '图生图',
  processingT2I: '文生图',
  enlargeButton: '图像放大',
  enlargeTitle: '图像放大：选择放大第几张图',
  chooseEnlargeSlotTitle: '选择放大第几张图',
  enlargeSlot: (i) => `放大第${i >= 0 && i < 9 ? ZH_NUM[i] : i + 1}张图`,
  tagNineGridMultiAngle: '九宫格多角度',
  tagNineGridMultiAnglePrompt:
    'Generate a nine-grid picture with the main character presented from a total of 9 perspectives: front view, left side view, right side view, oblique rear view, back view, low-angle view, and 45-degree overhead view. The character shall maintain the same pose with an unchanged scene. Ensure consistent lighting and details across all angles for overall harmony and uniformity, with no text appearing in the image.',
  tagCinematic: '电影级光影校正',
  tagThreeView: '角色四视图',
  tagThreeViewPrompt:
    '【四宫格真人写实】输出一张完整的 2×2 四宫格人物参考图（共四格）：左上正面脸部特写、右上正面全身站立、左下侧面全身站立、右下背面全身站立；同一人物、同一服装、同一发型；必须是真人写实摄影质感（photorealistic real human），禁止卡通、插画、二次元、概念设定板画风；统一纯白背景；四个宫格必须严格同等大小、等宽等高、整齐对齐；宫格之间禁止任何间隙、空隙、黑边、白边、分隔线或留白边框，四格紧密贴合；画面内无任何文字',
  tagScene3d: '场景转换360图',
  tagScene3dMenuTitle: '场景转换360图',
  tagScene3dMenuApply: '生成 360 场景（banana · 21:9 · 4K）',
  tagScene3dMenuHint: '填入全景模板，并切换全能图片 V2 / 21:9 / 4K',
  tagScene3dPrompt: `# Positive Prompt:
(360-degree equirectangular panorama:1.3) of a {scene_type} environment,
(designed for VR viewing with perfect spherical continuity:1.2).

{scene_description}

The environment is a seamless 360-degree wrap-around space.
The areas outside the original view are logically completed: [AI补充内容].
Consistent architectural and landscape logic throughout.
{lighting_desc} lighting creating {color_tone} tones.
Textures and perspectives flow continuously, (left and right edges match flawlessly:1.3),
(horizon line is perfectly level and continuous:1.2),
no visible seams, no stitch lines, spherical projection.

Photorealistic, ultra-detailed, cinematic composition, 8k resolution, {emotional_keywords}.`,
  placeholderPrompt: '输入图片生成提示词…（Enter 发送 · Shift+Enter 换行）',
  titlePromptInput: '提示词输入框',
  refImagesColumnTitle: '参考图',
  appendImageSubject: (i) => `图${i + 1}主体`,
  refThumbTitle: (n) => `参考图 ${n}（拖拽可调顺序）`,
  refThumbAlt: (n) => `参考图 ${n}`,
  initializingModel: '正在初始化模型...',
  generatingImage: '正在生成图片...',
  voiceTranscribing: '正在实时听写…',
  voiceStartTitle: '按住说话',
  voiceStopTitle: '松开结束',
};

const en: ImageInputPanelStrings = {
  modelLabel: 'Model:',
  ratioLabel: 'Ratio:',
  resolutionLabel: 'Resolution:',
  chooseModelTitle: 'Choose model',
  chooseAspectTitle: 'Choose aspect ratio',
  chooseResolutionTitle: 'Choose resolution',
  refImagesCount: (n) => `${n} ref image(s)`,
  maxRefImages: (n) => `Max ${n}`,
  maxRefImagesTitle: (n) => `This model supports up to ${n} reference images`,
  priceTooltip:
    'Estimated credits = base_price × multiplier × yuanbao_rate × Quantity (table + image count, default Quantity=1)',
  creditsSuffix: 'credits',
  noPricingYet: 'Not priced',
  noPricingTitle: 'No pricing for this model or parameters',
  modeTooltipI2I: (n) => `Image-to-image (${n} ref)`,
  modeTooltipT2I: 'Text-to-image',
  runI2I: 'Img2img',
  runT2I: 'Txt2img',
  processingI2I: 'Img2img',
  processingT2I: 'Txt2img',
  enlargeButton: 'Upscale',
  enlargeTitle: 'Upscale: choose which reference slot',
  chooseEnlargeSlotTitle: 'Choose which image to upscale',
  enlargeSlot: (i) => `Upscale image ${i + 1}`,
  tagNineGridMultiAngle: '9-grid multi-angle',
  tagNineGridMultiAnglePrompt:
    'Generate a nine-grid picture with the main character presented from a total of 9 perspectives: front view, left side view, right side view, oblique rear view, back view, low-angle view, and 45-degree overhead view. The character shall maintain the same pose with an unchanged scene. Ensure consistent lighting and details across all angles for overall harmony and uniformity, with no text appearing in the image.',
  tagCinematic: 'Cinematic lighting',
  tagThreeView: 'Character 4-view sheet',
  tagThreeViewPrompt:
    'Photorealistic real-human 2x2 reference sheet on pure white: face close-up, full-body front, full-body side, full-body back; same person/outfit; four EQUAL cells edge-to-edge with ZERO gaps or divider lines; NOT illustration/anime/concept art; no text on image',
  tagScene3d: 'Scene → 360°',
  tagScene3dMenuTitle: 'Scene → 360°',
  tagScene3dMenuApply: 'Generate 360 scene (banana · 21:9 · 4K)',
  tagScene3dMenuHint: 'Fill panorama template; switch 全能图片 V2 / 21:9 / 4K',
  tagScene3dPrompt: `# Positive Prompt:
(360-degree equirectangular panorama:1.3) of a {scene_type} environment,
(designed for VR viewing with perfect spherical continuity:1.2).

{scene_description}

The environment is a seamless 360-degree wrap-around space.
The areas outside the original view are logically completed: [AI补充内容].
Consistent architectural and landscape logic throughout.
{lighting_desc} lighting creating {color_tone} tones.
Textures and perspectives flow continuously, (left and right edges match flawlessly:1.3),
(horizon line is perfectly level and continuous:1.2),
no visible seams, no stitch lines, spherical projection.

Photorealistic, ultra-detailed, cinematic composition, 8k resolution, {emotional_keywords}.`,
  placeholderPrompt: 'Enter image prompt… (Enter to send · Shift+Enter for newline)',
  titlePromptInput: 'Prompt',
  refImagesColumnTitle: 'References',
  appendImageSubject: (i) => `Image ${i + 1} subject`,
  refThumbTitle: (n) => `Reference ${n} (drag to reorder)`,
  refThumbAlt: (n) => `Reference ${n}`,
  initializingModel: 'Initializing model…',
  generatingImage: 'Generating image…',
  voiceTranscribing: 'Live dictation…',
  voiceStartTitle: 'Hold to talk',
  voiceStopTitle: 'Release to finish',
};

export function imageInputPanelT(locale: AppLocale): ImageInputPanelStrings {
  return locale === 'en' ? en : zh;
}
