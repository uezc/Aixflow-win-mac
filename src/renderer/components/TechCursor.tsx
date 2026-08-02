import { useEffect, useState } from 'react';
import {
  getTechCursorShape,
  subscribeTechCursorShape,
  type TechCursorShape,
} from '../utils/techCursorPrefs';

type Props = {
  /** 若传入则强制该形状；默认跟随设置（localStorage） */
  shape?: TechCursorShape;
  enabled?: boolean;
};

function canUseCustomCursor(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches) {
      return false;
    }
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * 科技鼠标：只切换系统光标资源（cursor:url），不渲染跟随图标。
 * 「系统默认」时不改任何 cursor 样式。
 */
const TechCursor: React.FC<Props> = ({ shape: shapeProp, enabled = true }) => {
  const [prefShape, setPrefShape] = useState<TechCursorShape>(() =>
    typeof window !== 'undefined' ? getTechCursorShape() : 'off',
  );
  const shape = shapeProp ?? prefShape;
  const [deviceOk, setDeviceOk] = useState(() => canUseCustomCursor());
  const active = enabled && deviceOk && shape !== 'off';

  useEffect(() => {
    if (shapeProp != null) return;
    setPrefShape(getTechCursorShape());
    return subscribeTechCursorShape(setPrefShape);
  }, [shapeProp]);

  useEffect(() => {
    setDeviceOk(canUseCustomCursor());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!active) {
      root.classList.remove('nexflow-tech-cursor-on');
      return;
    }
    root.classList.add('nexflow-tech-cursor-on');
    return () => {
      root.classList.remove('nexflow-tech-cursor-on');
    };
  }, [active]);

  return null;
};

export default TechCursor;
