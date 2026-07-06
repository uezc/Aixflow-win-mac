import type { AppLocale } from './settingsI18n';

export type ImageTo3dStrings = {
  nodeTitle: string;
  noInput: string;
  generating: string;
  generate: string;
  preview: string;
  download: string;
  downloadSuccessWithTexture: string;
  downloadSuccessGlbOnly: string;
  downloadSuccessTextureNoRef: string;
  downloadSuccessGlbOnlyNoRef: string;
  openPreview: string;
  creditsSuffix: string;
  notSupported: string;
  failedDefault: string;
  successHint: string;
  refImageLabel: string;
  resultTextureLabel: string;
  resultTextureHint: string;
  resultTexturePending: string;
  refImagesCount: (n: number) => string;
  inputFromEdge: string;
  emptyViewport: string;
  selectToPreview3d: string;
  webglUnavailable: string;
  webglUnavailableHint: string;
  fullscreenTitle: string;
  close: string;
  rotateHint: string;
  rotateHintHover: string;
  fullscreenBgGrid: string;
  fullscreenBgBlack: string;
  fullscreenBgWhite: string;
  downloadSuccess: string;
  downloadFailed: string;
  noModelToDownload: string;
  downloadApiUnavailable: string;
  upload: string;
  uploadRefImage: string;
  uploadImageOnly: string;
  uploadFailed: string;
  uploadAssetImported: string;
  uploadAssetInvalid: string;
  saveToLibrary: string;
  saveToLibrarySuccess: string;
  saveToLibraryAlready: string;
  saveToLibraryFailed: string;
  modelPlusBadge: string;
  modelHy3d: string;
  modelTrellis2: string;
  modelLabel: string;
};

const zh: ImageTo3dStrings = {
  nodeTitle: '图片转 3D',
  noInput: '请连接图片节点，或上传参考图 / .aixflow',
  generating: '生成中…',
  generate: '生成 3D',
  preview: '预览',
  download: '下载',
  downloadSuccessWithTexture: '已保存 .aixflow（参考图 + GLB + 贴图）',
  downloadSuccessGlbOnly: '已保存 .aixflow（参考图 + GLB）',
  downloadSuccessTextureNoRef: '已保存 .aixflow（GLB + 贴图；未包含参考图）',
  downloadSuccessGlbOnlyNoRef: '已保存 .aixflow（仅 GLB；未包含参考图与贴图）',
  openPreview: '打开 3D 预览',
  creditsSuffix: '元宝',
  notSupported: '当前环境不支持图片转 3D',
  failedDefault: '图片转 3D 失败',
  successHint: 'GLB 已生成，可预览、保存到资产库或下载',
  refImageLabel: '参考图',
  resultTextureLabel: '结果贴图',
  resultTextureHint: '生成后自动加载；下载为 .aixflow 包（含 GLB 与贴图）',
  resultTexturePending: '生成后自动填入',
  refImagesCount: (n) => `参考图 ${n}张`,
  inputFromEdge: '已连接参考图',
  emptyViewport: '生成后将在此预览 GLB 模型',
  selectToPreview3d: '选中本节点以加载 3D 预览',
  webglUnavailable: 'WebGL 不可用或上下文已满',
  webglUnavailableHint: '请选中本节点预览，或使用右上角全屏；可关闭其他 3D 视图后重试',
  fullscreenTitle: '3D 模型预览',
  close: '关闭',
  rotateHint: '拖拽旋转 · 滚轮缩放',
  rotateHintHover: '悬停自动旋转 · 全屏可自由旋转',
  fullscreenBgGrid: '网格',
  fullscreenBgBlack: '纯黑',
  fullscreenBgWhite: '纯白',
  downloadSuccess: '已保存 .aixflow',
  downloadFailed: '下载失败，请重试',
  noModelToDownload: '暂无 3D 模型可下载',
  downloadApiUnavailable: '下载功能未就绪，请重新编译主进程后重启应用',
  upload: '上传',
  uploadRefImage: '上传参考图或 .aixflow / GLB 模型',
  uploadImageOnly: '请选择图片、.aixflow 或 .glb 文件',
  uploadFailed: '上传失败',
  uploadAssetImported: '3D 模型已导入，可预览或下载',
  uploadAssetInvalid: '无法识别该 3D 资产文件',
  saveToLibrary: '保存到资产库',
  saveToLibrarySuccess: '已保存到 3D 模型库',
  saveToLibraryAlready: '已在 3D 模型库中',
  saveToLibraryFailed: '保存到资产库失败',
  modelLabel: '模型',
  modelHy3d: 'Hy3D',
  modelTrellis2: 'Trellis2',
  modelPlusBadge: 'PLUS',
};

