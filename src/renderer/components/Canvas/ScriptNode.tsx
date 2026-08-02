import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ScrollText } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useCanvasTheme } from '../../contexts/CanvasThemeContext';
import { directorPipelineT } from '../../i18n/directorPipelineI18n';
import { scaleModulePx } from '../../utils/moduleDisplayScale';

export interface ScriptNodeData {
  text?: string;
  title?: string;
  width?: number;
  height?: number;
  onUpdate?: (d: Partial<ScriptNodeData>) => void;
  [key: string]: unknown;
}

const ScriptNode: React.FC<NodeProps<ScriptNodeData>> = ({ id, data, selected }) => {
  const { locale } = useAppLocale();
  const { isDarkMode } = useCanvasTheme();
  const tt = directorPipelineT(locale);
  const text = String(data?.text ?? '');

  const onChange = useCallback(
    (value: string) => {
      data?.onUpdate?.({ text: value, title: tt.scriptTitle });
    },
    [data, tt.scriptTitle],
  );

  return (
    <div
      className={`custom-node-container nexflow-script-node relative rounded-xl overflow-visible flex flex-col ${
        isDarkMode ? 'nexflow-glass-panel' : 'apple-panel-light'
      } ${
        selected
          ? isDarkMode
            ? 'ring-2 ring-green-400/80'
            : 'ring-2 ring-green-500'
          : ''
      }`}
      style={{ width: data?.width || scaleModulePx(360), minHeight: data?.height || scaleModulePx(280) }}
      data-node-id={id}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ top: '50%', left: 0 }}
        className="nexflow-plus-handle nexflow-plus-handle-left"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{ top: '50%', right: 0 }}
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />

      <div
        className={`flex items-center gap-2 px-3 py-2 ${
          isDarkMode ? 'border-b border-white/10' : 'border-b border-gray-200'
        }`}
      >
        <ScrollText className={`w-4 h-4 shrink-0 ${isDarkMode ? 'text-sky-400' : 'text-blue-600'}`} />
        <span
          className={`text-sm font-semibold truncate ${
            isDarkMode ? 'text-white/90' : 'text-gray-900'
          }`}
        >
          {tt.scriptTitle}
        </span>
      </div>

      <div className="p-2 flex-1">
        <textarea
          className={`nodrag nopan nowheel w-full min-h-[220px] resize-y rounded-lg px-3 py-2 text-sm outline-none ${
            isDarkMode
              ? 'border border-white/10 bg-black/25 text-white/90 placeholder:text-white/35 focus:border-sky-500/60'
              : 'border border-gray-200 bg-white/80 text-gray-900 placeholder:text-gray-400 focus:border-blue-400'
          }`}
          placeholder={tt.scriptPlaceholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
};

export default memo(ScriptNode);
