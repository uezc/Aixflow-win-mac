import type { AppLocale } from './settingsI18n';

export type ImageNodeChromeStrings = {
  mattingProgress: (credits: string) => string;
  watermarkProgress: (credits: string) => string;
  needImageFirst: string;
  mattingNotSupported: string;
  mattingFailedDefault: string;
  mattingTitle: string;
  mattingButton: string;
  mattingPriceTitle: string;
  watermarkNotSupported: string;
  watermarkFailedDefault: string;
  watermarkTitle: string;
  watermarkButton: string;
  watermarkPriceTitle: string;
  upscaleV3Progress: (credits: string) => string;
  upscaleV3NotSupported: string;
  upscaleV3FailedDefault: string;
  /** 悬停/aria 用，按钮上不显示文字 */
  upscaleV3Title: string;
  upscaleV3PriceTitle: string;
  multiAngleProgress: (credits: string) => string;
  multiAngleNotSupported: string;
  multiAngleFailedDefault: string;
  multiAngleTitle: string;
  multiAngleButton: string;
  multiAnglePriceTitle: string;
  perspective3dTitle: string;
  perspective3dButton: string;
  dragCubeHint: string;
  closeAria: string;
  drawingBoardTitle: string;
  drawingBoardAria: string;
  drawingBoardButton: string;
  /** 图片节点顶部：3D 空间构图入口（与画板并列） */
  spatialCompositionTitle: string;
  spatialCompositionAria: string;
  spatialCompositionButton: string;
  flipButton: string;
  flipHorizontalTitle: string;
  flipVerticalTitle: string;
  flipMenuHoverHint: string;
  cropButton: string;
  cropTitle: string;
  cropHint: string;
  cropConfirm: string;
  cropConfirming: string;
  cropCancel: string;
  cropFailed: string;
  /** 裁剪导出到画布的新模块标题 */
  cropNodeLabel: string;
  uploadImageTitle: string;
  downloadTitle: string;
  zoomPreviewTitle: string;
  /** 节点已选中时：再次点击或空格放大 */
  previewOpenHint: string;
  creditsSuffix: string;
  editTitle: string;
  webglChecking: string;
  webglUnavailable: string;
  webglUnavailableHint: string;
  resetView: string;
  rotation: string;
  tilt: string;
  shotScale: string;
  /** 视角控制器内可选图生图模型 */
  cameraControlModelTitle: string;
  cameraControlModelBanana: string;
  cameraControlModelSeedream: string;
  /** 视角生成比例 */
  cameraControlAspectTitle: string;
  cameraControlAspectOriginal: string;
  cameraControlResolutionTitle: string;
  cameraGenerateAria: string;
  cameraGenerateNeedImage: string;
  cameraGenerateNodeLabel: string;
  shotCloseup: string;
  shotMedium: string;
  shotWide: string;
  rotateAngleTitle: string;
  tiltAngleTitle: string;
  shotScaleTitle: string;
  /** 占位 SVG 中简短错误文案 */
  imageLoadFailedShort: string;
  /** 360° 等距柱状全景预览（嵌入图片模块） */
  panorama360Title: string;
  panorama360Button: string;
  panorama360ViewMode: string;
  panorama360Preview: string;
  panorama360PreviewExit: string;
  panorama360Convert: string;
  panorama360ConvertNodeLabel: string;
  panorama360SceneConvert: string;
  panorama360SceneConvertHint: string;
  panorama360Hint: string;
  panorama360NoImage: string;
  panorama360Near: string;
  panorama360Far: string;
  panorama360ZoomTitle: string;
  panorama360AspectAdaptive: string;
  panorama360Screenshot: string;
  panorama360ResetFov: string;
  panorama360CaptureFailed: string;
  panorama360NeedProject: string;
  panorama360CaptureNotReady: string;
  panorama360CaptureNodeLabel: string;
  panorama360ExpandRatioPicker: string;
  panorama360CollapseRatioPicker: string;
  panorama360RatioShortcutHint: string;
  /** 将九宫格输出拆成 9 个独立图片节点 */
  splitNineButton: string;
  splitNineTitle: string;
  /** 悬停「一键拆分」主区域时的简短说明 */
  splitGridHoverHint: string;
  /** 下拉：四宫格拆分 */
  splitGridMenuFour: string;
  /** 下拉：2×3 六宫格 */
  splitGridMenuTwoByThree: string;
  /** 下拉：3×2 六宫格 */
  splitGridMenuThreeByTwo: string;
  /** 下拉：九宫格拆分 */
  splitGridMenuNine: string;
  /** 下拉：自定义行列 */
  splitGridMenuCustom: string;
  splitGridCustomApply: string;
  splitGridCustomInvalid: string;
  /** 多图全屏预览：导入单张为新图片节点 */
  importToCanvasButton: string;
  importToCanvasSuccess: string;
  importToCanvasFailed: string;
  /** 单张合成九宫格裁切失败（画布/IPC） */
  splitNineCropFailed: string;
  splitNineNodeLabel: (index: number) => string;
  splitFourNodeLabel: (index: number) => string;
  splitSixNodeLabel: (index: number) => string;
  splitCustomNodeLabel: (index: number) => string;
};

