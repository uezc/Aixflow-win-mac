import React from 'react';
import { Maximize2 } from 'lucide-react';
import { VideoPreview } from '../VideoPreview';
import { MusicPlayer } from './MusicPlayer';
import { normalizeVideoUrl } from '../../utils/normalizeVideoUrl';
import { mapProjectPath } from '../../utils/pathMapper';

/** 任务列表媒体 URL：裸路径 → local-resource，并补中文编码；可选项目路径映射 */
function useTaskMediaUrl(raw: string | undefined, projectId?: string): string {
  const initial = React.useMemo(() => normalizeVideoUrl(String(raw || '').trim()), [raw]);
  const [url, setUrl] = React.useState(initial);

  React.useEffect(() => {
    setUrl(initial);
    if (!initial || !projectId || !initial.startsWith('local-resource://')) return;
    let cancelled = false;
    mapProjectPath(initial, projectId)
      .then((mapped) => {
        if (!cancelled && mapped) setUrl(normalizeVideoUrl(mapped));
      })
      .catch(() => {
        /* keep initial */
      });
    return () => {
      cancelled = true;
    };
  }, [initial, projectId]);

  return url;
}

/** 视频/音频：有地址立刻挂载；本地文件经 normalize 后应秒出首帧，勿因 IO 一直转圈 */
export const TaskMediaPreview: React.FC<{
  task: { taskType?: string; videoUrl?: string; audioUrl?: string; localFilePath?: string; nodeId?: string };
  isDarkMode: boolean;
  projectId?: string;
  onPreviewVideo: (url: string, nodeId?: string) => void;
  onPreviewAudio: (url: string) => void;
}> = ({ task, isDarkMode, projectId, onPreviewVideo, onPreviewAudio }) => {
  const rawVideo =
    task.videoUrl ||
    (task.taskType === 'video' && task.localFilePath ? task.localFilePath : undefined);
  const rawAudio = task.audioUrl || (task.taskType === 'audio' ? task.localFilePath : undefined);
  const videoUrl = useTaskMediaUrl(rawVideo, projectId);
  const audioUrl = useTaskMediaUrl(rawAudio, projectId);

  if (task.taskType === 'video' && videoUrl) {
    return (
      <div className="relative w-full h-32 bg-black/30">
        <VideoPreview
          src={videoUrl}
          className="w-full h-32 object-cover cursor-pointer"
          muted
          preload="metadata"
          playsInline
          onClick={() => onPreviewVideo(videoUrl)}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPreviewVideo(videoUrl, task.nodeId);
          }}
          className={`absolute top-2 right-2 z-10 pointer-events-auto nexflow-btn-secondary nexflow-btn-secondary-sm !p-1.5 ${
            isDarkMode ? '' : '!border-gray-300/80 !bg-white/95 !text-gray-700 hover:!bg-gray-50'
          }`}
          title="预览"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (task.taskType === 'audio' && audioUrl) {
    return (
      <div className="pointer-events-auto relative w-full">
        <MusicPlayer
          audioUrl={audioUrl}
          isDarkMode={isDarkMode}
          showWaveform
          compactWaveform
          onPreview={() => onPreviewAudio(audioUrl)}
        />
      </div>
    );
  }

  return (
    <div
      className={`w-full h-32 flex items-center justify-center text-xs ${
        isDarkMode ? 'text-white/30 bg-white/5' : 'text-gray-400 bg-gray-100'
      }`}
    >
      无媒体
    </div>
  );
};
