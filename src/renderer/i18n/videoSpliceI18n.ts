import type { AppLocale } from './settingsI18n';

export type VideoSpliceStrings = {
  inputHandleTitle: string;
  title: string;
  saveToComputer: string;
  saveToComputerTitle: string;
  exportToCanvas: string;
  exportToCanvasTitle: string;
  exportToCanvasDone: string;
  exportToCanvasDoneWithAudio: string;
  exportToCanvasFailed: (msg?: string) => string;
  outputHandleTitle: string;
  fullscreenTitle: string;
  addMedia: string;
  fullscreenEditing: string;
  emptyAddClips: string;
  resetPlayheadTitle: string;
  zoomInTimelineTitle: string;
  zoomOutTimelineTitle: string;
  cutModeOnTitle: string;
  cutModeOffTitle: string;
  cutAtPlayheadTitle: string;
  cutSplitNothingAlert: string;
  copyClipsTitle: string;
  pasteClipsTitle: string;
  pasteClipsNothingAlert: string;
  deleteSelectedTitle: string;
  delete: string;
  trackVideo: string;
  videoTrackLabel: (idx: number) => string;
  addVideoTrack: string;
  addVideoTrackTitle: string;
  removeVideoTrack: string;
  removeVideoTrackTitle: (label: string) => string;
  removeVideoTrackConfirm: (label: string) => string;
  mute: string;
  unmute: string;
  volumeSliderTitle: string;
  audioVolumeSliderTitle: string;
  /** 轨道旁数字音量框 */
  volumeNumericInputTitle: string;
  audioTrackLabel: (idx: number) => string;
  addAudioTrackHint: string;
  addAudioTrack: string;
  addAudioTrackTitle: string;
  removeAudioTrack: string;
  removeAudioTrackTitle: (label: string) => string;
  removeAudioTrackConfirm: (label: string) => string;
  videoTrackLeftSnapOnTitle: string;
  videoTrackLeftSnapOffTitle: string;
  audioTrackLeftSnapOnTitle: (label: string) => string;
  audioTrackLeftSnapOffTitle: (label: string) => string;
  exitFullscreenTitle: string;
  clipNameVideo: string;
  clipNameImage: string;
  clipNameAudio: string;
  trimAriaLabel: string;
  trimTrackTitle: string;
  /** 时间轴片段左右边缘裁剪 */
  trimClipEdgeTitle: string;
  exportNoClips: string;
  exportUnavailable: string;
  exportSilentConfirm: string;
  exportOkSilent: (path: string) => string;
  exportOk: (path: string) => string;
  exportFailed: string;
  exportFailedMsg: (msg: string) => string;
  /** 导出进行中文案 */
  exportingToComputer: string;
  exportingToCanvas: string;
  exportingProgress: (pct: number) => string;
  importMediaSkipped: (names: string) => string;
  aspectRatioLabel: string;
  pickAspectRatioTitle: string;
  /** 预览区：重置片段画面位置/尺寸 */
  resetClipLayout: string;
  resetClipLayoutTitle: string;
  /** 预览变换模式：位置/尺寸 */
  transformModeLayout: string;
  transformModeLayoutTitle: string;
  /** 预览变换模式：画面裁剪 */
  transformModeCrop: string;
  transformModeCropTitle: string;
  /** 预览区：重置源画面裁剪 */
  resetClipCrop: string;
  resetClipCropTitle: string;
};

