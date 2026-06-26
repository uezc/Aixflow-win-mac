import type { AppLocale } from './settingsI18n';

export type PanoramaPlacementStrings = {
  title: string;
  subtitle: string;
  aspectLabel: string;
  placementMode: (n: number) => string;
  extractViewStub: string;
  smartExtractStub: string;
  addModels: string;
  shapeSphere: string;
  shapeCube: string;
  shapeHuman: string;
  hintSelect: string;
  hintMove: string;
  hintRotate: string;
  hintScale: string;
  transformMove: string;
  transformRotate: string;
  aspectAdaptive: string;
  aspect169: string;
  aspect916: string;
  aspect11: string;
  aspect43: string;
  aspect34: string;
  aspect32: string;
  aspect219: string;
  aspect235: string;
  depthPreview: string;
  deleteItem: string;
  placedList: string;
  modelSphere: (i: number) => string;
  modelCube: (i: number) => string;
  modelHuman: (i: number) => string;
  modelCylinder: (i: number) => string;
  modelCone: (i: number) => string;
  modelTable: (i: number) => string;
  modelChair: (i: number) => string;
  placedListWithCount: (n: number) => string;
  outputDimensions: (w: number, h: number) => string;
  ratioStatus: (label: string) => string;
  objectsCountShort: (n: number) => string;
  sidebarPlacementTitle: string;
  placeHint: string;
  controlsHintBottom: string;
  scaleRot: (scale: string, deg: string) => string;
  resetView: string;
  outputToNode: string;
  fullscreen: string;
  exitFullscreen: string;
  close: string;
  modalCloseTitle: string;
  fullscreenHostTitle: string;
  exitFullscreenHostTitle: string;
  humanoidColorLabel: string;
  /** 色板：纯白实体材质 */
  humanoidSurfaceWhite: string;
  /** 色板：高透玻璃材质 */
  humanoidSurfaceGlass: string;
  /** 侧栏：人物缩放滑条区块标题 */
  humanoidScaleSection: string;
  /** 侧栏：标准 / 瘦 体型切换标题 */
  humanoidBuildSection: string;
  humanoidBuildStandard: string;
  humanoidBuildThin: string;
  /** 侧栏：欧拉角三节 */
  rotationSection: string;
  rotationAxisX: string;
  rotationAxisY: string;
  rotationAxisZ: string;
  /** 旋钮 title：X 横向 0°–360° */
  rotationAxisXTitle: string;
  rotationAxisYTitle: string;
  rotationAxisZTitle: string;
  openposeSection: string;
  openposeReset: string;
  openposeArmL: string;
  openposeArmR: string;
  openposeElbowL: string;
  openposeElbowR: string;
  /** OpenPose：左大腿控制点（髋部抬腿 / 外开 / 扭转） */
  openposeThighL: string;
  /** OpenPose：右大腿控制点 */
  openposeThighR: string;
  openposeKneeL: string;
  openposeKneeR: string;
  /** OpenPose：左踝控制点 */
  openposeAnkleL: string;
  /** OpenPose：右踝控制点 */
  openposeAnkleR: string;
  openposeNeck: string;
  openposeWaist: string;
  /** OpenPose：侧栏示意骨架，拖动关节圆点调节 */
  openposeDragHint: string;
  /** OpenPose：头部正面（有值时显示极简笑脸贴图；文案可保留作无障碍/未来用） */
  openPoseHeadLabel: string;
  /** OpenPose：选中关节后，前后向滑块轴标题 */
  openPoseSliderFrontBack: string;
  /** OpenPose：选中关节后，左右向滑块轴标题 */
  openPoseSliderLeftRight: string;
  /** OpenPose：选中关节后，第三轴滑块（扭转 / 侧倾等） */
  openPoseSliderTwist: string;
  /** OpenPose：关节滑块辅助说明 */
  openposeSliderHint: string;
  /** 左侧：已保存 OpenPose 预设列标题 */
  openposePresetColumnTitle: string;
  /** 左侧：将当前姿势写入预设列表 */
  openposeSavePreset: string;
  openposeApplyPreset: string;
  openposeDeletePreset: string;
  openposePresetsHint: string;
  openposePresetName: (index: number) => string;
  /** 列表行：缩放 + 三轴角度 */
  itemPlacementDetail: (scale: string, rx: number, ry: number, rz: number, poseExtra: string) => string;
  /** 底栏 FOV 旁：提示滚轮调节视距 */
  fovBarHint: string;
};

