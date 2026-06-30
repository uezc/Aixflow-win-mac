import React from 'react';
import { Maximize2 } from 'lucide-react';
import { VideoPreview } from '../VideoPreview';
import { MusicPlayer } from './MusicPlayer';

/** 视频/音频懒挂载：仅进入视口时渲染，减轻任务列表过多时的内存与渲染压力 */
export const TaskMediaPreview: React.FC<{
  task: { taskType?: string; videoUrl?: string; audioUrl?: string; nodeId?: string };
  isDarkMode: boolean;
  onPreviewVideo: (url: string, nodeId?: string) => void;
  onPreviewAudio: (url: string) => void;
}> = ({ task, isDarkMode, onPreviewVideo, onPreviewAudio }) => {
  const [inView, setInView] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setInView(true);
      },
      { rootMargin: '100px', threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      {!inView ? (
        <div
          className={`w-full h-32 flex items-center justify-center text-xs ${
            isDarkMode ? 'text-white/30 bg-white/5' : 'text-gray-400 bg-gray-100'
          }`}
        >
          加载中...
        </div>
      ) : task.taskType === 'video' && task.videoUrl ? (
        <div className="relative w-full h-32">
          <VideoPreview
            src={task.videoUrl}
            className="w-full h-32 object-cover cursor-pointer"
            muted
            preload="metadata"
            playsInline
            onClick={() => onPreviewVideo(task.videoUrl!)}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPreviewVideo(task.videoUrl!, task.nodeId);
            }}
            className={`absolute top-2 right-2 z-10 pointer-events-auto nexflow-btn-secondary nexflow-btn-secondary-sm !p-1.5 ${
              isDarkMode ? '' : '!border-gray-300/80 !bg-white/95 !text-gray-700 hover:!bg-gray-50'
            }`}
            title="预览"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : task.taskType === 'audio' && task.audioUrl ? (
        (() => {
          let normalizedUrl = task.audioUrl;
          if (!normalizedUrl.startsWith('http') && !normalizedUrl.startsWith('data:') && !normalizedUrl.startsWith('local-resource://')) {
            const cleanPath = normalizedUrl.replace(/^(file:\/\/|local-resource:\/\/)/, '');
            normalizedUrl = `local-resource://${cleanPath.replace(/\\/g, '/')}`;
          }
          return (
            <MusicPlayer
              audioUrl={task.audioUrl}
              isDarkMode={isDarkMode}
              onPreview={() => onPreviewAudio(normalizedUrl)}
            />
          );
        })()
      ) : null}
    </div>
  );
};
