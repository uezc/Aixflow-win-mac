import React from 'react';
import { ChevronLeft, LayoutGrid } from 'lucide-react';

export interface ImagePreviewWithToolsProps {
  imageUrl: string;
  nodeId?: string;
  localPath?: string;
  isDarkMode?: boolean;
  onApply?: (nodeId: string, dataUrl: string) => void;
  onClose: () => void;
  /** 多图模块全屏预览：将当前图导入为原模块旁的新图片节点 */
  onImportToCanvas?: () => void;
  importToCanvasLabel?: string;
}

export const ImagePreviewWithTools: React.FC<ImagePreviewWithToolsProps> = ({
  imageUrl,
  onClose,
  onImportToCanvas,
  importToCanvasLabel = '导入到画布',
}) => {
  return (
    <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center">
      <div className="relative flex-1 flex items-center justify-center w-full max-w-[95vw] max-h-[85vh] p-4">
        <img
          src={imageUrl}
          alt="预览"
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl select-none"
          draggable={false}
        />
      </div>

      <div className="flex items-center gap-3 pb-6">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-white hover:bg-white/90 text-black transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          返回
        </button>
        {onImportToCanvas ? (
          <button
            type="button"
            onClick={onImportToCanvas}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            <LayoutGrid className="w-4 h-4" />
            {importToCanvasLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
};
