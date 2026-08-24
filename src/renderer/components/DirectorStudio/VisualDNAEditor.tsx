/**
 * Visual Style Library — AI 导演视觉风格库
 * 用户只选风格卡片；调色参数隐藏在后台 VisualDNA。
 * 暂不接模型；「AI 推荐」为本地启发式占位。
 */

import React, { useMemo, useState } from 'react';
import type {
  DramaProjectVisualBible,
  DramaVisualDNA,
  VisualStylePreset,
} from '../../../shared/directorDomain';
import {
  VISUAL_STYLE_PRESETS,
  applyVisualStylePreset,
  recommendVisualStylePresets,
  buildCinematicPromptZhFromVisualDna,
} from '../../../shared/directorDomain';
import { useAppLocale } from '../../contexts/AppLocaleContext';

function mutedCls(isDark: boolean) {
  return isDark ? 'text-white/50' : 'text-gray-500';
}

function cardCls(isDark: boolean) {
  return isDark
    ? 'rounded-xl border border-white/10 bg-white/[0.04]'
    : 'rounded-xl border border-gray-200 bg-white';
}

export type VisualStyleLibraryProps = {
  /** 已绑定的 Project Visual Bible */
  value: DramaProjectVisualBible;
  isDark: boolean;
  /** 选定风格后回写 Project Visual Bible（含冻结 DNA） */
  onChange: (next: DramaProjectVisualBible) => void;
  /** 可选：剧本文本，用于「AI 推荐」启发式 */
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

function StyleCard({
  preset,
  active,
  isDark,
  en,
  recommended,
  onSelect,
}: {
  preset: VisualStylePreset;
  active: boolean;
  isDark: boolean;
  en: boolean;
  recommended?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`nodrag w-full text-left rounded-xl overflow-hidden transition-all ${
        active
          ? isDark
            ? 'ring-2 ring-sky-400 bg-sky-500/20 shadow-[0_0_0_1px_rgba(56,189,248,0.4)]'
            : 'ring-2 ring-sky-500 bg-sky-50'
          : isDark
            ? 'bg-black/30 hover:bg-black/45 ring-1 ring-white/8'
            : 'bg-gray-50 hover:bg-gray-100 ring-1 ring-gray-200'
      }`}
      onClick={onSelect}
    >
      <div
        className="h-16 w-full relative"
        style={{
          background: preset.coverImage
            ? undefined
            : `linear-gradient(135deg, ${preset.accent}99, #0a0a0f 70%)`,
        }}
      >
        {preset.coverImage ? (
          <img src={preset.coverImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : null}
        {recommended ? (
          <span
            className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              isDark ? 'bg-sky-500 text-white' : 'bg-sky-600 text-white'
            }`}
          >
            {en ? 'AI pick' : 'AI推荐'}
          </span>
        ) : null}
      </div>
      <div className="p-2.5">
        <div className="text-[14px] font-semibold leading-tight">
          {en ? preset.nameEn : preset.name}
        </div>
        <div className={`mt-1 text-[11px] leading-snug line-clamp-2 ${mutedCls(isDark)}`}>
          {en ? preset.descriptionEn : preset.description}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {preset.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                isDark ? 'bg-white/8 text-white/65' : 'bg-gray-200/80 text-gray-600'
              }`}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
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

  const selected = useMemo(
    () => VISUAL_STYLE_PRESETS.find((p) => p.id === value.presetId) || null,
    [value.presetId],
  );

  const t = useMemo(
    () =>
      en
        ? {
            title: 'Visual Style Library',
            subtitle: 'Pick one look for the whole series — locks Project Visual Bible',
            library: 'Style cards',
            preview: 'Selected look',
            empty: 'Select a style card to lock visual consistency',
            recommend: 'AI suggest 3 looks',
            recommendHint: 'Heuristic only — model wiring later',
            bind: 'Bound to Project Visual Bible',
            unbound: 'Not bound yet',
            prompt: 'Locked cinematic prompt (ZH / EN)',
            promptZh: 'Chinese',
            promptEn: 'English',
          }
        : {
            title: '视觉风格库',
            subtitle: '选择一套整片视觉 · 锁定 Project Visual Bible，防画风漂移',
            library: '风格卡片',
            preview: '当前方案',
            empty: '请选择一张视觉风格卡片，锁定全剧一致性',
            recommend: 'AI 推荐 3 个视觉方案',
            recommendHint: '本地启发式占位，暂未接模型',
            bind: '已写入 Project Visual Bible',
            unbound: '尚未绑定视觉方案',
            prompt: '锁定电影 Prompt（中英对照）',
            promptZh: '中文',
            promptEn: 'English',
          },
    [en],
  );

  const promptEn = value.stylePrompt || value.visualDNA.generatedPrompt || '';
  const promptZh = useMemo(() => {
    if (!selected) return '';
    return buildCinematicPromptZhFromVisualDna(
      value.visualDNA.presetId === selected.id ? value.visualDNA : selected.visualDNA,
      selected.visualDNA.promptTemplateZh,
    );
  }, [selected, value.visualDNA]);

  const selectPreset = (id: string) => {
    onChange(
      applyVisualStylePreset(id, {
        ...value,
        recommendedPresetIds: recommendIds.length ? recommendIds : value.recommendedPresetIds,
      }),
    );
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
    // 若尚未选定，自动聚焦第一个推荐
    if (!value.selected_at && picks[0]) {
      onChange(
        applyVisualStylePreset(picks[0].id, {
          ...value,
          recommendedPresetIds: ids,
        }),
      );
    }
  };

  const coverUrl = selected?.coverImage || value.coverImage || '';
  const recommendSet = new Set(recommendIds.length ? recommendIds : value.recommendedPresetIds);

  return (
    <div className={`${cardCls(isDark)} flex flex-col min-h-0 h-full overflow-hidden`}>
      <div className="shrink-0 px-3.5 pt-3 pb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[16px] font-semibold">{t.title}</div>
          <div className={`text-[12px] mt-0.5 ${mutedCls(isDark)}`}>{t.subtitle}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            title={t.recommendHint}
            className={`nodrag rounded-lg px-3 py-1.5 text-[13px] font-medium ${
              isDark ? 'bg-sky-500/80 text-white' : 'bg-sky-600 text-white'
            }`}
            onClick={runRecommend}
          >
            {t.recommend}
          </button>
          <span
            className={`text-[12px] ${
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

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 px-3.5 pb-3.5">
        {/* 风格卡片网格 */}
        <aside className="lg:col-span-7 flex flex-col min-h-0 overflow-hidden">
          <div className={`text-[13px] font-medium mb-2 ${mutedCls(isDark)}`}>{t.library}</div>
          <div className="flex-1 min-h-0 overflow-auto custom-scrollbar-dark pr-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
              {VISUAL_STYLE_PRESETS.map((p) => (
                <StyleCard
                  key={p.id}
                  preset={p}
                  active={value.presetId === p.id && !!value.selected_at}
                  isDark={isDark}
                  en={en}
                  recommended={recommendSet.has(p.id)}
                  onSelect={() => selectPreset(p.id)}
                />
              ))}
            </div>
          </div>
        </aside>

        {/* 当前方案预览 */}
        <section className="lg:col-span-5 flex flex-col min-h-0 overflow-hidden">
          <div className={`text-[13px] font-medium mb-2 ${mutedCls(isDark)}`}>{t.preview}</div>
          <div
            className={`flex-1 min-h-[10rem] rounded-xl overflow-hidden border flex flex-col ${
              isDark ? 'border-white/10 bg-black/40' : 'border-gray-200 bg-gray-100'
            }`}
          >
            <div className="relative h-36 shrink-0">
              {coverUrl ? (
                <img src={coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
              ) : selected ? (
                <div
                  className="absolute inset-0"
                  style={{
                    background: `linear-gradient(135deg, ${selected.accent}aa, #0a0a0f)`,
                  }}
                />
              ) : (
                <div
                  className={`flex h-full items-center justify-center px-4 text-center text-[13px] ${mutedCls(isDark)}`}
                >
                  {t.empty}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 p-3 space-y-2 overflow-auto custom-scrollbar-dark">
              {selected ? (
                <>
                  <div className="text-[15px] font-semibold">
                    {en ? selected.nameEn : selected.name}
                  </div>
                  <div className={`text-[12px] leading-relaxed ${mutedCls(isDark)}`}>
                    {en ? selected.descriptionEn : selected.description}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(value.tags.length ? value.tags : selected.tags).map((tag) => (
                      <span
                        key={tag}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          isDark ? 'bg-white/10' : 'bg-gray-200'
                        }`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div>
                    <div className={`text-[12px] mb-1.5 ${mutedCls(isDark)}`}>{t.prompt}</div>
                    <div className="space-y-2">
                      <div
                        className={`rounded-lg px-2.5 py-2 ${
                          isDark ? 'bg-black/40' : 'bg-white'
                        }`}
                      >
                        <div
                          className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${
                            isDark ? 'text-sky-300/80' : 'text-sky-700'
                          }`}
                        >
                          {t.promptZh}
                        </div>
                        <div
                          className={`text-[12px] leading-relaxed ${
                            isDark ? 'text-white/80' : 'text-gray-700'
                          }`}
                        >
                          {promptZh || '—'}
                        </div>
                      </div>
                      <div
                        className={`rounded-lg px-2.5 py-2 ${
                          isDark ? 'bg-black/40' : 'bg-white'
                        }`}
                      >
                        <div
                          className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${
                            isDark ? 'text-sky-300/80' : 'text-sky-700'
                          }`}
                        >
                          {t.promptEn}
                        </div>
                        <div
                          className={`text-[12px] leading-relaxed ${
                            isDark ? 'text-white/75' : 'text-gray-700'
                          }`}
                        >
                          {promptEn || '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className={`text-[13px] ${mutedCls(isDark)}`}>{t.empty}</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

/** 兼容旧 VisualDNAEditor 调用：内部转接到风格库 */
export const VisualDNAEditor: React.FC<VisualDNAEditorProps> = ({
  value,
  isDark,
  onChange,
  projectVisualBible,
  onProjectVisualBibleChange,
  scriptHint,
  keywords,
}) => {
  const bible: DramaProjectVisualBible =
    projectVisualBible ||
    applyVisualStylePreset(value.presetId, {
      visualDNA: value,
      stylePrompt: value.generatedPrompt,
      selected_at: value.presetId && value.presetId !== 'unset' ? Date.now() : 0,
    });

  return (
    <VisualStyleLibrary
      value={bible}
      isDark={isDark}
      scriptHint={scriptHint}
      keywords={keywords}
      onChange={(next) => {
        onProjectVisualBibleChange?.(next);
        onChange(next.visualDNA);
      }}
    />
  );
};