const zh: ImageNodeChromeStrings = {
  mattingProgress: (c) => `抠图中…（约 ${c} 元宝）`,
  watermarkProgress: (c) => `去水印中…（约 ${c} 元宝）`,
  needImageFirst: '请先连接或上传图片',
  mattingNotSupported: '当前环境不支持抠图',
  mattingFailedDefault: '抠图失败',
  mattingTitle: '抠图（去除背景）',
  mattingButton: '抠图',
  mattingPriceTitle: '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity（单次抠图，优先 nx_model_config）',
  watermarkNotSupported: '当前环境不支持去水印',
  watermarkFailedDefault: '去水印失败',
  watermarkTitle: '去水印',
  watermarkButton: '去水印',
  watermarkPriceTitle: '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity（单次去水印，优先 nx_model_config）',
  upscaleV3Progress: (c) => `超分放大中…（约 ${c} 元宝）`,
  upscaleV3NotSupported: '当前环境不支持超分放大',
  upscaleV3FailedDefault: '超分放大失败',
  upscaleV3Title: '超分放大',
  upscaleV3PriceTitle: '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity（单次超分，优先 nx_model_config）',
  multiAngleProgress: (c) => `人物多角度生成中…（约 ${c} 元宝）`,
  multiAngleNotSupported: '当前环境不支持人物多角度',
  multiAngleFailedDefault: '人物多角度生成失败',
  multiAngleTitle: '人物多角度',
  multiAngleButton: '人物多角度',
  multiAnglePriceTitle: '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity（单次人物多角度，优先 nx_model_config，应用 ID 1990056102572290049）',
  perspective3dTitle: '3D 视角',
  perspective3dButton: '3D 视角',
  dragCubeHint: '拖拽正方体改变角度',
  closeAria: '关闭',
  drawingBoardTitle: '在画板中打开图片进行绘图和标记',
  drawingBoardAria: '画板',
  drawingBoardButton: '画板',
  spatialCompositionTitle: '打开 3D 空间构图，在三维场景中摆放物体并输出到本节点',
  spatialCompositionAria: '3D 空间构图',
  spatialCompositionButton: '3D构图',
  flipButton: '翻转',
  flipHorizontalTitle: '水平翻转',
  flipVerticalTitle: '垂直翻转',
  flipMenuHoverHint: '悬停选择水平或垂直翻转',
  cropButton: '裁剪',
  cropTitle: '图片裁剪',
  cropHint: '拖动选框或四角调整保留区域；双击选区或点确认后，按选区裁剪并生成右侧新模块（原图不变）',
  cropConfirm: '确认裁剪',
  cropConfirming: '裁剪中…',
  cropCancel: '取消',
  cropNodeLabel: '画面裁剪',
  cropFailed: '裁剪失败，请确认图片已加载完成',
  uploadImageTitle: '上传图片',
  downloadTitle: '下载',
  zoomPreviewTitle: '放大预览',
  previewOpenHint: '双击或按空格全屏预览（预览内滚轮缩放）；模块上 Ctrl+滚轮查看细节',
  creditsSuffix: '元宝',
  editTitle: '编辑标题',
  webglChecking: '检测 WebGL…',
  webglUnavailable: 'WebGL 不可用',
  webglUnavailableHint: '请尝试刷新页面或使用支持 WebGL 的浏览器',
  resetView: '重置',
  rotation: '水平角度',
  tilt: '垂直角度',
  shotScale: '距离',
  cameraControlModelTitle: '选择模型',
  cameraControlModelBanana: '全能图片 V2',
  cameraControlModelSeedream: 'Seedream v5',
  cameraControlAspectTitle: '比例',
  cameraControlAspectOriginal: '原始',
  cameraControlResolutionTitle: '清晰度',
  cameraGenerateAria: '生成',
  cameraGenerateNeedImage: '请先有图片再生成',
  cameraGenerateNodeLabel: '视角生成',
  shotCloseup: '特写',
  shotMedium: '中景',
  shotWide: '全景',
  rotateAngleTitle: '水平角度',
  tiltAngleTitle: '垂直角度',
  shotScaleTitle: '距离',
  imageLoadFailedShort: '图片加载失败',
  panorama360Title: '360° 全景',
  panorama360Button: '360° 全景',
  panorama360ViewMode: '360° 环视',
  panorama360Preview: '预览',
  panorama360PreviewExit: '退出预览',
  panorama360Convert: '转换',
  panorama360ConvertNodeLabel: '360场景图',
  panorama360SceneConvert: '场景转换360图',
  panorama360SceneConvertHint: '选择支持 21:9 的图生图模型，套用全景模板并生成',
  panorama360Hint: '拖拽视角浏览；支持等距柱状投影全景图',
  panorama360NoImage: '请先生成或上传图片后再查看全景',
  panorama360Near: '近',
  panorama360Far: '远',
  panorama360ZoomTitle: '视野远近',
  panorama360AspectAdaptive: '自适应',
  panorama360Screenshot: '相机截图',
  panorama360ResetFov: '视角复位',
  panorama360CaptureFailed: '全景截图失败',
  panorama360NeedProject: '请先打开或保存项目后再截图到画布',
  panorama360CaptureNotReady: '渲染未就绪，请稍后再试',
  panorama360CaptureNodeLabel: '全景截图',
  panorama360ExpandRatioPicker: '展开截图比例',
  panorama360CollapseRatioPicker: '收起比例',
  panorama360RatioShortcutHint: 'C 展开/收起',
  splitNineButton: '一键拆分',
  splitNineTitle:
    '多图：按张拆成节点；单张合成图：可拆为 2×2 / 2×3 / 3×2 / 3×3 或自定义行列。悬停按钮选择方式，新节点在右侧画布生成。',
  splitGridHoverHint: '悬停选择：2×2 / 2×3 / 3×2 / 3×3 / 自定义拆分',
  splitGridMenuFour: '四宫格拆分（2×2）',
  splitGridMenuTwoByThree: '六宫格拆分（2×3）',
  splitGridMenuThreeByTwo: '六宫格拆分（3×2）',
  splitGridMenuNine: '九宫格拆分（3×3）',
  splitGridMenuCustom: '自定义',
  splitGridCustomApply: '拆分',
  splitGridCustomInvalid: '请输入 1–8 的列数与行数（最多 36 格）',
  importToCanvasButton: '导入到画布',
  importToCanvasSuccess: '导入成功',
  importToCanvasFailed: '导入到画布失败，请稍后重试',
  splitNineCropFailed: '裁切失败：请确认图片已加载完成，或尝试重新打开项目后再试',
  splitNineNodeLabel: (index) => `九宫格 ${index + 1}`,
  splitFourNodeLabel: (index) => `四宫格 ${index + 1}`,
  splitSixNodeLabel: (index) => `六宫格 ${index + 1}`,
  splitCustomNodeLabel: (index) => `宫格 ${index + 1}`,
};

