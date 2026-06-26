import type { AppLocale } from './settingsI18n';

export type WorkspaceChromeStrings = {
  statusCloudCredits: string;
  statusNotConnected: string;
  statusConnecting: string;
  statusRecharge: string;
  statusPricingSync: string;
  statusCreditsTooltip: string;
  statusRunning: string;
  backToProjects: string;
  openProjectFolder: string;
  openProjectFolderTitle: string;
  /** 主进程拦截空覆盖 data.json 时的提示 */
  emptyOverwriteBlockedMessage: string;
  backupProjectButton: string;
  backupProjectTitle: string;
  backupProjectSuccess: (fileNames: string) => string;
  backupProjectNoDataToBackup: string;
  backupProjectNoProject: string;
  backupProjectIoError: string;
  backupProjectFailed: string;
  restoreFromBackupButton: string;
  restoreFromBackupTitle: string;
  restoreFromBackupSuccess: (nodeCount: number, previousCount: number) => string;
  restoreFromBackupNoBackup: string;
  restoreFromBackupNotNewer: (currentCount: number, backupCount: number) => string;
  restoreFromBackupNoProject: string;
  restoreFromBackupIoError: string;
  restoreFromBackupFailed: string;
  undoTitle: string;
  redoTitle: string;
  darkModeSettingsTitle: string;
  edgeStyleLabel: string;
  edgeCurve: string;
  edgeOrthogonal: string;
  dotSizeLabel: string;
  dotSizeRangeTitle: string;
  canvasColorSettingsTitle: string;
  canvasBackground: string;
  dotColor: string;
  moduleColor: string;
  edgeColor: string;
  sidebarColor: string;
  sidebarColorTitle: string;
  dotThickness: string;
  pickCanvasBg: string;
  pickDotColor: string;
  pickModuleColor: string;
  pickEdgeColor: string;
  pickSidebarColor: string;
  switchToLightMode: string;
  switchToDarkMode: string;
  brightness: string;
  brightnessTitle: string;
  brightnessSliderTitle: string;
  fullscreenTitle: string;
  headerCloudCredits: string;
  headerConnectingCloud: string;
  headerCreditsTooltip: string;
  headerCurrencyUnit: string;
  headerLowBalanceTitle: string;
  headerRefreshBalanceTitle: string;
  languageToEn: string;
  languageToZh: string;
  /** 语言下拉按钮无障碍说明 */
  languageMenuTitle: string;
  taskList: string;
  clearAllTasks: string;
  clearAllTasksTitle: string;
  taskCount: (n: number) => string;
  noTasks: string;
  taskFailed: string;
  taskTimeoutWait: string;
  noPrompt: string;
  /** 任务列表：提示词过长时展开全文 */
  taskPromptExpand: string;
  taskPromptCollapse: string;
  /** LLM 文本任务：列表预览点击提示 */
  taskTextTapToView: string;
  /** LLM 文本任务：全文弹窗标题 */
  taskTextModalTitle: string;
  taskTextModalClose: string;
  genFailedTapDetail: string;
  taskFailedDefault: string;
  completed: string;
  /** 已完成：可选耗时（秒）、消耗元宝（与画布定价表一致，为预估） */
  completedStatus: (o: { durationSec?: number; yuanbaoConsumed?: number }) => string;
  running: (sec: number) => string;
  timeout: string;
  failed: string;
  viewFailureDetails: string;
  viewFailureDetailsTitle: string;
  downloadTitle: string;
  placeOnCanvasTitle: string;
  deleteTitle: string;
  dateLocale: string;
  llmGenerating: string;
  progressImage: string;
  progressVideo: string;
  progressAudio: string;
  downloadFailed: string;
  noImageToDownload: string;
  viewportPausedLoad: string;
  waitingForImage: string;
  genFailedTitle: string;
  waitingForVideo: string;
  pleaseWait: string;
  /** 画布文本 / LLM 输出空状态提示 */
  doubleClickEditText: string;
  /** LLM 输出区编辑中 title */
  editOutputCancelEscapeTitle: string;
  /** 画布文本 / LLM 输出：缩小字体 */
  fontZoomOutTitle: string;
  /** 画布文本 / LLM 输出：放大字体 */
  fontZoomInTitle: string;
  /** 文本节点：麦克风语音输入按钮 tooltip */
  textVoiceInputTitle: string;
  /** 文本节点：语音输入（开始录音） */
  textVoiceInputButton: string;
  /** 文本节点：录音中按钮文案 */
  textVoiceInputStopButton: string;
  /** 文本节点：录音弹窗标题 */
  textVoiceModalTitle: string;
  /** 文本节点：录音弹窗说明 */
  textVoiceModalSubtitle: string;
  /** 文本节点：Whisper 识别进行中 */
  textVoiceTranscribing: string;
  /** Text split 节点：分隔符标签 */
  textSplitSeparatorLabel: string;
};

