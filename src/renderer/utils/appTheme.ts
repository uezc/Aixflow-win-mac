/** 全局明暗模式：Workspace 与 Projects 等页面共用 */
export const NEXFLOW_DARK_MODE_KEY = 'nexflow_is_dark_mode';
export const NEXFLOW_THEME_CHANGE_EVENT = 'nexflow-theme-change';

/** 将明暗模式同步到 document（项目列表 / 画布根节点 class 之外的全局兜底） */
export function applyThemeToDocument(isDarkMode: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const body = document.body;
  root.classList.toggle('light-mode', !isDarkMode);
  root.classList.toggle('dark-mode', isDarkMode);
  body.classList.toggle('light-mode', !isDarkMode);
  body.classList.toggle('dark-mode', isDarkMode);
}

/** 应用启动时调用：未设置过偏好则默认暗黑并写入 localStorage */
export function initAppTheme(): boolean {
  if (typeof localStorage === 'undefined') {
    applyThemeToDocument(true);
    return true;
  }
  const existing = localStorage.getItem(NEXFLOW_DARK_MODE_KEY);
  if (existing == null || existing === '') {
    localStorage.setItem(NEXFLOW_DARK_MODE_KEY, '1');
  }
  const isDark = readIsDarkMode();
  applyThemeToDocument(isDark);
  return isDark;
}

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
  applyThemeToDocument(isDarkMode);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NEXFLOW_THEME_CHANGE_EVENT, { detail: { isDarkMode } }));
  }
}
