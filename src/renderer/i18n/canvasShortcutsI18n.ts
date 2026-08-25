import type { AppLocale } from './settingsI18n';

export type CanvasShortcutEntryStrings = {
  label: string;
  /** 无键位时右侧说明（如工具栏、自动保存） */
  hint?: string;
};

export type CanvasShortcutOpRowStrings = {
  action: string;
  desc: string;
};

export type CanvasShortcutsStrings = {
  panelTitle: string;
  generalSection: string;
  editSection: string;
  opsSection: string;
  opsActionHeader: string;
  opsDescHeader: string;
  promptTipsSection: string;
  promptTipsAtTitle: string;
  promptTipsAtBody: string;
  promptTipsWireNote: string;
  escClose: string;
  restoreDefaults: string;
  restoreDefaultsDone: string;
  openPanelTitle: string;
  zoomIn: CanvasShortcutEntryStrings;
  zoomOut: CanvasShortcutEntryStrings;
  fitView: CanvasShortcutEntryStrings;
  minimap: CanvasShortcutEntryStrings;
  panCanvas: CanvasShortcutEntryStrings;
  saveCanvas: CanvasShortcutEntryStrings;
  openSettings: CanvasShortcutEntryStrings;
  cutNodes: CanvasShortcutEntryStrings;
  copyNodes: CanvasShortcutEntryStrings;
  regionScreenshot: CanvasShortcutEntryStrings;
  pasteNodes: CanvasShortcutEntryStrings;
  undo: CanvasShortcutEntryStrings;
  deleteNodes: CanvasShortcutEntryStrings;
  multiSelect: CanvasShortcutEntryStrings;
  quickConnect: CanvasShortcutEntryStrings;
  /** MiniMax-H3 视频节点：一键优化提示词 */
  optimizeH3Prompt: CanvasShortcutEntryStrings;
  /** 按住说话语音输入（可自定义） */
  voiceInputHold: CanvasShortcutEntryStrings;
  voiceInputHoldRecording: string;
  voiceInputHoldClickToRebind: string;
  voiceInputHoldSaved: string;
  wheelUpKey: string;
  wheelDownKey: string;
  clickKey: string;
  ops: {
    doubleClick: CanvasShortcutOpRowStrings;
    leftDrag: CanvasShortcutOpRowStrings;
    rightClick: CanvasShortcutOpRowStrings;
    boxSelect: CanvasShortcutOpRowStrings;
  };
};

const zh: CanvasShortcutsStrings = {
  panelTitle: '快捷键与设置',
  generalSection: '通用',
  editSection: '编辑与选择',
  opsSection: '常规操作',
  opsActionHeader: '操作',
  opsDescHeader: '说明',
  promptTipsSection: '@ 引用',
  promptTipsAtTitle: '@ 引用',
  promptTipsAtBody:
    '在生成节点的提示词编辑框中输入 @，会弹出引用菜单。你可以选择画布上的节点、资产或上游结果，把角色设定、场景说明、参考图、参考视频、参考音频等内容带到当前节点里继续生成。',
  promptTipsWireNote:
    '图片、视频、音频这类素材优先用连线传递；文本设定、说明和提示词片段常用 @ 引用。',
  escClose: '退出录制 / 关闭面板',
  restoreDefaults: '恢复默认设置',
  restoreDefaultsDone: '已恢复为默认快捷键（含语音 Ctrl+`）',
  openPanelTitle: '快捷键与设置',
  zoomIn: { label: '放大' },
  zoomOut: { label: '缩小' },
  fitView: { label: '聚焦节点 / 适应画布', hint: '工具栏' },
  minimap: { label: '小地图', hint: '左下角' },
  panCanvas: { label: '拖动画布', hint: '中键拖动 / Space+拖动' },
  saveCanvas: { label: '保存画布', hint: '自动保存' },
  openSettings: { label: '打开设置', hint: '顶部工具栏' },
  cutNodes: { label: '剪切节点' },
  copyNodes: { label: '复制节点' },
  regionScreenshot: { label: '区域截图' },
  pasteNodes: { label: '粘贴节点' },
  undo: { label: '撤销' },
  deleteNodes: { label: '删除节点' },
  multiSelect: { label: '多选节点（配合点击）' },
  quickConnect: { label: '快速连线（点击目标）' },
  optimizeH3Prompt: { label: '优化提示词（MiniMax-H3）' },
  voiceInputHold: {
    label: '语音输入（按住说话）',
    hint: '先点输入框，再按住快捷键；点击右侧可改键',
  },
  voiceInputHoldRecording: '按下新快捷键…',
  voiceInputHoldClickToRebind: '点击改键',
  voiceInputHoldSaved: '语音快捷键已更新',
  wheelUpKey: '滚轮 ↑',
  wheelDownKey: '滚轮 ↓',
  clickKey: '点击',
  ops: {
    doubleClick: { action: '双击画布', desc: '打开添加模块菜单，快速创建节点' },
    leftDrag: { action: '左键拖拽', desc: '移动节点' },
    rightClick: { action: '右键画布', desc: '打开右键菜单' },
    boxSelect: { action: '左键框选', desc: '框选多个模块' },
  },
};

