import { useEffect, useState, RefObject } from 'react';

/**
 * 使用 IntersectionObserver 检测元素是否在视口内。
 * 当模块离开视口时，可用于强制销毁内部 video 实例并释放资源。
 * @param ref 目标 DOM 元素的 ref
 * @param rootMargin 视口外扩边距，格式同 IntersectionObserver.rootMargin（如 "200px"）
 * @param threshold 交叉比例阈值 0-1
 * @param initial 首帧是否视为可见；按需加载场景建议传 false
 */
export function useViewportIntersection(
  ref: RefObject<HTMLElement | null>,
  rootMargin = '100px',
  threshold = 0,
  initial = true,
): boolean {
  const [isIntersecting, setIsIntersecting] = useState(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsIntersecting(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      { root: null, rootMargin, threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, threshold]);

  return isIntersecting;
}
