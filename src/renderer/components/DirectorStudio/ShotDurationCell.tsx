/**
 * 分镜表时长单元格 + 表头工具条（Human-in-the-loop）
 * - duration_sec 允许小数，双击编辑
 * - 展示 AI 置信区间条；越界琥珀色警告但不拦截
 * - 锁定后「重新计算」不覆盖 duration_sec
 * - Hover 展示 duration_why（AI 计算原因）
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ShotDurationPaceStyle } from '../../../shared/directorDomain';
import { snapToTier } from '../../../shared/directorDomain';

export type ShotDurationCellProps = {
  isDark: boolean;
  durationSec: number;
  durationMin?: number;
  durationMax?: number;
  durationAi?: number;
  locked?: boolean;
  why?: string;
  /** 旁注出片档，不强制改表内值 */
  showExportTier?: boolean;
  onChangeSec: (sec: number) => void;
  onToggleLock: () => void;
};

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export const ShotDurationCell: React.FC<ShotDurationCellProps> = ({
  isDark,
  durationSec,
  durationMin,
  durationMax,
  durationAi,
  locked,
  why,
  showExportTier = true,
  onChangeSec,
  onToggleLock,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [tipOpen, setTipOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lo = Number(durationMin);
  const hi = Number(durationMax);
  const hasBand = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
  const sec = Number(durationSec);
  const display = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const outOfBand = hasBand && display > 0 && (display < lo || display > hi);
  const ai = Number(durationAi);
  const aiPct = hasBand
    ? clampPct((((Number.isFinite(ai) ? ai : display) - lo) / (hi - lo)) * 100)
    : 50;
  const userPct = hasBand ? clampPct(((display - lo) / (hi - lo)) * 100) : 50;
  const whyText = String(why || '').trim();

  useEffect(() => {
    if (editing) {
      setDraft(display > 0 ? String(display) : '');
      queueMicrotask(() => inputRef.current?.select());
    }
  }, [editing, display]);

  useEffect(
    () => () => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
    },
    [],
  );

  const commitEdit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n > 0) onChangeSec(Math.round(n * 10) / 10);
    setEditing(false);
  };

  const openTip = () => {
    if (!whyText || editing) return;
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => setTipOpen(true), 280);
  };
  const closeTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    setTipOpen(false);
  };

  return (
    <div
      className={`nodrag relative min-w-0 rounded px-0.5 py-0.5 ${
        outOfBand
          ? isDark
            ? 'ring-1 ring-amber-400/80 bg-amber-500/10'
            : 'ring-1 ring-amber-500 bg-amber-50'
          : ''
      }`}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        closeTip();
        if (!editing) setEditing(true);
      }}
      onMouseEnter={openTip}
      onMouseLeave={closeTip}
    >
      {tipOpen && whyText ? (
        <div
          role="tooltip"
          className={`pointer-events-none absolute bottom-[calc(100%+4px)] left-0 z-20 w-[min(220px,70vw)] rounded-md px-2 py-1.5 text-[10px] leading-snug shadow-lg ${
            isDark
              ? 'border border-white/15 bg-[#1a1d26] text-white/85'
              : 'border border-gray-200 bg-white text-gray-700'
          }`}
        >
          <div className={`mb-0.5 font-semibold ${isDark ? 'text-teal-300/90' : 'text-teal-700'}`}>
            AI 时长依据
          </div>
          <div className="break-words whitespace-pre-wrap">{whyText}</div>
          {Number.isFinite(ai) && ai > 0 ? (
            <div className={`mt-1 tabular-nums ${isDark ? 'text-white/45' : 'text-gray-400'}`}>
              AI 建议 {ai.toFixed(1)}s
              {hasBand ? ` · 区间 ${lo.toFixed(1)}–${hi.toFixed(1)}s` : ''}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-0.5 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            step={0.1}
            min={0.5}
            max={30}
            className={`nodrag w-full min-w-0 rounded px-1 py-0.5 text-[12px] tabular-nums outline-none ${
              isDark
                ? 'bg-white/10 text-white'
                : 'bg-white text-gray-900 border border-gray-200'
            }`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className={`nodrag flex-1 min-w-0 text-left text-[12px] font-semibold tabular-nums truncate ${
              isDark ? 'text-white/90' : 'text-gray-900'
            }`}
            title={whyText ? undefined : '双击编辑'}
            onClick={(e) => e.stopPropagation()}
          >
            {display > 0 ? `${display.toFixed(1)}s` : '—'}
          </button>
        )}
        <button
          type="button"
          className={`nodrag shrink-0 rounded px-0.5 text-[11px] leading-none ${
            locked
              ? isDark
                ? 'text-amber-300'
                : 'text-amber-700'
              : isDark
                ? 'text-white/35 hover:text-white/70'
                : 'text-gray-400 hover:text-gray-700'
          }`}
          title={locked ? '已锁定：重算不改秒数' : '未锁定：重算可改秒数'}
          onClick={(e) => {
            e.stopPropagation();
            closeTip();
            onToggleLock();
          }}
        >
          {locked ? '🔒' : '🔓'}
        </button>
      </div>

      {hasBand ? (
        <div
          className={`relative mt-1 h-1.5 w-full rounded-full overflow-hidden ${
            isDark ? 'bg-white/10' : 'bg-gray-200'
          }`}
          aria-hidden
        >
          <div
            className={`absolute inset-y-0 left-0 right-0 ${isDark ? 'bg-teal-500/25' : 'bg-teal-200'}`}
          />
          <div
            className={`absolute top-0 bottom-0 w-0.5 ${isDark ? 'bg-teal-300' : 'bg-teal-600'}`}
            style={{ left: `${aiPct}%` }}
          />
          <div
            className={`absolute top-[-1px] bottom-[-1px] w-1.5 rounded-full -ml-[3px] ${
              isDark ? 'bg-white' : 'bg-gray-900'
            }`}
            style={{ left: `${userPct}%` }}
          />
        </div>
      ) : null}

      {hasBand ? (
        <div
          className={`mt-0.5 flex justify-between text-[9px] tabular-nums leading-tight ${
            isDark ? 'text-white/40' : 'text-gray-400'
          }`}
        >
          <span>{lo.toFixed(1)}</span>
          <span>{hi.toFixed(1)}</span>
        </div>
      ) : null}

      {outOfBand ? (
        <div
          className={`mt-0.5 text-[9px] leading-tight ${
            isDark ? 'text-amber-300/90' : 'text-amber-700'
          }`}
        >
          超出建议区间
        </div>
      ) : null}

      {showExportTier && display > 0 ? (
        <div
          className={`mt-0.5 text-[9px] leading-tight truncate ${
            isDark ? 'text-white/35' : 'text-gray-400'
          }`}
          title="仅旁注，不覆盖表内秒数"
        >
          出片≈{snapToTier(display)}s
        </div>
      ) : null}
    </div>
  );
};

export type DurationToolbarProps = {
  isDark: boolean;
  totalCapSec: number | null;
  paceStyle: ShotDurationPaceStyle;
  sumSec: number;
  onCapChange: (cap: number | null) => void;
  onPaceChange: (pace: ShotDurationPaceStyle) => void;
  onRecalculate: () => void;
};

export const DurationToolbar: React.FC<DurationToolbarProps> = ({
  isDark,
  totalCapSec,
  paceStyle,
  sumSec,
  onCapChange,
  onPaceChange,
  onRecalculate,
}) => {
  const over = totalCapSec != null && totalCapSec > 0 && sumSec > totalCapSec + 0.05;
  const inputCls = `nodrag w-[4.5rem] rounded px-1.5 py-1 text-[12px] tabular-nums outline-none ${
    isDark
      ? 'bg-white/[0.08] text-white border border-white/15'
      : 'bg-white text-gray-900 border border-gray-200'
  }`;
  const selectCls = `nodrag rounded px-1.5 py-1 text-[12px] outline-none ${
    isDark
      ? 'bg-white/[0.08] text-white border border-white/15'
      : 'bg-white text-gray-900 border border-gray-200'
  }`;

  return (
    <div
      className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-2.5 py-2 text-[12px] ${
        isDark ? 'border border-white/10 bg-white/[0.03]' : 'border border-gray-200 bg-gray-50'
      }`}
    >
      <label className={`inline-flex items-center gap-1.5 ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
        总时长上限
        <input
          type="number"
          min={1}
          step={1}
          placeholder="如 75"
          className={inputCls}
          value={totalCapSec != null && totalCapSec > 0 ? String(totalCapSec) : ''}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (!v) {
              onCapChange(null);
              return;
            }
            const n = Number(v);
            onCapChange(Number.isFinite(n) && n > 0 ? n : null);
          }}
        />
        <span>s</span>
      </label>

      <span
        className={`tabular-nums font-medium ${
          over
            ? isDark
              ? 'text-rose-300'
              : 'text-rose-600'
            : isDark
              ? 'text-white/80'
              : 'text-gray-800'
        }`}
        title={over ? '已超过总时长上限' : '当前分镜合计'}
      >
        合计 {sumSec.toFixed(1)}s
        {totalCapSec != null && totalCapSec > 0 ? ` / ${totalCapSec}s` : ''}
        {over ? ' · 超限' : ''}
      </span>

      <label className={`inline-flex items-center gap-1.5 ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
        节奏
        <select
          className={selectCls}
          value={paceStyle}
          onChange={(e) => onPaceChange(e.target.value as ShotDurationPaceStyle)}
        >
          <option value="standard">标准</option>
          <option value="fast">快节奏</option>
          <option value="slow">慢节奏</option>
        </select>
      </label>

      <button
        type="button"
        className={`nodrag rounded-md px-2.5 py-1 text-[12px] font-medium ${
          isDark
            ? 'border border-teal-400/40 bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'
            : 'border border-teal-600/30 bg-teal-50 text-teal-800 hover:bg-teal-100'
        }`}
        onClick={onRecalculate}
      >
        重新计算时长
      </button>
    </div>
  );
};
