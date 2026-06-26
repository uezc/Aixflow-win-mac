import type { AppLocale } from './settingsI18n';

export type FlowEmptyCanvasStrings = {
  doubleClickScreen: string;
  fitViewTitle: string;
  /** 底部工具栏：屏幕截图入口 */
  screenshotToCanvas: string;
  screenshotTooltip: string;
  minimapAria: string;
  minimapTitle: string;
};

const zh: FlowEmptyCanvasStrings = {
  doubleClickScreen: '双击屏幕',
  fitViewTitle: '一键归位（居中所有模块）',
  screenshotToCanvas: '屏幕截图',
  screenshotTooltip: '区域截图（Alt+1 / Alt+Shift+S / Ctrl+Shift+Y）：框选后确认条紧贴选区下方，可双击选区内确认；右键或 Esc 取消',
  minimapAria: '小地图导航',
  minimapTitle: '小地图导航',
};

const en: FlowEmptyCanvasStrings = {
  doubleClickScreen: 'Double-click canvas',
  fitViewTitle: 'Fit all nodes in view',
  screenshotToCanvas: 'Screenshot',
  screenshotTooltip: 'Region capture (Alt+1 / Alt+Shift+S / Ctrl+Shift+Y): toolbar under selection, double-click inside to confirm; right-click or Esc to cancel',
  minimapAria: 'Minimap',
  minimapTitle: 'Minimap navigation',
};

export function flowEmptyCanvasT(locale: AppLocale): FlowEmptyCanvasStrings {
  return locale === 'en' ? en : zh;
}
