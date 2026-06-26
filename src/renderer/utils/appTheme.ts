/** 全局明暗模式：Workspace 与 Projects 等页面共用 */
export const NEXFLOW_DARK_MODE_KEY = 'nexflow_is_dark_mode';
export const NEXFLOW_THEME_CHANGE_EVENT = 'nexflow-theme-change';

export function readIsDarkMode(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const v = localStorage.getItem(NEXFLOW_DARK_MODE_KEY);
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  return true;
}

export function writeIsDarkMode(isDarkMode: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(NEXFLOW_DARK_MODE_KEY, isDarkMode ? '1' : '0');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NEXFLOW_THEME_CHANGE_EVENT, { detail: { isDarkMode } }));
  }
}
