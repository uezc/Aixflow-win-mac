import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, FolderOpen, Sun, Moon, Maximize2, Settings, GitBranch, Workflow, Undo2, Redo2, Coins, Globe, ChevronDown, Check, Archive, RotateCcw, MousePointer2, Minus, Bug } from 'lucide-react';
import { scratchTintClass, type ScratchColorId } from '../../theme/scratchColors';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { APP_LOCALE_OPTIONS, appLocaleNativeLabel, type AppLocale } from '../../i18n/settingsI18n';
import { workspaceChromeT, type WorkspaceChromeStrings } from '../../i18n/workspaceI18n';
import MediaOssRouteToggle from '../MediaOssRouteToggle';
import {
  getTechCursorShape,
  setTechCursorShape,
  subscribeTechCursorShape,
  type TechCursorShape,
} from '../../utils/techCursorPrefs';

function hdrTextBtn(isDarkMode: boolean, scratch: ScratchColorId, extra = '') {
  if (isDarkMode) {
    return `flex items-center gap-2 px-3 py-1.5 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all text-sm ${extra}`.trim();
  }
  return `flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-sm scratch-float-btn ${scratchTintClass(scratch)} ${extra}`.trim();
}

function hdrRoundBtn(isDarkMode: boolean, scratch: ScratchColorId) {
  if (isDarkMode) {
    return 'flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/[0.08] text-white/90 transition-colors hover:bg-white/[0.14] hover:text-white disabled:cursor-not-allowed disabled:opacity-35';
  }
  return `flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35 scratch-float-btn ${scratchTintClass(scratch)}`;
}

function hdrIconBtn(isDarkMode: boolean, scratch: ScratchColorId) {
  if (isDarkMode) {
    return 'flex items-center justify-center w-8 h-8 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors';
  }
  return `flex items-center justify-center w-8 h-8 rounded-lg transition-colors scratch-float-btn ${scratchTintClass(scratch)}`;
}

function settingsPopupClass(isDarkMode: boolean) {
  return isDarkMode
    ? 'absolute left-0 top-full mt-1 z-[100] min-w-[280px] rounded-xl border border-white/20 bg-gray-900/95 backdrop-blur-sm py-3 px-3 shadow-xl'
    : 'absolute left-0 top-full mt-1 z-[100] min-w-[280px] rounded-xl border border-gray-200/90 bg-white py-3 px-3 shadow-lg shadow-gray-300/25';
}

function settingsLabelClass(isDarkMode: boolean) {
  return isDarkMode ? 'text-xs text-white/80' : 'text-xs text-gray-700';
}

function settingsValueClass(isDarkMode: boolean) {
  return isDarkMode ? 'text-xs text-white/60' : 'text-xs text-gray-500';
}

function settingsColorInputClass(isDarkMode: boolean) {
  return isDarkMode
    ? 'w-8 h-8 rounded cursor-pointer border border-white/30 bg-transparent p-0'
    : 'w-8 h-8 rounded cursor-pointer border border-gray-300 bg-white p-0';
}

function settingsRangeClass(isDarkMode: boolean) {
  return isDarkMode
    ? 'flex-1 h-2 rounded-full appearance-none cursor-pointer accent-amber-500 bg-white/20'
    : 'flex-1 h-2 rounded-full appearance-none cursor-pointer accent-amber-500 bg-gray-200';
}

function settingsEdgeToggleClass(isDarkMode: boolean, active: boolean) {
  const base = 'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs transition-colors';
  if (isDarkMode) {
    return `${base} ${active ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/10'}`;
  }
  return `${base} ${active ? 'bg-gray-200 text-gray-900' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`;
}