const en: ImageTo3dStrings = {
  nodeTitle: 'Image to 3D',
  noInput: 'Connect an image node or upload a reference',
  generating: 'Generating…',
  generate: 'Generate 3D',
  preview: 'Preview',
  download: 'Download',
  downloadSuccessWithTexture: 'Saved .aixflow (reference + GLB + texture)',
  downloadSuccessGlbOnly: 'Saved .aixflow (reference + GLB)',
  downloadSuccessTextureNoRef: 'Saved .aixflow (GLB + texture; reference not included)',
  downloadSuccessGlbOnlyNoRef: 'Saved .aixflow (GLB only; no reference or texture)',
  openPreview: 'Open 3D preview',
  creditsSuffix: ' credits',
  notSupported: 'Image to 3D is not available in this environment',
  failedDefault: 'Image to 3D failed',
  successHint: 'GLB ready — preview, save to library, or download',
  refImageLabel: 'Reference',
  resultTextureLabel: 'Result texture',
  resultTextureHint: 'Auto-loaded after generation; download as .aixflow (GLB + texture)',
  resultTexturePending: 'Filled after generation',
  refImagesCount: (n) => `${n} ref image${n > 1 ? 's' : ''}`,
  inputFromEdge: 'Reference connected',
  emptyViewport: 'GLB preview will appear here after generation',
  selectToPreview3d: 'Select this node to load 3D preview',
  webglUnavailable: 'WebGL unavailable or context limit reached',
  webglUnavailableHint: 'Select this node or use fullscreen preview; close other 3D views and retry',
  fullscreenTitle: '3D model preview',
  close: 'Close',
  rotateHint: 'Drag to rotate · Scroll to zoom',
  rotateHintHover: 'Hover to auto-rotate · Fullscreen for free orbit',
  fullscreenBgGrid: 'Grid',
  fullscreenBgBlack: 'Black',
  fullscreenBgWhite: 'White',
  downloadSuccess: 'Saved .aixflow',
  downloadFailed: 'Download failed. Please try again.',
  noModelToDownload: 'No 3D model available to download',
  downloadApiUnavailable: 'Download is not ready. Rebuild the main process and restart the app.',
  upload: 'Upload',
  uploadRefImage: 'Upload reference image or .aixflow / GLB',
  uploadImageOnly: 'Choose an image, .aixflow, or .glb file',
  uploadFailed: 'Upload failed',
  uploadAssetImported: '3D model imported — preview or download',
  uploadAssetInvalid: 'Unrecognized 3D asset file',
  saveToLibrary: 'Save to library',
  saveToLibrarySuccess: 'Saved to 3D model library',
  saveToLibraryAlready: 'Already in 3D model library',
  saveToLibraryFailed: 'Failed to save to library',
  modelLabel: 'Model',
  modelHy3d: 'Hy3D',
  modelTrellis2: 'Trellis2',
  modelPlusBadge: 'PLUS',
};

export function imageTo3dT(locale: AppLocale): ImageTo3dStrings {
  return locale === 'en' ? en : zh;
}