const zh: VideoSpliceStrings = {
  inputHandleTitle: '连接视频/图片/声音模块（可超级连线批量导入）',
  title: '视频剪辑',
  saveToComputer: '保存到电脑',
  saveToComputerTitle: '导出并保存到电脑',
  exportToCanvas: '导出到画布',
  exportToCanvasTitle: '导出并在右侧新建视频模块；含音轨时同时新建声音模块',
  exportToCanvasDone: '已导出到画布',
  exportToCanvasDoneWithAudio: '已导出视频与声音模块到画布',
  exportToCanvasFailed: (msg) => msg || '导出到画布失败，请稍后重试',
  outputHandleTitle: '导出成片可连到视频模块',
  fullscreenTitle: '全屏',
  addMedia: '添加素材',
  fullscreenEditing: '全屏编辑中',
  emptyAddClips: '添加视频或图片到轨道',
  resetPlayheadTitle: '重置到第一个素材起始点并停止',
  zoomInTimelineTitle: '放大时间轴 (Ctrl+滚轮)；拖动时按住 Ctrl 吸附到刻度',
  zoomOutTimelineTitle: '缩小时间轴 (Ctrl+滚轮)；拖动时按住 Ctrl 吸附到刻度',
  cutModeOnTitle: '剪刀模式：移动播放头后再次按 Ctrl+X 或点播放头剪刀剪断；Esc 退出',
  cutModeOffTitle: '剪刀：按 Ctrl+X 进入剪刀模式，再按一次在播放头处剪断',
  cutAtPlayheadTitle: '在此位置剪断（Ctrl+X）',
  cutSplitNothingAlert: '播放头须落在要剪断的素材上（距头尾至少 0.05 秒），请先把刻度线移到素材中间再按 Ctrl+X',
  copyClipsTitle: '复制选中素材 (Ctrl+C)',
  pasteClipsTitle: '在鼠标位置粘贴素材 (Ctrl+V)，重叠素材将后移',
  pasteClipsNothingAlert: '剪贴板为空，请先选中素材并按 Ctrl+C 复制',
  deleteSelectedTitle: '删除选中素材 (Delete)',
  delete: '删除',
  trackVideo: '视频',
  videoTrackLabel: (i) => (i === 0 ? '视频' : `视频${i + 1}`),
  addVideoTrack: '添加视频轨道',
  addVideoTrackTitle: '新增一条空白视频轨；上方轨道画面覆盖下方轨道',
  removeVideoTrack: '删除轨道',
  removeVideoTrackTitle: (label) => `删除${label}`,
  removeVideoTrackConfirm: (label) => `${label}上有视频或图片素材，确定删除该轨道？`,
  mute: '静音',
  unmute: '取消静音',
  volumeSliderTitle: '拖拽调节音量 0-100',
  audioVolumeSliderTitle: '拖拽调节音量 0-300%',
  volumeNumericInputTitle: '音量 0-100',
  audioTrackLabel: (i) => `音频${i + 1}`,
  addAudioTrackHint: '点击添加音频轨道，或从上方按钮添加素材',
  addAudioTrack: '添加音频轨道',
  addAudioTrackTitle: '新增一条空白音频轨，可将素材在轨间拖动',
  removeAudioTrack: '删除轨道',
  removeAudioTrackTitle: (label) => `删除${label}`,
  removeAudioTrackConfirm: (label) => `${label}上有音频素材，确定删除该轨道？`,
  videoTrackLeftSnapOnTitle: '已开启：视频轨片段向左紧凑排列（点击关闭）',
  videoTrackLeftSnapOffTitle: '已关闭：视频轨片段可留空（点击开启向左吸附）',
  audioTrackLeftSnapOnTitle: (label) => `已开启：${label}片段向左紧凑排列（点击关闭）`,
  audioTrackLeftSnapOffTitle: (label) => `已关闭：${label}片段可留空（点击开启向左吸附）`,
  exitFullscreenTitle: '退出全屏',
  clipNameVideo: '视频',
  clipNameImage: '图片',
  clipNameAudio: '音频',
  trimAriaLabel: '裁剪范围与播放进度',
  trimTrackTitle: '拖拽前后指针选择裁剪区间，点击轨道跳转播放位置',
  trimClipEdgeTitle: '拖拽左右边缘裁剪入出点',
  exportNoClips: '暂无视频或图片素材可导出',
  exportUnavailable: '导出功能不可用',
  exportSilentConfirm: '视频轨道已静音且无其他音轨，导出将无声音。是否继续？',
  exportOkSilent: (path) =>
    `视频已导出（无声音）: ${path}\n\n请点击视频轨道左侧的喇叭图标取消静音，或确认源视频文件包含音轨。`,
  exportOk: (path) => `视频已导出: ${path}`,
  exportFailed: '导出失败',
  exportFailedMsg: (msg) => msg || '导出失败',
  exportingToComputer: '正在导出到电脑…',
  exportingToCanvas: '正在导出到画布…',
  exportingProgress: (pct) => `导出中 ${Math.max(0, Math.min(100, Math.round(pct)))}%`,
  importMediaSkipped: (names) => `以下文件未能导入剪辑轨道（格式不支持或读取失败）：${names}`,
  aspectRatioLabel: '画面比例',
  pickAspectRatioTitle: '选择预览与导出的画面比例',
  resetClipLayout: '重置位置',
  resetClipLayoutTitle: '将画面位置与尺寸恢复为铺满预览',
  transformModeLayout: '位置',
  transformModeLayoutTitle: '调节裁切后画面在画布上的位置与尺寸',
  transformModeCrop: '裁剪',
  transformModeCropTitle: '裁剪源画面；保留框即位置模式下的画面占位',
  resetClipCrop: '重置裁剪',
  resetClipCropTitle: '清除画面裁剪，恢复完整源画面占位',
};

