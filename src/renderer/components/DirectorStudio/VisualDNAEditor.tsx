/**

 * Visual Style Library — 画风左、色调右；同尺寸卡，一屏铺满不滚动

 */



import React, { useMemo, useState } from 'react';

import type {

  DramaProjectVisualBible,

  DramaVisualDNA,

} from '../../../shared/directorDomain';

import {

  VISUAL_LOOK_OPTIONS,

  VISUAL_GRADE_OPTIONS,

  applyVisualStyleLookGrade,

  applyVisualStylePreset,

  recommendVisualStylePresets,

  buildVisualStylePreset,

  parseVisualStyleLookGrade,

  getVisualLookOption,

  getVisualGradeOption,

} from '../../../shared/directorDomain';

import { useAppLocale } from '../../contexts/AppLocaleContext';

import {

  VISUAL_GRADE_COVERS,

  VISUAL_LOOK_COVERS,

} from '../../assets/visual-style-previews';



function mutedCls(isDark: boolean) {

  return isDark ? 'text-white/55' : 'text-gray-500';

}



function cardCls(isDark: boolean) {

  return isDark

    ? 'rounded-xl border border-white/10 bg-white/[0.04]'

    : 'rounded-xl border border-gray-200 bg-white';

}



export type VisualStyleLibraryProps = {

  value: DramaProjectVisualBible;

  isDark: boolean;

  onChange: (next: DramaProjectVisualBible) => void;

  scriptHint?: string;

  keywords?: string[];

};



/** @deprecated 旧名兼容 */

export type VisualDNAEditorProps = {

  value: DramaVisualDNA;

  isDark: boolean;

  onChange: (next: DramaVisualDNA) => void;

  projectVisualBible?: DramaProjectVisualBible;

  onProjectVisualBibleChange?: (next: DramaProjectVisualBible) => void;

  scriptHint?: string;

  keywords?: string[];

};



/** 填满网格格的选择卡（两侧同列数 → 同尺寸） */

function StylePickCard({

  label,

  accent,

  coverUrl,

  active,

  isDark,

  onSelect,

}: {

  label: string;

  accent: string;

  coverUrl?: string;

  active: boolean;

  isDark: boolean;

  onSelect: () => void;

}) {

  return (

    <button

      type="button"

      aria-pressed={active}

      title={label}

      className={`nodrag group relative h-full min-h-0 w-full overflow-hidden rounded-lg text-left transition-all ${

        active

          ? isDark

            ? 'ring-2 ring-sky-400 shadow-md shadow-sky-500/20'

            : 'ring-2 ring-sky-500 shadow-sm shadow-sky-200/80'

          : isDark

            ? 'ring-1 ring-white/10 hover:ring-white/30 hover:brightness-110'

            : 'ring-1 ring-gray-200 hover:ring-gray-300 hover:shadow-sm'

      }`}

      style={

        coverUrl

          ? { backgroundColor: '#0c0c12' }

          : {

              background: `linear-gradient(145deg, ${accent}f0 0%, ${accent}88 42%, #0c0c12 100%)`,

            }

      }

      onClick={onSelect}

    >

      {coverUrl ? (

        <img

          src={coverUrl}

          alt=""

          draggable={false}

          className="absolute inset-0 h-full w-full object-cover object-center"

        />

      ) : null}

      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 sm:px-2 sm:py-1.5">

        <div className="truncate text-[11px] sm:text-[12px] font-semibold leading-tight text-white drop-shadow">

          {label}

        </div>

      </div>

      {active ? (

        <span className="absolute right-1 top-1 rounded bg-sky-500 px-1.5 py-px text-[9px] font-semibold text-white shadow">

          已选

        </span>

      ) : null}

    </button>

  );

}



