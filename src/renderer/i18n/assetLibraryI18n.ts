import type { AppLocale } from './settingsI18n';

export type AssetLibraryStrings = {
  tabRole: string;
  tabModel3d: string;
  tabScene: string;
  expandLibrary: string;
  collapseLibrary: string;
  galleryMode: string;
  listMode: string;
  gallerySearchPlaceholder: string;
  galleryTypeImage: string;
  galleryTypeScene: string;
  galleryTypeModel3d: string;
  galleryWideHint: string;
  sceneListTitle: string;
  sceneUpload: string;
  sceneUploadTitle: string;
  sceneEmpty: string;
  sceneDragHint: string;
  sceneDeleteSelected: string;
  sceneImported: string;
  sceneImportFailed: string;
  sceneSelectAll: string;
  sceneDeselectAll: string;
  sceneAdd: string;
  sceneAddTitle: string;
  sceneEditTitle: string;
  sceneImportToCanvasTitle: string;
  sceneNickname: string;
  sceneNormalImage: string;
  sceneDisplay3dImage: string;
  sceneUploadNormal: string;
  sceneUploadDisplay3d: string;
  scenePickFromCanvas: string;
  sceneSave: string;
  sceneCancel: string;
  sceneNeedBothImages: string;
  sceneSaved: string;
  sceneSaveFailed: string;
  sceneExportTitle: string;
  sceneImportTitle: string;
  sceneSelectToExport: string;
  sceneExportNotReady: string;
  sceneExported: string;
  sceneExportedMulti: string;
  sceneExportFailed: string;
  sceneImportedCount: string;
  sceneAixflowImportFailed: string;
  roleSelectAll: string;
  roleDeselectAll: string;
  roleAdd: string;
  roleAddTitle: string;
  roleEditMaterials: string;
  roleDeleteSelected: string;
  roleExportTitle: string;
  roleImportTitle: string;
  roleExport3dTitle: string;
  roleImport3dTitle: string;
  roleImport3dExtraTitle: string;
  roleExpandList: string;
  roleCollapseList: string;
  roleNicknameLabel: string;
  roleNicknamePlaceholder: string;
  roleUploadVoice: string;
  roleUploadVoiceClick: string;
  roleUploadVoiceOptional: string;
  rolePickFromCanvas: string;
  roleUploadFourViews: string;
  roleFourViewsHint: string;
  roleFourViewsHintEdit: string;
  roleCancel: string;
  roleSave: string;
  roleAddBtn: string;
  roleSaving: string;
  roleAdding: string;
  rolePreviewVoice: string;
  roleStopPreview: string;
  roleNoVoice: string;
  roleVoiceFromCanvas: string;
  roleVoiceSelected: string;
  roleReplaceVoice: string;
  roleReplaceShort: string;
  roleVoicePickTitle: string;
  roleViewPickFromCanvas: string;
  roleViewPickTitle: string;
  roleViewSlotFace: string;
  roleViewSlotFront: string;
  roleViewSlotSide: string;
  roleViewSlotBack: string;
  roleNeedNickname: string;
  roleAdded: string;
  roleSaved: string;
  roleSaveFailed: string;
  roleAddFailed: string;
};