const en: VideoSpliceStrings = {
  inputHandleTitle: 'Connect video / image / audio nodes (batch via super-connect)',
  title: 'Video editor',
  saveToComputer: 'Save to computer',
  saveToComputerTitle: 'Export and save to your computer',
  exportToCanvas: 'To canvas',
  exportToCanvasTitle: 'Export video to the right; adds an audio node when the timeline has audio',
  exportToCanvasDone: 'Exported to canvas',
  exportToCanvasDoneWithAudio: 'Exported video and audio nodes to canvas',
  exportToCanvasFailed: (msg) => msg || 'Export to canvas failed. Please try again.',
  outputHandleTitle: 'Connect exported video to a video node',
  fullscreenTitle: 'Fullscreen',
  addMedia: 'Add media',
  fullscreenEditing: 'Fullscreen editing',
  emptyAddClips: 'Add video or image clips to the timeline',
  resetPlayheadTitle: 'Jump to start of first clip and stop',
  zoomInTimelineTitle: 'Zoom timeline in (Ctrl+scroll); Ctrl while dragging snaps to ticks',
  zoomOutTimelineTitle: 'Zoom timeline out (Ctrl+scroll); Ctrl while dragging snaps to ticks',
  cutModeOnTitle: 'Split mode: move playhead, press Ctrl+X again or click scissors; Esc to exit',
  cutModeOffTitle: 'Scissors: Ctrl+X to enter split mode, press again to split at playhead',
  cutAtPlayheadTitle: 'Split here (Ctrl+X)',
  cutSplitNothingAlert: 'Move the playhead onto the clip to split (at least 0.05s from edges), then press Ctrl+X',
  copyClipsTitle: 'Copy selection (Ctrl+C)',
  pasteClipsTitle: 'Paste at mouse (Ctrl+V); overlapping clips shift right',
  pasteClipsNothingAlert: 'Clipboard is empty. Select clips and press Ctrl+C to copy.',
  deleteSelectedTitle: 'Delete selection (Delete)',
  delete: 'Delete',
  trackVideo: 'Video',
  videoTrackLabel: (i) => (i === 0 ? 'Video' : `Video ${i + 1}`),
  addVideoTrack: 'Add video track',
  addVideoTrackTitle: 'Add an empty video track; upper tracks cover lower tracks',
  removeVideoTrack: 'Remove track',
  removeVideoTrackTitle: (label) => `Remove ${label}`,
  removeVideoTrackConfirm: (label) => `${label} has clips. Remove this track?`,
  mute: 'Mute',
  unmute: 'Unmute',
  volumeSliderTitle: 'Drag to adjust volume (0–100)',
  audioVolumeSliderTitle: 'Drag to adjust volume (0–300%)',
  volumeNumericInputTitle: 'Volume 0–100',
  audioTrackLabel: (i) => `Audio ${i + 1}`,
  addAudioTrackHint: 'Add an audio track here, or use Add media above',
  addAudioTrack: 'Add audio track',
  addAudioTrackTitle: 'Add an empty audio track; drag clips between tracks',
  removeAudioTrack: 'Remove track',
  removeAudioTrackTitle: (label) => `Remove ${label}`,
  removeAudioTrackConfirm: (label) => `${label} has clips. Remove this track?`,
  videoTrackLeftSnapOnTitle: 'On: video clips pack to the left (click to turn off)',
  videoTrackLeftSnapOffTitle: 'Off: video clips may have gaps (click to snap left)',
  audioTrackLeftSnapOnTitle: (label) => `On: ${label} clips pack to the left (click to turn off)`,
  audioTrackLeftSnapOffTitle: (label) => `Off: ${label} clips may have gaps (click to snap left)`,
  exitFullscreenTitle: 'Exit fullscreen',
  clipNameVideo: 'Video',
  clipNameImage: 'Image',
  clipNameAudio: 'Audio',
  trimAriaLabel: 'Trim range and playback',
  trimTrackTitle: 'Drag handles to trim; click track to seek',
  trimClipEdgeTitle: 'Drag left/right edge to trim in/out',
  exportNoClips: 'No video or image clips to export',
  exportUnavailable: 'Export is not available',
  exportSilentConfirm:
    'The video track is muted and there is no other audio. Export will be silent. Continue?',
  exportOkSilent: (path) =>
    `Exported (no audio): ${path}\n\nUnmute the video track on the left, or check that source files have audio.`,
  exportOk: (path) => `Exported: ${path}`,
  exportFailed: 'Export failed',
  exportFailedMsg: (msg) => msg || 'Export failed',
  exportingToComputer: 'Exporting to computer…',
  exportingToCanvas: 'Exporting to canvas…',
  exportingProgress: (pct) => `Exporting ${Math.max(0, Math.min(100, Math.round(pct)))}%`,
  importMediaSkipped: (names) => `Could not import to timeline (unsupported or failed): ${names}`,
  aspectRatioLabel: 'Aspect ratio',
  pickAspectRatioTitle: 'Preview and export aspect ratio',
  resetClipLayout: 'Reset layout',
  resetClipLayoutTitle: 'Reset clip position and size to fill the frame',
  transformModeLayout: 'Layout',
  transformModeLayoutTitle: 'Move and resize the cropped frame on the canvas',
  transformModeCrop: 'Crop',
  transformModeCropTitle: 'Crop the source; the keep box is the layout frame in Layout mode',
  resetClipCrop: 'Reset crop',
  resetClipCropTitle: 'Clear crop and restore the full source frame placement',
};

export function videoSpliceT(locale: AppLocale): VideoSpliceStrings {
  return locale === 'en' ? en : zh;
}