export const VisualStyleLibrary: React.FC<VisualStyleLibraryProps> = ({

  value,

  isDark,

  onChange,

  scriptHint,

  keywords,

}) => {

  const { locale } = useAppLocale();

  const en = locale === 'en';

  const [recommendIds, setRecommendIds] = useState<string[]>(

    () => value.recommendedPresetIds || [],

  );



  const parsed = useMemo(() => parseVisualStyleLookGrade(value.presetId), [value.presetId]);

  const lookId = parsed.lookId;

  const gradeId = parsed.gradeId;

  const selected = useMemo(

    () => (lookId && gradeId ? buildVisualStylePreset(lookId, gradeId) : null),

    [lookId, gradeId],

  );



  const t = useMemo(

    () =>

      en

        ? {

            title: 'Visual Style',

            subtitle: 'Look left · Grade right',

            look: 'Look',

            grade: 'Grade',

            preview: 'Combined',

            empty: 'Select look + grade',

            recommend: 'AI suggest 3',

            recommendHint: 'Heuristic only',

            bind: 'Bound',

            unbound: 'Not bound',

          }

        : {

            title: '视觉风格',

            subtitle: '左画风 · 右色调 · 一屏选完',

            look: '画风',

            grade: '色调',

            preview: '组合提示词',

            empty: '请选择画风与色调',

            recommend: 'AI 推荐 3 组',

            recommendHint: '本地启发式占位',

            bind: '已锁定',

            unbound: '尚未锁定',

          },

    [en],

  );



  const lookOpt = getVisualLookOption(lookId);

  const gradeOpt = getVisualGradeOption(gradeId);

  const combinedPrompt = useMemo(() => {

    if (!lookOpt || !gradeOpt) return '';

    if (en) return `${lookOpt.lookEn}, ${gradeOpt.gradeEn}`;

    return `${lookOpt.lookZh}，${gradeOpt.gradeZh}`;

  }, [lookOpt, gradeOpt, en]);



  const commitLookGrade = (nextLook: string, nextGrade: string) => {

    if (!nextLook || !nextGrade) return;

    onChange(

      applyVisualStyleLookGrade(nextLook, nextGrade, {

        ...value,

        recommendedPresetIds: recommendIds.length ? recommendIds : value.recommendedPresetIds,

      }),

    );

  };



  const selectLook = (id: string) => {

    commitLookGrade(id, gradeId || 'dark_cyan');

  };



  const selectGrade = (id: string) => {

    commitLookGrade(lookId || 'live', id);

  };



  const runRecommend = () => {

    const picks = recommendVisualStylePresets({

      scriptText: scriptHint,

      keywords,

    });

    const ids = picks.map((p) => p.id);

    setRecommendIds(ids);

    onChange({

      ...value,

      recommendedPresetIds: ids,

    });

    if (!value.selected_at && picks[0]) {

      onChange(

        applyVisualStylePreset(picks[0].id, {

          ...value,

          recommendedPresetIds: ids,

        }),

      );

    }

  };



  const recommendSet = new Set(recommendIds.length ? recommendIds : value.recommendedPresetIds);



  // 两侧同列数：卡片等宽等高；10 项 → 5×2 一屏铺满

  const pickGridCls =

    'grid h-full min-h-0 grid-cols-5 grid-rows-2 gap-1.5 sm:gap-2 [&>*]:min-h-0';



  return (

    <div className={`${cardCls(isDark)} flex h-full min-h-0 flex-col overflow-hidden`}>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2">

        <div className="min-w-0">

          <div className="text-[14px] font-semibold leading-tight">{t.title}</div>

          <div className={`truncate text-[11px] ${mutedCls(isDark)}`}>{t.subtitle}</div>

        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">

          <button

            type="button"

            title={t.recommendHint}

            className={`nodrag rounded-md px-2.5 py-1 text-[12px] font-medium ${

              isDark ? 'bg-sky-500/80 text-white' : 'bg-sky-600 text-white'

            }`}

            onClick={runRecommend}

          >

            {t.recommend}

          </button>

          <span

            className={`text-[11px] ${

              value.selected_at

                ? isDark

                  ? 'text-emerald-300'

                  : 'text-emerald-700'

                : mutedCls(isDark)

            }`}

          >

            {value.selected_at ? t.bind : t.unbound}

          </span>

        </div>

      </div>



      {/* 左画风 · 右色调：等宽分区 + 同网格同尺寸 */}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden px-3 lg:grid-cols-2">

        <section

          className={`flex min-h-0 flex-col overflow-hidden rounded-xl border p-2 ${

            isDark

              ? 'border-white/10 bg-sky-500/[0.06]'

              : 'border-sky-100 bg-sky-50/80'

          }`}

        >

          <div

            className={`mb-1.5 shrink-0 text-[12px] font-semibold ${

              isDark ? 'text-sky-200' : 'text-sky-800'

            }`}

          >

            {t.look}

            <span className={`ml-1.5 text-[11px] font-normal ${mutedCls(isDark)}`}>

              {VISUAL_LOOK_OPTIONS.length} 选 1

            </span>

          </div>

          <div className={`min-h-0 flex-1 ${pickGridCls}`}>

            {VISUAL_LOOK_OPTIONS.map((p) => (

              <StylePickCard

                key={p.id}

                label={en ? p.nameEn : p.name}

                accent={p.accent}

                coverUrl={VISUAL_LOOK_COVERS[p.id]}

                active={lookId === p.id && !!value.selected_at}

                isDark={isDark}

                onSelect={() => selectLook(p.id)}

              />

            ))}

          </div>

        </section>



        <section

          className={`flex min-h-0 flex-col overflow-hidden rounded-xl border p-2 ${

            isDark

              ? 'border-white/10 bg-violet-500/[0.06]'

              : 'border-violet-100 bg-violet-50/80'

          }`}

        >

          <div

            className={`mb-1.5 shrink-0 text-[12px] font-semibold ${

              isDark ? 'text-violet-200' : 'text-violet-800'

            }`}

          >

            {t.grade}

            <span className={`ml-1.5 text-[11px] font-normal ${mutedCls(isDark)}`}>

              {VISUAL_GRADE_OPTIONS.length} 选 1

            </span>

          </div>

          <div className={`min-h-0 flex-1 ${pickGridCls}`}>

            {VISUAL_GRADE_OPTIONS.map((p) => (

              <StylePickCard

                key={p.id}

                label={en ? p.nameEn : p.name}

                accent={p.accent}

                coverUrl={VISUAL_GRADE_COVERS[p.id]}

                active={gradeId === p.id && !!value.selected_at}

                isDark={isDark}

                onSelect={() => selectGrade(p.id)}

              />

            ))}

          </div>

        </section>

      </div>



      {/* 底部组合提示词（紧凑） */}

      <div className="shrink-0 px-3 pb-2.5 pt-2">

        <div

          className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${

            isDark ? 'border-white/10 bg-black/45' : 'border-gray-200 bg-gray-50'

          }`}

          style={

            selected

              ? {

                  background: isDark

                    ? `linear-gradient(90deg, ${selected.accent}33, transparent 55%), rgba(0,0,0,0.45)`

                    : undefined,

                }

              : undefined

          }

        >

          <span className={`shrink-0 text-[11px] ${mutedCls(isDark)}`}>{t.preview}</span>

          {selected && lookOpt && gradeOpt ? (

            <>

              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug">

                {en ? selected.nameEn : selected.name}

                <span className={`ml-2 font-medium ${isDark ? 'text-white/80' : 'text-gray-700'}`}>

                  {combinedPrompt}

                </span>

              </div>

              {recommendSet.has(selected.id) ? (

                <span

                  className={`rounded-full px-2 py-px text-[10px] font-semibold ${

                    isDark ? 'bg-sky-500 text-white' : 'bg-sky-600 text-white'

                  }`}

                >

                  {en ? 'AI pick' : 'AI推荐'}

                </span>

              ) : null}

            </>

          ) : (

            <div className={`text-[12px] ${mutedCls(isDark)}`}>{t.empty}</div>

          )}

        </div>

      </div>

    </div>

  );

};



/** @deprecated 旧 VisualDNAEditor 壳：转发到风格库 */

export const VisualDNAEditor: React.FC<VisualDNAEditorProps> = ({

  value,

  isDark,

  onChange,

  projectVisualBible,

  onProjectVisualBibleChange,

  scriptHint,

  keywords,

}) => {

  if (!projectVisualBible || !onProjectVisualBibleChange) {

    return null;

  }

  return (

    <VisualStyleLibrary

      value={projectVisualBible}

      isDark={isDark}

      onChange={(next) => {

        onProjectVisualBibleChange(next);

        onChange(next.visualDNA || value);

      }}

      scriptHint={scriptHint}

      keywords={keywords}

    />

  );

};


