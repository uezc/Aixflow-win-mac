import type { AppLocale } from './settingsI18n';

export type VideoSpliceStrings = {
  inputHandleTitle: string;
  title: string;
  saveToComputer: string;
  saveToComputerTitle: string;
  exportToCanvas: string;
  exportToCanvasTitle: string;
  exportToCanvasDone: string;
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
  exportNoClips: string;
  exportUnavailable: string;
  exportSilentConfirm: string;
  exportOkSilent: (path: string) => string;
  exportOk: (path: string) => string;
  exportFailed: string;
  exportFailedMsg: (msg: string) => string;
  importMediaSkipped: (names: string) => string;
};

const zh: VideoSpliceStrings = {
  inputHandleTitle: '连接视频/图片/声音模块（可超级连线批量导入）',
  title: '视频剪辑',
  saveToComputer: '保存到电脑',
  saveToComputerTitle: '导出并保存到电脑',
  exportToCanvas: '导出到画布',
  exportToCanvasTitle: '导出视频并在右侧新建视频模块（自动连线）',
  exportToCanvasDone: '已导出到画布',
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
  exportNoClips: '暂无视频或图片素材可导出',
  exportUnavailable: '导出功能不可用',
  exportSilentConfirm: '视频轨道已静音且无其他音轨，导出将无声音。是否继续？',
  exportOkSilent: (path) =>
    `视频已导出（无声音）: ${path}\n\n请点击视频轨道左侧的喇叭图标取消静音，或确认源视频文件包含音轨。`,
  exportOk: (path) => `视频已导出: ${path}`,
  exportFailed: '导出失败',
  exportFailedMsg: (msg) => msg || '导出失败',
  importMediaSkipped: (names) => `以下文件未能导入剪辑轨道（格式不支持或读取失败）：${names}`,
};

const en: VideoSpliceStrings = {
  inputHandleTitle: 'Connect video / image / audio nodes (batch via super-connect)',
  title: 'Video editor',
  saveToComputer: 'Save to computer',
  saveToComputerTitle: 'Export and save to your computer',
  exportToCanvas: 'To canvas',
  exportToCanvasTitle: 'Export and add a video node to the right (auto-connect)',
  exportToCanvasDone: 'Exported to canvas',
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
  exportNoClips: 'No video or image clips to export',
  exportUnavailable: 'Export is not available',
  exportSilentConfirm:
    'The video track is muted and there is no other audio. Export will be silent. Continue?',
  exportOkSilent: (path) =>
    `Exported (no audio): ${path}\n\nUnmute the video track on the left, or check that source files have audio.`,
  exportOk: (path) => `Exported: ${path}`,
  exportFailed: 'Export failed',
  exportFailedMsg: (msg) => msg || 'Export failed',
  importMediaSkipped: (names) => `Could not import to timeline (unsupported or failed): ${names}`,
};

export function videoSpliceT(locale: AppLocale): VideoSpliceStrings {
  return locale === 'en' ? en : zh;
}
