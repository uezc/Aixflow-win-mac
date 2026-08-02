import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Box,
  Circle,
  Cylinder,
  Cone,
  UserRound,
  Table,
  Armchair,
  Trash2,
  Maximize2,
  Minimize2,
  ImageDown,
} from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { spatialComposition3DT } from '../../i18n/spatialComposition3DI18n';
import {
  SpatialCompositionSceneCanvas,
  type SceneItem,
  type SceneObjectKind,
} from './SpatialCompositionSceneCore';

export type { SceneItem, SceneObjectKind } from './SpatialCompositionSceneCore';

type PaletteLabelKey = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'humanoid' | 'table' | 'chair';

export interface SpatialComposition3DPanelProps {
  isDarkMode?: boolean;
  onOutput: (dataUrl: string) => void;
  /** 外层弹窗是否全屏（由宿主如 Workspace 控制） */
  hostFullscreen?: boolean;
  onHostFullscreenChange?: (full: boolean) => void;
}

const PALETTE: { kind: SceneObjectKind; Icon: React.ComponentType<{ className?: string }>; labelKey: PaletteLabelKey }[] = [
  { kind: 'cube', Icon: Box, labelKey: 'cube' },
  { kind: 'sphere', Icon: Circle, labelKey: 'sphere' },
  { kind: 'cylinder', Icon: Cylinder, labelKey: 'cylinder' },
  { kind: 'cone', Icon: Cone, labelKey: 'cone' },
  { kind: 'humanoid', Icon: UserRound, labelKey: 'humanoid' },
  { kind: 'table', Icon: Table, labelKey: 'table' },
  { kind: 'chair', Icon: Armchair, labelKey: 'chair' },
];

const SpatialComposition3DPanel: React.FC<SpatialComposition3DPanelProps> = ({
  isDarkMode,
  onOutput,
  hostFullscreen = false,
  onHostFullscreenChange,
}) => {
  const { locale } = useAppLocale();
  const tt = useMemo(() => spatialComposition3DT(locale), [locale]);
  const [items, setItems] = useState<SceneItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<SceneObjectKind | null>(null);
  const [depthPreview, setDepthPreview] = useState(false);
  const [viewportExpanded, setViewportExpanded] = useState(false);
  const saveRef = useRef<(() => string | null) | null>(null);
  const handleOutput = useCallback(() => {
    const fn = saveRef.current;
    if (!fn) return;
    const dataUrl = fn();
    if (dataUrl) onOutput(dataUrl);
  }, [onOutput]);

  const clearScene = () => {
    setItems([]);
    setSelectedId(null);
    setPendingKind(null);
  };

  const dark = isDarkMode ?? true;
  const panelBg = dark ? 'nexflow-glass-panel' : 'bg-slate-100';
  const textMuted = dark ? 'text-zinc-400' : 'text-slate-600';
  const btnBase = dark ? 'border-zinc-600 bg-zinc-800 hover:bg-zinc-700' : 'border-slate-200 bg-white hover:bg-slate-50';

  const viewportHeightClass = hostFullscreen
    ? 'h-full min-h-0 flex-1'
    : viewportExpanded
      ? 'h-[min(72vh,640px)]'
      : 'h-[min(42vh,380px)]';

  return (
    <div
      className={`flex flex-col overflow-hidden min-h-0 flex-1 ${hostFullscreen ? `h-full rounded-none border-0 ${dark ? 'bg-zinc-900' : 'bg-slate-50'}` : `rounded-xl border ${dark ? 'border-zinc-700' : 'border-slate-200'} ${panelBg}`}`}
    >
      <div className={`relative min-h-[220px] ${hostFullscreen ? 'flex-1 min-h-0' : 'flex-shrink-0'} ${viewportHeightClass}`}>
        {!onHostFullscreenChange && (
          <button
            type="button"
            className={`absolute top-2 right-2 z-10 rounded-lg border p-1.5 ${dark ? 'border-zinc-600 bg-zinc-800/90' : 'border-slate-200 bg-white'} ${textMuted}`}
            title={tt.expandViewport}
            onClick={() => setViewportExpanded((v) => !v)}
          >
            {viewportExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}
        <div className={`absolute bottom-2 left-2 z-10 text-[11px] ${textMuted}`}>{tt.objectsCount(items.length)}</div>
        <SpatialCompositionSceneCanvas
          className="h-full w-full"
          items={items}
          onItemsChange={setItems}
          depthPreview={depthPreview}
          saveRef={saveRef}
          pendingKind={pendingKind}
          setPendingKind={setPendingKind}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
        />
      </div>

      <div className={`p-3 grid grid-cols-4 gap-2 flex-shrink-0 ${dark ? 'bg-zinc-900/80' : 'bg-slate-50'}`}>
        {PALETTE.map(({ kind, Icon, labelKey }) => {
          const active = pendingKind === kind;
          return (
            <button
              key={kind}
              type="button"
              title={tt[labelKey]}
              onClick={() => setPendingKind((k) => (k === kind ? null : kind))}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-[11px] transition-colors ${
                active ? 'border-sky-500 bg-sky-500/15 text-sky-200' : `${btnBase} ${textMuted}`
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{tt[labelKey]}</span>
            </button>
          );
        })}
        <button
          type="button"
          title={tt.clear}
          onClick={clearScene}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-[11px] transition-colors border-red-900/50 bg-red-950/30 text-red-200 hover:bg-red-950/50`}
        >
          <Trash2 className="w-5 h-5" />
          <span>{tt.clear}</span>
        </button>
      </div>

      <div className={`flex gap-2 px-3 pb-2 flex-shrink-0`}>
        <button
          type="button"
          onClick={() => setDepthPreview(false)}
          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
            !depthPreview ? (dark ? 'bg-zinc-700 text-white border-zinc-500' : 'bg-slate-800 text-white border-slate-700') : `${btnBase} ${textMuted}`
          }`}
        >
          {tt.materialShading}
        </button>
        <button
          type="button"
          onClick={() => setDepthPreview(true)}
          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
            depthPreview ? (dark ? 'bg-zinc-700 text-white border-zinc-500' : 'bg-slate-800 text-white border-slate-700') : `${btnBase} ${textMuted}`
          }`}
        >
          {tt.zDepthChannel}
        </button>
      </div>

      <div className="px-3 pb-3 flex-shrink-0">
        <button
          type="button"
          onClick={handleOutput}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold shadow ${
            dark ? 'bg-zinc-100 text-zinc-900 hover:bg-white' : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          <ImageDown className="w-4 h-4" />
          {tt.outputToNode}
        </button>
        <p className={`mt-2 text-center text-[10px] leading-relaxed ${textMuted}`}>{tt.controlsHint}</p>
        {pendingKind && <p className={`mt-1 text-center text-[10px] ${dark ? 'text-sky-300' : 'text-sky-700'}`}>{tt.placeHint}</p>}
      </div>
    </div>
  );
};

export default SpatialComposition3DPanel;
