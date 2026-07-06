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
  /** 360° 球幕 + 道具摆放合一编辑器 */
  panoramaPlacementTitle: string;
  panoramaPlacementAria: string;
  panoramaPlacementButton: string;
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
  /** 下拉：九宫格拆分 */
  splitGridMenuNine: string;
  /** 多图全屏预览：导入单张为新图片节点 */
  importToCanvasButton: string;
  importToCanvasSuccess: string;
  importToCanvasFailed: string;
  /** 单张合成九宫格裁切失败（画布/IPC） */
  splitNineCropFailed: string;
  splitNineNodeLabel: (index: number) => string;
  splitFourNodeLabel: (index: number) => string;
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
  multiAngleProgress: (c) => `人物多角度生成中…（约 ${c} 元宝）`,
  multiAngleNotSupported: '当前环境不支持人物多角度',
  multiAngleFailedDefault: '人物多角度生成失败',
  multiAngleTitle: '人物多角度',
  multiAngleButton: '人物多角度',
  multiAnglePriceTitle: '预估元宝 = base_price×multiplier×yuanbao_rate×Quantity（单次人物多角度，优先 nx_model_config，应用 ID 1990056102572290049）',
  perspective3dTitle: '3D 视角',
  perspective3dButton: '3D 视角',
  dragCubeHint: '拖拽方块调整角度',
  closeAria: '关闭',
  drawingBoardTitle: '在画板中打开图片进行绘图和标记',
  drawingBoardAria: '画板',
  drawingBoardButton: '画板',
  spatialCompositionTitle: '打开 3D 空间构图，在三维场景中摆放物体并输出到本节点',
  spatialCompositionAria: '3D 空间构图',
  spatialCompositionButton: '3D构图',
  panoramaPlacementTitle: '在 360° 球幕中摆放人物并导出到画布',
  panoramaPlacementAria: '3D 全景摆放',
  panoramaPlacementButton: '3D场景预览',
  flipButton: '翻转',
  flipHorizontalTitle: '水平翻转',
  flipVerticalTitle: '垂直翻转',
  flipMenuHoverHint: '悬停选择水平或垂直翻转',
  cropButton: '裁剪',
  cropTitle: '图片裁剪',
  cropHint: '拖拽选框移动位置，拖动四角调整范围，确认后替换当前图片',
  cropConfirm: '确认裁剪',
  cropConfirming: '裁剪中…',
  cropCancel: '取消',
  cropFailed: '裁剪失败，请确认图片已加载完成',
  uploadImageTitle: '上传图片',
  downloadTitle: '下载',
  zoomPreviewTitle: '放大预览',
  previewOpenHint: '再次点击或按空格放大预览',
  creditsSuffix: '元宝',
  editTitle: '编辑标题',
  webglChecking: '检测 WebGL…',
  webglUnavailable: 'WebGL 不可用',
  webglUnavailableHint: '请尝试刷新页面或使用支持 WebGL 的浏览器',
  resetView: '重置',
  rotation: '旋转',
  tilt: '倾斜',
  shotScale: '景别',
  shotCloseup: '特写',
  shotMedium: '中景',
  shotWide: '全景',
  rotateAngleTitle: '旋转角度',
  tiltAngleTitle: '倾斜角度',
  shotScaleTitle: '景别缩放',
  imageLoadFailedShort: '图片加载失败',
  panorama360Title: '360° 全景',
  panorama360Button: '360° 全景',
  panorama360Hint: '拖拽视角浏览；支持等距柱状投影全景图',
  panorama360NoImage: '请先生成或上传图片后再查看全景',
  panorama360Near: '近',
  panorama360Far: '远',
  panorama360ZoomTitle: '视野远近',
  panorama360AspectAdaptive: '自适应',
  panorama360Screenshot: '截图',
  panorama360ResetFov: '复位',
  panorama360CaptureFailed: '全景截图失败',
  panorama360NeedProject: '请先打开或保存项目后再截图到画布',
  panorama360CaptureNotReady: '渲染未就绪，请稍后再试',
  panorama360CaptureNodeLabel: '全景截图',
  panorama360ExpandRatioPicker: '展开截图比例',
  panorama360CollapseRatioPicker: '收起比例',
  panorama360RatioShortcutHint: 'C 展开/收起',
  splitNineButton: '一键拆分',
  splitNineTitle:
    '多图：按张拆成节点（最多 9 张）；单张合成图：可拆为 2×2 四宫或 3×3 九宫。悬停按钮选择方式，新节点在右侧画布生成。',
  splitGridHoverHint: '悬停选择：四宫格拆分 或 九宫格拆分',
  splitGridMenuFour: '四宫格拆分（2×2）',
  splitGridMenuNine: '九宫格拆分（3×3）',
  importToCanvasButton: '导入到画布',
  importToCanvasSuccess: '导入成功',
  importToCanvasFailed: '导入到画布失败，请稍后重试',
  splitNineCropFailed: '裁切失败：请确认图片已加载完成，或尝试重新打开项目后再试',
  splitNineNodeLabel: (index) => `九宫格 ${index + 1}`,
  splitFourNodeLabel: (index) => `四宫格 ${index + 1}`,
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
  panoramaPlacementTitle: 'Open 3D panorama: place figures on the 360° view and export to canvas',
  panoramaPlacementAria: '3D panorama placement',
  panoramaPlacementButton: '3D scene preview',
  flipButton: 'Flip',
  flipHorizontalTitle: 'Flip horizontal',
  flipVerticalTitle: 'Flip vertical',
  flipMenuHoverHint: 'Hover for horizontal or vertical flip',
  cropButton: 'Crop',
  cropTitle: 'Crop image',
  cropHint: 'Drag the box to move; drag corners to resize. Confirm to replace the current image.',
  cropConfirm: 'Apply crop',
  cropConfirming: 'Cropping…',
  cropCancel: 'Cancel',
  cropFailed: 'Crop failed. Ensure the image is loaded.',
  uploadImageTitle: 'Upload image',
  downloadTitle: 'Download',
  zoomPreviewTitle: 'Zoom preview',
  previewOpenHint: 'Click again or press Space to zoom',
  creditsSuffix: 'credits',
  editTitle: 'Edit title',
  webglChecking: 'Checking WebGL…',
  webglUnavailable: 'WebGL unavailable',
  webglUnavailableHint: 'Try refreshing or use a browser with WebGL support',
  resetView: 'Reset',
  rotation: 'Rotation',
  tilt: 'Tilt',
  shotScale: 'Framing',
  shotCloseup: 'Close-up',
  shotMedium: 'Medium',
  shotWide: 'Wide',
  rotateAngleTitle: 'Rotation angle',
  tiltAngleTitle: 'Tilt angle',
  shotScaleTitle: 'Framing / distance',
  imageLoadFailedShort: 'Image failed to load',
  panorama360Title: '360° panorama',
  panorama360Button: '360° panorama',
  panorama360Hint: 'Drag to look around. Equirectangular images work best.',
  panorama360NoImage: 'Add or generate an image first.',
  panorama360Near: 'Near',
  panorama360Far: 'Far',
  panorama360ZoomTitle: 'Field of view',
  panorama360AspectAdaptive: 'Auto',
  panorama360Screenshot: 'Capture',
  panorama360ResetFov: 'Reset',
  panorama360CaptureFailed: 'Panorama capture failed',
  panorama360NeedProject: 'Open or save a project before capturing to the canvas',
  panorama360CaptureNotReady: 'Renderer not ready, try again',
  panorama360CaptureNodeLabel: 'Panorama capture',
  panorama360ExpandRatioPicker: 'Choose aspect ratio',
  panorama360CollapseRatioPicker: 'Collapse',
  panorama360RatioShortcutHint: 'C to toggle',
  splitNineButton: 'Split grid',
  splitNineTitle:
    'Multi-image: one node per URL (up to 9). Single composite: split into 2×2 or 3×3 tiles. Hover the button to choose; new nodes appear to the right.',
  splitGridHoverHint: 'Hover to choose: 2×2 or 3×3 split',
  splitGridMenuFour: '2×2 split',
  splitGridMenuNine: '3×3 split',
  importToCanvasButton: 'Import to canvas',
  importToCanvasSuccess: 'Imported successfully',
  importToCanvasFailed: 'Failed to import to canvas. Please try again.',
  splitNineCropFailed: 'Crop failed: ensure the image is fully loaded, or reopen the project and try again.',
  splitNineNodeLabel: (index) => `Grid ${index + 1}`,
  splitFourNodeLabel: (index) => `Quad ${index + 1}`,
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
