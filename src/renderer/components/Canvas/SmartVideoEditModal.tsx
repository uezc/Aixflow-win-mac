import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppLocale } from '../../contexts/AppLocaleContext';

export type SmartEditOutput = 'clips' | 'keyframes';
export type SmartEditMode = 'stable' | 'balanced' | 'sensitive';
/** 关键帧：智能检测画面变化 / 手动按固定秒间隔 */
export type KeyframeExtractMethod = 'smart' | 'interval';

export type SmartVideoEditSettings = {
  output: SmartEditOutput;
  mode: SmartEditMode;
  fps: 16 | 24 | 30;
  maxClips: number;
  /** 提取关键帧时的方式 */
  keyframeMethod: KeyframeExtractMethod;
  /** 手动按间隔抽帧时的秒间隔（1–30） */
  keyframeIntervalSec: number;
};

type Props = {
  isDarkMode: boolean;
  busy?: boolean;
  onCancel: () => void;
  onStart: (settings: SmartVideoEditSettings) => void;
};

const zh = {
  title: '智能剪辑设置',
  output: '输出',
  clips: '提取视频片段',
  keyframes: '提取视频关键帧',
  keyframeMethod: '抽帧方式',
  methodSmart: '智能提取',
  methodInterval: '按时间间隔',
  mode: '切镜灵敏度',
  modeHint: '画面变化要多明显，才会切成新镜头。',
  stableTitle: '少切',
  stableDesc: '只认明显硬切，镜头更长',
  balancedTitle: '适中',
  balancedDesc: '明显换景就切，推荐日常',
  sensitiveTitle: '多切',
  sensitiveDesc: '轻微变化也切，镜头更碎',
  minClip: '最短片段',
  minClipHint: '每个镜头至少多长；越短越容易切碎。',
  minClipLong: '较长',
  minClipLongDesc: '≥ 1.2 秒',
  minClipMid: '适中',
  minClipMidDesc: '≥ 0.8 秒',
  minClipShort: '较短',
  minClipShortDesc: '≥ 0.6 秒',
  interval: '抽帧间隔',
  intervalUnit: (sec: number) => `每 ${sec} 秒一帧`,
  intervalMin: '1s',
  intervalMax: '30s',
  maxGenerate: '最多生成',
  segments: '段',
  frames: '帧',
  hintClips: '分析后在下方胶片轨道预览镜头（与手动裁剪同一条轨道），确认后每个镜头对应画布右侧新模块。',
  hintKeyframesSmart: '按画面变化智能选取关键帧，确认后自动生成画布右侧图片模块。',
  hintKeyframesInterval: '按设定时间间隔抽取画面帧，确认后自动生成画布右侧图片模块。',
  cancel: '取消',
  start: '开始',
};

const en = {
  title: 'Smart Edit Settings',
  output: 'Output',
  clips: 'Extract video clips',
  keyframes: 'Extract keyframes',
  keyframeMethod: 'Keyframe method',
  methodSmart: 'Smart extract',
  methodInterval: 'By interval',
  mode: 'Cut sensitivity',
  modeHint: 'How obvious a visual change must be before starting a new shot.',
  stableTitle: 'Fewer cuts',
  stableDesc: 'Only clear hard cuts · longer shots',
  balancedTitle: 'Balanced',
  balancedDesc: 'Cut on clear scene changes · recommended',
  sensitiveTitle: 'More cuts',
  sensitiveDesc: 'React to subtle changes · shorter shots',
  minClip: 'Min clip length',
  minClipHint: 'Shortest allowed shot; shorter means finer cuts.',
  minClipLong: 'Longer',
  minClipLongDesc: '≥ 1.2s',
  minClipMid: 'Medium',
  minClipMidDesc: '≥ 0.8s',
  minClipShort: 'Shorter',
  minClipShortDesc: '≥ 0.6s',
  interval: 'Frame interval',
  intervalUnit: (sec: number) => `Every ${sec}s`,
  intervalMin: '1s',
  intervalMax: '30s',
  maxGenerate: 'Max',
  segments: 'clips',
  frames: 'frames',
  hintClips: 'Preview shots on the shared trim filmstrip, then confirm — each shot becomes a linked canvas module.',
  hintKeyframesSmart: 'Pick keyframes by visual change, then place image modules on the right.',
  hintKeyframesInterval: 'Extract frames at a fixed interval into image modules on the right.',
  cancel: 'Cancel',
  start: 'Start',
};

