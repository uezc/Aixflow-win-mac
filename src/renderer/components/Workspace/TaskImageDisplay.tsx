import React, { useMemo } from 'react';
import { Maximize2 } from 'lucide-react';
import {
  getFullOutputImagesGridLayout,
  getOutputImageGridLayout,
  gridClassForLayout,
} from '../../utils/multiImageGridPreview';

export interface TaskImageDisplayProps {
  task: {
    localFilePath?: string;
    imageUrl?: string;
    outputImages?: string[];
    nodeTitle?: string;
    nodeId?: string;
  };
  projectId?: string;
  formatImagePath: (path: string) => string;
  mapProjectPath: (url: string, projectId?: string) => Promise<string>;
  onPreview: (imageUrl: string, nodeId?: string) => void;
  isDarkMode: boolean;
}

/**
 * 任务列表图片显示组件（支持路径映射 + 懒加载）
 */
export const TaskImageDisplay: React.FC<TaskImageDisplayProps> = ({
  task,
  projectId,
  formatImagePath,
  mapProjectPath,
  onPreview,
  isDarkMode,
}) => {
  const [mappedImageUrl, setMappedImageUrl] = React.useState<string | null>(null);
  const [mappedImageUrls, setMappedImageUrls] = React.useState<string[]>([]);
  const [showAll, setShowAll] = React.useState(false);
  const [inView, setInView] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const thumbGridLayout = useMemo(
    () => getOutputImageGridLayout(mappedImageUrls.length),
    [mappedImageUrls.length],
  );
  const expandGridLayout = useMemo(
    () =>
      mappedImageUrls.length > 9
        ? getFullOutputImagesGridLayout(mappedImageUrls.length)
        : getOutputImageGridLayout(mappedImageUrls.length),
    [mappedImageUrls.length],
  );

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
      { rootMargin: '80px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (!inView) return;
    const srcsRaw = Array.isArray(task.outputImages) && task.outputImages.length > 0
      ? task.outputImages
      : task.localFilePath
        ? [task.localFilePath]
        : [task.imageUrl || ''];
    const srcs = srcsRaw.map((u) => formatImagePath(u || '')).filter(Boolean);
    if (srcs.length === 0) {
      setMappedImageUrl(null);
      setMappedImageUrls([]);
      return;
    }
    Promise.all(
      srcs.map(async (u) => {
        if (projectId && u.startsWith('local-resource://')) {
          try {
            const mapped = await mapProjectPath(u, projectId);
            return mapped || u;
          } catch {
            return u;
          }
        }
        return u;
      }),
    ).then((mappedAll) => {
      setMappedImageUrls(mappedAll);
      setMappedImageUrl(mappedAll[0] || null);
    });
  }, [inView, task.localFilePath, task.imageUrl, task.outputImages, projectId, formatImagePath, mapProjectPath]);

  if (!mappedImageUrl) {
    return (
      <div
        ref={containerRef}
        className={`w-full h-32 flex items-center justify-center text-xs ${
          isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
        }`}
      >
        {inView ? '加载中...' : ''}
      </div>
    );
  }

  const handlePreview = (imageOverride?: string) => {
    const imageToPreview =
      imageOverride ||
      (task.localFilePath ? formatImagePath(task.localFilePath) : formatImagePath(task.imageUrl || ''));
    const nodeId = task.nodeId;
    if (projectId && imageToPreview.startsWith('local-resource://')) {
      mapProjectPath(imageToPreview, projectId)
        .then((mapped) => onPreview(mapped, nodeId))
        .catch(() => onPreview(imageToPreview, nodeId));
    } else {
      onPreview(imageToPreview, nodeId);
    }
  };

  const thumbRemain = mappedImageUrls.length - thumbGridLayout.maxSlots;

  return (
    <div ref={containerRef} className="relative w-full h-32">
      {inView ? (
        mappedImageUrls.length > 1 ? (
          <div
            className={`w-full h-32 grid ${gridClassForLayout(thumbGridLayout.cols)} gap-1 p-1`}
            style={{ gridTemplateRows: `repeat(${thumbGridLayout.rows}, minmax(0, 1fr))` }}
          >
            {mappedImageUrls.slice(0, thumbGridLayout.maxSlots).map((img, idx) => {
              const isMoreTile = thumbGridLayout.maxSlots === 9 && idx === 8 && thumbRemain > 0;
              if (isMoreTile) {
                return (
                  <button
                    key={`${img}-${idx}-more`}
                    type="button"
                    className="w-full h-full min-h-0 rounded bg-black/60 text-white text-xs font-semibold"
                    onClick={() => setShowAll(true)}
                    title={`还有 ${thumbRemain} 张`}
                  >
                    +{thumbRemain}
                  </button>
                );
              }
              return (
                <button
                  key={`${img}-${idx}`}
                  type="button"
                  className="w-full h-full min-h-0 rounded overflow-hidden bg-black/20"
                  onClick={() => handlePreview(img)}
                >
                  <img
                    src={img}
                    alt={`${task.nodeTitle || ''}-${idx + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <img
            src={mappedImageUrl}
            alt={task.nodeTitle || ''}
            className="w-full h-32 object-cover cursor-pointer"
            loading="lazy"
            onClick={() => handlePreview()}
            onError={async (e) => {
              const img = e.target as HTMLImageElement;
              const localUrl = task.localFilePath ? formatImagePath(task.localFilePath) : null;
              if (localUrl && img.src !== localUrl) {
                if (projectId && localUrl.startsWith('local-resource://')) {
                  mapProjectPath(localUrl, projectId)
                    .then((mapped) => {
                      img.src = mapped;
                    })
                    .catch(() => {
                      img.src = localUrl;
                    });
                } else {
                  img.src = localUrl;
                }
              } else {
                img.src =
                  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ccc" width="100" height="100"/%3E%3Ctext x="50" y="50" text-anchor="middle" dy=".3em" fill="%23999"%3E图片加载失败%3C/text%3E%3C/svg%3E';
              }
            }}
          />
        )
      ) : (
        <div
          className={`w-full h-32 flex items-center justify-center text-xs ${
            isDarkMode ? 'text-white/30 bg-white/5' : 'text-gray-400 bg-gray-100'
          }`}
        >
          加载中...
        </div>
      )}
      {inView && (
        <button
          onClick={() => handlePreview()}
          className={`absolute top-2 right-2 p-1.5 rounded-lg ${
            isDarkMode ? 'bg-black/50 hover:bg-black/70 text-white' : 'bg-white/80 hover:bg-white text-gray-700'
          } transition-colors`}
          title="预览"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      )}
      {showAll && mappedImageUrls.length > 0 && (
        <div
          className="fixed inset-0 z-[1400] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowAll(false)}
        >
          <div
            className={`w-full max-w-5xl max-h-[80vh] flex flex-col overflow-hidden rounded-xl p-3 ${isDarkMode ? 'bg-zinc-900' : 'bg-white'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <span className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                共 {mappedImageUrls.length} 张
              </span>
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className={`px-2 py-1 text-xs rounded ${isDarkMode ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-800'}`}
              >
                关闭
              </button>
            </div>
            <div
              className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${isDarkMode ? 'custom-scrollbar-dark nexflow-output-images-modal-scroll' : 'custom-scrollbar'}`}
            >
              <div
                className={`grid w-full overflow-hidden ${gridClassForLayout(expandGridLayout.cols)} gap-2`}
                style={{ gridTemplateRows: `repeat(${expandGridLayout.rows}, minmax(0, 1fr))` }}
              >
                {mappedImageUrls.map((img, idx) => (
                  <button
                    key={`${img}-${idx}-all`}
                    type="button"
                    className="rounded-lg overflow-hidden bg-black/20 aspect-square min-h-[72px]"
                    onClick={() => handlePreview(img)}
                    title={`预览第 ${idx + 1} 张`}
                  >
                    <img
                      src={img}
                      alt={`${task.nodeTitle || ''}-${idx + 1}`}
                      className="w-full h-full object-cover select-none"
                      draggable={false}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
