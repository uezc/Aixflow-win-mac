import type { AppLocale } from './settingsI18n';

export type AssetLibraryStrings = {
  tabRole: string;
  tabModel3d: string;
  tabScene: string;
  tabDigitalHuman: string;
  tabRvcVoice: string;
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
  model3dEditTitle: string;
  model3dUploadAvatarLocal: string;
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
  /** 角色形象文字描述 */
  roleImageDescLabel: string;
  roleImageDescPlaceholder: string;
  roleImageDescHint: string;
  roleReverseModelLabel: string;
  roleReverseNeedImage: string;
  roleReversing: string;
  roleReverseRun: string;
  roleReverseFailed: string;
  roleReverseEmpty: string;
  roleReverseCreditsSuffix: string;
  roleReversePriceTitle: string;
  roleReverseNoPrice: string;
  roleReverseClickImageTitle: string;
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
  dhAdd: string;
  dhAddTitle: string;
  dhEditTitle: string;
  dhEmpty: string;
  dhDragHint: string;
  dhDeleteSelected: string;
  dhNickname: string;
  dhNicknamePlaceholder: string;
  dhReferenceVideo: string;
  dhDriveAudio: string;
  dhUploadVideo: string;
  dhUploadVideoUnavailable: string;
  dhUploadAudio: string;
  dhPickFromCanvas: string;
  dhPickVideoFromCanvas: string;
  dhPickAudioFromCanvas: string;
  dhNeedBothMedia: string;
  dhNeedVideo: string;
  dhDriveAudioOptional: string;
  dhSaved: string;
  dhSaveFailed: string;
  dhPreviewAudio: string;
  dhPlaceOnCanvas: string;
  /** HeyGem 等面板从素材库点选数字人 */
  dhSelectForPanel: string;
  dhPickForPanelHint: string;
  dhHasVideo: string;
  dhHasAudio: string;
  dhNoVideo: string;
  dhNoAudio: string;
  dhAudioSelected: string;
  dhAudioReady: string;
  dhModalPreviewAudio: string;
  dhModalStopAudio: string;
  dhHoverVideoPreview: string;
  dhUntitled: string;
  dhSaveNotReady: string;
  rvcVoiceAdd: string;
  rvcVoiceAddTitle: string;
  rvcVoiceEditTitle: string;
  rvcVoiceEmpty: string;
  rvcVoiceDragHint: string;
  rvcVoiceDeleteSelected: string;
  rvcVoiceImported: string;
  rvcVoiceImportFailed: string;
  rvcVoiceSaved: string;
  rvcVoiceSaveFailed: string;
  rvcVoiceDeleted: string;
  rvcVoiceImportTitle: string;
  rvcVoiceNickname: string;
  rvcVoiceNicknamePlaceholder: string;
  rvcVoiceModelName: string;
  rvcVoiceModelNamePlaceholder: string;
  rvcVoicePackagePath: string;
  rvcVoicePackagePlaceholder: string;
  rvcVoiceNeedPackage: string;
  rvcVoiceCancel: string;
  rvcVoiceSave: string;
  rvcVoiceSaving: string;
  rvcVoicePlaceToCanvas: string;
  rvcVoiceUntitled: string;
  rvcVoiceSavedFromTrain: string;
  rvcVoiceUploadAvatar: string;
  rvcVoiceClearAvatar: string;
  rvcVoiceRenameLabel: string;
  rvcVoiceTrainAudioLabel: string;
  rvcVoiceUploadTrainAudio: string;
  rvcVoicePickTrainAudioFromCanvas: string;
  rvcVoiceClearTrainAudio: string;
  rvcVoiceLibraryHint: string;
};