/** 画布指针形状：系统 / 科技箭头 */
function CursorShapePicker({ wc, isDarkMode }: { wc: WorkspaceChromeStrings; isDarkMode: boolean }) {
  const [shape, setShape] = useState<TechCursorShape>(() => getTechCursorShape());
  useEffect(() => subscribeTechCursorShape(setShape), []);
  const options: Array<{ id: TechCursorShape; label: string; icon: React.ReactNode }> = [
    { id: 'off', label: wc.cursorShapeOff, icon: <Minus className="w-3.5 h-3.5" /> },
    { id: 'delta', label: wc.cursorShapeDelta, icon: <MousePointer2 className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <span className={settingsLabelClass(isDarkMode)}>{wc.cursorShapeLabel}</span>
      <div className="flex gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setTechCursorShape(opt.id)}
            className={settingsEdgeToggleClass(isDarkMode, shape === opt.id)}
            title={opt.label}
          >
            {opt.icon}
            <span className="truncate">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 暗黑模式设置：波点粗细 + 波点间距 + 连接线颜色 + 连接线样式 */
function DarkModeSettings({
  wc,
  isDarkMode,
  dotSize = 1.2,
  setDotSize,
  canvasDotGap = 60,
  setCanvasDotGap,
  edgeColor,
  setEdgeColor,
  edgePathStyle,
  setEdgePathStyle,
}: {
  wc: WorkspaceChromeStrings;
  isDarkMode: boolean;
  dotSize?: number;
  setDotSize?: (v: number) => void;
  canvasDotGap?: number;
  setCanvasDotGap?: (v: number) => void;
  edgeColor?: string;
  setEdgeColor?: (v: string) => void;
  edgePathStyle?: 'curve' | 'smoothStep';
  setEdgePathStyle?: (v: 'curve' | 'smoothStep') => void;
}) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as Node;
      if (popupRef.current?.contains(el) || buttonRef.current?.contains(el)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);
  const hasAny = !!setDotSize || !!setCanvasDotGap || !!setEdgePathStyle || !!setEdgeColor;
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => hasAny && setOpen((o) => !o)}
        disabled={!hasAny}
        className={`${hdrIconBtn(isDarkMode, 'variables')} disabled:opacity-50 disabled:cursor-not-allowed`}
        title={wc.darkModeSettingsTitle}
      >
        <Settings className="w-4 h-4" />
      </button>
      {open && hasAny && (
        <div
          ref={popupRef}
          className={settingsPopupClass(isDarkMode)}
          style={isDarkMode ? { boxShadow: '0 8px 32px rgba(0,0,0,0.4)' } : undefined}
        >
          <div className="flex flex-col gap-3">
            <CursorShapePicker wc={wc} isDarkMode={isDarkMode} />
            {setEdgeColor && (
              <div className="flex items-center justify-between gap-2">
                <span className={settingsLabelClass(isDarkMode)}>{wc.edgeColor}</span>
                <input
                  type="color"
                  value={edgeColor ?? '#9CA3AF'}
                  onChange={(e) => setEdgeColor(e.target.value)}
                  className={settingsColorInputClass(isDarkMode)}
                  title={wc.pickEdgeColor}
                  aria-label={wc.pickEdgeColor}
                />
              </div>
            )}
            {setEdgePathStyle && edgePathStyle != null && (
              <div className="flex flex-col gap-1.5">
                <span className={settingsLabelClass(isDarkMode)}>{wc.edgeStyleLabel}</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEdgePathStyle('curve')}
                    className={settingsEdgeToggleClass(isDarkMode, edgePathStyle === 'curve')}
                  >
                    <Workflow className="w-3.5 h-3.5" />
                    {wc.edgeCurve}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEdgePathStyle('smoothStep')}
                    className={settingsEdgeToggleClass(isDarkMode, edgePathStyle === 'smoothStep')}
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    {wc.edgeOrthogonal}
                  </button>
                </div>
              </div>
            )}
            {setDotSize && (
              <div className="flex flex-col gap-1.5">
                <span className={settingsLabelClass(isDarkMode)}>{wc.dotThickness}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.1}
                    value={dotSize}
                    onChange={(e) => setDotSize(parseFloat(e.target.value))}
                    className={settingsRangeClass(isDarkMode)}
                    title={wc.dotSizeRangeTitle}
                  />
                  <span className={`${settingsValueClass(isDarkMode)} w-8`}>{Math.round(dotSize * 100)}%</span>
                </div>
              </div>
            )}
            {setCanvasDotGap && (
              <div className="flex flex-col gap-1.5">
                <span className={settingsLabelClass(isDarkMode)}>{wc.dotGap}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={20}
                    max={180}
                    step={5}
                    value={canvasDotGap}
                    onChange={(e) => setCanvasDotGap(parseInt(e.target.value, 10))}
                    className={settingsRangeClass(isDarkMode)}
                    title={wc.dotGapRangeTitle}
                  />
                  <span className={`${settingsValueClass(isDarkMode)} w-10 tabular-nums`}>{canvasDotGap}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 顶栏界面语言：地球图标 + 下拉（新增语言时在 APP_LOCALE_OPTIONS 扩展） */
function LanguageMenu({
  locale,
  setLocale,
  wc,
  isDarkMode,
}: {
  locale: AppLocale;
  setLocale: (next: AppLocale) => void;
  wc: WorkspaceChromeStrings;
  isDarkMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as Node;
      if (popupRef.current?.contains(el) || buttonRef.current?.contains(el)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={hdrTextBtn(isDarkMode, 'looks')}
        title={wc.languageMenuTitle}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-label={wc.languageMenuTitle}
      >
        <Globe className="w-4 h-4 shrink-0" aria-hidden />
        <span className="text-xs font-medium">{appLocaleNativeLabel(locale)}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          ref={popupRef}
          role="listbox"
          aria-label={wc.languageMenuTitle}
          className="absolute right-0 top-full mt-1 z-[100] min-w-[168px] rounded-xl border border-white/20 bg-gray-900/95 backdrop-blur-sm py-1.5 shadow-xl custom-scrollbar-dark max-h-[min(280px,50vh)] overflow-y-auto"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
        >
          {APP_LOCALE_OPTIONS.map((code) => (
            <button
              key={code}
              type="button"
              role="option"
              aria-selected={locale === code ? 'true' : 'false'}
              onClick={() => {
                setLocale(code);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                locale === code ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>{appLocaleNativeLabel(code)}</span>
              {locale === code ? <Check className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden /> : <span className="w-4 h-4 shrink-0" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 画布外观设置：颜色 + 波点粗细 + 连接线样式（随明暗模式切换弹窗样式） */
function LightModeColorSettings({
  wc,
  isDarkMode,
  lightCanvasBgColor,
  setLightCanvasBgColor,
  lightDotsColor,
  setLightDotsColor,
  lightDotSize,
  setLightDotSize,
  canvasDotGap = 60,
  setCanvasDotGap,
  edgeColor,
  setEdgeColor,
  edgePathStyle,
  setEdgePathStyle,
}: {
  wc: WorkspaceChromeStrings;
  isDarkMode: boolean;
  lightCanvasBgColor: string;
  setLightCanvasBgColor?: (v: string) => void;
  lightDotsColor: string;
  setLightDotsColor?: (v: string) => void;
  lightDotSize: number;
  setLightDotSize?: (v: number) => void;
  canvasDotGap?: number;
  setCanvasDotGap?: (v: number) => void;
  edgeColor?: string;
  setEdgeColor?: (v: string) => void;
  edgePathStyle?: 'curve' | 'smoothStep';
  setEdgePathStyle?: (v: 'curve' | 'smoothStep') => void;
}) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as Node;
      if (popupRef.current?.contains(el) || buttonRef.current?.contains(el)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);
  const canEdit = setLightCanvasBgColor && setLightDotsColor;
  const hasEdgeColorSetter = !!setEdgeColor;
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => canEdit && setOpen((o) => !o)}
        disabled={!canEdit}
        className={`${hdrIconBtn(isDarkMode, 'variables')} disabled:opacity-50 disabled:cursor-not-allowed`}
        title={wc.canvasColorSettingsTitle}
      >
        <Settings className="w-4 h-4" />
      </button>
      {open && canEdit && (
        <div
          ref={popupRef}
          className={settingsPopupClass(isDarkMode)}
          style={isDarkMode ? { boxShadow: '0 8px 32px rgba(0,0,0,0.4)' } : undefined}
        >
          <div className="flex flex-col gap-3">
            <CursorShapePicker wc={wc} isDarkMode={isDarkMode} />
            <div className="flex items-center justify-between gap-2">
              <span className={settingsLabelClass(isDarkMode)}>{wc.canvasBackground}</span>
              <input
                type="color"
                value={lightCanvasBgColor}
                onChange={(e) => setLightCanvasBgColor(e.target.value)}
                className={settingsColorInputClass(isDarkMode)}
                title={wc.pickCanvasBg}
                aria-label={wc.pickCanvasBg}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={settingsLabelClass(isDarkMode)}>{wc.dotColor}</span>
              <input
                type="color"
                value={lightDotsColor}
                onChange={(e) => setLightDotsColor(e.target.value)}
                className={settingsColorInputClass(isDarkMode)}
                title={wc.pickDotColor}
                aria-label={wc.pickDotColor}
              />
            </div>
            {hasEdgeColorSetter && (
              <div className="flex items-center justify-between gap-2">
                <span className={settingsLabelClass(isDarkMode)}>{wc.edgeColor}</span>
                <input
                  type="color"
                  value={edgeColor ?? '#9CA3AF'}
                  onChange={(e) => setEdgeColor?.(e.target.value)}
                  className={settingsColorInputClass(isDarkMode)}
                  title={wc.pickEdgeColor}
                  aria-label={wc.pickEdgeColor}
                />
              </div>
            )}
            {setEdgePathStyle && edgePathStyle != null && (
              <div className="flex flex-col gap-1.5">
                <span className={settingsLabelClass(isDarkMode)}>{wc.edgeStyleLabel}</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEdgePathStyle('curve')}
                    className={settingsEdgeToggleClass(isDarkMode, edgePathStyle === 'curve')}
                  >
                    <Workflow className="w-3.5 h-3.5" />
                    {wc.edgeCurve}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEdgePathStyle('smoothStep')}
                    className={settingsEdgeToggleClass(isDarkMode, edgePathStyle === 'smoothStep')}
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    {wc.edgeOrthogonal}
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className={settingsLabelClass(isDarkMode)}>{wc.dotThickness}</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.1}
                  value={lightDotSize}
                  onChange={(e) => setLightDotSize?.(parseFloat(e.target.value))}
                  className={settingsRangeClass(isDarkMode)}
                  title={wc.dotThickness}
                />
                <span className={`${settingsValueClass(isDarkMode)} w-8`}>{Math.round(lightDotSize * 100)}%</span>
              </div>
            </div>
            {setCanvasDotGap && (
              <div className="flex flex-col gap-1.5">
                <span className={settingsLabelClass(isDarkMode)}>{wc.dotGap}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={20}
                    max={180}
                    step={5}
                    value={canvasDotGap}
                    onChange={(e) => setCanvasDotGap(parseInt(e.target.value, 10))}
                    className={settingsRangeClass(isDarkMode)}
                    title={wc.dotGapRangeTitle}
                  />
                  <span className={`${settingsValueClass(isDarkMode)} w-10 tabular-nums`}>{canvasDotGap}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface WorkspaceHeaderProps {
  isDarkMode: boolean;
  setIsDarkMode: (value: boolean) => void;
  lightBrightness: number;
  setLightBrightness: (value: number) => void;
  lightCanvasBgColor?: string;
  setLightCanvasBgColor?: (value: string) => void;
  lightDotsColor?: string;
  setLightDotsColor?: (value: string) => void;
  lightDotSize?: number;
  setLightDotSize?: (value: number) => void;
  edgeColor?: string;
  setEdgeColor?: (value: string) => void;
  darkDotSize?: number;
  setDarkDotSize?: (value: number) => void;
  canvasDotGap?: number;
  setCanvasDotGap?: (value: number) => void;
  onOpenFolder: () => void | Promise<void>;
  /** 手动备份 data.json / data.json.bak 到项目 backups/ */
  onBackupProject?: () => void | Promise<void>;
  /** 当 data.json.bak 节点更多时，从备份恢复工程 */
  onRestoreFromBackup?: () => void | Promise<void>;
  onNavigateBack?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  edgePathStyle: 'curve' | 'smoothStep';
  setEdgePathStyle: (v: 'curve' | 'smoothStep') => void;
  projectId: string | undefined;
  /** Laf 云端余额：status 为 connecting/error 时显示「正在连接云端服务...」 */
  lafStatus: 'idle' | 'connecting' | 'success' | 'error';
  lafBalance: number | null;
  onLafClick?: () => void;
}

const WorkspaceHeader = React.memo(function WorkspaceHeader({
  isDarkMode,
  setIsDarkMode,
  lightBrightness,
  setLightBrightness,
  lightCanvasBgColor = '#E5E7EB',
  setLightCanvasBgColor,
  lightDotsColor = '#000000',
  setLightDotsColor,
  lightDotSize = 2,
  setLightDotSize,
  edgeColor,
  setEdgeColor,
  darkDotSize,
  setDarkDotSize,
  canvasDotGap = 60,
  setCanvasDotGap,
  onOpenFolder,
  onBackupProject,
  onRestoreFromBackup,
  onNavigateBack,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  edgePathStyle,
  setEdgePathStyle,
  projectId,
  lafStatus = 'idle',
  lafBalance = null,
  onLafClick,
}: WorkspaceHeaderProps) {
  const { locale, setLocale } = useAppLocale();
  const wc = workspaceChromeT(locale);
  const lafLowBalance =
    lafBalance !== null && Number.isFinite(lafBalance) && lafBalance <= 10;
  return (
    <div className="h-14 apple-panel flex items-center justify-between px-4 flex-shrink-0 relative z-[100] overflow-visible" style={{ pointerEvents: 'auto' }}>
      {/* 左侧：返回项目列表 + 打开项目文件夹 */}
      <div className="flex items-center gap-4">
        {onNavigateBack && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateBack();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={hdrTextBtn(isDarkMode, 'motion', 'nodrag nopan')}
            style={{ pointerEvents: 'auto' }}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{wc.backToProjects}</span>
          </button>
        )}
        {projectId && (
          <>
            <button
              onClick={onOpenFolder}
              className={hdrTextBtn(isDarkMode, 'sensing')}
              title={wc.openProjectFolderTitle}
            >
              <FolderOpen className="w-4 h-4" />
              <span>{wc.openProjectFolder}</span>
            </button>
            {onBackupProject && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void onBackupProject();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className={hdrTextBtn(isDarkMode, 'events', 'nodrag nopan')}
                title={wc.backupProjectTitle}
              >
                <Archive className="w-4 h-4" />
                <span>{wc.backupProjectButton}</span>
              </button>
            )}
            {onRestoreFromBackup && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void onRestoreFromBackup();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className={hdrTextBtn(isDarkMode, 'operators', 'nodrag nopan')}
                title={wc.restoreFromBackupTitle}
              >
                <RotateCcw className="w-4 h-4" />
                <span>{wc.restoreFromBackupButton}</span>
              </button>
            )}
            {onUndo != null && onRedo != null && (
              <div className="flex items-center gap-1.5 nodrag nopan">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onUndo(); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={!canUndo}
                  className={hdrRoundBtn(isDarkMode, 'control')}
                  title={wc.undoTitle}
                  aria-label={wc.undoTitle}
                >
                  <Undo2 className="h-[18px] w-[18px] shrink-0" strokeWidth={2.25} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRedo(); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={!canRedo}
                  className={hdrRoundBtn(isDarkMode, 'control')}
                  title={wc.redoTitle}
                  aria-label={wc.redoTitle}
                >
                  <Redo2 className="h-[18px] w-[18px] shrink-0" strokeWidth={2.25} aria-hidden />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 右侧：设置 + 明暗切换（暗黑模式下设置紧挨切换按钮左侧）+ API 状态指示灯 */}
      <div className="flex items-center gap-[20px]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const api = window.electronAPI;
              const title = wc.bugFeedback;
              void (api?.openInAppBrowser
                ? api.openInAppBrowser(
                    'https://my.feishu.cn/wiki/WKXnwDtPeiN5dXkv1Grc8vXSnfh?from=from_copylink',
                    title,
                  )
                : api?.openExternalUrl?.(
                    'https://my.feishu.cn/wiki/WKXnwDtPeiN5dXkv1Grc8vXSnfh?from=from_copylink',
                  ));
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={hdrTextBtn(isDarkMode, 'variables', 'nodrag nopan')}
            title={wc.bugFeedbackTitle}
            aria-label={wc.bugFeedback}
          >
            <Bug className="w-4 h-4" />
            <span>{wc.bugFeedback}</span>
          </button>
          <MediaOssRouteToggle isDarkMode={isDarkMode} />
          {isDarkMode ? (
            <>
              <DarkModeSettings
                wc={wc}
                isDarkMode={isDarkMode}
                dotSize={darkDotSize}
                setDotSize={setDarkDotSize}
                canvasDotGap={canvasDotGap}
                setCanvasDotGap={setCanvasDotGap}
                edgeColor={edgeColor}
                setEdgeColor={setEdgeColor}
                edgePathStyle={edgePathStyle}
                setEdgePathStyle={setEdgePathStyle}
              />
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={hdrTextBtn(isDarkMode, 'events')}
                title={wc.switchToLightMode}
              >
                <Moon className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <LightModeColorSettings
                wc={wc}
                isDarkMode={isDarkMode}
                lightCanvasBgColor={lightCanvasBgColor}
                setLightCanvasBgColor={setLightCanvasBgColor}
                lightDotsColor={lightDotsColor}
                setLightDotsColor={setLightDotsColor}
                lightDotSize={lightDotSize}
                setLightDotSize={setLightDotSize}
                canvasDotGap={canvasDotGap}
                setCanvasDotGap={setCanvasDotGap}
                edgeColor={edgeColor}
                setEdgeColor={setEdgeColor}
                edgePathStyle={edgePathStyle}
                setEdgePathStyle={setEdgePathStyle}
              />
              <div className="flex items-center gap-2 w-[144px] shrink-0">
                <span className="text-xs flex-shrink-0 text-white" title={wc.brightnessTitle}>
                  {wc.brightness} {Math.round(lightBrightness * 100)}%
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={lightBrightness}
                  onChange={(e) => setLightBrightness(parseFloat(e.target.value))}
                  className="flex-1 min-w-0 h-2 rounded-full appearance-none cursor-pointer accent-amber-500 bg-gray-300/60"
                  title={wc.brightnessSliderTitle}
                />
              </div>
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={hdrTextBtn(isDarkMode, 'motion')}
                style={{ marginLeft: 18 }}
                title={wc.switchToDarkMode}
              >
                <Sun className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
        <LanguageMenu locale={locale} setLocale={setLocale} wc={wc} isDarkMode={isDarkMode} />
        {/* 窗口全屏切换（F11 快捷键也可切换） */}
        <button
          onClick={() => window.electronAPI?.toggleFullscreen?.().catch((err: unknown) => console.error('切换全屏失败:', err))}
          className={hdrTextBtn(isDarkMode, 'sensing')}
          title={wc.fullscreenTitle}
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => onLafClick?.()}
            className={`${hdrTextBtn(isDarkMode, 'control')} ${
              lafLowBalance ? 'nx-laf-balance-low !text-red-100 hover:!brightness-95' : ''
            }`}
            title={lafLowBalance ? wc.headerLowBalanceTitle : wc.headerRefreshBalanceTitle}
          >
            <Coins className="w-4 h-4 shrink-0 text-amber-400" aria-hidden />
            <span className="text-white/80">{wc.headerCloudCredits}</span>
            {lafStatus !== 'success' && lafBalance === null && (
              <span className="text-white/60 text-xs">{wc.headerConnectingCloud}</span>
            )}
            {lafBalance !== null && (
              <span
                className={`text-xs inline-flex items-baseline gap-0.5 overflow-hidden min-w-[3ch] cursor-help ${
                  lafLowBalance ? 'text-red-400' : 'text-white/60'
                }`}
                title={wc.headerCreditsTooltip}
              >
                <AnimatePresence mode="wait">
                  <motion.span
                    key={lafBalance}
                    initial={{ y: 8, opacity: 0.6, scale: 0.95 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: -8, opacity: 0.6, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    className="inline-block tabular-nums font-medium"
                  >
                    {lafBalance}
                  </motion.span>
                </AnimatePresence>
                <span> {wc.headerCurrencyUnit}</span>
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

export default WorkspaceHeader;
