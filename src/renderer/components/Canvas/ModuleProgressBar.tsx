import React from 'react';

export interface ModuleProgressBarProps {
  /** 进度 0-100；达到 100 时渐隐并触发 onFadeComplete（循环动画模式下不驱动宽度） */
  progress: number;
  /** 是否显示遮罩；为 false 或 progress>=100 时渐隐消失 */
  visible: boolean;
  /** 可选：纯色背景（如 #1C1C1E），遮罩使用该色时完全遮挡底层内容，仅显示进度条与文案 */
  solidBackground?: string;
  /** 可选：进度状态文案（如「正在生成图片...」），显示在遮罩中央 */
  progressMessage?: string;
  /** 与模块外框一致的圆角（px），默认 16 对应 rounded-2xl */
  borderRadius?: number;
  /** 可选：完成或隐藏时的过渡时长（ms） */
  fadeDurationMs?: number;
  /** 可选：进度达到 100% 并渐隐结束后回调 */
  onFadeComplete?: () => void;
  /**
   * sweep：从左向右 scaleX（画布模块默认）
   * cover：绿色铺满容器 + 扫光动画（竖屏预览等需整区遮罩时用）
   */
  fillMode?: 'sweep' | 'cover';
}

/**
 * 全模块覆盖进度条：纯 CSS 永动机式循环动画（0%→100% 匀速，瞬间重置）。
 * 仅当 generating 时挂载/显示；遮罩半透明，不依赖 JS 实时更新 width。
 */
export const ModuleProgressBar: React.FC<ModuleProgressBarProps> = ({
  progress,
  visible,
  solidBackground,
  progressMessage,
  borderRadius = 16,
  fadeDurationMs = 300,
  onFadeComplete,
  fillMode = 'sweep',
}) => {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const isComplete = clampedProgress >= 100;
  const show = visible && !isComplete;
  const opacity = show ? 1 : 0;

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    if (e.propertyName === 'opacity' && !show && onFadeComplete) {
      onFadeComplete();
    }
  };

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none nexflow-module-progress-bar"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        borderRadius: `${borderRadius}px`,
        overflow: 'hidden',
        opacity,
        transition: `opacity ${fadeDurationMs}ms ease-out`,
        zIndex: 50,
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      {/* 遮罩：有 solidBackground 时用纯色完全遮挡底层，否则用半透明 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: solidBackground ?? 'rgba(0,0,0,0.15)',
          borderRadius: `${borderRadius}px`,
        }}
      />
      {/* 进度条填充：sweep 从左向右；cover 始终铺满整区并轻脉冲 */}
      <div
        className={
          fillMode === 'cover' ? 'module-progress-fill-cover' : 'module-progress-fill-full'
        }
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
        }}
      />
      {/* 进度文案：居中显示，保留「之前的信息」可见性 */}
      {progressMessage && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: '13px',
              fontWeight: 500,
              color: 'rgba(255,255,255,0.95)',
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            }}
          >
            {progressMessage}
          </span>
        </div>
      )}
    </div>
  );
};
