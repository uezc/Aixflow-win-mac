import React from 'react';

export interface GlbViewerPlaceholderProps {
  className?: string;
  message?: string;
  subMessage?: string;
}

/** 无 WebGL 时的静态透视网格占位（不占用 GPU 上下文） */
const GlbViewerPlaceholder: React.FC<GlbViewerPlaceholderProps> = ({
  className = '',
  message,
  subMessage,
}) => (
  <div
    className={`relative overflow-hidden bg-[#1a1a1e] flex flex-col items-center justify-center ${className}`}
  >
    <div
      className="absolute inset-0 opacity-40"
      style={{
        backgroundImage: `
          linear-gradient(rgba(113,113,122,0.35) 1px, transparent 1px),
          linear-gradient(90deg, rgba(113,113,122,0.35) 1px, transparent 1px)
        `,
        backgroundSize: '28px 28px',
        transform: 'perspective(420px) rotateX(58deg) scale(1.4)',
        transformOrigin: 'center 80%',
      }}
    />
    <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a1e] via-transparent to-[#1a1a1e]/60 pointer-events-none" />
    {message && (
      <p className="relative z-[1] text-xs text-center text-white/45 px-4 max-w-[90%]">{message}</p>
    )}
    {subMessage && (
      <p className="relative z-[1] text-[10px] text-center text-white/30 px-4 mt-1 max-w-[90%]">{subMessage}</p>
    )}
  </div>
);

export default GlbViewerPlaceholder;
