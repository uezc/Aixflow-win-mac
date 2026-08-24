/**
 * 剧本分析工作台 — 单栏表格（可编辑 / 添加 / 删除）
 * Tabs：故事 / 视觉 / 声音 / 角色 / 场景 / 势力 / 道具 / 分镜脚本
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  DramaCharacterDossier,
  DramaDirectorSession,
  DramaEpisodeBible,
  DramaGender,
} from '../../../shared/directorDomain';
import {
  collectDramaEpisodeAppearingCharacterIds,
  createEmptyDramaCharacter,
  createEmptyDramaCharacterDossier,
  createEmptyDramaEpisodeBible,
  createEmptyDramaOrganization,
  createEmptyDramaProp,
  createEmptyDramaSceneAsset,
  createEmptyDramaShotSuggestion,
  createEmptyDramaVoice,
  DRAMA_CHARACTER_DOSSIER_FIELDS,
  formatDramaShotTimeEnv,
  normalizeShotDurationPaceStyle,
  parseDramaShotTimeEnv,
  recalculateShotSuggestionDurations,
  resolveSoundBible,
  resolveVisualBible,
  suggestionsNeedDurationInit,
  type ShotDurationPaceStyle,
} from '../../../shared/directorDomain';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { DurationToolbar, ShotDurationCell } from './ShotDurationCell';

function mutedCls(isDark: boolean) {
  return isDark ? 'text-white/55' : 'text-gray-500';
}

function cardCls(isDark: boolean) {
  return isDark
    ? 'rounded-xl border border-white/10 bg-white/[0.04]'
    : 'rounded-xl border border-gray-200 bg-white';
}

function tableWrapCls(isDark: boolean) {
  return isDark
    ? 'w-full border-collapse text-left text-[17px] [&_th]:border-b [&_th]:border-white/12 [&_td]:border-b [&_td]:border-white/8'
    : 'w-full border-collapse text-left text-[17px] [&_th]:border-b [&_th]:border-gray-200 [&_td]:border-b [&_td]:border-gray-100';
}

function thCls(isDark: boolean) {
  return `sticky top-0 z-[1] px-4 py-3.5 text-[15px] font-semibold whitespace-nowrap ${
    isDark ? 'bg-[#16181f] text-white/70' : 'bg-gray-50 text-gray-600'
  }`;
}

function tdCls() {
  return 'px-4 py-3.5 align-top break-words text-[17px] leading-[1.75]';
}

function fieldInputCls(isDark: boolean) {
  return `nodrag w-full min-h-[2.75rem] rounded-md px-2.5 py-2 text-[17px] leading-[1.7] outline-none ${
    isDark
      ? 'bg-white/[0.06] text-white placeholder:text-white/30 focus:bg-white/[0.1]'
      : 'bg-gray-50 text-gray-900 placeholder:text-gray-400 focus:bg-white'
  }`;
}

function addBtnCls(isDark: boolean) {
  return `nodrag mt-3 rounded-lg px-3.5 py-2 text-[14px] font-medium ${
    isDark
      ? 'border border-white/20 bg-white/[0.06] text-white/85 hover:bg-white/10'
      : 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
  }`;
}

function emptyDossier(): DramaCharacterDossier {
  return {
    code: '',
    character_type: '',
    age: '',
    identity: '',
    desire: '',
    fear: '',
    surface_personality: '',
    deep_personality: '',
    emotion_signals: '',
    signature_actions: '',
    dialogue_style: '',
    subtext_rule: '',
    relation_to_lead: '',
    scene_anchor: '',
    action_index: '',
  };
}

function delBtnCls(isDark: boolean) {
  return `nodrag shrink-0 rounded-md px-2 py-1 text-[13px] ${
    isDark ? 'text-rose-300/90 hover:bg-rose-500/15' : 'text-rose-600 hover:bg-rose-50'
  }`;
}

function AddCastBar({
  isDark,
  placeholder,
  submitLabel,
  hint,
  unnamed,
  existingNames,
  onAdd,
}: {
  isDark: boolean;
  placeholder: string;
  submitLabel: string;
  hint: string;
  unnamed: string;
  existingNames: string[];
  onAdd: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const name = draft.trim() || unnamed;
    if (draft.trim() && existingNames.includes(name)) {
      setDraft('');
      return;
    }
    onAdd(name);
    setDraft('');
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        className={`${fieldInputCls(isDark)} max-w-xs`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          submit();
        }}
      />
      <button
        type="button"
        className={addBtnCls(isDark).replace('mt-3 ', '')}
        onClick={submit}
      >
        {submitLabel}
      </button>
      <span className={`text-[13px] ${mutedCls(isDark)}`}>{hint}</span>
    </div>
  );
}

/** 本地编辑，失焦再写回 session，避免每键重绘整页 */
function DeferredInput({
  value,
  onCommit,
  className,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);
  return (
    <input
      className={className}
      value={local}
      placeholder={placeholder}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        focusedRef.current = false;
        if (local !== value) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function AutoTextarea({
  value,
  onChange,
  isDark,
  minRows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  isDark: boolean;
  minRows?: number;
}) {
  const [local, setLocal] = useState(value);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);
  return (
    <textarea
      className={`${fieldInputCls(isDark)} resize-y ${
        isDark ? 'custom-scrollbar-dark' : 'custom-scrollbar'
      }`}
      style={{ minHeight: `${Math.max(minRows, 2) * 1.75 + 1}rem` }}
      value={local}
      rows={minRows}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        focusedRef.current = false;
        if (local !== value) onChange(local);
      }}
    />
  );
}

