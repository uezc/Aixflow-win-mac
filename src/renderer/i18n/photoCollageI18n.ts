import type { AppLocale } from './settingsI18n';

export type PhotoCollageStrings = {
  nodeTitle: string;
  ratioLabel: string;
  canvasSize: string;
  custom: string;
  collapseCustom: string;
  pickRatioTitle: string;
  canvasPixelTitle: string;
  customSizeHint: string;
  canvasWidth: string;
  canvasHeight: string;
  apply: string;
  importFromNodesTitle: string;
  /** 超级连线超出图层上限时提示；{n}=忽略张数 {max}=上限 */
  superConnectOverflow: string;
  layerUp: string;
  layerDown: string;
  layerFront: string;
  layerBack: string;
  flipH: string;
  flipV: string;
  deleteLayer: string;
  exportToWorkspaceTitle: string;
  fullscreenEdit: string;
  resetTransform: string;
  rotateKnob: string;
  exportPng: string;
  studioTitle: string;
  studioSubtitle: string;
  escClose: string;
  exportToCanvas: string;
  exportToCanvasShort: string;
  exportToCanvasDone: string;
  exportToCanvasFailed: string;
  backToCanvas: string;
  canvasSizeSection: string;
  aspectPickHint: string;
  canvasSizeDesc: string;
  customModeHint: string;
  noTemplateHint: string;
  layers: string;
  layerLabel: string;
  noLayers: string;
  reset: string;
  direction: string;
  resetLayerTitle: string;
  rotateLayerTitle: string;
  layerUpTitle: string;
  layerDownTitle: string;
  layerFrontTitle: string;
  layerBackTitle: string;
  flipHTitle: string;
  flipVTitle: string;
  deleteLayerTitle: string;
  footerCanvas: string;
  footerViewport: string;
  footerScale: string;
  footerSelectedLayer: string;
  footerNoSelection: string;
  width: string;
  height: string;
};

const zh: PhotoCollageStrings = {
  nodeTitle: '拼图',
  ratioLabel: '比例',
  canvasSize: '画布尺寸',
  custom: '自定义',
  collapseCustom: '收起自定义',
  pickRatioTitle: '选择画布比例与分辨率',
  canvasPixelTitle: '画布 {w}×{h} 像素',
  customSizeHint: '自定义尺寸，可直接输入宽高：',
  canvasWidth: '画布宽度',
  canvasHeight: '画布高度',
  apply: '应用',
  importFromNodesTitle: '连接图片模块导入（可超级连线批量导入）',
  superConnectOverflow: '拼图最多 {max} 层，已忽略多余的 {n} 张图',
  layerUp: '上移一层',
  layerDown: '下移一层',
  layerFront: '置顶',
  layerBack: '置底',
  flipH: '水平镜像',
  flipV: '垂直镜像',
  deleteLayer: '删除选中图层',
  exportToWorkspaceTitle: '导出到画布（在拼图节点右侧新建图片节点）',
  fullscreenEdit: '全屏编辑',
  resetTransform: '复位旋转与镜像',
  rotateKnob: '拖动旋钮旋转选中图层',
  exportPng: '导出 PNG',
  studioTitle: '拼图工作室',
  studioSubtitle: '独立全屏编辑 · 画布与图层在此集中调整',
  escClose: 'Esc 关闭',
  exportToCanvas: '导出到画布（在拼图节点右侧新建图片节点）',
  exportToCanvasShort: '到画布',
  exportToCanvasDone: '已导出到画布',
  exportToCanvasFailed: '导出到画布失败，请稍后重试。',
  backToCanvas: '返回画布',
  canvasSizeSection: '画布尺寸',
  aspectPickHint: '先选比例（一排三个），再在下方选常用分辨率，像素会按该比例自动换算。',
  canvasSizeDesc: '与当前所选比例一致的一组像素尺寸，点选即可套用。',
  customModeHint: '自定义模式下请使用下方宽高输入；收起自定义后可继续套用模板。',
  noTemplateHint: '当前宽高不在常用比例模板中，请点选上方面板中一项比例，或使用「自定义」输入。',
  layers: '图层',
  layerLabel: '图层',
  noLayers: '暂无图层：请连接图片节点，或框选多张图后用绿色超级连线批量导入',
  reset: '复位',
  direction: '方向',
  resetLayerTitle: '复位旋转与镜像',
  rotateLayerTitle: '拖动旋转图层',
  layerUpTitle: '上移一层',
  layerDownTitle: '下移一层',
  layerFrontTitle: '置顶',
  layerBackTitle: '置底',
  flipHTitle: '水平镜像',
  flipVTitle: '垂直镜像',
  deleteLayerTitle: '删除图层',
  footerCanvas: '逻辑画布',
  footerViewport: '视口',
  footerScale: '预览缩放',
  footerSelectedLayer: '已选图层',
  footerNoSelection: '未选中图层',
  width: '宽',
  height: '高',
};

