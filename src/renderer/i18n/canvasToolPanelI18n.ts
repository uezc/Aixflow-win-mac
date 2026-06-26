import type { AppLocale } from './settingsI18n';

export type CanvasToolPanelStrings = {
  panelTitle: string;
  wheelZoomTitle: string;
  zoomOutTitle: string;
  zoomInTitle: string;
  fullscreenEnter: string;
  fullscreenExit: string;
  fullscreenToggleTitle: string;
  clear: string;
  done: string;
  cancel: string;
  color: string;
  colorAria: (hex: string) => string;
  /** 选择笔刷大小时的标签 */
  brushSizeLabel: string;
  /** 选择橡皮擦大小时的标签 */
  eraserSizeLabel: string;
  shape: string;
  toolBrushTitle: string;
  toolEraserTitle: string;
  toolRectTitle: string;
  toolCircleTitle: string;
  toolTextTitle: string;
  /** 立体小人：工具栏按钮与放置提示 */
  toolManikinTitle: string;
  manikinPlaceHint: string;
  manikinSizeLabel: string;
  manikinRotationLabel: string;
  textPlaceholder: string;
  exportCrossOriginAlert: string;
};

const zh: CanvasToolPanelStrings = {
  panelTitle: '画板工具',
  wheelZoomTitle: '滚轮缩放画布',
  zoomOutTitle: '缩小',
  zoomInTitle: '放大',
  fullscreenEnter: '全屏',
  fullscreenExit: '退出全屏',
  fullscreenToggleTitle: '画板全屏',
  clear: '清空',
  done: '完成',
  cancel: '取消',
  color: '颜色',
  colorAria: (hex) => `选择颜色 ${hex}`,
  brushSizeLabel: '笔刷尺寸',
  eraserSizeLabel: '橡皮擦尺寸',
  shape: '形状',
  toolBrushTitle: '笔刷',
  toolEraserTitle: '橡皮擦',
  toolRectTitle: '空心矩形',
  toolCircleTitle: '空心圆形',
  toolTextTitle: '文字',
  toolManikinTitle: '立体小人',
  manikinPlaceHint: '已选中：在画布上点击放置小人，或从按钮拖入画布',
  manikinSizeLabel: '小人大小',
  manikinRotationLabel: '小人朝向',
  textPlaceholder: '输入文字',
  exportCrossOriginAlert: '无法导出标记：画布中的图片来自跨域地址，浏览器禁止导出。请使用本地上传的图片。',
};

const en: CanvasToolPanelStrings = {
  panelTitle: 'Canvas tools',
  wheelZoomTitle: 'Scroll wheel to zoom',
  zoomOutTitle: 'Zoom out',
  zoomInTitle: 'Zoom in',
  fullscreenEnter: 'Fullscreen',
  fullscreenExit: 'Exit fullscreen',
  fullscreenToggleTitle: 'Toggle fullscreen',
  clear: 'Clear',
  done: 'Done',
  cancel: 'Cancel',
  color: 'Color',
  colorAria: (hex) => `Color ${hex}`,
  brushSizeLabel: 'Brush size',
  eraserSizeLabel: 'Eraser size',
  shape: 'Shape',
  toolBrushTitle: 'Brush',
  toolEraserTitle: 'Eraser',
  toolRectTitle: 'Hollow rectangle',
  toolCircleTitle: 'Hollow circle',
  toolTextTitle: 'Text',
  toolManikinTitle: '3D figure',
  manikinPlaceHint: 'Active: click on the canvas to place, or drag from the button onto the canvas',
  manikinSizeLabel: 'Figure size',
  manikinRotationLabel: 'Figure rotation',
  textPlaceholder: 'Type text',
  exportCrossOriginAlert:
    'Cannot export: the image is from a cross-origin URL. Use a locally uploaded image.',
};

export function canvasToolPanelT(locale: AppLocale): CanvasToolPanelStrings {
  return locale === 'en' ? en : zh;
}
