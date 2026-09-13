/**
 * 导演执行表时间轴：加厚切段条、条内显示分段文字、拖边界改时长。
 * 双击条内编辑；Ctrl/⌘+双击切开；双击分界线合并。
 */
import React, { useEffect, useRef, useState } from 'react';
import type { DramaTimelineEvent } from '../../../shared/directorDomain';
import {
  formatTimelineRange,
  mergeDramaTimelineEventsAt,
  setDramaTimelineBoundarySec,
  splitDramaTimelineEventAt,
  DRAMA_TIMELINE_SPLIT_DISABLED,
} from '../../../shared/directorDomain';

function clientXToSec(el: HTMLElement, clientX: number, dur: number): number {
  const r = el.getBoundingClientRect();
  if (r.width <= 0) return 0;
  const x = Math.min(Math.max(clientX - r.left, 0), r.width);
  return (x / r.width) * dur;
}

const SEG_FILL = [
  'bg-violet-500/95',
  'bg-sky-500/95',
  'bg-fuchsia-500/90',
  'bg-indigo-500/95',
  'bg-cyan-500/90',
];

/** 彩条铺满可用高度；收起时由父级动画压到 0 */
const TICK_H = '0px';

function formatEventPrompt(ev: DramaTimelineEvent): string {
  const visual = String(ev.visual_action || '').trim();
  const dlg = String(ev.dialogue || '').trim();
  const env = (ev.environment_audio || []).filter(Boolean).join('、');
  return [visual, `对白：${dlg || '无'}`, `环境音：${env || '无'}`].filter(Boolean).join('\n');
}

function parseEventPrompt(raw: string): Partial<DramaTimelineEvent> {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  let dialogue = '';
  let envLine = '';
  const visualParts: string[] = [];
  for (const line of lines) {
    const dlg = line.match(/^(?:对白|台词)\s*[：:]\s*(.*)$/);
    if (dlg) {
      const v = dlg[1].trim();
      dialogue = !v || v === '无' || v === '无台词' ? '' : v.replace(/^[「『"]|[」』"]$/g, '');
      continue;
    }
    const env = line.match(/^(?:环境音|音效)\s*[：:]\s*(.*)$/);
    if (env) {
      envLine = env[1].trim();
      if (envLine === '无') envLine = '';
      continue;
    }
    visualParts.push(line);
  }
  return {
    visual_action: visualParts.join('。').replace(/。+/g, '。').replace(/。$/g, ''),
    dialogue,
    environment_audio: envLine
      ? envLine
          .split(/[、,，;；]+/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
    ...(dialogue ? {} : { lip_sync: false }),
  };
}

function SegmentEditBox({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (next: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      className="nodrag nowheel mt-0.5 min-h-0 w-full flex-1 resize-none rounded bg-black/35 px-1 py-0.5 text-[11px] leading-snug text-white outline-none ring-1 ring-white/50"
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSave(draft);
        }
      }}
    />
  );
}