const zh: AssetLibraryStrings = {
  tabRole: '角色',
  tabModel3d: '模型',
  tabScene: '场景',
  tabDigitalHuman: '数字人',
  tabRvcVoice: '音色',
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
  model3dEditTitle: '模型信息',
  model3dUploadAvatarLocal: '本地上传',
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
  roleImageDescLabel: '角色形象描述',
  roleImageDescPlaceholder: '描述角色外貌、服装与气质…也可点击上方已选图片自动反推',
  roleImageDescHint: '先选反推模型（会显示价格），点选一张参考图，再点「运行反推」写入描述。',
  roleReverseModelLabel: '图像反推模型',
  roleReverseNeedImage: '请先在四视图中放入至少一张图片，并点选要反推的那一张',
  roleReversing: '反推中…',
  roleReverseRun: '运行反推',
  roleReverseFailed: '图像反推失败',
  roleReverseEmpty: '反推完成但未返回文字，请换一张图或换模型重试',
  roleReverseCreditsSuffix: '元宝',
  roleReversePriceTitle: '本次图像反推预估元宝',
  roleReverseNoPrice: '暂未定价',
  roleReverseClickImageTitle: '点选此图作为反推对象，再点下方「运行反推」',
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
  dhAdd: '添加数字人',
  dhAddTitle: '添加参考视频',
  dhEditTitle: '编辑参考视频',
  dhEmpty: '暂无数字人素材，请添加参考视频',
  dhDragHint: '拖到画布创建视频模块',
  dhDeleteSelected: '删除勾选的数字人素材',
  dhNickname: '名称',
  dhNicknamePlaceholder: '如：新娘、主播 A',
  dhReferenceVideo: '参考视频（数字人形象）',
  dhDriveAudio: '驱动音频',
  dhUploadVideo: '本地上传',
  dhUploadVideoUnavailable: '本地上传需在桌面版 Electron 中使用',
  dhUploadAudio: '上传音频',
  dhPickFromCanvas: '画布中选择',
  dhPickVideoFromCanvas: '画布选视频',
  dhPickAudioFromCanvas: '画布选音频',
  dhNeedBothMedia: '请同时设置参考视频与驱动音频',
  dhNeedVideo: '请设置参考视频',
  dhDriveAudioOptional: '驱动音频（可选）',
  dhSaved: '数字人素材已保存',
  dhSaveFailed: '保存失败',
  dhPreviewAudio: '试听驱动音频',
  dhPlaceOnCanvas: '导入到画布（视频模块）',
  dhSelectForPanel: '选择为参考视频',
  dhPickForPanelHint: '点击条目即可回填到数字人面板（Esc 取消）',
  dhHasVideo: '有视频',
  dhHasAudio: '有音频',
  dhNoVideo: '缺视频',
  dhNoAudio: '缺音频',
  dhAudioSelected: '已选择音频',
  dhAudioReady: '驱动音频已添加',
  dhModalPreviewAudio: '点击试听',
  dhModalStopAudio: '点击停止',
  dhHoverVideoPreview: '悬停预览参考视频',
  dhUntitled: '未命名数字人',
  dhSaveNotReady: '保存功能未就绪，请重新编译主进程并重启应用',
  rvcVoiceAdd: '添加',
  rvcVoiceAddTitle: '添加 RVC 模型包',
  rvcVoiceEditTitle: '编辑音色（改名 / 头像 / 训练音频）',
  rvcVoiceEmpty: '训练完成的 zip 模型包会自动出现在这里；不需要的可勾选删除',
  rvcVoiceDragHint: '模型包为 zip，仅在素材库管理',
  rvcVoiceDeleteSelected: '删除勾选的 RVC 音色',
  rvcVoiceImported: 'RVC 模型包已加入资产库',
  rvcVoiceImportFailed: '导入失败',
  rvcVoiceSaved: '已保存',
  rvcVoiceSaveFailed: '保存失败',
  rvcVoiceDeleted: '已删除',
  rvcVoiceImportTitle: '导入本地 zip 模型包',
  rvcVoiceNickname: '显示名称',
  rvcVoiceNicknamePlaceholder: '如：周美丽声音',
  rvcVoiceModelName: '模型名称',
  rvcVoiceModelNamePlaceholder: '训练时填写的名称',
  rvcVoicePackagePath: '模型包',
  rvcVoicePackagePlaceholder: 'local-resource:// 或选择 zip 文件',
  rvcVoiceNeedPackage: '请选择模型包文件',
  rvcVoiceCancel: '取消',
  rvcVoiceSave: '保存',
  rvcVoiceSaving: '保存中…',
  rvcVoicePlaceToCanvas: '导入到画布（声音节点）',
  rvcVoiceUntitled: '未命名音色',
  rvcVoiceSavedFromTrain: 'RVC 训练完成，模型包已写入音色库',
  rvcVoiceUploadAvatar: '设置头像',
  rvcVoiceClearAvatar: '清除头像',
  rvcVoiceRenameLabel: '显示名称（可改名）',
  rvcVoiceTrainAudioLabel: '训练音频片段',
  rvcVoiceUploadTrainAudio: '电脑上传',
  rvcVoicePickTrainAudioFromCanvas: '画布选择',
  rvcVoiceClearTrainAudio: '清除训练音频',
  rvcVoiceLibraryHint: 'zip 压缩包不能作为声音播放；请在音色库中管理、改名或删除',
};

