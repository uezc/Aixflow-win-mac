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
  copyNodes: CanvasShortcutEntryStrings;
  regionScreenshot: CanvasShortcutEntryStrings;
  pasteNodes: CanvasShortcutEntryStrings;
  undo: CanvasShortcutEntryStrings;
  deleteNodes: CanvasShortcutEntryStrings;
  multiSelect: CanvasShortcutEntryStrings;
  quickConnect: CanvasShortcutEntryStrings;
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
  panelTitle: '快捷键查询',
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
  restoreDefaultsDone: '已恢复为默认快捷键列表',
  openPanelTitle: '快捷键查询',
  zoomIn: { label: '放大' },
  zoomOut: { label: '缩小' },
  fitView: { label: '聚焦节点 / 适应画布', hint: '工具栏' },
  minimap: { label: '小地图', hint: '左下角' },
  panCanvas: { label: '拖动画布', hint: '中键拖动 / Space+拖动' },
  saveCanvas: { label: '保存画布', hint: '自动保存' },
  openSettings: { label: '打开设置', hint: '顶部工具栏' },
  copyNodes: { label: '复制节点' },
  regionScreenshot: { label: '区域截图' },
  pasteNodes: { label: '粘贴节点' },
  undo: { label: '撤销' },
  deleteNodes: { label: '删除节点' },
  multiSelect: { label: '多选节点（配合点击）' },
  quickConnect: { label: '快速连线（点击目标）' },
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
  panelTitle: 'Keyboard shortcuts',
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
  restoreDefaultsDone: 'Restored default shortcut list',
  openPanelTitle: 'Keyboard shortcuts',
  zoomIn: { label: 'Zoom in' },
  zoomOut: { label: 'Zoom out' },
  fitView: { label: 'Focus nodes / fit view', hint: 'Toolbar' },
  minimap: { label: 'Minimap', hint: 'Bottom left' },
  panCanvas: { label: 'Pan canvas', hint: 'Middle-drag / Space+drag' },
  saveCanvas: { label: 'Save canvas', hint: 'Auto-save' },
  openSettings: { label: 'Open settings', hint: 'Top toolbar' },
  copyNodes: { label: 'Copy nodes' },
  regionScreenshot: { label: 'Region capture' },
  pasteNodes: { label: 'Paste nodes' },
  undo: { label: 'Undo' },
  deleteNodes: { label: 'Delete nodes' },
  multiSelect: { label: 'Multi-select (with click)' },
  quickConnect: { label: 'Quick connect (click target)' },
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
