/** 画布底部弹出操作框（Video/Image/LLM/Audio/Character/3D 等 InputPanel 共用） */
export const CANVAS_BOTTOM_INPUT_PANEL_LAYOUT =
  'rounded-2xl border-2 transform transition-all duration-300 ease-out h-full flex flex-col overflow-hidden';

export function canvasBottomInputPanelShell(
  isDarkMode: boolean,
  opts?: { pad?: string; extra?: string },
): string {
  const pad = opts?.pad ?? 'p-3';
  const extra = opts?.extra ?? '';
  const shell = isDarkMode
    ? `relative nexflow-glass-panel border-sky-400/45 ${CANVAS_BOTTOM_INPUT_PANEL_LAYOUT} ${pad}`
    : `relative nexflow-bottom-input-panel-light border-sky-400/75 ${CANVAS_BOTTOM_INPUT_PANEL_LAYOUT} ${pad}`;
  return extra ? `${shell} ${extra}`.trim() : shell;
}