const en: AssetLibraryStrings = {
  tabRole: 'Characters',
  tabModel3d: 'Models',
  tabScene: 'Scenes',
  tabDigitalHuman: 'Digital human',
  tabRvcVoice: 'Voices',
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
  model3dEditTitle: 'Model info',
  model3dUploadAvatarLocal: 'Upload from computer',
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
  roleImageDescLabel: 'Character look description',
  roleImageDescPlaceholder: 'Describe appearance, outfit, vibe… or click a filled view above to auto-caption',
  roleImageDescHint: 'Pick a caption model (price shown), select a reference image, then click Run caption.',
  roleReverseModelLabel: 'Image caption model',
  roleReverseNeedImage: 'Add at least one image and select which view to caption',
  roleReversing: 'Captioning…',
  roleReverseRun: 'Run caption',
  roleReverseFailed: 'Image caption failed',
  roleReverseEmpty: 'Caption finished with no text. Try another image or model.',
  roleReverseCreditsSuffix: 'credits',
  roleReversePriceTitle: 'Estimated credits for this image caption',
  roleReverseNoPrice: 'Not priced',
  roleReverseClickImageTitle: 'Select this image, then click Run caption below',
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
  dhAdd: 'Add digital human',
  dhAddTitle: 'Add reference video',
  dhEditTitle: 'Edit reference video',
  dhEmpty: 'No digital human assets yet — add a reference video',
  dhDragHint: 'Drag to canvas to create a video module',
  dhDeleteSelected: 'Delete selected digital human assets',
  dhNickname: 'Name',
  dhNicknamePlaceholder: 'e.g. Host A',
  dhReferenceVideo: 'Reference video (avatar)',
  dhDriveAudio: 'Drive audio',
  dhUploadVideo: 'Upload from disk',
  dhUploadVideoUnavailable: 'Local upload requires the desktop Electron app',
  dhUploadAudio: 'Upload audio',
  dhPickFromCanvas: 'Pick from canvas',
  dhPickVideoFromCanvas: 'Pick video on canvas',
  dhPickAudioFromCanvas: 'Pick audio on canvas',
  dhNeedBothMedia: 'Both reference video and drive audio are required',
  dhNeedVideo: 'Reference video is required',
  dhDriveAudioOptional: 'Drive audio (optional)',
  dhSaved: 'Digital human assets saved',
  dhSaveFailed: 'Save failed',
  dhPreviewAudio: 'Preview drive audio',
  dhPlaceOnCanvas: 'Place on canvas (video module)',
  dhSelectForPanel: 'Use as reference video',
  dhPickForPanelHint: 'Click an item to fill the digital human panel (Esc to cancel)',
  dhHasVideo: 'Video',
  dhHasAudio: 'Audio',
  dhNoVideo: 'No video',
  dhNoAudio: 'No audio',
  dhAudioSelected: 'Audio selected',
  dhAudioReady: 'Drive audio added',
  dhModalPreviewAudio: 'Tap to preview',
  dhModalStopAudio: 'Tap to stop',
  dhHoverVideoPreview: 'Hover to preview reference video',
  dhUntitled: 'Untitled',
  dhSaveNotReady: 'Save not ready — rebuild the main process and restart the app',
  rvcVoiceAdd: 'Add',
  rvcVoiceAddTitle: 'Add RVC model package',
  rvcVoiceEditTitle: 'Edit voice (rename / avatar / train audio)',
  rvcVoiceEmpty: 'Trained zip packages appear here automatically; delete any you do not need',
  rvcVoiceDragHint: 'Zip packages are managed in the library only',
  rvcVoiceDeleteSelected: 'Delete selected RVC voices',
  rvcVoiceImported: 'RVC package added to library',
  rvcVoiceImportFailed: 'Import failed',
  rvcVoiceSaved: 'Saved',
  rvcVoiceSaveFailed: 'Save failed',
  rvcVoiceDeleted: 'Deleted',
  rvcVoiceImportTitle: 'Import local zip package',
  rvcVoiceNickname: 'Display name',
  rvcVoiceNicknamePlaceholder: 'e.g. My Voice',
  rvcVoiceModelName: 'Model name',
  rvcVoiceModelNamePlaceholder: 'Name used during training',
  rvcVoicePackagePath: 'Model package',
  rvcVoicePackagePlaceholder: 'local-resource:// or pick a zip file',
  rvcVoiceNeedPackage: 'Select a model package file',
  rvcVoiceCancel: 'Cancel',
  rvcVoiceSave: 'Save',
  rvcVoiceSaving: 'Saving…',
  rvcVoicePlaceToCanvas: 'Place on canvas (audio node)',
  rvcVoiceUntitled: 'Untitled voice',
  rvcVoiceSavedFromTrain: 'RVC training done — package saved to voice library',
  rvcVoiceUploadAvatar: 'Set avatar',
  rvcVoiceClearAvatar: 'Clear avatar',
  rvcVoiceRenameLabel: 'Display name (rename)',
  rvcVoiceTrainAudioLabel: 'Training audio clip',
  rvcVoiceUploadTrainAudio: 'Upload from computer',
  rvcVoicePickTrainAudioFromCanvas: 'Pick from canvas',
  rvcVoiceClearTrainAudio: 'Clear training audio',
  rvcVoiceLibraryHint: 'Zip packages cannot be played as audio — manage them here',
};

export function assetLibraryT(locale: AppLocale): AssetLibraryStrings {
  return locale === 'en' ? en : zh;
}
