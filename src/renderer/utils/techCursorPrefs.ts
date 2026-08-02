/** 画布科技光标形状偏好（localStorage + 跨组件事件） */

export type TechCursorShape = 'off' | 'delta';

export const TECH_CURSOR_SHAPE_KEY = 'nexflow_tech_cursor_shape';
export const TECH_CURSOR_SHAPE_EVENT = 'nexflow-tech-cursor-shape';

const VALID: TechCursorShape[] = ['off', 'delta'];

export function getTechCursorShape(): TechCursorShape {
  try {
    const v = localStorage.getItem(TECH_CURSOR_SHAPE_KEY);
    // 旧版「光棒」迁移为科技箭头
    if (v === 'beam') return 'delta';
    if (v && (VALID as string[]).includes(v)) return v as TechCursorShape;
  } catch {
    /* ignore */
  }
  return 'off';
}

export function setTechCursorShape(shape: TechCursorShape): void {
  try {
    localStorage.setItem(TECH_CURSOR_SHAPE_KEY, shape);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(TECH_CURSOR_SHAPE_EVENT, { detail: shape }));
  } catch {
    /* ignore */
  }
}

export function subscribeTechCursorShape(cb: (shape: TechCursorShape) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === TECH_CURSOR_SHAPE_KEY) cb(getTechCursorShape());
  };
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail === 'beam') {
      cb('delta');
      return;
    }
    if (typeof detail === 'string' && (VALID as string[]).includes(detail)) {
      cb(detail as TechCursorShape);
      return;
    }
    cb(getTechCursorShape());
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(TECH_CURSOR_SHAPE_EVENT, onCustom);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(TECH_CURSOR_SHAPE_EVENT, onCustom);
  };
}