/** 分镜表单元格：贴在表格里的纯文本，不要圆角底框、不要格内滚动条；失焦再提交 */
function ShotPlainCell({
  value,
  onChange,
  isDark,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  isDark: boolean;
  multiline?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [local, setLocal] = useState(value);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 22)}px`;
  }, [local]);
  const cls = `nodrag w-full max-w-full bg-transparent border-0 shadow-none rounded-none px-0 py-0 outline-none resize-none overflow-hidden break-words text-[14px] leading-[1.5] ${
    isDark ? 'text-white/90' : 'text-gray-900'
  }`;
  const commit = () => {
    focusedRef.current = false;
    if (local !== value) onChange(local);
  };
  if (!multiline) {
    return (
      <input
        className={cls}
        value={local}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }
  return (
    <textarea
      ref={ref}
      className={cls}
      rows={1}
      value={local}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
    />
  );
}

function ShotSubLabel({ isDark, children }: { isDark: boolean; children: React.ReactNode }) {
  return <div className={`mt-1 text-[10px] leading-tight ${mutedCls(isDark)}`}>{children}</div>;
}

function parseGender(raw: string): DramaGender {
  const s = String(raw || '').trim().toLowerCase();
  if (s === '男' || s === 'm' || s === 'male') return 'male';
  if (s === '女' || s === 'f' || s === 'female') return 'female';
  if (s === '其他' || s === 'other') return 'other';
  return '';
}

function formatGender(g: string, en: boolean): string {
  if (g === 'male') return en ? 'M' : '男';
  if (g === 'female') return en ? 'F' : '女';
  return g || '';
}

function parseAgeGender(raw: string): { age: string; gender: DramaGender } {
  const s = String(raw || '').trim();
  const parts = s.split(/[/／|｜]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { age: parts[0], gender: parseGender(parts[1]) };
  const g = parseGender(s);
  if (g) return { age: s.replace(/男|女|male|female|^m$|^f$/gi, '').trim(), gender: g };
  return { age: s, gender: '' };
}

function splitList(raw: string, sep: RegExp): string[] {
  return String(raw || '')
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
}

function withEpisodeBible(
  session: DramaDirectorSession,
  episodeId: string,
  mut: (b: DramaEpisodeBible) => DramaEpisodeBible,
  fallback?: DramaEpisodeBible | null,
): DramaDirectorSession {
  const id = String(episodeId || '').trim();
  if (!id) return session;
  const cur =
    session.episode_bibles?.[id] ||
    (fallback ? createEmptyDramaEpisodeBible({ ...fallback, episode_id: id }) : null);
  if (!cur) return session;
  return {
    ...session,
    episode_bibles: {
      ...session.episode_bibles,
      [id]: mut(createEmptyDramaEpisodeBible(cur)),
    },
  };
}

type KvRow = {
  id: string;
  label: string;
  value: string;
  labelLocked?: boolean;
  minRows?: number;
};

function EditableKvTable({
  isDark,
  rows,
  fieldLabel,
  valueLabel,
  addLabel,
  onChangeRows,
  onAdd,
}: {
  isDark: boolean;
  rows: KvRow[];
  fieldLabel: string;
  valueLabel: string;
  addLabel: string;
  onChangeRows: (rows: KvRow[]) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <table className={tableWrapCls(isDark)}>
        <thead>
          <tr>
            <th className={`${thCls(isDark)} w-[10.5rem]`}>{fieldLabel}</th>
            <th className={thCls(isDark)}>{valueLabel}</th>
            <th className={`${thCls(isDark)} w-[4.5rem] text-right`}> </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className={`${tdCls()} ${mutedCls(isDark)}`}>
                {r.labelLocked ? (
                  <span className="whitespace-nowrap">{r.label}</span>
                ) : (
                  <input
                    className={fieldInputCls(isDark)}
                    value={r.label}
                    placeholder="字段名"
                    onChange={(e) => {
                      const next = rows.map((x, idx) =>
                        idx === i ? { ...x, label: e.target.value } : x,
                      );
                      onChangeRows(next);
                    }}
                  />
                )}
              </td>
              <td className={tdCls()}>
                <AutoTextarea
                  isDark={isDark}
                  value={r.value}
                  minRows={r.minRows || 2}
                  onChange={(v) => {
                    const next = rows.map((x, idx) => (idx === i ? { ...x, value: v } : x));
                    onChangeRows(next);
                  }}
                />
              </td>
              <td className={`${tdCls()} text-right`}>
                <button
                  type="button"
                  className={delBtnCls(isDark)}
                  onClick={() => onChangeRows(rows.filter((_, idx) => idx !== i))}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className={addBtnCls(isDark)} onClick={onAdd}>
        {addLabel}
      </button>
    </div>
  );
}

const PROJECT_TABS = [
  'story',
  'visual',
  'sound',
  'characters',
  'scenes',
  'orgs',
  'props',
  'shots',
] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

export type AnalyzeDirectorWorkspaceProps = {
  session: DramaDirectorSession;
  episodeBible: DramaEpisodeBible;
  isDark: boolean;
  onChange?: (next: DramaDirectorSession) => void;
};

export const AnalyzeDirectorWorkspace: React.FC<AnalyzeDirectorWorkspaceProps> = ({
  session,
  episodeBible,
  isDark,
  onChange,
}) => {
  const { locale } = useAppLocale();
  const en = locale === 'en';
  const [tab, setTab] = useState<ProjectTab>('story');
  const [showOtherCast, setShowOtherCast] = useState(false);
  const [showDossier, setShowDossier] = useState(false);
  const visual = resolveVisualBible(session, episodeBible.episode_id);
  const sound = resolveSoundBible(session, episodeBible.episode_id);
  const story = session.bible.story;
  const bible = session.bible;
  const pvb = bible.projectVisualBible;
  const epId = episodeBible.episode_id;
  const appearingIds = useMemo(
    () => collectDramaEpisodeAppearingCharacterIds(session, epId),
    // 避免依赖整个 session 对象：每键入一次都会换引用导致无意义重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      epId,
      session.active_episode_id,
      session.bible.characters,
      session.scene_beats,
      session.episode_bibles?.[epId]?.directing_notes,
      session.episode_bibles?.[epId]?.shot_suggestions,
      session.episode_bibles?.[epId]?.visual_events,
    ],
  );
  const otherCastCount = useMemo(
    () =>
      appearingIds.size
        ? bible.characters.filter((c) => !appearingIds.has(c.character_id)).length
        : 0,
    [appearingIds, bible.characters],
  );
  const visibleCharacters = useMemo(() => {
    if (!appearingIds.size) return bible.characters;
    if (showOtherCast) return bible.characters;
    return bible.characters.filter((c) => appearingIds.has(c.character_id));
  }, [appearingIds, bible.characters, showOtherCast]);

  const commit = (next: DramaDirectorSession) => onChange?.(next);

  const durationPaceStyle = normalizeShotDurationPaceStyle(session.meta.durationPaceStyle);
  const durationTotalCapSec =
    Number(session.meta.durationTotalCapSec) > 0 ? Number(session.meta.durationTotalCapSec) : null;
  const durationSumSec = useMemo(() => {
    let sum = 0;
    for (const s of episodeBible.shot_suggestions || []) {
      const n = Number(s.duration_sec);
      if (Number.isFinite(n) && n > 0) sum += n;
    }
    return Math.round(sum * 10) / 10;
  }, [episodeBible.shot_suggestions]);

  const patchDurationMeta = (patch: {
    durationPaceStyle?: ShotDurationPaceStyle;
    durationTotalCapSec?: number | null;
  }) => {
    commit({
      ...session,
      meta: {
        ...session.meta,
        ...(patch.durationPaceStyle != null ? { durationPaceStyle: patch.durationPaceStyle } : {}),
        ...(patch.durationTotalCapSec !== undefined
          ? {
              durationTotalCapSec:
                patch.durationTotalCapSec != null && patch.durationTotalCapSec > 0
                  ? patch.durationTotalCapSec
                  : undefined,
            }
          : {}),
      },
    });
  };

  const recalculateDurations = () => {
    commit(
      withEpisodeBible(session, epId, (b) => ({
        ...b,
        shot_suggestions: recalculateShotSuggestionDurations(b.shot_suggestions || [], {
          paceStyle: durationPaceStyle,
          totalCapSec: durationTotalCapSec,
        }),
      })),
    );
  };

  /** 旧分镜无区间时：进表自动补一次（不覆盖已有 locked 秒数） */
  const durationInitKeyRef = useRef('');
  useEffect(() => {
    if (tab !== 'shots') return;
    const list = episodeBible.shot_suggestions || [];
    if (!list.length || !suggestionsNeedDurationInit(list)) return;
    const key = `${epId}:${list.map((s) => s.suggestion_id).join(',')}`;
    if (durationInitKeyRef.current === key) return;
    durationInitKeyRef.current = key;
    recalculateDurations();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在缺区间时补一次
  }, [tab, epId, episodeBible.shot_suggestions]);

  const t = useMemo(
    () =>
      en
        ? {
            projectHint: 'Click any cell to edit · Add / delete rows as needed',
            dnaPrompt: 'Project Visual Bible prompt',
            styleName: 'Style preset',
            tabs: {
              story: 'Story',
              visual: 'Visual',
              sound: 'Sound',
              characters: 'Cast',
              scenes: 'Scenes',
              orgs: 'Orgs',
              props: 'Props',
              shots: 'Shots',
            } as Record<ProjectTab, string>,
            worldview: 'Worldview',
            era: 'Era',
            synopsis: 'Synopsis',
            rules: 'Rules',
            forbidden: 'Forbidden',
            relations: 'Relationships',
            style: 'Style',
            color: 'Color',
            camera: 'Camera',
            lighting: 'Lighting',
            refs: 'Reference works',
            negative: 'Negative (asset gen)',
            voiceStyle: 'Voice style',
            emotion: 'Emotion range',
            music: 'Music style',
            ambient: 'Ambient',
            addRow: '+ Add row',
            addCharacter: '+ Add character',
            addCharacterHint: 'Type a name and add — for roles the analysis missed',
            addCharacterPlaceholder: 'e.g. Convenience store girl',
            addCharacterSubmit: 'Add',
            addScene: '+ Add scene',
            addOrg: '+ Add org',
            addProp: '+ Add prop',
            addShot: '+ Add shot',
            addVoice: '+ Add voice',
            unnamed: 'Untitled',
            lookPending: 'look TBD',
            vibePending: 'mood TBD',
            emotionPending: 'emotion TBD',
            shotsHint:
              'Unhappy? Use the buttons above to regenerate structure, or thicken existing rows from character dossiers (camera / action / emotion / sound). Time·Env = dawn/sunrise/noon/afternoon/dusk/night/late-night/daybreak · short setting note.',
            dossierTitle: 'Standard dossiers (optional)',
            dossierHint: 'Shot planning only. Looks stay in the table above.',
            dossierEmpty: 'No dossier yet. Optional: “Regenerate dossiers”.',
            dossierShow: 'Show dossiers',
            dossierHide: 'Hide dossiers',
            epCast: 'This episode',
            otherCast: 'Other episodes (keep look)',
            showOtherCast: 'Show other-episode cast',
            hideOtherCast: 'Hide other-episode cast',
            col: {
              field: 'Field',
              value: 'Value',
              name: 'Name',
              role: 'Role',
              identity: 'Identity',
              ageGender: 'Age / Gender',
              look: 'Look',
              note: 'Directing note',
              location: 'Location',
              time: 'Time',
              mood: 'Mood',
              prompt: 'Prompt',
              kind: 'Kind',
              desc: 'Description',
              scene: 'Scene',
              shot: 'Shot',
              size: 'Size',
              move: 'Move',
              action: 'Action',
              purpose: 'Intent',
              dialogue: 'Dialogue + subtext',
              emotionPlay: 'Actor emotion',
              subtext: 'Subtext',
              lighting: 'Light',
              timeEnv: 'Time · Env',
              blocking: 'Blocking',
              sfx: 'Sound design',
              duration: 'Sec',
              cast: 'Cast',
              character: 'Character',
              timbre: 'Timbre',
            },
          }
        : {
            projectHint: '单元格可直接改 · 支持添加 / 删除',
            dnaPrompt: 'Project Visual Bible Prompt',
            styleName: '视觉预设',
            tabs: {
              story: '故事',
              visual: '视觉',
              sound: '声音',
              characters: '角色',
              scenes: '场景',
              orgs: '势力',
              props: '道具',
              shots: '分镜脚本',
            } as Record<ProjectTab, string>,
            worldview: '世界观',
            era: '时代',
            synopsis: '剧情摘要',
            rules: '规则',
            forbidden: '禁用元素',
            relations: '人物关系',
            style: '风格',
            color: '色彩',
            camera: '摄影/镜头',
            lighting: '灯光',
            refs: '参考作品',
            negative: '禁用提示（资产生成）',
            voiceStyle: '声线取向',
            emotion: '情绪范围',
            music: '音乐风格',
            ambient: '环境声',
            addRow: '+ 添加一行',
            addCharacter: '+ 添加角色',
            addCharacterHint: '输入姓名即可添加分析漏掉的角色',
            addCharacterPlaceholder: '例如：便利店女孩',
            addCharacterSubmit: '添加',
            addScene: '+ 添加场景',
            addOrg: '+ 添加势力',
            addProp: '+ 添加道具',
            addShot: '+ 添加分镜',
            addVoice: '+ 添加音色',
            unnamed: '未命名',
            lookPending: '外貌待补',
            vibePending: '时空氛围待补',
            emotionPending: '情绪待补',
            shotsHint: '不满意用上方按钮整表重跑；已有人设时也可只加厚运镜/动作/情绪/声音，不改镜数。时段环境填：朦胧亮/日出/正午/下午/傍晚/晚上/深夜/黎明 · 环境简述。',
            dossierTitle: '标准化人设（可选）',
            dossierHint: '仅供自动拆镜；平时可收起。外貌看上表。',
            dossierEmpty: '还没有人设表。可选：点「重新生成人设」。',
            dossierShow: '展开人设',
            dossierHide: '收起人设',
            epCast: '本集出场',
            otherCast: '其他集（沿用定妆）',
            showOtherCast: '显示其他集人物',
            hideOtherCast: '收起其他集人物',
            col: {
              field: '字段',
              value: '内容',
              name: '名称',
              role: '角色定位',
              identity: '身份',
              ageGender: '年龄/性别',
              look: '外形摘要',
              note: '导演备注',
              location: '地点',
              time: '时空',
              mood: '氛围',
              prompt: '提示词',
              kind: '类型',
              desc: '描述',
              scene: '场',
              shot: '镜',
              size: '景别',
              move: '运镜',
              action: '画面动作',
              purpose: '镜头目的',
              dialogue: '对白+潜台词',
              emotionPlay: '演员情绪',
              subtext: '潜台词',
              lighting: '光线',
              timeEnv: '时段环境',
              blocking: '构图/站位',
              sfx: '声音设计',
              duration: '秒',
              cast: '出场',
              character: '角色',
              timbre: '音色',
            },
          },
    [en],
  );

  const storyRows: KvRow[] = [
    { id: 'worldview', label: t.worldview, value: story?.worldview || '', labelLocked: true, minRows: 3 },
    { id: 'era', label: t.era, value: story?.era || '', labelLocked: true },
    {
      id: 'synopsis',
      label: t.synopsis,
      value: story?.synopsis || bible.plot || '',
      labelLocked: true,
      minRows: 4,
    },
    ...(story?.rules || []).map((value, i) => ({
      id: `rule-${i}`,
      label: t.rules,
      value,
      labelLocked: true,
    })),
    ...(story?.forbidden_elements || []).map((value, i) => ({
      id: `forbid-${i}`,
      label: t.forbidden,
      value,
      labelLocked: true,
    })),
    {
      id: 'relations',
      label: t.relations,
      value: bible.relationships || '',
      labelLocked: true,
      minRows: 3,
    },
    ...(story?.extra_fields || []).map((x, i) => ({
      id: `extra-${i}`,
      label: x.label || '',
      value: x.value || '',
    })),
  ];

  const applyStoryRows = (rows: KvRow[]) => {
    const rules: string[] = [];
    const forbidden: string[] = [];
    const extras: ExtraField[] = [];
    let worldview = '';
    let era = '';
    let synopsis = '';
    let relations = bible.relationships || '';
    for (const r of rows) {
      if (r.id === 'worldview') worldview = r.value;
      else if (r.id === 'era') era = r.value;
      else if (r.id === 'synopsis') synopsis = r.value;
      else if (r.id === 'relations') relations = r.value;
      else if (r.id.startsWith('rule-')) rules.push(r.value);
      else if (r.id.startsWith('forbid-')) forbidden.push(r.value);
      else extras.push({ label: r.label, value: r.value });
    }
    commit({
      ...session,
      bible: {
        ...bible,
        plot: synopsis || bible.plot,
        relationships: relations,
        story: {
          ...story,
          worldview,
          era,
          synopsis,
          rules,
          forbidden_elements: forbidden,
          extra_fields: extras,
        },
        project: {
          ...bible.project,
          worldview: worldview || bible.project.worldview,
          era: era || bible.project.era,
        },
      },
    });
  };

  const visualRows: KvRow[] = [
    {
      id: 'styleName',
      label: t.styleName,
      value: pvb?.presetName || pvb?.presetId || '',
      labelLocked: true,
    },
    {
      id: 'dnaPrompt',
      label: t.dnaPrompt,
      value: pvb?.stylePrompt || visual.style || '',
      labelLocked: true,
      minRows: 3,
    },
    { id: 'style', label: t.style, value: visual.style || '', labelLocked: true },
    { id: 'color', label: t.color, value: visual.color || '', labelLocked: true },
    { id: 'camera', label: t.camera, value: visual.camera || '', labelLocked: true },
    { id: 'lighting', label: t.lighting, value: visual.lighting || '', labelLocked: true },
    {
      id: 'refs',
      label: t.refs,
      value: (visual.referenceWorks || []).join(' · '),
      labelLocked: true,
    },
    { id: 'negative', label: t.negative, value: visual.negativePrompt || '', labelLocked: true },
    ...(visual.extra_fields || []).map((x, i) => ({
      id: `vextra-${i}`,
      label: x.label || '',
      value: x.value || '',
    })),
  ];

  const applyVisualRows = (rows: KvRow[]) => {
    const extras: ExtraField[] = [];
    const pick = (id: string) => rows.find((r) => r.id === id)?.value || '';
    for (const r of rows) {
      if (r.id.startsWith('vextra-') || (!r.labelLocked && r.id.startsWith('vextra'))) {
        extras.push({ label: r.label, value: r.value });
      } else if (!r.labelLocked) extras.push({ label: r.label, value: r.value });
    }
    const nextVisual = {
      ...visual,
      style: pick('style'),
      color: pick('color'),
      camera: pick('camera'),
      lighting: pick('lighting'),
      referenceWorks: splitList(pick('refs'), /[·|,，、]/),
      negativePrompt: pick('negative'),
      extra_fields: extras,
    };
    let next: DramaDirectorSession = {
      ...session,
      bible: {
        ...bible,
        visual: nextVisual,
        projectVisualBible: {
          ...pvb,
          presetName: pick('styleName') || pvb?.presetName,
          stylePrompt: pick('dnaPrompt') || pvb?.stylePrompt,
        },
      },
    };
    if (session.episode_bibles?.[epId]?.visual_override) {
      next = withEpisodeBible(next, epId, (b) => ({ ...b, visual_override: nextVisual }));
    }
    commit(next);
  };

  const soundRows: KvRow[] = [
    { id: 'voiceStyle', label: t.voiceStyle, value: sound.voiceStyle || '', labelLocked: true },
    { id: 'emotion', label: t.emotion, value: sound.emotionRange || '', labelLocked: true },
    { id: 'music', label: t.music, value: sound.musicStyle || '', labelLocked: true },
    {
      id: 'ambient',
      label: t.ambient,
      value: (sound.ambientSound || []).join(' · '),
      labelLocked: true,
    },
    ...(sound.extra_fields || []).map((x, i) => ({
      id: `sextra-${i}`,
      label: x.label || '',
      value: x.value || '',
    })),
  ];

  const applySoundRows = (rows: KvRow[]) => {
    const extras: ExtraField[] = [];
    const pick = (id: string) => rows.find((r) => r.id === id)?.value || '';
    for (const r of rows) {
      if (!r.labelLocked) extras.push({ label: r.label, value: r.value });
    }
    const nextSound = {
      ...sound,
      voiceStyle: pick('voiceStyle'),
      emotionRange: pick('emotion'),
      musicStyle: pick('music'),
      ambientSound: splitList(pick('ambient'), /[·|,，、]/),
      extra_fields: extras,
    };
    let next: DramaDirectorSession = {
      ...session,
      bible: { ...bible, sound: nextSound },
    };
    if (session.episode_bibles?.[epId]?.sound_override) {
      next = withEpisodeBible(next, epId, (b) => ({ ...b, sound_override: nextSound }));
    }
    commit(next);
  };

  return (
    <div className={`flex flex-col min-h-0 h-full text-[17px] ${cardCls(isDark)} p-5`}>
      <div className="shrink-0 flex items-center justify-between gap-2 mb-3">
        <div className={`text-[15px] ${mutedCls(isDark)}`}>{t.projectHint}</div>
      </div>
      <div className="shrink-0 flex flex-wrap gap-2 mb-4">
        {PROJECT_TABS.map((key) => (
          <button
            key={key}
            type="button"
            className={`nodrag rounded-lg px-3.5 py-2 text-[15px] ${
              tab === key
                ? isDark
                  ? 'bg-sky-500/30 text-sky-100'
                  : 'bg-sky-100 text-sky-900'
                : isDark
                  ? 'bg-white/5 hover:bg-white/10'
                  : 'bg-gray-100 hover:bg-gray-200'
            }`}
            onClick={() => setTab(key)}
          >
            {t.tabs[key]}
          </button>
        ))}
      </div>
      <div
        className={`flex-1 min-h-0 pr-1 ${
          tab === 'shots'
            ? 'overflow-y-auto overflow-x-hidden'
            : 'overflow-auto custom-scrollbar-dark'
        }`}
      >
        {tab === 'story' ? (
          <EditableKvTable
            isDark={isDark}
            fieldLabel={t.col.field}
            valueLabel={t.col.value}
            addLabel={t.addRow}
            rows={storyRows}
            onChangeRows={applyStoryRows}
            onAdd={() =>
              applyStoryRows([...storyRows, { id: `extra-${Date.now()}`, label: '', value: '' }])
            }
          />
        ) : null}

        {tab === 'visual' ? (
          <EditableKvTable
            isDark={isDark}
            fieldLabel={t.col.field}
            valueLabel={t.col.value}
            addLabel={t.addRow}
            rows={visualRows}
            onChangeRows={applyVisualRows}
            onAdd={() =>
              applyVisualRows([...visualRows, { id: `vextra-${Date.now()}`, label: '', value: '' }])
            }
          />
        ) : null}

        {tab === 'sound' ? (
          <div className="space-y-5">
            <EditableKvTable
              isDark={isDark}
              fieldLabel={t.col.field}
              valueLabel={t.col.value}
              addLabel={t.addRow}
              rows={soundRows}
              onChangeRows={applySoundRows}
              onAdd={() =>
                applySoundRows([...soundRows, { id: `sextra-${Date.now()}`, label: '', value: '' }])
              }
            />
            <table className={tableWrapCls(isDark)}>
              <thead>
                <tr>
                  <th className={thCls(isDark)}>{t.col.character}</th>
                  <th className={thCls(isDark)}>{t.col.timbre}</th>
                  <th className={thCls(isDark)}>{t.emotion}</th>
                  <th className={`${thCls(isDark)} w-[4.5rem]`} />
                </tr>
              </thead>
              <tbody>
                {bible.voices.map((v) => {
                  const ch = bible.characters.find((c) => c.character_id === v.character_id);
                  return (
                    <tr key={v.voice_id}>
                      <td className={tdCls()}>{ch?.name || (en ? 'Character voice' : '角色音色')}</td>
                      <td className={tdCls()}>
                        <AutoTextarea
                          isDark={isDark}
                          value={v.voiceStyle || v.timbre || ''}
                          onChange={(val) =>
                            commit({
                              ...session,
                              bible: {
                                ...bible,
                                voices: bible.voices.map((x) =>
                                  x.voice_id === v.voice_id
                                    ? { ...x, voiceStyle: val, timbre: val }
                                    : x,
                                ),
                              },
                            })
                          }
                        />
                      </td>
                      <td className={tdCls()}>
                        <AutoTextarea
                          isDark={isDark}
                          value={v.emotion_range || ''}
                          onChange={(val) =>
                            commit({
                              ...session,
                              bible: {
                                ...bible,
                                voices: bible.voices.map((x) =>
                                  x.voice_id === v.voice_id ? { ...x, emotion_range: val } : x,
                                ),
                              },
                            })
                          }
                        />
                      </td>
                      <td className={`${tdCls()} text-right`}>
                        <button
                          type="button"
                          className={delBtnCls(isDark)}
                          onClick={() =>
                            commit({
                              ...session,
                              bible: {
                                ...bible,
                                voices: bible.voices.filter((x) => x.voice_id !== v.voice_id),
                                characters: bible.characters.map((c) =>
                                  c.voice_id === v.voice_id ? { ...c, voice_id: '' } : c,
                                ),
                              },
                            })
                          }
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              type="button"
              className={addBtnCls(isDark)}
              onClick={() => {
                const voice = createEmptyDramaVoice({
                  character_id: bible.characters[0]?.character_id || '',
                });
                commit({
                  ...session,
                  bible: { ...bible, voices: [...bible.voices, voice] },
                });
              }}
            >
              {t.addVoice}
            </button>
          </div>
        ) : null}

        {tab === 'characters' ? (
          <div>
            {appearingIds.size > 0 && otherCastCount > 0 ? (
              <div className={`mb-2 flex items-center justify-between gap-2 text-[13px] ${mutedCls(isDark)}`}>
                <span>
                  {t.epCast} {visibleCharacters.filter((c) => appearingIds.has(c.character_id)).length}
                  {showOtherCast ? ` · ${t.otherCast} ${otherCastCount}` : ''}
                </span>
                <button
                  type="button"
                  className={`nodrag rounded-md px-2 py-1 ${
                    isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                  onClick={() => setShowOtherCast((v) => !v)}
                >
                  {showOtherCast ? t.hideOtherCast : `${t.showOtherCast}（${otherCastCount}）`}
                </button>
              </div>
            ) : null}
            <table className={tableWrapCls(isDark)}>
              <thead>
                <tr>
                  <th className={thCls(isDark)}>{t.col.name}</th>
                  <th className={thCls(isDark)}>{t.col.role}</th>
                  <th className={thCls(isDark)}>{t.col.identity}</th>
                  <th className={thCls(isDark)}>{t.col.ageGender}</th>
                  <th className={`${thCls(isDark)} min-w-[14rem]`}>{t.col.look}</th>
                  <th className={thCls(isDark)}>{t.col.note}</th>
                  <th className={`${thCls(isDark)} w-[4.5rem]`} />
                </tr>
              </thead>
              <tbody>
                {visibleCharacters.map((c) => {
                  const note = episodeBible.directing_notes.find(
                    (d) => d.character_id === c.character_id,
                  );
                  const look =
                    String(c.prompt || '').trim() ||
                    [c.visual?.face, c.visual?.hair, c.visual?.clothing]
                      .map((x) => String(x || '').trim())
                      .filter(Boolean)
                      .join(' · ') ||
                    '';
                  const gender = formatGender(c.gender, en);
                  const patchChar = (patch: Partial<typeof c>) =>
                    commit({
                      ...session,
                      bible: {
                        ...bible,
                        characters: bible.characters.map((x) =>
                          x.character_id === c.character_id ? { ...x, ...patch } : x,
                        ),
                      },
                    });
                  return (
                    <tr key={c.character_id}>
                      <td className={tdCls()}>
                        <DeferredInput
                          className={fieldInputCls(isDark)}
                          value={c.name}
                          onCommit={(val) => patchChar({ name: val })}
                        />
                      </td>
                      <td className={tdCls()}>
                        <DeferredInput
                          className={fieldInputCls(isDark)}
                          value={c.role}
                          onCommit={(val) => patchChar({ role: val })}
                        />
                      </td>
                      <td className={tdCls()}>
                        <DeferredInput
                          className={fieldInputCls(isDark)}
                          value={c.identity}
                          onCommit={(val) => patchChar({ identity: val })}
                        />
                      </td>
                      <td className={tdCls()}>
                        <DeferredInput
                          className={fieldInputCls(isDark)}
                          value={[c.age, gender].filter(Boolean).join(' / ')}
                          onCommit={(val) => {
                            const parsed = parseAgeGender(val);
                            patchChar({ age: parsed.age, gender: parsed.gender });
                          }}
                        />
                      </td>
                      <td className={tdCls()}>
                        <AutoTextarea
                          isDark={isDark}
                          minRows={3}
                          value={look}
                          onChange={(val) => patchChar({ prompt: val })}
                        />
                      </td>
                      <td className={tdCls()}>
                        <AutoTextarea
                          isDark={isDark}
                          value={note?.positioning || note?.performance_focus || ''}
                          onChange={(val) =>
                            commit(
                              withEpisodeBible(
                                session,
                                epId,
                                (b) => {
                                  const notes = [...(b.directing_notes || [])];
                                  const idx = notes.findIndex(
                                    (d) => d.character_id === c.character_id,
                                  );
                                  const row = {
                                    character_id: c.character_id,
                                    name: c.name,
                                    positioning: val,
                                    episode_goal: idx >= 0 ? notes[idx].episode_goal : '',
                                    psychological_arc:
                                      idx >= 0 ? notes[idx].psychological_arc : '',
                                    key_actions: idx >= 0 ? notes[idx].key_actions : '',
                                    performance_focus: val,
                                    relationship_changes:
                                      idx >= 0 ? notes[idx].relationship_changes : '',
                                    dossier: idx >= 0 ? notes[idx].dossier : undefined,
                                  };
                                  if (idx >= 0) notes[idx] = { ...notes[idx], ...row };
                                  else notes.push(row);
                                  return { ...b, directing_notes: notes };
                                },
                                episodeBible,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className={`${tdCls()} text-right`}>
                        <button
                          type="button"
                          className={delBtnCls(isDark)}
                          onClick={() =>
                            commit({
                              ...session,
                              bible: {
                                ...bible,
                                characters: bible.characters.filter(
                                  (x) => x.character_id !== c.character_id,
                                ),
                                voices: bible.voices.filter(
                                  (v) => v.character_id !== c.character_id,
                                ),
                              },
                            })
                          }
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <AddCastBar
              isDark={isDark}
              placeholder={t.addCharacterPlaceholder}
              submitLabel={t.addCharacterSubmit}
              hint={t.addCharacterHint}
              unnamed={t.unnamed}
              existingNames={bible.characters.map((c) => String(c.name || '').trim()).filter(Boolean)}
              onAdd={(name) => {
                const ch = createEmptyDramaCharacter({
                  name,
                  role: '',
                  identity: '',
                });
                const noteRow = {
                  character_id: ch.character_id,
                  name,
                  positioning: '',
                  episode_goal: '',
                  psychological_arc: '',
                  key_actions: '',
                  performance_focus: '',
                  relationship_changes: '',
                };
                let next: DramaDirectorSession = {
                  ...session,
                  bible: {
                    ...bible,
                    characters: [...bible.characters, ch],
                  },
                };
                next = withEpisodeBible(
                  next,
                  epId,
                  (b) => {
                    const notes = [...(b.directing_notes || [])];
                    if (!notes.some((d) => d.character_id === ch.character_id)) {
                      notes.push(noteRow);
                    }
                    return { ...b, directing_notes: notes };
                  },
                  episodeBible,
                );
                commit(next);
              }}
            />
            <div className="mt-6 flex items-center gap-2 flex-wrap">
              <div className={`text-[15px] font-semibold ${isDark ? 'text-white/90' : 'text-gray-900'}`}>
                {t.dossierTitle}
              </div>
              <span className={`text-[13px] ${mutedCls(isDark)}`}>{t.dossierHint}</span>
              <button
                type="button"
                className={`nodrag rounded-md px-2 py-1 text-[13px] ${
                  isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-gray-100 hover:bg-gray-200'
                }`}
                onClick={() => setShowDossier((v) => !v)}
              >
                {showDossier ? t.dossierHide : t.dossierShow}
              </button>
            </div>
            {showDossier ? (
              <>
            {bible.characters.every((c) => {
              const note = episodeBible.directing_notes.find((d) => d.character_id === c.character_id);
              return !note?.dossier;
            }) ? (
              <p className={`mt-2 text-[14px] ${mutedCls(isDark)}`}>{t.dossierEmpty}</p>
            ) : null}
            <div className="mt-3 grid gap-4">
              {visibleCharacters.map((c) => {
                const note = episodeBible.directing_notes.find((d) => d.character_id === c.character_id);
                const dossier = { ...emptyDossier(), ...(note?.dossier || {}) };
                return (
                  <div key={`dossier-${c.character_id}`} className={cardCls(isDark)}>
                    <div
                      className={`px-3 py-2 text-[15px] font-medium ${
                        isDark ? 'border-b border-white/10' : 'border-b border-gray-200'
                      }`}
                    >
                      {c.name || t.unnamed}
                      {dossier.code ? (
                        <span className={`ml-2 text-[13px] font-normal ${mutedCls(isDark)}`}>
                          {dossier.code}
                        </span>
                      ) : null}
                    </div>
                    <table className={tableWrapCls(isDark)}>
                      <thead>
                        <tr>
                          <th className={`${thCls(isDark)} w-[9.5rem]`}>{t.col.field}</th>
                          <th className={thCls(isDark)}>{t.col.value}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {DRAMA_CHARACTER_DOSSIER_FIELDS.map((f) => (
                          <tr key={f.key}>
                            <td className={`${tdCls()} ${mutedCls(isDark)}`}>
                              {en ? f.labelEn : f.label}
                            </td>
                            <td className={tdCls()}>
                              <AutoTextarea
                                isDark={isDark}
                                minRows={f.key === 'emotion_signals' || f.key === 'signature_actions' ? 3 : 2}
                                value={dossier[f.key] || ''}
                                onChange={(val) =>
                                  commit(
                                    withEpisodeBible(
                                      session,
                                      epId,
                                      (b) => {
                                      const notes = [...(b.directing_notes || [])];
                                      const idx = notes.findIndex(
                                        (d) => d.character_id === c.character_id,
                                      );
                                      const prev = idx >= 0 ? notes[idx] : {
                                        character_id: c.character_id,
                                        name: c.name,
                                        positioning: '',
                                        episode_goal: '',
                                        psychological_arc: '',
                                        key_actions: '',
                                        performance_focus: '',
                                        relationship_changes: '',
                                      };
                                      const nextDossier =
                                        createEmptyDramaCharacterDossier({
                                          ...emptyDossier(),
                                          ...(prev.dossier || {}),
                                          [f.key]: val,
                                        }) || { ...emptyDossier(), [f.key]: val };
                                      const row = {
                                        ...prev,
                                        name: c.name,
                                        dossier: nextDossier,
                                      };
                                      if (idx >= 0) notes[idx] = row;
                                      else notes.push(row);
                                      return { ...b, directing_notes: notes };
                                    },
                                      episodeBible,
                                    ),
                                  )
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
              </>
            ) : null}
          </div>
        ) : null}

        {tab === 'scenes' ? (
          <div>
            <table className={tableWrapCls(isDark)}>
              <thead>
                <tr>
                  <th className={thCls(isDark)}>{t.col.name}</th>
                  <th className={thCls(isDark)}>{t.col.location}</th>
                  <th className={thCls(isDark)}>{t.col.time}</th>
                  <th className={thCls(isDark)}>{t.col.mood}</th>
                  <th className={`${thCls(isDark)} min-w-[14rem]`}>{t.col.prompt}</th>
                  <th className={`${thCls(isDark)} w-[4.5rem]`} />
                </tr>
              </thead>
              <tbody>
                {bible.scenes.map((s) => (
                  <tr key={s.scene_id}>
                    <td className={tdCls()}>
                      <input
                        className={fieldInputCls(isDark)}
                        value={s.name}
                        onChange={(e) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              scenes: bible.scenes.map((x) =>
                                x.scene_id === s.scene_id ? { ...x, name: e.target.value } : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={tdCls()}>
                      <input
                        className={fieldInputCls(isDark)}
                        value={s.location || ''}
                        onChange={(e) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              scenes: bible.scenes.map((x) =>
                                x.scene_id === s.scene_id ? { ...x, location: e.target.value } : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={tdCls()}>
                      <input
                        className={fieldInputCls(isDark)}
                        value={[s.time_default, s.weather_default].filter(Boolean).join(' · ')}
                        onChange={(e) => {
                          const parts = e.target.value.split(/[·|]/).map((x) => x.trim());
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              scenes: bible.scenes.map((x) =>
                                x.scene_id === s.scene_id
                                  ? {
                                      ...x,
                                      time_default: parts[0] || '',
                                      weather_default: parts.slice(1).join(' · '),
                                    }
                                  : x,
                              ),
                            },
                          });
                        }}
                      />
                    </td>
                    <td className={tdCls()}>
                      <input
                        className={fieldInputCls(isDark)}
                        value={s.mood || ''}
                        onChange={(e) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              scenes: bible.scenes.map((x) =>
                                x.scene_id === s.scene_id ? { ...x, mood: e.target.value } : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={tdCls()}>
                      <AutoTextarea
                        isDark={isDark}
                        minRows={3}
                        value={s.prompt || s.lighting || s.spatial_structure || ''}
                        onChange={(val) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              scenes: bible.scenes.map((x) =>
                                x.scene_id === s.scene_id ? { ...x, prompt: val } : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={`${tdCls()} text-right`}>
                      <button
                        type="button"
                        className={delBtnCls(isDark)}
                        onClick={() =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              scenes: bible.scenes.filter((x) => x.scene_id !== s.scene_id),
                            },
                          })
                        }
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className={addBtnCls(isDark)}
              onClick={() =>
                commit({
                  ...session,
                  bible: {
                    ...bible,
                    scenes: [...bible.scenes, createEmptyDramaSceneAsset({ name: t.unnamed })],
                  },
                })
              }
            >
              {t.addScene}
            </button>
          </div>
        ) : null}

        {tab === 'orgs' ? (
          <div>
            <table className={tableWrapCls(isDark)}>
              <thead>
                <tr>
                  <th className={thCls(isDark)}>{t.col.name}</th>
                  <th className={thCls(isDark)}>{t.col.kind}</th>
                  <th className={thCls(isDark)}>{t.col.desc}</th>
                  <th className={`${thCls(isDark)} w-[4.5rem]`} />
                </tr>
              </thead>
              <tbody>
                {bible.organizations.map((o) => (
                  <tr key={o.organization_id}>
                    <td className={tdCls()}>
                      <input
                        className={fieldInputCls(isDark)}
                        value={o.name}
                        onChange={(e) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              organizations: bible.organizations.map((x) =>
                                x.organization_id === o.organization_id
                                  ? { ...x, name: e.target.value }
                                  : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={tdCls()}>
                      <input
                        className={fieldInputCls(isDark)}
                        value={o.kind}
                        onChange={(e) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              organizations: bible.organizations.map((x) =>
                                x.organization_id === o.organization_id
                                  ? { ...x, kind: e.target.value }
                                  : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={tdCls()}>
                      <AutoTextarea
                        isDark={isDark}
                        value={o.description || o.visual_traits || ''}
                        onChange={(val) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              organizations: bible.organizations.map((x) =>
                                x.organization_id === o.organization_id
                                  ? { ...x, description: val }
                                  : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={`${tdCls()} text-right`}>
                      <button
                        type="button"
                        className={delBtnCls(isDark)}
                        onClick={() =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              organizations: bible.organizations.filter(
                                (x) => x.organization_id !== o.organization_id,
                              ),
                            },
                          })
                        }
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className={addBtnCls(isDark)}
              onClick={() =>
                commit({
                  ...session,
                  bible: {
                    ...bible,
                    organizations: [
                      ...bible.organizations,
                      createEmptyDramaOrganization({ name: t.unnamed }),
                    ],
                  },
                })
              }
            >
              {t.addOrg}
            </button>
          </div>
        ) : null}

        {tab === 'props' ? (
          <div>
            <table className={tableWrapCls(isDark)}>
              <thead>
                <tr>
                  <th className={thCls(isDark)}>{t.col.name}</th>
                  <th className={thCls(isDark)}>{t.col.desc}</th>
                  <th className={thCls(isDark)}>{t.col.prompt}</th>
                  <th className={`${thCls(isDark)} w-[4.5rem]`} />
                </tr>
              </thead>
              <tbody>
                {bible.props.map((p) => (
                  <tr key={p.prop_id}>
                    <td className={tdCls()}>
                      <input
                        className={fieldInputCls(isDark)}
                        value={p.name}
                        onChange={(e) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              props: bible.props.map((x) =>
                                x.prop_id === p.prop_id ? { ...x, name: e.target.value } : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={tdCls()}>
                      <AutoTextarea
                        isDark={isDark}
                        value={p.description || ''}
                        onChange={(val) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              props: bible.props.map((x) =>
                                x.prop_id === p.prop_id ? { ...x, description: val } : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={tdCls()}>
                      <AutoTextarea
                        isDark={isDark}
                        value={p.prompt || ''}
                        onChange={(val) =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              props: bible.props.map((x) =>
                                x.prop_id === p.prop_id ? { ...x, prompt: val } : x,
                              ),
                            },
                          })
                        }
                      />
                    </td>
                    <td className={`${tdCls()} text-right`}>
                      <button
                        type="button"
                        className={delBtnCls(isDark)}
                        onClick={() =>
                          commit({
                            ...session,
                            bible: {
                              ...bible,
                              props: bible.props.filter((x) => x.prop_id !== p.prop_id),
                            },
                          })
                        }
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className={addBtnCls(isDark)}
              onClick={() =>
                commit({
                  ...session,
                  bible: {
                    ...bible,
                    props: [...bible.props, createEmptyDramaProp({ name: t.unnamed })],
                  },
                })
              }
            >
              {t.addProp}
            </button>
          </div>
        ) : null}

        {tab === 'shots' ? (
          <div className="overflow-x-hidden">
            <p className={`mt-3 mb-3 text-[13px] ${mutedCls(isDark)}`}>{t.shotsHint}</p>
            <DurationToolbar
              isDark={isDark}
              totalCapSec={durationTotalCapSec}
              paceStyle={durationPaceStyle}
              sumSec={durationSumSec}
              onCapChange={(cap) => patchDurationMeta({ durationTotalCapSec: cap })}
              onPaceChange={(pace) => patchDurationMeta({ durationPaceStyle: pace })}
              onRecalculate={recalculateDurations}
            />
            <table
              className={`w-full table-fixed border-collapse text-left text-[14px] leading-[1.5] ${
                isDark
                  ? '[&_th]:border-b [&_th]:border-white/15 [&_td]:border-b [&_td]:border-white/8'
                  : '[&_th]:border-b [&_th]:border-gray-200 [&_td]:border-b [&_td]:border-gray-100'
              }`}
            >
              <colgroup>
                <col className="w-[3%]" />
                <col className="w-[6%]" />
                <col className="w-[7%]" />
                <col className="w-[3%]" />
                <col className="w-[5%]" />
                <col className="w-[9%]" />
                <col className="w-[6%]" />
                <col className="w-[11%]" />
                <col className="w-[7%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[5%]" />
                <col className="w-[5%]" />
                <col className="w-[5%]" />
                <col className="w-[7%]" />
                <col className="w-[4%]" />
              </colgroup>
              <thead>
                <tr>
                  {(
                    [
                      '#',
                      t.col.scene,
                      t.col.timeEnv,
                      t.col.shot,
                      t.col.size,
                      t.col.move,
                      t.col.blocking,
                      t.col.action,
                      t.col.emotionPlay,
                      t.col.dialogue,
                      t.col.purpose,
                      t.col.lighting,
                      t.col.sfx,
                      t.col.cast,
                      t.col.duration,
                      '',
                    ] as const
                  ).map((label, i) => (
                    <th
                      key={i}
                      className={`sticky top-0 z-[1] px-1.5 py-2 text-[12px] font-semibold whitespace-normal break-words ${
                        isDark ? 'bg-[#16181f] text-white/65' : 'bg-gray-50 text-gray-600'
                      } ${i === 15 ? 'text-right' : ''}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {episodeBible.shot_suggestions.map((s, i) => (
                  <tr key={s.suggestion_id || i}>
                    <td className={`px-1.5 py-2 align-top break-words ${mutedCls(isDark)}`}>{i + 1}</td>
                    <td className="px-1.5 py-2 align-top break-words">
                      <ShotPlainCell
                        isDark={isDark}
                        value={s.scene}
                        onChange={(v) =>
                          commit(
                            withEpisodeBible(session, epId, (b) => ({
                              ...b,
                              shot_suggestions: b.shot_suggestions.map((x) =>
                                x.suggestion_id === s.suggestion_id ? { ...x, scene: v } : x,
                              ),
                            })),
                          )
                        }
                      />
                    </td>
                    <td className="px-1.5 py-2 align-top break-words">
                      <ShotPlainCell
                        isDark={isDark}
                        multiline
                        value={formatDramaShotTimeEnv(s.time_of_day || '', s.environment || '')}
                        onChange={(v) => {
                          const parsed = parseDramaShotTimeEnv(v);
                          commit(
                            withEpisodeBible(session, epId, (b) => ({
                              ...b,
                              shot_suggestions: b.shot_suggestions.map((x) =>
                                x.suggestion_id === s.suggestion_id
                                  ? {
                                      ...x,
                                      time_of_day: parsed.time_of_day,
                                      environment: parsed.environment,
                                    }
                                  : x,
                              ),
                            })),
                          );
                        }}
                      />
                    </td>
                    {(
                      [
                        ['shot', s.shot, false],
                        ['size', s.size, false],
                        ['move', s.move || s.camera, true],
                        ['blocking', s.blocking || '', true],
                        ['action', s.action, true],
                        ['emotion_play', s.emotion_play || '', true],
                      ] as const
                    ).map(([key, val, multiline]) => (
                      <td key={key} className="px-1.5 py-2 align-top break-words">
                        <ShotPlainCell
                          isDark={isDark}
                          multiline={multiline}
                          value={val}
                          onChange={(v) =>
                            commit(
                              withEpisodeBible(session, epId, (b) => ({
                                ...b,
                                shot_suggestions: b.shot_suggestions.map((x) => {
                                  if (x.suggestion_id !== s.suggestion_id) return x;
                                  if (key === 'shot') return { ...x, shot: v };
                                  if (key === 'size') return { ...x, size: v };
                                  if (key === 'move') return { ...x, move: v };
                                  if (key === 'blocking') return { ...x, blocking: v };
                                  if (key === 'action') return { ...x, action: v };
                                  return { ...x, emotion_play: v };
                                }),
                              })),
                            )
                          }
                        />
                      </td>
                    ))}
                    <td className="px-1.5 py-2 align-top break-words">
                      <ShotPlainCell
                        isDark={isDark}
                        multiline
                        value={s.dialogue}
                        onChange={(v) =>
                          commit(
                            withEpisodeBible(session, epId, (b) => ({
                              ...b,
                              shot_suggestions: b.shot_suggestions.map((x) =>
                                x.suggestion_id === s.suggestion_id ? { ...x, dialogue: v } : x,
                              ),
                            })),
                          )
                        }
                      />
                      <ShotSubLabel isDark={isDark}>{en ? 'subtext' : '潜'}</ShotSubLabel>
                      <ShotPlainCell
                        isDark={isDark}
                        multiline
                        value={s.subtext || ''}
                        onChange={(v) =>
                          commit(
                            withEpisodeBible(session, epId, (b) => ({
                              ...b,
                              shot_suggestions: b.shot_suggestions.map((x) =>
                                x.suggestion_id === s.suggestion_id ? { ...x, subtext: v } : x,
                              ),
                            })),
                          )
                        }
                      />
                    </td>
                    {(
                      [
                        ['purpose', s.purpose, true],
                        ['lighting', s.lighting || '', true],
                        ['sound', s.sound || '', true],
                        ['cast', (s.cast_names || []).join('、'), false],
                      ] as const
                    ).map(([key, val, multiline]) => (
                      <td key={key} className="px-1.5 py-2 align-top break-words">
                        <ShotPlainCell
                          isDark={isDark}
                          multiline={multiline}
                          value={val}
                          onChange={(v) =>
                            commit(
                              withEpisodeBible(session, epId, (b) => ({
                                ...b,
                                shot_suggestions: b.shot_suggestions.map((x) => {
                                  if (x.suggestion_id !== s.suggestion_id) return x;
                                  if (key === 'purpose') return { ...x, purpose: v };
                                  if (key === 'lighting') return { ...x, lighting: v };
                                  if (key === 'sound') return { ...x, sound: v };
                                  return { ...x, cast_names: splitList(v, /[、,，]/) };
                                }),
                              })),
                            )
                          }
                        />
                      </td>
                    ))}
                    <td className="px-1.5 py-2 align-top break-words">
                      <ShotDurationCell
                        isDark={isDark}
                        durationSec={s.duration_sec}
                        durationMin={s.duration_min}
                        durationMax={s.duration_max}
                        durationAi={s.duration_ai}
                        locked={!!s.duration_locked}
                        why={s.duration_why}
                        onChangeSec={(sec) =>
                          commit(
                            withEpisodeBible(session, epId, (b) => ({
                              ...b,
                              shot_suggestions: b.shot_suggestions.map((x) =>
                                x.suggestion_id === s.suggestion_id
                                  ? { ...x, duration_sec: sec }
                                  : x,
                              ),
                            })),
                          )
                        }
                        onToggleLock={() =>
                          commit(
                            withEpisodeBible(session, epId, (b) => ({
                              ...b,
                              shot_suggestions: b.shot_suggestions.map((x) =>
                                x.suggestion_id === s.suggestion_id
                                  ? { ...x, duration_locked: !x.duration_locked }
                                  : x,
                              ),
                            })),
                          )
                        }
                      />
                    </td>
                    <td className="px-1.5 py-2 align-top text-right">
                      <button
                        type="button"
                        className={delBtnCls(isDark)}
                        onClick={() =>
                          commit(
                            withEpisodeBible(session, epId, (b) => ({
                              ...b,
                              shot_suggestions: b.shot_suggestions.filter(
                                (x) => x.suggestion_id !== s.suggestion_id,
                              ),
                            })),
                          )
                        }
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className={addBtnCls(isDark)}
              onClick={() =>
                commit(
                  withEpisodeBible(session, epId, (b) => ({
                    ...b,
                    shot_suggestions: [
                      ...b.shot_suggestions,
                      createEmptyDramaShotSuggestion({
                        shot: String(b.shot_suggestions.length + 1).padStart(2, '0'),
                      }),
                    ],
                  })),
                )
              }
            >
              {t.addShot}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