const zh: PanoramaPlacementStrings = {
  title: '3D场景预览',
  subtitle: '360° · 球幕',
  aspectLabel: '比例',
  placementMode: (n) => `物体放置 ${n}`,
  extractViewStub: '提取视角',
  smartExtractStub: '智能提取',
  addModels: '添加人物',
  shapeSphere: '圆形',
  shapeCube: '方形',
  shapeHuman: '添加人物',
  hintSelect: '左键选中',
  hintMove: '左键拖移',
  hintRotate: '侧栏旋转旋钮：水平(X) / 左右(Y) / 前后(Z)，各 0°–360°',
  hintScale: '滚轮远近',
  transformMove: '平移',
  transformRotate: '旋转',
  aspectAdaptive: '自适应',
  aspect169: '16:9',
  aspect916: '9:16',
  aspect11: '1:1',
  aspect43: '4:3',
  aspect34: '3:4',
  aspect32: '3:2',
  aspect219: '21:9',
  aspect235: '2.35:1',
  depthPreview: 'Z 深度预览',
  deleteItem: '删除',
  placedList: '已放置',
  modelSphere: (i) => `圆形模型 ${i}`,
  modelCube: (i) => `方形模型 ${i}`,
  modelHuman: (i) => `人物 ${i}`,
  modelCylinder: (i) => `圆柱 ${i}`,
  modelCone: (i) => `圆锥 ${i}`,
  modelTable: (i) => `桌子 ${i}`,
  modelChair: (i) => `椅子 ${i}`,
  placedListWithCount: (n) => `已放置 (${n})`,
  outputDimensions: (w, h) => `输出: ${w}×${h}`,
  ratioStatus: (label) => `比例: ${label}`,
  objectsCountShort: (n) => `物体: ${n}`,
  sidebarPlacementTitle: '物体',
  placeHint: '已选类型：点击球面放置；点击物体可选中',
  controlsHintBottom: '左键环视 · 拖移物体 · 滚轮远近',
  scaleRot: (scale, deg) => `缩放 ${scale}x · 旋转 ${deg}°`,
  itemPlacementDetail: (scale, rx, ry, rz, poseExtra) =>
    `缩放 ${scale}x · X${rx}° Y${ry}° Z${rz}°${poseExtra}`,
  resetView: '重置视角',
  outputToNode: '输出到画布',
  fullscreen: '全屏',
  exitFullscreen: '退出全屏',
  close: '关闭',
  modalCloseTitle: '关闭',
  fullscreenHostTitle: '全屏',
  exitFullscreenHostTitle: '退出全屏',
  humanoidColorLabel: '小人颜色',
  humanoidSurfaceWhite: '白色（实体）',
  humanoidSurfaceGlass: '玻璃透明',
  humanoidScaleSection: '人物缩放',
  humanoidBuildSection: '体型',
  humanoidBuildStandard: '标准',
  humanoidBuildThin: '瘦',
  rotationSection: '旋转',
  rotationAxisX: '水平',
  rotationAxisY: '左右',
  rotationAxisZ: '前后',
  rotationAxisXTitle: '水平（X 轴）· 0°–360°',
  rotationAxisYTitle: '左右（Y 轴）· 0°–360°',
  rotationAxisZTitle: '前后（Z 轴）· 0°–360°',
  openposeSection: 'OpenPose',
  openposeReset: '重置',
  openposeArmL: '左臂摆',
  openposeArmR: '右臂摆',
  openposeElbowL: '左肘弯',
  openposeElbowR: '右肘弯',
  openposeThighL: '左大腿（抬腿）',
  openposeThighR: '右大腿（抬腿）',
  openposeKneeL: '左膝',
  openposeKneeR: '右膝',
  openposeAnkleL: '左踝',
  openposeAnkleR: '右踝',
  openposeNeck: '脖子（左右转头）',
  openposeWaist: '腰部（俯仰）',
  openposeDragHint: '立体预览：空白处拖拽旋转视角；点击身体部位即可选中并高亮，用下方三滑块调节该部位三轴角度（与球幕人台同步）。',
  openPoseHeadLabel: '头',
  openPoseSliderFrontBack: '前后',
  openPoseSliderLeftRight: '左右',
  openPoseSliderTwist: '扭转',
  openposeSliderHint: '先点击模型上的身体部位（会高亮），再用下方三条滑块调节；点空白处取消选中。',
  openposePresetColumnTitle: '已存姿势',
  openposeSavePreset: '保存当前',
  openposeApplyPreset: '应用',
  openposeDeletePreset: '删除',
  openposePresetsHint: '保存当前 OpenPose 与体型；点「应用」载入到选中人台或待放置预览。',
  openposePresetName: (n) => `姿势 ${n}`,
  fovBarHint: '滚轮调节 FOV',
};