function Chip({
  active,
  isDarkMode,
  onClick,
  children,
}: {
  active: boolean;
  isDarkMode: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-sky-500 text-white'
          : isDarkMode
            ? 'bg-white/10 text-white/80 hover:bg-white/15'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

/** 带标题 + 一行说明的选项卡，便于理解稳/均衡/敏感等含义 */
function ChoiceCard({
  active,
  isDarkMode,
  title,
  description,
  onClick,
  disabled,
}: {
  active: boolean;
  isDarkMode: boolean;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
        active
          ? 'border-sky-400/80 bg-sky-500 text-white shadow-sm shadow-sky-900/20'
          : isDarkMode
            ? 'border-white/10 bg-white/[0.06] text-white/85 hover:bg-white/10'
            : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100'
      }`}
    >
      <span className="text-xs font-semibold leading-tight">{title}</span>
      <span
        className={`text-[10px] leading-snug ${
          active ? 'text-white/85' : isDarkMode ? 'text-white/45' : 'text-gray-500'
        }`}
      >
        {description}
      </span>
    </button>
  );
}

export const SmartVideoEditModal: React.FC<Props> = ({ isDarkMode, busy, onCancel, onStart }) => {
  const { locale } = useAppLocale();
  const t = locale === 'en' ? en : zh;
  const [output, setOutput] = useState<SmartEditOutput>('clips');
  const [mode, setMode] = useState<SmartEditMode>('balanced');
  const [fps, setFps] = useState<16 | 24 | 30>(24);
  const [maxClips, setMaxClips] = useState(20);
  const [keyframeMethod, setKeyframeMethod] = useState<KeyframeExtractMethod>('smart');
  const [keyframeIntervalSec, setKeyframeIntervalSec] = useState(2);

  const hint =
    output === 'clips'
      ? t.hintClips
      : keyframeMethod === 'smart'
        ? t.hintKeyframesSmart
        : t.hintKeyframesInterval;

  const modeChoices: Array<{ value: SmartEditMode; title: string; description: string }> = [
    { value: 'stable', title: t.stableTitle, description: t.stableDesc },
    { value: 'balanced', title: t.balancedTitle, description: t.balancedDesc },
    { value: 'sensitive', title: t.sensitiveTitle, description: t.sensitiveDesc },
  ];

  const minClipChoices: Array<{ value: 16 | 24 | 30; title: string; description: string }> = [
    { value: 16, title: t.minClipLong, description: t.minClipLongDesc },
    { value: 24, title: t.minClipMid, description: t.minClipMidDesc },
    { value: 30, title: t.minClipShort, description: t.minClipShortDesc },
  ];

  const modePicker = (
    <div>
      <div className={`mb-1 text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>{t.mode}</div>
      <p className={`mb-2 text-[10px] leading-relaxed ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
        {t.modeHint}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {modeChoices.map((c) => (
          <ChoiceCard
            key={c.value}
            active={mode === c.value}
            isDarkMode={isDarkMode}
            title={c.title}
            description={c.description}
            disabled={!!busy}
            onClick={() => setMode(c.value)}
          />
        ))}
      </div>
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className={`mx-4 w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl ${
          isDarkMode ? 'nexflow-glass-panel border border-white/10 text-white' : 'bg-white border border-gray-200 text-gray-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`border-b px-4 py-3 text-sm font-semibold ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
          {t.title}
        </div>
        <div className="space-y-4 px-4 py-4">
          <div>
            <div className={`mb-2 text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>{t.output}</div>
            <div className="flex flex-wrap gap-2">
              <Chip active={output === 'clips'} isDarkMode={isDarkMode} onClick={() => setOutput('clips')}>
                {t.clips}
              </Chip>
              <Chip active={output === 'keyframes'} isDarkMode={isDarkMode} onClick={() => setOutput('keyframes')}>
                {t.keyframes}
              </Chip>
            </div>
          </div>

          {output === 'clips' ? (
            <>
              {modePicker}
              <div>
                <div className={`mb-1 text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>{t.minClip}</div>
                <p className={`mb-2 text-[10px] leading-relaxed ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
                  {t.minClipHint}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {minClipChoices.map((c) => (
                    <ChoiceCard
                      key={c.value}
                      active={fps === c.value}
                      isDarkMode={isDarkMode}
                      title={c.title}
                      description={c.description}
                      disabled={!!busy}
                      onClick={() => setFps(c.value)}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className={`mb-2 text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>{t.keyframeMethod}</div>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    active={keyframeMethod === 'smart'}
                    isDarkMode={isDarkMode}
                    onClick={() => setKeyframeMethod('smart')}
                  >
                    {t.methodSmart}
                  </Chip>
                  <Chip
                    active={keyframeMethod === 'interval'}
                    isDarkMode={isDarkMode}
                    onClick={() => setKeyframeMethod('interval')}
                  >
                    {t.methodInterval}
                  </Chip>
                </div>
              </div>

              {keyframeMethod === 'smart' ? (
                modePicker
              ) : (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={`text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>{t.interval}</span>
                    <span className={`text-xs font-medium tabular-nums ${isDarkMode ? 'text-white/85' : 'text-gray-800'}`}>
                      {t.intervalUnit(keyframeIntervalSec)}
                    </span>
                  </div>
                  <style>{`
                    .nexflow-smart-edit-interval-range {
                      -webkit-appearance: none;
                      appearance: none;
                      width: 100%;
                      height: 4px;
                      border-radius: 999px;
                      outline: none;
                      background: ${isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
                    }
                    .nexflow-smart-edit-interval-range::-webkit-slider-thumb {
                      -webkit-appearance: none;
                      width: 14px;
                      height: 14px;
                      border-radius: 50%;
                      background: #3b82f6;
                      border: none;
                      box-shadow: 0 0 0 2px ${isDarkMode ? 'rgba(10,10,12,0.9)' : 'rgba(255,255,255,0.95)'};
                      cursor: pointer;
                    }
                    .nexflow-smart-edit-interval-range::-moz-range-thumb {
                      width: 14px;
                      height: 14px;
                      border-radius: 50%;
                      background: #3b82f6;
                      border: none;
                      cursor: pointer;
                    }
                    .nexflow-smart-edit-interval-range:disabled {
                      opacity: 0.45;
                    }
                  `}</style>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    step={1}
                    value={keyframeIntervalSec}
                    disabled={!!busy}
                    onChange={(e) =>
                      setKeyframeIntervalSec(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
                    }
                    className="nexflow-smart-edit-interval-range nodrag cursor-pointer"
                    aria-label={t.interval}
                    title={t.intervalUnit(keyframeIntervalSec)}
                  />
                  <div
                    className={`mt-1.5 flex justify-between text-[10px] tabular-nums ${
                      isDarkMode ? 'text-white/35' : 'text-gray-400'
                    }`}
                  >
                    <span>{t.intervalMin}</span>
                    <span>{t.intervalMax}</span>
                  </div>
                </div>
              )}
            </>
          )}

          <div>
            <div className={`mb-2 text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>{t.maxGenerate}</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={60}
                value={maxClips}
                disabled={!!busy}
                onChange={(e) => setMaxClips(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                className={`w-24 rounded-lg border px-2 py-1.5 text-sm outline-none ${
                  isDarkMode ? 'border-white/15 bg-black/30 text-white' : 'border-gray-200 bg-white text-gray-900'
                }`}
              />
              <span className={`text-xs ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
                {output === 'keyframes' ? t.frames : t.segments}
              </span>
            </div>
          </div>
          <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>{hint}</p>
        </div>
        <div className={`flex justify-end gap-2 border-t px-4 py-3 ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            type="button"
            disabled={!!busy}
            onClick={onCancel}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              isDarkMode ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              onStart({ output, mode, fps, maxClips, keyframeMethod, keyframeIntervalSec })
            }
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-60"
          >
            {busy ? '…' : t.start}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SmartVideoEditModal;