const zh: WorkspaceChromeStrings = {
  statusCloudCredits: '云端元宝',
  statusNotConnected: '未连接云端',
  statusConnecting: '连接中…',
  statusRecharge: '充值',
  statusPricingSync: '定价同步',
  statusCreditsTooltip: '元宝可用于所有云端 AI 模型生成',
  statusRunning: '运行中',
  backToProjects: '返回项目列表',
  openProjectFolder: '打开项目文件夹',
  openProjectFolderTitle: '打开项目文件夹',
  emptyOverwriteBlockedMessage:
    '检测到可能清空整个工程的操作，系统已阻止保存。若需清空，请手动删除节点后重试。',
  backupProjectButton: '备份工程',
  backupProjectTitle: '将 data.json 与 data.json.bak 复制到项目 backups 文件夹（带时间戳）',
  backupProjectSuccess: (fileNames) => `已备份到 backups/：${fileNames}`,
  backupProjectNoDataToBackup: '未找到 data.json 或 data.json.bak，无法备份。',
  backupProjectNoProject: '找不到项目目录，请确认工程已保存且项目未被移动或删除。',
  backupProjectIoError: '备份写入失败，请检查磁盘空间、防病毒软件拦截与 backups 文件夹写入权限。',
  backupProjectFailed: '备份失败，请稍后重试或检查磁盘权限。',
  restoreFromBackupButton: '从备份恢复',
  restoreFromBackupTitle: '若 data.json.bak 中节点更多，用备份覆盖当前工程（会先保存 data.json.pre-restore-*.json）',
  restoreFromBackupSuccess: (nodeCount, previousCount) =>
    `已从备份恢复 ${nodeCount} 个模块（恢复前 ${previousCount} 个）。画布将重新加载。`,
  restoreFromBackupNoBackup: '未找到可用的 data.json.bak，无法恢复。',
  restoreFromBackupNotNewer: (currentCount, backupCount) =>
    `备份中没有更多模块（当前 ${currentCount} 个，备份 ${backupCount} 个）。可打开项目文件夹查看 backups/ 里的历史备份。`,
  restoreFromBackupNoProject: '找不到项目目录，无法恢复。',
  restoreFromBackupIoError: '恢复写入失败，请检查磁盘权限。',
  restoreFromBackupFailed: '恢复失败，请稍后重试。',
  undoTitle: '撤销 (Ctrl+Z)',
  redoTitle: '重做 (Ctrl+Y)',
  darkModeSettingsTitle: '暗黑模式设置',
  edgeStyleLabel: '连接线样式',
  edgeCurve: '曲线',
  edgeOrthogonal: '直角',
  dotSizeLabel: '波点大小',
  dotSizeRangeTitle: '波点大小（50%–400%）',
  canvasColorSettingsTitle: '画布颜色设置',
  canvasBackground: '画布背景',
  dotColor: '波点颜色',
  moduleColor: '模块组件颜色',
  edgeColor: '连接线颜色',
  sidebarColor: '侧边栏颜色',
  sidebarColorTitle: '选择侧边栏颜色（角色列表、任务列表）',
  dotThickness: '波点粗细',
  pickCanvasBg: '选择画布背景颜色',
  pickDotColor: '选择波点颜色',
  pickModuleColor: '选择模块组件颜色',
  pickEdgeColor: '选择连接线颜色',
  pickSidebarColor: '选择侧边栏颜色',
  switchToLightMode: '切换到光明模式',
  switchToDarkMode: '切换到暗黑模式',
  brightness: '亮度',
  brightnessTitle: '亮度调节',
  brightnessSliderTitle: '拖动调节亮度',
  fullscreenTitle: '窗口全屏切换（F11 快捷键可快捷切换）',
  headerCloudCredits: '云端元宝',
  headerConnectingCloud: '正在连接云端服务...',
  headerCreditsTooltip: '元宝可用于所有云端 AI 模型生成',
  headerCurrencyUnit: '元宝',
  headerLowBalanceTitle: '余额不足，请及时充值（云端元宝）',
  headerRefreshBalanceTitle: '点击刷新云端余额',
  languageToEn: 'English',
  languageToZh: '中文',
  languageMenuTitle: '界面语言',
  taskList: '任务列表',
  clearAllTasks: '清空',
  clearAllTasksTitle: '清空全部任务',
  taskCount: (n) => `共 ${n} 个任务`,
  noTasks: '暂无任务',
  taskFailed: '任务失败',
  taskTimeoutWait: '已超时，等待重试...',
  noPrompt: '无提示词',
  taskPromptExpand: '展开',
  taskPromptCollapse: '收起',
  taskTextTapToView: '点击查看全文',
  taskTextModalTitle: '生成结果',
  taskTextModalClose: '关闭',
  genFailedTapDetail: '生成失败（点击卡片查看详情）',
  taskFailedDefault: '任务失败',
  completed: '已完成',
  completedStatus: (o) => {
    let s = '已完成';
    if (typeof o.durationSec === 'number') s += ` · ${o.durationSec}s`;
    if (typeof o.yuanbaoConsumed === 'number') s += ` · ${o.yuanbaoConsumed}元宝`;
    return s;
  },
  running: (sec) => `运行中 ${sec}s`,
  timeout: '超时',
  failed: '失败',
  viewFailureDetails: '查看失败详情',
  viewFailureDetailsTitle: '查看失败详情',
  downloadTitle: '下载',
  placeOnCanvasTitle: '放入画布',
  deleteTitle: '删除',
  dateLocale: 'zh-CN',
  llmGenerating: '生成中...',
  progressImage: '正在生成图片...',
  progressVideo: '正在生成视频...',
  progressAudio: '正在生成音频...',
  downloadFailed: '下载失败',
  noImageToDownload: '暂无可下载的图片',
  viewportPausedLoad: '视口外暂停加载',
  waitingForImage: '等待生成图片...',
  genFailedTitle: '生成失败',
  waitingForVideo: '等待生成视频...',
  pleaseWait: '请稍候',
  doubleClickEditText: '双击编辑文本...',
  editOutputCancelEscapeTitle: '编辑输出文本，按 Escape 取消',
  fontZoomOutTitle: '缩小字体',
  fontZoomInTitle: '放大字体',
  textVoiceInputTitle:
    '用麦克风录音，停止后本地识别为文字并追加到正文；选「简体中文」时输出简体（与上方「转文字」共用语言）',
  textVoiceInputButton: '语音输入',
  textVoiceInputStopButton: '停止',
  textVoiceModalTitle: '正在录制语音',
  textVoiceModalSubtitle: '对着麦克风说话，结束后点击「停止并保存」将转为文字填入正文',
  textVoiceTranscribing: '正在识别语音…',
  textSplitSeparatorLabel: '分隔符',
};