const en: CanvasShortcutsStrings = {
  panelTitle: 'Shortcuts & settings',
  generalSection: 'General',
  editSection: 'Edit & selection',
  opsSection: 'Common operations',
  opsActionHeader: 'Action',
  opsDescHeader: 'Description',
  promptTipsSection: '@ mention',
  promptTipsAtTitle: '@ mention',
  promptTipsAtBody:
    'Type @ in a generation node’s prompt box to open the mention menu. Pick a canvas node, asset, or upstream result to bring character setups, scene notes, reference images, videos, or audio into the current node.',
  promptTipsWireNote:
    'Prefer wiring for image, video, and audio media; use @ mentions for text setups, notes, and prompt snippets.',
  escClose: 'Exit capture / close panel',
  restoreDefaults: 'Restore defaults',
  restoreDefaultsDone: 'Restored defaults (voice shortcut back to Ctrl+`)',
  openPanelTitle: 'Shortcuts & settings',
  zoomIn: { label: 'Zoom in' },
  zoomOut: { label: 'Zoom out' },
  fitView: { label: 'Focus nodes / fit view', hint: 'Toolbar' },
  minimap: { label: 'Minimap', hint: 'Bottom left' },
  panCanvas: { label: 'Pan canvas', hint: 'Middle-drag / Space+drag' },
  saveCanvas: { label: 'Save canvas', hint: 'Auto-save' },
  openSettings: { label: 'Open settings', hint: 'Top toolbar' },
  cutNodes: { label: 'Cut nodes' },
  copyNodes: { label: 'Copy nodes' },
  regionScreenshot: { label: 'Region capture' },
  pasteNodes: { label: 'Paste nodes' },
  undo: { label: 'Undo' },
  deleteNodes: { label: 'Delete nodes' },
  multiSelect: { label: 'Multi-select (with click)' },
  quickConnect: { label: 'Quick connect (click target)' },
  optimizeH3Prompt: { label: 'Optimize prompt (MiniMax-H3)' },
  voiceInputHold: {
    label: 'Voice input (hold to talk)',
    hint: 'Focus a field, hold shortcut; click keys to rebind',
  },
  voiceInputHoldRecording: 'Press a new shortcut…',
  voiceInputHoldClickToRebind: 'Click to rebind',
  voiceInputHoldSaved: 'Voice shortcut updated',
  wheelUpKey: 'Scroll ↑',
  wheelDownKey: 'Scroll ↓',
  clickKey: 'Click',
  ops: {
    doubleClick: { action: 'Double-click canvas', desc: 'Open add-module menu' },
    leftDrag: { action: 'Left-drag', desc: 'Move nodes' },
    rightClick: { action: 'Right-click canvas', desc: 'Open context menu' },
    boxSelect: { action: 'Left-drag box', desc: 'Box-select modules' },
  },
};

export function canvasShortcutsT(locale: AppLocale): CanvasShortcutsStrings {
  return locale === 'en' ? en : zh;
}

/** 修饰键展示：统一使用 Win 风格 Ctrl（帮助面板不展示 Mac ⌘） */
export function canvasShortcutModLabel(): string {
  return 'Ctrl';
}
