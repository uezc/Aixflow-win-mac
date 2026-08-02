import React, { memo, useCallback, useMemo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { useFrozenFlowZoom } from '../../hooks/useFrozenFlowViewport';
import {
  Clapperboard,
  Download,
  ImagePlus,
  LayoutGrid,
  List,
  Loader2,
} from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { storyboardScriptT } from '../../i18n/storyboardScriptI18n';
import { useStoryboardScriptInputPanelAnchor } from '../../contexts/StoryboardScriptInputPanelContext';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
import {
  createDefaultStoryboardScriptState,
  getStoryboardScriptDisplayColumns,
  serializeStoryboardScriptRowsToCsv,
  setStoryboardScriptSelectedRows,
  updateStoryboardScriptCell,
  type MediaMode,
  type StoryboardScriptColumnKey,
  type StoryboardScriptState,
} from '../../../shared/storyboardScript';

export interface StoryboardScriptNodeData {
  storyboardScript?: StoryboardScriptState;
  userPrompt?: string;
  chatModel?: string;
  isGenerating?: boolean;
  error?: string;
  title?: string;
  onUpdate?: (d: Partial<StoryboardScriptNodeData>) => void;
  onExportCsv?: () => void;
  onExportJson?: () => void;
  onSpawnSelectedImages?: () => void;
  [key: string]: unknown;
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const StoryboardScriptNode: React.FC<NodeProps<StoryboardScriptNodeData>> = ({
  id,
  data,
  selected,
}) => {
  const { locale } = useAppLocale();
  const tt = useMemo(() => storyboardScriptT(locale), [locale]);
  const zoom = useFrozenFlowZoom(1);
  const zoomInv = 1 / (zoom || 1);
  const panelAnchor = useStoryboardScriptInputPanelAnchor();
  const showPromptPanel = !!(panelAnchor && panelAnchor.nodeId === id && selected);

  const script = useMemo(
    () => createDefaultStoryboardScriptState(data?.storyboardScript || {}),
    [data?.storyboardScript],
  );
  const rows = script.rows || [];
  const mediaMode: MediaMode = script.mediaMode === 'video' ? 'video' : 'image';
  const viewMode = script.viewMode === 'card' ? 'card' : 'list';
  const columns = useMemo(
    () => getStoryboardScriptDisplayColumns(mediaMode, rows),
    [mediaMode, rows],
  );
  const isGenerating = !!data?.isGenerating;
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null);

  const patchScript = useCallback(
    (next: StoryboardScriptState) => {
      data?.onUpdate?.({ storyboardScript: next, title: next.title });
    },
    [data],
  );

  const setMediaMode = (mode: MediaMode) => {
    patchScript({ ...script, mediaMode: mode });
  };

  const setViewMode = (mode: 'list' | 'card') => {
    patchScript({ ...script, viewMode: mode });
  };

  const toggleRow = (index: number) => {
    const set = new Set(script.selectedRowIndexes);
    if (set.has(index)) set.delete(index);
    else set.add(index);
    patchScript(setStoryboardScriptSelectedRows(script, [...set]));
  };

  const onCellCommit = (rowIndex: number, key: StoryboardScriptColumnKey, value: string) => {
    patchScript(updateStoryboardScriptCell(script, rowIndex, key, value));
    setEditing(null);
  };

  const handleExportCsv = () => {
    if (data?.onExportCsv) {
      data.onExportCsv();
      return;
    }
    const csv = serializeStoryboardScriptRowsToCsv(rows, columns);
    downloadTextFile(`storyboard-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const handleExportJson = () => {
    if (data?.onExportJson) {
      data.onExportJson();
      return;
    }
    const json = script.canonicalJson || JSON.stringify({ rows }, null, 2);
    downloadTextFile(`storyboard-${Date.now()}.json`, json, 'application/json');
  };

  const btnSeg = (active: boolean) =>
    `px-2.5 py-1 text-[11px] rounded-md transition-colors ${
      active
        ? 'bg-zinc-100 text-zinc-900 font-medium'
        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
    }`;

  return (
    <div
      className={`custom-node-container nexflow-storyboard-script-node relative rounded-xl overflow-visible border ${
        selected ? 'border-amber-500/70' : 'border-zinc-700'
      } bg-zinc-900/95 shadow-xl`}
      style={{ minWidth: scaleModulePx(640), minHeight: scaleModulePx(360) }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-zinc-900"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-zinc-900"
      />

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <Clapperboard className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-semibold text-zinc-100 truncate">
            {data?.title || script.title || tt.moduleTitle}
          </span>
          <span className="text-[10px] text-zinc-500 shrink-0">{tt.objectsCount(rows.length)}</span>
          {isGenerating && <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex rounded-lg border border-zinc-700 bg-zinc-950/80 p-0.5">
            <button type="button" className={btnSeg(mediaMode === 'image')} onClick={() => setMediaMode('image')}>
              {tt.mediaModeImage}
            </button>
            <button type="button" className={btnSeg(mediaMode === 'video')} onClick={() => setMediaMode('video')}>
              {tt.mediaModeVideo}
            </button>
          </div>
          <div className="flex rounded-lg border border-zinc-700 bg-zinc-950/80 p-0.5">
            <button
              type="button"
              className={btnSeg(viewMode === 'list')}
              onClick={() => setViewMode('list')}
              title={tt.viewList}
            >
              <List className="w-3.5 h-3.5 inline" />
            </button>
            <button
              type="button"
              className={btnSeg(viewMode === 'card')}
              onClick={() => setViewMode('card')}
              title={tt.viewCard}
            >
              <LayoutGrid className="w-3.5 h-3.5 inline" />
            </button>
          </div>
          <button
            type="button"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            title={tt.exportCsv}
            onClick={handleExportCsv}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            title={tt.spawnImages}
            onClick={() => data?.onSpawnSelectedImages?.()}
          >
            <ImagePlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3 h-[min(52vh,420px)] overflow-auto nodrag nowheel">
        {rows.length === 0 ? (
          <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center px-6">
            <p className="text-sm text-zinc-300 font-medium">{tt.emptyTitle}</p>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">{tt.emptyHint}</p>
            {data?.error ? <p className="mt-3 text-xs text-red-400">{String(data.error)}</p> : null}
          </div>
        ) : viewMode === 'list' ? (
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-800">
                <th className="p-1.5 w-8 text-left">#</th>
                {columns.map((col) => (
                  <th key={col} className="p-1.5 text-left whitespace-nowrap font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const checked = script.selectedRowIndexes.includes(ri);
                return (
                  <tr
                    key={ri}
                    className={`border-b border-zinc-800/80 ${checked ? 'bg-amber-500/10' : 'hover:bg-zinc-800/40'}`}
                  >
                    <td className="p-1.5 align-top">
                      <input
                        type="checkbox"
                        className="nodrag"
                        checked={checked}
                        onChange={() => toggleRow(ri)}
                      />
                    </td>
                    {columns.map((col) => {
                      const isEdit = editing?.row === ri && editing?.col === col;
                      const val = row[col] ?? '';
                      return (
                        <td
                          key={col}
                          className="p-1.5 align-top max-w-[180px]"
                          onDoubleClick={() => setEditing({ row: ri, col })}
                        >
                          {isEdit ? (
                            <textarea
                              className="nodrag nopan w-full min-h-[48px] rounded bg-zinc-950 border border-zinc-600 text-zinc-100 p-1 text-[11px]"
                              defaultValue={val}
                              autoFocus
                              onBlur={(e) => onCellCommit(ri, col, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditing(null);
                              }}
                            />
                          ) : (
                            <div className="text-zinc-200 whitespace-pre-wrap break-words line-clamp-4">
                              {val || '—'}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {rows.map((row, ri) => {
              const checked = script.selectedRowIndexes.includes(ri);
              const promptKey: StoryboardScriptColumnKey =
                mediaMode === 'video' ? '视频提示词' : '图片提示词';
              return (
                <div
                  key={ri}
                  className={`rounded-lg border p-2.5 ${
                    checked ? 'border-amber-500/60 bg-amber-500/10' : 'border-zinc-700 bg-zinc-950/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        className="nodrag"
                        checked={checked}
                        onChange={() => toggleRow(ri)}
                      />
                      {tt.moduleTitle} #{row['镜号'] || ri + 1}
                    </label>
                    <span className="text-[10px] text-zinc-500">{row['时长']}</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 line-clamp-2 mb-1">
                    {row['画面描述'] || row['场景'] || '—'}
                  </p>
                  <p className="text-[11px] text-zinc-200 whitespace-pre-wrap line-clamp-5">
                    {row[promptKey] || '—'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showPromptPanel && panelAnchor && (
        <div
          className="nodrag nopan absolute z-[60] pointer-events-auto"
          style={{
            top: 'calc(100% + 14px)',
            left: '50%',
            width: panelAnchor.width,
            height: panelAnchor.height === 'auto' ? 'auto' : panelAnchor.height,
            transform: `translateX(-50%) scale(${zoomInv})`,
            transformOrigin: 'top center',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {panelAnchor.panel}
        </div>
      )}
    </div>
  );
};

export default memo(StoryboardScriptNode);