const en: WorkspaceChromeStrings = {
  statusCloudCredits: 'Cloud credits',
  statusNotConnected: 'Cloud offline',
  statusConnecting: 'Connecting…',
  statusRecharge: 'Top up',
  statusPricingSync: 'Pricing sync',
  statusCreditsTooltip: 'Credits are used for all cloud AI generation',
  statusRunning: 'Running',
  backToProjects: 'Back to projects',
  openProjectFolder: 'Open project folder',
  openProjectFolderTitle: 'Open project folder',
  emptyOverwriteBlockedMessage:
    'Saving would clear the entire project; the operation was blocked. To empty the canvas, delete all nodes manually, then save again.',
  backupProjectButton: 'Backup project',
  backupProjectTitle: 'Copy data.json and data.json.bak to project backups/ (timestamped)',
  backupProjectSuccess: (fileNames) => `Backed up to backups/: ${fileNames}`,
  backupProjectNoDataToBackup: 'No data.json or data.json.bak found; nothing to back up.',
  backupProjectNoProject: 'Project folder not found. Save the project once or check that the folder was not moved or deleted.',
  backupProjectIoError: 'Backup write failed. Check disk space, antivirus blocking, and write permission on backups/.',
  backupProjectFailed: 'Backup failed. Check disk permissions or try again.',
  restoreFromBackupButton: 'Restore from backup',
  restoreFromBackupTitle:
    'If data.json.bak has more nodes, overwrite the current project (saves data.json.pre-restore-*.json first)',
  restoreFromBackupSuccess: (nodeCount, previousCount) =>
    `Restored ${nodeCount} modules from backup (was ${previousCount}). Reloading canvas…`,
  restoreFromBackupNoBackup: 'No usable data.json.bak found.',
  restoreFromBackupNotNewer: (currentCount, backupCount) =>
    `Backup does not have more modules (current ${currentCount}, backup ${backupCount}). Check backups/ in the project folder.`,
  restoreFromBackupNoProject: 'Project folder not found; cannot restore.',
  restoreFromBackupIoError: 'Restore write failed. Check disk permissions.',
  restoreFromBackupFailed: 'Restore failed. Try again later.',
  undoTitle: 'Undo (Ctrl+Z)',
  redoTitle: 'Redo (Ctrl+Y)',
  darkModeSettingsTitle: 'Dark mode settings',
  edgeStyleLabel: 'Edge style',
  edgeCurve: 'Curved',
  edgeOrthogonal: 'Orthogonal',
  dotSizeLabel: 'Dot size',
  dotSizeRangeTitle: 'Dot size (50%–400%)',
  canvasColorSettingsTitle: 'Canvas colors',
  canvasBackground: 'Canvas background',
  dotColor: 'Dot color',
  moduleColor: 'Module color',
  edgeColor: 'Edge color',
  sidebarColor: 'Sidebar color',
  sidebarColorTitle: 'Sidebar color (characters & tasks)',
  dotThickness: 'Dot thickness',
  pickCanvasBg: 'Pick canvas background',
  pickDotColor: 'Pick dot color',
  pickModuleColor: 'Pick module color',
  pickEdgeColor: 'Pick edge color',
  pickSidebarColor: 'Pick sidebar color',
  switchToLightMode: 'Switch to light mode',
  switchToDarkMode: 'Switch to dark mode',
  brightness: 'Brightness',
  brightnessTitle: 'Brightness',
  brightnessSliderTitle: 'Adjust brightness',
  fullscreenTitle: 'Toggle fullscreen (F11)',
  headerCloudCredits: 'Cloud credits',
  headerConnectingCloud: 'Connecting to cloud...',
  headerCreditsTooltip: 'Credits are used for all cloud AI generation',
  headerCurrencyUnit: 'credits',
  headerLowBalanceTitle: 'Low balance — please top up',
  headerRefreshBalanceTitle: 'Click to refresh balance',
  languageToEn: 'English',
  languageToZh: '中文',
  languageMenuTitle: 'Display language',
  taskList: 'Tasks',
  clearAllTasks: 'Clear',
  clearAllTasksTitle: 'Clear all tasks',
  taskCount: (n) => `${n} task(s)`,
  noTasks: 'No tasks',
  taskFailed: 'Failed',
  taskTimeoutWait: 'Timed out, retrying...',
  noPrompt: 'No prompt',
  taskPromptExpand: 'Show more',
  taskPromptCollapse: 'Show less',
  taskTextTapToView: 'Tap to view full text',
  taskTextModalTitle: 'Generated text',
  taskTextModalClose: 'Close',
  genFailedTapDetail: 'Generation failed (tap for details)',
  taskFailedDefault: 'Task failed',
  completed: 'Done',
  completedStatus: (o) => {
    let s = 'Done';
    if (typeof o.durationSec === 'number') s += ` · ${o.durationSec}s`;
    if (typeof o.yuanbaoConsumed === 'number') s += ` · ${o.yuanbaoConsumed} credits`;
    return s;
  },
  running: (sec) => `Running ${sec}s`,
  timeout: 'Timeout',
  failed: 'Failed',
  viewFailureDetails: 'View error details',
  viewFailureDetailsTitle: 'View error details',
  downloadTitle: 'Download',
  placeOnCanvasTitle: 'Place on canvas',
  deleteTitle: 'Delete',
  dateLocale: 'en-US',
  llmGenerating: 'Generating...',
  progressImage: 'Generating image...',
  progressVideo: 'Generating video...',
  progressAudio: 'Generating audio...',
  downloadFailed: 'Download failed',
  noImageToDownload: 'No image to download',
  viewportPausedLoad: 'Paused (off-screen)',
  waitingForImage: 'Waiting for image…',
  genFailedTitle: 'Generation failed',
  waitingForVideo: 'Waiting for video…',
  pleaseWait: 'Please wait',
  doubleClickEditText: 'Double-click to edit…',
  editOutputCancelEscapeTitle: 'Edit output. Press Escape to cancel.',
  fontZoomOutTitle: 'Decrease font size',
  fontZoomInTitle: 'Increase font size',
  textVoiceInputTitle:
    'Record with the mic; after stop, local Whisper appends text. Choose “Simplified Chinese” for simplified output (same language as “Transcribe” above).',
  textVoiceInputButton: 'Voice input',
  textVoiceInputStopButton: 'Stop',
  textVoiceModalTitle: 'Recording voice',
  textVoiceModalSubtitle: 'Speak into the mic, then tap “Stop & save” to transcribe into the text.',
  textVoiceTranscribing: 'Transcribing…',
  textSplitSeparatorLabel: 'Delimiter',
};

export function workspaceChromeT(locale: AppLocale): WorkspaceChromeStrings {
  return locale === 'en' ? en : zh;
}