const en: PhotoCollageStrings = {
  nodeTitle: 'Collage',
  ratioLabel: 'Ratio',
  canvasSize: 'Canvas size',
  custom: 'Custom',
  collapseCustom: 'Hide custom',
  pickRatioTitle: 'Choose aspect ratio and resolution',
  canvasPixelTitle: 'Canvas {w}×{h} px',
  customSizeHint: 'Custom size — enter width and height:',
  canvasWidth: 'Canvas width',
  canvasHeight: 'Canvas height',
  apply: 'Apply',
  importFromNodesTitle: 'Connect image nodes to import (batch via super-connect)',
  superConnectOverflow: 'Collage holds up to {max} layers; skipped {n} extra image(s)',
  layerUp: 'Move up',
  layerDown: 'Move down',
  layerFront: 'Bring to front',
  layerBack: 'Send to back',
  flipH: 'Flip horizontal',
  flipV: 'Flip vertical',
  deleteLayer: 'Delete selected layer',
  exportToWorkspaceTitle: 'Export to canvas (new image node to the right)',
  fullscreenEdit: 'Fullscreen edit',
  resetTransform: 'Reset rotation and flip',
  rotateKnob: 'Drag knob to rotate selected layer',
  exportPng: 'Export PNG',
  studioTitle: 'Collage studio',
  studioSubtitle: 'Fullscreen editing — adjust canvas and layers here',
  escClose: 'Esc to close',
  exportToCanvas: 'Export to canvas (new image node to the right)',
  exportToCanvasShort: 'To canvas',
  exportToCanvasDone: 'Exported to canvas',
  exportToCanvasFailed: 'Export to canvas failed. Please try again.',
  backToCanvas: 'Back to canvas',
  canvasSizeSection: 'Canvas size',
  aspectPickHint: 'Pick a ratio (three per row), then choose a preset resolution below.',
  canvasSizeDesc: 'Pixel sizes for the selected ratio — click to apply.',
  customModeHint: 'Use width/height inputs below in custom mode; collapse custom to use presets again.',
  noTemplateHint: 'Current size is not a preset — pick a ratio above or use Custom.',
  layers: 'Layers',
  layerLabel: 'Layer',
  noLayers: 'No layers yet — connect image nodes, or multi-select and use the green super-connect',
  reset: 'Reset',
  direction: 'Rotate',
  resetLayerTitle: 'Reset rotation and flip',
  rotateLayerTitle: 'Drag to rotate layer',
  layerUpTitle: 'Move up',
  layerDownTitle: 'Move down',
  layerFrontTitle: 'Bring to front',
  layerBackTitle: 'Send to back',
  flipHTitle: 'Flip horizontal',
  flipVTitle: 'Flip vertical',
  deleteLayerTitle: 'Delete layer',
  footerCanvas: 'Canvas',
  footerViewport: 'Viewport',
  footerScale: 'Preview zoom',
  footerSelectedLayer: 'Selected layer',
  footerNoSelection: 'No layer selected',
  width: 'W',
  height: 'H',
};

export function photoCollageT(locale: AppLocale): PhotoCollageStrings {
  return locale === 'en' ? en : zh;
}

export function photoCollageCanvasPixelTitle(locale: AppLocale, w: number, h: number): string {
  return photoCollageT(locale).canvasPixelTitle.replace('{w}', String(w)).replace('{h}', String(h));
}