const zh: AssetLibraryStrings = {
  tabRole: '角色',
  tabModel3d: '模型',
  tabScene: '场景',
  expandLibrary: '展开资产库',
  collapseLibrary: '收起资产库',
  galleryMode: '大窗口',
  listMode: '列表',
  gallerySearchPlaceholder: '搜索当前库',
  galleryTypeImage: '图片',
  galleryTypeScene: '场景',
  galleryTypeModel3d: '3D',
  galleryWideHint: '大窗口模式',
  sceneListTitle: '场景',
  sceneUpload: '上传',
  sceneUploadTitle: '上传全景/场景图',
  sceneEmpty: '暂无场景，请添加正常图与 3D 展示图',
  sceneDragHint: '拖到画布创建图片节点',
  sceneDeleteSelected: '删除勾选的场景',
  sceneImported: '场景已加入资产库',
  sceneImportFailed: '场景上传失败',
  sceneSelectAll: '全选',
  sceneDeselectAll: '取消全选',
  sceneAdd: '添加场景',
  sceneAddTitle: '添加场景',
  sceneEditTitle: '编辑场景',
  sceneImportToCanvasTitle: '导入到画布（原图与 3D 图）',
  sceneNickname: '场景名称',
  sceneNormalImage: '正常图（平面展示）',
  sceneDisplay3dImage: '3D 展示图（全景/360）',
  sceneUploadNormal: '上传正常图',
  sceneUploadDisplay3d: '上传 3D 图',
  scenePickFromCanvas: '画布中选择',
  sceneSave: '保存',
  sceneCancel: '取消',
  sceneNeedBothImages: '请同时设置正常图与 3D 展示图',
  sceneSaved: '场景已保存',
  sceneSaveFailed: '场景保存失败',
  sceneExportTitle: '导出勾选的场景（.aixflow）',
  sceneImportTitle: '导入 .aixflow 场景包',
  sceneSelectToExport: '请先勾选要导出的场景',
  sceneExportNotReady: '导出功能未就绪，请重新编译主进程后重启',
  sceneExported: '已导出场景',
  sceneExportedMulti: '已导出 {n} 个 .aixflow 到文件夹',
  sceneExportFailed: '导出失败',
  sceneImportedCount: '已导入 {n} 个场景',
  sceneAixflowImportFailed: '导入失败',
  roleSelectAll: '全选',
  roleDeselectAll: '取消全选',
  roleAdd: '添加角色',
  roleAddTitle: '添加角色',
  roleEditMaterials: '修改角色素材',
  roleDeleteSelected: '删除勾选的角色',
  roleExportTitle: '导出勾选的角色',
  roleImportTitle: '导入角色',
  roleExport3dTitle: '导出勾选的 3D 模型（.aixflow）',
  roleImport3dTitle: '导入 .aixflow / GLB 到 3D 模型库',
  roleImport3dExtraTitle: '导入 .aixflow / GLB（可拖到画布）',
  roleExpandList: '点击展开角色列表',
  roleCollapseList: '收起角色列表',
  roleNicknameLabel: '角色昵称',
  roleNicknamePlaceholder: '请输入角色昵称',
  roleUploadVoice: '上传角色参考音',
  roleUploadVoiceClick: '点击上传参考音（可选）',
  roleUploadVoiceOptional: '上传角色参考音（可选）',
  rolePickFromCanvas: '画布中选择',
  roleUploadFourViews: '上传角色4视图（可选）',
  roleFourViewsHint: '四格对应多角度参考图（可选）；第一张图将作为角色头像。创建后写入角色数据。',
  roleFourViewsHintEdit: '四格对应多角度参考图（可选）；第一张图将作为角色头像。保存后更新角色数据。',
  roleCancel: '取消',
  roleSave: '保存',
  roleAddBtn: '添加',
  roleSaving: '保存中...',
  roleAdding: '添加中...',
  rolePreviewVoice: '试听参考音',
  roleStopPreview: '停止试听',
  roleNoVoice: '暂无参考音',
  roleVoiceFromCanvas: '来自画布',
  roleVoiceSelected: '已选择参考音',
  roleReplaceVoice: '更换参考音文件',
  roleReplaceShort: '更换',
  roleVoicePickTitle: '在画布上点击已有音轨的音频或语音转写等模块',
  roleViewPickFromCanvas: '画布中选择',
  roleViewPickTitle: '在画布上点击带图输出的图片或角色模块',
  roleViewSlotFace: '面部',
  roleViewSlotFront: '正面全身',
  roleViewSlotSide: '侧面全身',
  roleViewSlotBack: '背面全身',
  roleNeedNickname: '请输入角色昵称',
  roleAdded: '已添加角色',
  roleSaved: '已保存素材',
  roleSaveFailed: '保存失败',
  roleAddFailed: '添加角色失败',
};

