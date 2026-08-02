import React from 'react';
import { Film, Loader2 } from 'lucide-react';
import type { Node } from 'reactflow';
import { useAppLocale } from '../../contexts/AppLocaleContext';

type Props = {
  selectedNodes: Node[];
  position: { x: number; y: number };
  isDarkMode: boolean;
  busy?: boolean;
  onJoin: () => void;
};

/**
 * 框选 ≥2 个视频模块时，在选区上方显示「视频连接」按钮（替代各节点浮动菜单）。
 */
const VideoJoinButton: React.FC<Props> = ({ selectedNodes, position, isDarkMode, busy, onJoin }) => {
  const { locale } = useAppLocale();
  const count = selectedNodes.length;

  return (
    <div
      className="flex flex-col items-center gap-1.5"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%)',
        position: 'absolute',
        pointerEvents: 'auto',
        zIndex: 1000,
        isolation: 'isolate',
      }}
    >
      <button
        type="button"
        disabled={!!busy || count < 2}
        onClick={(e) => {
          e.stopPropagation();
          if (busy || count < 2) return;
          onJoin();
        }}
        className={`
          flex items-center gap-2 rounded-full px-4 py-2 shadow-lg transition-all
          animate-in fade-in zoom-in
          disabled:cursor-not-allowed disabled:opacity-60
          ${
            isDarkMode
              ? 'bg-sky-600 text-white hover:bg-sky-500'
              : 'bg-sky-600 text-white hover:bg-sky-500'
          }
        `}
        title={
          locale === 'en'
            ? 'Join selected videos left→right, top→bottom into a new module'
            : '按从左到右、从上到下顺序拼接选中视频，生成右侧新模块'
        }
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
        <span className="text-sm font-medium">
          {busy
            ? locale === 'en'
              ? 'Joining…'
              : '拼接中…'
            : locale === 'en'
              ? `Join ${count} videos`
              : `连接${count}个视频`}
        </span>
      </button>
    </div>
  );
};

export default VideoJoinButton;