export function DramaShotTimelineRuler({
  durationSec,
  events,
  activeId,
  hoverId,
  onSelect,
  onHover,
  onChange,
  onPreview,
  onPatchEvent,
  nameById,
  isDark,
  /** 有值时彩条正文显示整镜编译稿，不再显示切段画面提示 */
  promptOverride,
}: {
  durationSec: number;
  events: DramaTimelineEvent[];
  activeId?: string;
  hoverId?: string;
  onSelect?: (eventId: string, index: number) => void;
  onHover?: (eventId: string | null) => void;
  onChange?: (next: DramaTimelineEvent[]) => void;
  onPreview?: (next: DramaTimelineEvent[] | null) => void;
  onPatchEvent?: (eventId: string, patch: Partial<DramaTimelineEvent>) => void;
  nameById?: Map<string, string>;
  isDark: boolean;
  promptOverride?: string;
}) {
  const dur = Math.max(0.1, Number(durationSec) || 10);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ afterIndex: number; startX: number; moved: boolean } | null>(null);
  const liveRef = useRef(events);
  const rafRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [local, setLocal] = useState<DramaTimelineEvent[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const shown = local || events;

  useEffect(() => {
    if (dragging) return;
    liveRef.current = events;
  }, [events, dragging]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const commit = (next: DramaTimelineEvent[]) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setLocal(null);
    onPreview?.(null);
    onChange?.(next);
  };

  const onBoundaryDown = (afterIndex: number, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { afterIndex, startX: e.clientX, moved: false };
    liveRef.current = shown;
    const track = trackRef.current;
    if (track) {
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const onBoundaryMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !trackRef.current) return;
    if (!dragRef.current.moved) {
      if (Math.abs(e.clientX - dragRef.current.startX) < 4) return;
      dragRef.current.moved = true;
      setDragging(true);
    }
    const t = clientXToSec(trackRef.current, e.clientX, dur);
    const next = setDramaTimelineBoundarySec(liveRef.current, dragRef.current.afterIndex, t, dur);
    liveRef.current = next;
    // 拖动中只本地刷新彩条，禁止 onPreview 冒泡到父级（否则每帧重算 H3 编译会卡死）
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setLocal(liveRef.current);
    });
  };

  const onBoundaryUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const didDrag = dragRef.current.moved;
    dragRef.current = null;
    setDragging(false);
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (didDrag) commit(liveRef.current);
    else {
      setLocal(null);
      onPreview?.(null);
    }
  };

  const splitAtClientX = (clientX: number) => {
    if (DRAMA_TIMELINE_SPLIT_DISABLED) return;
    const el = trackRef.current;
    if (!el) return;
    commit(splitDramaTimelineEventAt(shown, clientXToSec(el, clientX, dur), dur));
  };

  const mergeAtClientX = (clientX: number): boolean => {
    if (DRAMA_TIMELINE_SPLIT_DISABLED) return false;
    const el = trackRef.current;
    if (!el || shown.length < 2) return false;
    const t = clientXToSec(el, clientX, dur);
    const slop = Math.max(0.18, dur * 0.025);
    let best = -1;
    let bestDist = slop;
    for (let i = 0; i < shown.length - 1; i++) {
      const d = Math.abs(t - Number(shown[i].end_sec));
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) return false;
    const keepId = shown[best]?.event_id;
    commit(mergeDramaTimelineEventsAt(shown, best, dur));
    if (keepId) onSelect?.(keepId);
    return true;
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div
        ref={trackRef}
        className={`relative min-h-0 flex-1 select-none ${dragging ? 'cursor-col-resize' : ''}`}
        style={{ touchAction: 'none' }}
        onPointerMove={onBoundaryMove}
        onPointerUp={onBoundaryUp}
        onPointerCancel={onBoundaryUp}
        onPointerLeave={() => {
          if (!dragging) onHover?.(null);
        }}
      >
        <div
          className={`absolute inset-x-0 top-0 overflow-hidden rounded-md ${
            isDark ? 'bg-white/10' : 'bg-gray-200'
          }`}
          style={{ bottom: TICK_H }}
        />
        {!shown.length ? (
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center rounded-md text-[12px] ${
              isDark ? 'text-white/45' : 'text-gray-500'
            }`}
            style={{ bottom: TICK_H }}
          >
            切段生成中或点下方「生成本镜切段」…
          </div>
        ) : null}
        {shown.map((ev, idx) => {
          const start = Math.max(0, Number(ev.start_sec) || 0);
          const end = Math.max(start, Number(ev.end_sec) || start);
          const left = (start / dur) * 100;
          const width = Math.max(0.8, ((end - start) / dur) * 100);
          const selected = !!activeId && activeId === ev.event_id;
          const hovered = hoverId === ev.event_id;
          const who = (ev.character_ids || [])
            .map((id) => nameById?.get(id) || id)
            .filter(Boolean)
            .join('、');
          const visual = String(ev.visual_action || '').trim();
          const env = (ev.environment_audio || []).filter(Boolean).join('、');
          const dlg = String(ev.dialogue || '').trim();
          const overrideBody = String(promptOverride || '').trim();
          const narrow = width < 9;
          const editing = !overrideBody && editingId === ev.event_id;
          return (
            <div
              key={ev.event_id || `ev-${idx}`}
              role="button"
              tabIndex={0}
              className={`nodrag absolute top-0 flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-md px-1.5 py-1 text-center text-white transition-[filter,box-shadow] ${
                SEG_FILL[idx % SEG_FILL.length]
              } ${
                selected
                  ? 'z-[1] ring-2 ring-white/90 ring-offset-0 brightness-110'
                  : hovered
                    ? 'z-[1] ring-1 ring-white/45 brightness-105'
                    : 'hover:brightness-110'
              }`}
              style={{ left: `${left}%`, width: `${width}%`, bottom: TICK_H }}
              title={
                overrideBody
                  ? `整镜编译稿 · ${start}–${end}s`
                  : DRAMA_TIMELINE_SPLIT_DISABLED
                    ? `整镜单段（测试关切分）· ${start}–${end}s · 双击编辑`
                    : `双击编辑 · Ctrl+双击切开 · 拖分界改时长 · ${start}–${end}s`
              }
              onPointerEnter={() => onHover?.(ev.event_id)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(ev.event_id, idx);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (overrideBody) return;
                if (e.ctrlKey || e.metaKey) {
                  if (mergeAtClientX(e.clientX)) return;
                  splitAtClientX(e.clientX);
                  return;
                }
                setEditingId(ev.event_id);
                onSelect?.(ev.event_id, idx);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect?.(ev.event_id, idx);
                }
              }}
            >
              <div className="flex h-full w-full min-h-0 flex-col items-center justify-center overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-1.5 text-[11px] font-semibold leading-tight">
                <span className="tabular-nums drop-shadow-sm">
                  {formatTimelineRange(ev.start_sec, ev.end_sec)}
                </span>
                {!narrow && !overrideBody ? (
                  <button
                    type="button"
                    className={`nodrag rounded px-0.5 text-[10px] ${
                      ev.lip_sync ? 'bg-black/25 text-emerald-100' : 'bg-black/20 text-white/80'
                    }`}
                    title="点击切换口型"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPatchEvent?.(ev.event_id, { lip_sync: !ev.lip_sync });
                    }}
                  >
                    {ev.lip_sync ? '口型开' : '口型关'}
                  </button>
                ) : null}
                {overrideBody && !narrow ? (
                  <span className="rounded bg-black/25 px-1 text-[10px] text-amber-100">整镜编译稿</span>
                ) : null}
              </div>
              {!narrow && who && !overrideBody ? (
                <div className="truncate text-[10px] leading-tight text-white/90">{who}</div>
              ) : null}
              {editing ? (
                <SegmentEditBox
                  value={formatEventPrompt(ev)}
                  onSave={(v) => {
                    onPatchEvent?.(ev.event_id, parseEventPrompt(v));
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="mt-0.5 min-h-0 w-full overflow-hidden">
                  <p
                    className={`text-[12px] font-medium leading-snug drop-shadow-sm ${
                      overrideBody
                        ? 'max-h-full overflow-auto whitespace-pre-wrap break-words text-left custom-scrollbar-dark'
                        : 'line-clamp-6'
                    }`}
                  >
                    {overrideBody || visual || (narrow ? '' : '双击编辑本段')}
                  </p>
                  {!overrideBody && !narrow && dlg ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/90">
                      「{dlg}」
                    </p>
                  ) : null}
                  {!overrideBody && !narrow && env ? (
                    <p className="mt-0.5 line-clamp-1 text-[10px] text-white/75">{env}</p>
                  ) : null}
                </div>
              )}
              </div>
            </div>
          );
        })}
        {!DRAMA_TIMELINE_SPLIT_DISABLED
          ? shown.slice(0, -1).map((ev, idx) => {
          const end = Math.max(0, Number(ev.end_sec) || 0);
          const left = (end / dur) * 100;
          return (
            <div
              key={`b-${ev.event_id || idx}`}
              className="nodrag absolute top-0 z-[3] w-8 -translate-x-1/2 cursor-col-resize"
              style={{ left: `${left}%`, bottom: TICK_H, touchAction: 'none' }}
              onPointerDown={(e) => onBoundaryDown(idx, e)}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                commit(mergeDramaTimelineEventsAt(shown, idx, dur));
              }}
              title="拖动分界：左右拉，总时长不变 · 双击合并"
            >
              <div
                className={`mx-auto h-full w-1 rounded-full ${isDark ? 'bg-white/95' : 'bg-gray-900'}`}
              />
            </div>
          );
        })
          : null}
      </div>
    </div>
  );
}
