import React from 'react';
import { normRectToCss, type ClipLayout, type NormRect } from '../../utils/clipLayout';
import { isDefaultClipCrop, normalizeClipCrop, type ClipCrop } from '../../utils/clipCrop';

type ClipMediaShellProps = {
  /** 裁切后占位，或裁剪编辑时的未裁源占位（可超出 0–1） */
  layout?: Partial<ClipLayout | NormRect> | null;
  crop?: Partial<ClipCrop> | null;
  /**
   * 无 crop 时媒体如何填入 layout。
   * contain：匹配导出 letterbox；fill：裁剪编辑源占位，与琥珀遮罩坐标系对齐。
   */
  uncroppedFit?: 'contain' | 'fill';
  /** 外层（overflow 容器）额外 class */
  className?: string;
  /** 传给媒体元素的额外 class */
  mediaClassName?: string;
  /** 叠在外层上的样式（opacity / zIndex / pointerEvents 等） */
  style?: React.CSSProperties;
  children: React.ReactElement;
};

/**
 * 预览媒体壳：layout = 裁切后画面在画布上的占位；crop = 源裁切。
 * 始终使用「外层裁切盒 + 内层定位盒」稳定 DOM，避免 crop/模式切换时
 * 在「媒体自身定位」与「overflow 包裹」间切换导致 video/img 不重绘。
 */
const ClipMediaShell: React.FC<ClipMediaShellProps> = ({
  layout,
  crop,
  uncroppedFit = 'contain',
  className = '',
  mediaClassName = '',
  style,
  children,
}) => {
  const layoutCss = normRectToCss(layout);
  const C = normalizeClipCrop(crop);
  const hasCrop = !isDefaultClipCrop(C);
  const vw = Math.max(0.05, 1 - C.left - C.right);
  const vh = Math.max(0.05, 1 - C.top - C.bottom);
  const child = children as React.ReactElement<Record<string, unknown>>;
  const prevClass = typeof child.props.className === 'string' ? child.props.className : '';
  const prevStyle =
    child.props.style && typeof child.props.style === 'object'
      ? (child.props.style as React.CSSProperties)
      : undefined;
  const fitClass = hasCrop || uncroppedFit === 'fill' ? 'object-fill' : 'object-contain';

  return (
    <div
      className={['absolute overflow-hidden', className].filter(Boolean).join(' ')}
      style={{ ...layoutCss, ...style }}
    >
      <div
        className="absolute max-w-none"
        style={{
          width: hasCrop ? `${(1 / vw) * 100}%` : '100%',
          height: hasCrop ? `${(1 / vh) * 100}%` : '100%',
          left: hasCrop ? `${(-C.left / vw) * 100}%` : 0,
          top: hasCrop ? `${(-C.top / vh) * 100}%` : 0,
          right: 'auto',
          bottom: 'auto',
        }}
      >
        {React.cloneElement(child, {
          className: [prevClass, 'absolute inset-0 h-full w-full', fitClass, mediaClassName]
            .filter(Boolean)
            .join(' '),
          // 不把 layout 写进媒体 style，避免覆盖 stacked 预览里命令式设置的 opacity/visibility
          ...(prevStyle ? { style: prevStyle } : {}),
        })}
      </div>
    </div>
  );
};

export default ClipMediaShell;