const en: PanoramaPlacementStrings = {
  title: '3D scene preview',
  subtitle: '360° sphere',
  aspectLabel: 'Aspect',
  placementMode: (n) => `Objects ${n}`,
  extractViewStub: 'Extract view',
  smartExtractStub: 'Smart extract',
  addModels: 'Add figure',
  shapeSphere: 'Sphere',
  shapeCube: 'Cube',
  shapeHuman: 'Add character',
  hintSelect: 'Left: select',
  hintMove: 'Left drag: move',
  hintRotate: 'Sidebar knobs: horizontal (X), left-right (Y), front-back (Z), each 0°–360°',
  hintScale: 'Wheel: dolly',
  transformMove: 'Move',
  transformRotate: 'Rotate',
  aspectAdaptive: 'Fit',
  aspect169: '16:9',
  aspect916: '9:16',
  aspect11: '1:1',
  aspect43: '4:3',
  aspect34: '3:4',
  aspect32: '3:2',
  aspect219: '21:9',
  aspect235: '2.35:1',
  depthPreview: 'Z-depth preview',
  deleteItem: 'Remove',
  placedList: 'In scene',
  modelSphere: (i) => `Sphere ${i}`,
  modelCube: (i) => `Cube ${i}`,
  modelHuman: (i) => `Figure ${i}`,
  modelCylinder: (i) => `Cylinder ${i}`,
  modelCone: (i) => `Cone ${i}`,
  modelTable: (i) => `Table ${i}`,
  modelChair: (i) => `Chair ${i}`,
  placedListWithCount: (n) => `Placed (${n})`,
  outputDimensions: (w, h) => `Out: ${w}×${h}`,
  ratioStatus: (label) => `Aspect: ${label}`,
  objectsCountShort: (n) => `Objects: ${n}`,
  sidebarPlacementTitle: 'Placement',
  placeHint: 'Pick a type, click the sphere to place; click an object to select',
  controlsHintBottom: 'Orbit · move object · wheel dolly',
  scaleRot: (scale, deg) => `Scale ${scale}x · Rot ${deg}°`,
  itemPlacementDetail: (scale, rx, ry, rz, poseExtra) =>
    `Scale ${scale}x · X${rx}° Y${ry}° Z${rz}°${poseExtra}`,
  resetView: 'Reset view',
  outputToNode: 'Output to canvas',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  close: 'Close',
  modalCloseTitle: 'Close',
  fullscreenHostTitle: 'Fullscreen',
  exitFullscreenHostTitle: 'Exit fullscreen',
  humanoidColorLabel: 'Figure color',
  humanoidSurfaceWhite: 'White (solid)',
  humanoidSurfaceGlass: 'Glass (clear)',
  humanoidScaleSection: 'Figure scale',
  humanoidBuildSection: 'Build',
  humanoidBuildStandard: 'Standard',
  humanoidBuildThin: 'Slim',
  rotationSection: 'Rotation',
  rotationAxisX: 'Horizontal',
  rotationAxisY: 'Left-right',
  rotationAxisZ: 'Front-back',
  rotationAxisXTitle: 'Horizontal rotation (X) · 0°–360°',
  rotationAxisYTitle: 'Left-right rotation (Y) · 0°–360°',
  rotationAxisZTitle: 'Front-back rotation (Z) · 0°–360°',
  openposeSection: 'OpenPose',
  openposeReset: 'Reset pose',
  openposeArmL: 'L arm swing',
  openposeArmR: 'R arm swing',
  openposeElbowL: 'L elbow',
  openposeElbowR: 'R elbow',
  openposeThighL: 'L thigh (lift)',
  openposeThighR: 'R thigh (lift)',
  openposeKneeL: 'L knee',
  openposeKneeR: 'R knee',
  openposeAnkleL: 'L ankle',
  openposeAnkleR: 'R ankle',
  openposeNeck: 'Neck (turn)',
  openposeWaist: 'Waist (bend)',
  openposeDragHint:
    '3D preview: drag empty space to orbit; click a body part to select (it highlights), then use the three sliders below for that part’s angles (syncs with the figure on the sphere).',
  openPoseHeadLabel: 'Head',
  openPoseSliderFrontBack: 'Front / back',
  openPoseSliderLeftRight: 'Left / right',
  openPoseSliderTwist: 'Twist / tilt',
  openposeSliderHint:
    'Click a body part on the model (it highlights), then use the three sliders below. Click empty space to clear.',
  openposePresetColumnTitle: 'Saved poses',
  openposeSavePreset: 'Save current',
  openposeApplyPreset: 'Apply',
  openposeDeletePreset: 'Remove',
  openposePresetsHint: 'Saves current OpenPose and build. Apply loads onto the selected figure or placement preview.',
  openposePresetName: (n) => `Pose ${n}`,
  fovBarHint: 'Scroll wheel: FOV',
};

export function panoramaPlacementT(locale: AppLocale): PanoramaPlacementStrings {
  return locale === 'en' ? en : zh;
}