const en: AssetLibraryStrings = {
  tabRole: 'Characters',
  tabModel3d: 'Models',
  tabScene: 'Scenes',
  expandLibrary: 'Expand asset library',
  collapseLibrary: 'Collapse asset library',
  galleryMode: 'Gallery',
  listMode: 'List',
  gallerySearchPlaceholder: 'Search this library',
  galleryTypeImage: 'Image',
  galleryTypeScene: 'Scene',
  galleryTypeModel3d: '3D',
  galleryWideHint: 'Gallery mode',
  sceneListTitle: 'Scenes',
  sceneUpload: 'Upload',
  sceneUploadTitle: 'Upload panorama / scene image',
  sceneEmpty: 'No scenes yet — upload a panorama',
  sceneDragHint: 'Drag to canvas to create an image node',
  sceneDeleteSelected: 'Delete selected scenes',
  sceneImported: 'Scene added to library',
  sceneImportFailed: 'Scene upload failed',
  sceneSelectAll: 'Select all',
  sceneDeselectAll: 'Deselect all',
  sceneAdd: 'Add scene',
  sceneAddTitle: 'Add scene',
  sceneEditTitle: 'Edit scene',
  sceneImportToCanvasTitle: 'Place on canvas (normal + 3D images)',
  sceneNickname: 'Scene name',
  sceneNormalImage: 'Normal image (flat)',
  sceneDisplay3dImage: '3D display (panorama / 360)',
  sceneUploadNormal: 'Upload normal',
  sceneUploadDisplay3d: 'Upload 3D',
  scenePickFromCanvas: 'Pick from canvas',
  sceneSave: 'Save',
  sceneCancel: 'Cancel',
  sceneNeedBothImages: 'Both normal and 3D images are required',
  sceneSaved: 'Scene saved',
  sceneSaveFailed: 'Failed to save scene',
  sceneExportTitle: 'Export selected scenes (.aixflow)',
  sceneImportTitle: 'Import .aixflow scene packs',
  sceneSelectToExport: 'Select scenes to export first',
  sceneExportNotReady: 'Export not ready — rebuild main process and restart',
  sceneExported: 'Scene exported',
  sceneExportedMulti: 'Exported {n} .aixflow files to folder',
  sceneExportFailed: 'Export failed',
  sceneImportedCount: 'Imported {n} scene(s)',
  sceneAixflowImportFailed: 'Import failed',
  roleSelectAll: 'Select all',
  roleDeselectAll: 'Deselect all',
  roleAdd: 'Add character',
  roleAddTitle: 'Add character',
  roleEditMaterials: 'Edit character assets',
  roleDeleteSelected: 'Delete selected characters',
  roleExportTitle: 'Export selected characters',
  roleImportTitle: 'Import characters',
  roleExport3dTitle: 'Export selected 3D models (.aixflow)',
  roleImport3dTitle: 'Import .aixflow / GLB to 3D library',
  roleImport3dExtraTitle: 'Import .aixflow / GLB (draggable to canvas)',
  roleExpandList: 'Expand character list',
  roleCollapseList: 'Collapse character list',
  roleNicknameLabel: 'Character nickname',
  roleNicknamePlaceholder: 'Enter character nickname',
  roleUploadVoice: 'Upload reference voice',
  roleUploadVoiceClick: 'Click to upload reference audio (optional)',
  roleUploadVoiceOptional: 'Upload reference voice (optional)',
  rolePickFromCanvas: 'Pick from canvas',
  roleUploadFourViews: 'Upload 4-view references (optional)',
  roleFourViewsHint:
    'Four slots for multi-angle references (optional). The first image becomes the avatar. Saved to character data after creation.',
  roleFourViewsHintEdit:
    'Four slots for multi-angle references (optional). The first image becomes the avatar. Updates character data after save.',
  roleCancel: 'Cancel',
  roleSave: 'Save',
  roleAddBtn: 'Add',
  roleSaving: 'Saving…',
  roleAdding: 'Adding…',
  rolePreviewVoice: 'Preview reference voice',
  roleStopPreview: 'Stop preview',
  roleNoVoice: 'No reference voice',
  roleVoiceFromCanvas: 'From canvas',
  roleVoiceSelected: 'Reference audio selected',
  roleReplaceVoice: 'Replace reference audio',
  roleReplaceShort: 'Replace',
  roleVoicePickTitle: 'Click an audio or transcription node with audio on the canvas',
  roleViewPickFromCanvas: 'Pick from canvas',
  roleViewPickTitle: 'Click an image or character node with image output on the canvas',
  roleViewSlotFace: 'Face',
  roleViewSlotFront: 'Front full',
  roleViewSlotSide: 'Side full',
  roleViewSlotBack: 'Back full',
  roleNeedNickname: 'Enter a character nickname',
  roleAdded: 'Character added',
  roleSaved: 'Assets saved',
  roleSaveFailed: 'Save failed',
  roleAddFailed: 'Failed to add character',
};

export function assetLibraryT(locale: AppLocale): AssetLibraryStrings {
  return locale === 'en' ? en : zh;
}
