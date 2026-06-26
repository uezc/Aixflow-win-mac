import type { AppLocale } from './settingsI18n';

export type SpatialComposition3DStrings = {
  moduleTitle: string;
  expandViewport: string;
  /** 弹窗 / 视口全屏 */
  fullscreenHostTitle: string;
  exitFullscreenHostTitle: string;
  objectsCount: (n: number) => string;
  cube: string;
  sphere: string;
  cylinder: string;
  cone: string;
  humanoid: string;
  table: string;
  chair: string;
  clear: string;
  materialShading: string;
  zDepthChannel: string;
  outputToNode: string;
  controlsHint: string;
  placeHint: string;
  /** 独立弹窗顶部关闭 */
  modalCloseTitle: string;
};

const zh: SpatialComposition3DStrings = {
  moduleTitle: '3D 空间构图',
  expandViewport: '展开视口',
  fullscreenHostTitle: '全屏',
  exitFullscreenHostTitle: '退出全屏',
  objectsCount: (n) => `物体: ${n}`,
  cube: '方块',
  sphere: '球体',
  cylinder: '圆柱',
  cone: '圆锥',
  humanoid: '人形',
  table: '桌子',
  chair: '椅子',
  clear: '清空',
  materialShading: '材质着色',
  zDepthChannel: 'Z深度通道',
  outputToNode: '输出至参考节点',
  controlsHint: '左键旋转 · 右键平移 · 滚轮缩放 · 选中物体后可拖移箭头摆放',
  placeHint: '已选类型：点击地面放置；点击物体可选中并拖动坐标轴',
  modalCloseTitle: '关闭',
};

const en: SpatialComposition3DStrings = {
  moduleTitle: '3D spatial layout',
  expandViewport: 'Expand viewport',
  fullscreenHostTitle: 'Fullscreen',
  exitFullscreenHostTitle: 'Exit fullscreen',
  objectsCount: (n) => `Objects: ${n}`,
  cube: 'Cube',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  humanoid: 'Figure',
  table: 'Table',
  chair: 'Chair',
  clear: 'Clear',
  materialShading: 'Shaded',
  zDepthChannel: 'Z-depth',
  outputToNode: 'Output to image node',
  controlsHint: 'Left: orbit · Right: pan · Wheel: zoom · Drag axes to move selection',
  placeHint: 'Pick a type, then click the floor to place; click an object to move it with the gizmo',
  modalCloseTitle: 'Close',
};

export function spatialComposition3DT(locale: AppLocale): SpatialComposition3DStrings {
  return locale === 'en' ? en : zh;
}