const en: ImageNodeChromeStrings = {
  mattingProgress: (c) => `Removing background… (~${c} credits)`,
  watermarkProgress: (c) => `Removing watermark… (~${c} credits)`,
  needImageFirst: 'Connect or upload an image first',
  mattingNotSupported: 'Background removal is not available',
  mattingFailedDefault: 'Background removal failed',
  mattingTitle: 'Remove background',
  mattingButton: 'Matting',
  mattingPriceTitle: 'Estimated credits (per run, nx_model_config)',
  watermarkNotSupported: 'Watermark removal is not available',
  watermarkFailedDefault: 'Watermark removal failed',
  watermarkTitle: 'Remove watermark',
  watermarkButton: 'Dewatermark',
  watermarkPriceTitle: 'Estimated credits (per run, nx_model_config)',
  upscaleV3Progress: (c) => `Upscaling… (~${c} credits)`,
  upscaleV3NotSupported: 'Upscale is not available',
  upscaleV3FailedDefault: 'Upscale failed',
  upscaleV3Title: 'Upscale',
  upscaleV3PriceTitle: 'Estimated credits (per run, nx_model_config)',
  multiAngleProgress: (c) => `Generating multi-angle views… (~${c} credits)`,
  multiAngleNotSupported: 'Multi-angle generation is not available',
  multiAngleFailedDefault: 'Multi-angle generation failed',
  multiAngleTitle: 'Character multi-angle',
  multiAngleButton: 'Multi-angle',
  multiAnglePriceTitle: 'Estimated credits (per run, nx_model_config, app 1990056102572290049)',
  perspective3dTitle: '3D view',
  perspective3dButton: '3D view',
  dragCubeHint: 'Drag the cube to adjust angle',
  closeAria: 'Close',
  drawingBoardTitle: 'Open in drawing board',
  drawingBoardAria: 'Drawing board',
  drawingBoardButton: 'Draw',
  spatialCompositionTitle: 'Open 3D spatial layout: place objects and export to this node',
  spatialCompositionAria: '3D spatial layout',
  spatialCompositionButton: '3D layout',
  flipButton: 'Flip',
  flipHorizontalTitle: 'Flip horizontal',
  flipVerticalTitle: 'Flip vertical',
  flipMenuHoverHint: 'Hover for horizontal or vertical flip',
  cropButton: 'Crop',
  cropTitle: 'Crop image',
  cropHint:
    'Drag the box or corners to keep a region. Double-click the selection or confirm to crop into a new module on the right (original stays unchanged).',
  cropConfirm: 'Confirm crop',
  cropConfirming: 'Cropping…',
  cropCancel: 'Cancel',
  cropFailed: 'Crop failed. Ensure the image is loaded.',
  cropNodeLabel: 'Cropped image',
  uploadImageTitle: 'Upload image',
  downloadTitle: 'Download',
  zoomPreviewTitle: 'Zoom preview',
  previewOpenHint: 'Double-click or Space for fullscreen (wheel to zoom); Ctrl+wheel on module to inspect',
  creditsSuffix: 'credits',
  editTitle: 'Edit title',
  webglChecking: 'Checking WebGL…',
  webglUnavailable: 'WebGL unavailable',
  webglUnavailableHint: 'Try refreshing or use a browser with WebGL support',
  resetView: 'Reset',
  rotation: 'Horizontal',
  tilt: 'Vertical',
  shotScale: 'Distance',
  cameraControlModelTitle: 'Model',
  cameraControlModelBanana: '全能图片 V2',
  cameraControlModelSeedream: 'Seedream v5',
  cameraControlAspectTitle: 'Aspect',
  cameraControlAspectOriginal: 'Original',
  cameraControlResolutionTitle: 'Clarity',
  cameraGenerateAria: 'Generate',
  cameraGenerateNeedImage: 'Add an image before generating',
  cameraGenerateNodeLabel: 'Camera view',
  shotCloseup: 'Close-up',
  shotMedium: 'Medium',
  shotWide: 'Wide',
  rotateAngleTitle: 'Horizontal angle',
  tiltAngleTitle: 'Vertical angle',
  shotScaleTitle: 'Distance',
  imageLoadFailedShort: 'Image failed to load',
  panorama360Title: '360° panorama',
  panorama360Button: '360° panorama',
  panorama360ViewMode: '360° look-around',
  panorama360Preview: 'Preview',
  panorama360PreviewExit: 'Exit preview',
  panorama360Convert: 'Convert',
  panorama360ConvertNodeLabel: '360 scene',
  panorama360SceneConvert: 'Scene → 360°',
  panorama360SceneConvertHint: 'Pick a 21:9 img2img model; apply panorama template and generate',
  panorama360Hint: 'Drag to look around. Equirectangular images work best.',
  panorama360NoImage: 'Add or generate an image first.',
  panorama360Near: 'Near',
  panorama360Far: 'Far',
  panorama360ZoomTitle: 'Field of view',
  panorama360AspectAdaptive: 'Auto',
  panorama360Screenshot: 'Capture',
  panorama360ResetFov: 'Reset view',
  panorama360CaptureFailed: 'Panorama capture failed',
  panorama360NeedProject: 'Open or save a project before capturing to the canvas',
  panorama360CaptureNotReady: 'Renderer not ready, try again',
  panorama360CaptureNodeLabel: 'Panorama capture',
  panorama360ExpandRatioPicker: 'Choose aspect ratio',
  panorama360CollapseRatioPicker: 'Collapse',
  panorama360RatioShortcutHint: 'C to toggle',
  splitNineButton: 'Split grid',
  splitNineTitle:
    'Multi-image: one node per URL. Single composite: split into 2×2 / 2×3 / 3×2 / 3×3 or custom rows×cols. Hover the button to choose; new nodes appear to the right.',
  splitGridHoverHint: 'Hover to choose: 2×2 / 2×3 / 3×2 / 3×3 / custom',
  splitGridMenuFour: '2×2 split',
  splitGridMenuTwoByThree: '2×3 split',
  splitGridMenuThreeByTwo: '3×2 split',
  splitGridMenuNine: '3×3 split',
  splitGridMenuCustom: 'Custom',
  splitGridCustomApply: 'Split',
  splitGridCustomInvalid: 'Enter columns and rows from 1–8 (max 36 cells)',
  importToCanvasButton: 'Import to canvas',
  importToCanvasSuccess: 'Imported successfully',
  importToCanvasFailed: 'Failed to import to canvas. Please try again.',
  splitNineCropFailed: 'Crop failed: ensure the image is fully loaded, or reopen the project and try again.',
  splitNineNodeLabel: (index) => `Grid ${index + 1}`,
  splitFourNodeLabel: (index) => `Quad ${index + 1}`,
  splitSixNodeLabel: (index) => `Six ${index + 1}`,
  splitCustomNodeLabel: (index) => `Tile ${index + 1}`,
};

export function imageNodeChromeT(locale: AppLocale): ImageNodeChromeStrings {
  return locale === 'en' ? en : zh;
}

/** 与 `CAMERA_PRESETS`（cameraControlUtils）顺序一致 */
const CAMERA_PRESET_LABELS_ZH = ['正面', '右45°', '左45°', '背面', '仰拍', '俯拍', '特写', '中景', '全景'] as const;
const CAMERA_PRESET_LABELS_EN = [
  'Front',
  'Right 45°',
  'Left 45°',
  'Back',
  'Low angle',
  'High angle',
  'Close-up',
  'Medium',
  'Wide',
] as const;

export function imageNodeCameraPresetLabel(locale: AppLocale, index: number): string {
  const list = locale === 'en' ? CAMERA_PRESET_LABELS_EN : CAMERA_PRESET_LABELS_ZH;
  return list[index] ?? String(index);
}
