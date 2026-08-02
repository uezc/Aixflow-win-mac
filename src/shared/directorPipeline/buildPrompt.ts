import {
  DIRECTOR_ASSETS_SYSTEM_PROMPT,
  DIRECTOR_ASSETS_USER_PROMPT_TEMPLATE,
  DIRECTOR_MV_SCRIPT_SYSTEM_PROMPT,
  DIRECTOR_MV_SCRIPT_USER_PROMPT_TEMPLATE,
  DIRECTOR_MV_STORY_ANALYZE_SYSTEM_PROMPT,
  DIRECTOR_MV_STORY_ANALYZE_USER_PROMPT_TEMPLATE,
  DIRECTOR_MV_SHOTS_SYSTEM_PROMPT,
  DIRECTOR_MV_SHOTS_USER_PROMPT_TEMPLATE,
  DIRECTOR_PROMPTS_SYSTEM_PROMPT,
  DIRECTOR_PROMPTS_USER_PROMPT_TEMPLATE,
  DIRECTOR_SHOTS_SYSTEM_PROMPT,
  DIRECTOR_SHOTS_USER_PROMPT_TEMPLATE,
} from './prompts.js';
import {
  DIRECTOR_CINEMATIC_TECHNIQUE_INVENTORY,
  resolveDirectorMvCloseUpFramingGuide,
  resolveDirectorMvPlotExampleRows,
} from './cinematicCameraLanguage.js';
import type { DirectorAsset, DirectorPipelineState, DirectorShot } from './schema.js';
import { formatDirectorMvLockedCastForPrompt } from './schema.js';
import {
  buildDirectorShotAssetHintLines,
  directorAssetKindLabel,
  inferDirectorAssetGender,
} from './bindAssetRefs.js';
import {
  buildMvShotsIntentText,
  estimateShotCountFromMusicDuration,
  resolveDirectorMvAudioClipCount,
} from './mvHelpers.js';
import { resolveDirectorStylePrompt } from './stylePresets.js';
import {
  packLyricSegmentsIntoShotPacks,
  classifyDirectorMvPackAudioRole,
  directorMvPackAudioRoleLabelZh,
} from './lyricTimeline.js';

const PLACEHOLDER_PATTERN =
  /\{\{?\s*([^|{}]+?)(?:\s*\|\|?\s*([^}]+))?\s*\}\}?/g;

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, rawKey: string, rawDefault?: string) => {
    const key = rawKey.trim();
    const value = String(vars[key] ?? '').trim();
    if (value) return value;
    return String(rawDefault ?? '').trim();
  });
}

export function buildDirectorShotsMessages(
  scriptText: string,
  styleHint?: string,
): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: DIRECTOR_SHOTS_SYSTEM_PROMPT,
    userPrompt: fillTemplate(DIRECTOR_SHOTS_USER_PROMPT_TEMPLATE, {
      scriptText: String(scriptText || '').trim() || '（空剧本）',
      styleHint: String(styleHint || '').trim() || '（未指定，按剧情自行统一一种画风）',
    }),
  };
}

/** MV 模式：用音乐摘要+意图生成镜头表 */
export function buildDirectorMvShotsMessages(state: DirectorPipelineState): {
  systemPrompt: string;
  userPrompt: string;
} {
  const packs = packLyricSegmentsIntoShotPacks(state.mvMusic?.lyricSegments || [], {
    clipLengthMode: state.mvMusic?.clipLengthMode,
  });
  const shotCountHint = String(
    packs.length > 0
      ? packs.length
      : estimateShotCountFromMusicDuration(state.mvMusic?.durationSec || 0),
  );
  const closeUpOn = state.mvCloseUpFraming !== false;
  return {
    systemPrompt: fillTemplate(DIRECTOR_MV_SHOTS_SYSTEM_PROMPT, {
      shotCountHint,
      closeUpFramingGuide: resolveDirectorMvCloseUpFramingGuide(closeUpOn),
    }),
    userPrompt: fillTemplate(DIRECTOR_MV_SHOTS_USER_PROMPT_TEMPLATE, {
      styleHint: String(state.globalStyle || '').trim() || '（未指定）',
      shotCountHint,
      mvIntentText: buildMvShotsIntentText(state),
    }),
  };
}

function mvStoryPromptVars(state: DirectorPipelineState, directorNotes?: string): Record<string, string> {
  const music = state.mvMusic;
  const analysis = state.mvStoryAnalysis;
  const styleHint =
    resolveDirectorStylePrompt(state.stylePresetId, state.globalStyle) ||
    String(state.globalStyle || '').trim() ||
    '（未指定）';
  const packs = packLyricSegmentsIntoShotPacks(music?.lyricSegments || [], {
    clipLengthMode: music?.clipLengthMode,
  });
  const targetSegmentCount = String(resolveDirectorMvAudioClipCount(state));
  const audioStructure =
    packs.length > 0
      ? [
          `共 ${packs.length} 段切分（剧情明细表必须恰好 ${packs.length} 行，第 i 行 = 第 i 音频片段）：`,
          ...packs.map((p, i) => {
            const role = classifyDirectorMvPackAudioRole(packs, i);
            const roleZh = directorMvPackAudioRoleLabelZh(role);
            const clock = (sec: number) => {
              const s = Math.max(0, Math.floor(sec));
              return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
            };
            const vocal = roleZh.includes('有人声') ? '有人声' : '无人声';
            return `${i + 1}. ${clock(p.startSec)}-${clock(p.endSec)} ${roleZh}（${vocal}）`;
          }),
        ].join('\n')
      : `（尚未识别人声时间轴；请按前奏/主歌/副歌/间奏/尾奏拆成恰好 ${targetSegmentCount} 行的明细表，前奏段按无人声处理）`;
  const notesFromArg = String(directorNotes || '').trim();
  const notesFromState = String(state.mvScriptReference || '').trim();
  const closeUpOn = state.mvCloseUpFraming !== false;
  return {
    title: String(music?.title || '').trim() || '（未命名）',
    durationSec: String(Math.round(Number(music?.durationSec) || 0) || 0),
    targetSegmentCount,
    styleHint,
    directorNotes: notesFromArg || notesFromState || '（无额外参考）',
    lyrics: String(music?.lyrics || '').trim() || '（无歌词，请根据曲名/情绪合理推断）',
    analysisSummary: String(analysis?.summary || music?.summary || '').trim() || '（尚未分析）',
    genre: String(analysis?.genre || '').trim() || '（未标注）',
    emotions: (analysis?.emotions || []).join('、') || String(music?.moodHint || '').trim() || '（未标注）',
    keywords: (analysis?.keywords || []).join('、') || '（未标注）',
    lockedCast: formatDirectorMvLockedCastForPrompt(state) || '（未锁定主角，请自行设定 1–2 名主角）',
    audioStructure,
    closeUpFramingGuide: resolveDirectorMvCloseUpFramingGuide(closeUpOn),
    plotExampleRows: resolveDirectorMvPlotExampleRows(closeUpOn),
  };
}

/** MV 剧本步：音乐分析 */
export function buildDirectorMvStoryAnalyzeMessages(
  state: DirectorPipelineState,
  directorNotes?: string,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: DIRECTOR_MV_STORY_ANALYZE_SYSTEM_PROMPT,
    userPrompt: fillTemplate(DIRECTOR_MV_STORY_ANALYZE_USER_PROMPT_TEMPLATE, mvStoryPromptVars(state, directorNotes)),
  };
}

/** MV 剧本步：生成专业剧本 */
export function buildDirectorMvScriptMessages(
  state: DirectorPipelineState,
  directorNotes?: string,
): { systemPrompt: string; userPrompt: string } {
  const vars = mvStoryPromptVars(state, directorNotes);
  return {
    systemPrompt: fillTemplate(DIRECTOR_MV_SCRIPT_SYSTEM_PROMPT, {
      durationSec: vars.durationSec,
      targetSegmentCount: vars.targetSegmentCount,
      closeUpFramingGuide: vars.closeUpFramingGuide,
      plotExampleRows: vars.plotExampleRows,
    }),
    userPrompt: fillTemplate(DIRECTOR_MV_SCRIPT_USER_PROMPT_TEMPLATE, vars),
  };
}

export function buildDirectorAssetsMessages(opts: {
  shots: DirectorShot[];
  styleHint?: string;
}): { systemPrompt: string; userPrompt: string } {
  const shotsJson = JSON.stringify(
    (opts.shots || []).map((s) => ({
      镜号: s['镜号'],
      时长: s['时长'],
      画面描述: s['画面描述'],
      镜头角度: s['镜头角度'],
      焦距: s['焦距'],
      景别: s['景别'],
      光影氛围: s['光影氛围'],
      对白旁白: s['对白旁白'],
      音效: s['音效'],
      运镜: s['运镜'],
    })),
    null,
    2,
  );
  return {
    systemPrompt: DIRECTOR_ASSETS_SYSTEM_PROMPT,
    userPrompt: fillTemplate(DIRECTOR_ASSETS_USER_PROMPT_TEMPLATE, {
      styleHint: String(opts.styleHint || '').trim() || '（无）',
      shotsJson,
    }),
  };
}

export function buildDirectorPromptsMessages(opts: {
  shots: DirectorShot[];
  globalStyle?: string;
  /** Ordered refs that will map to @图片1..N */
  assetRefs: Array<Pick<DirectorAsset, 'name' | 'kind' | 'imageUrl' | 'prompt'>>;
  /** 近景特写开关 */
  closeUpFraming?: boolean;
}): { systemPrompt: string; userPrompt: string } {
  const assetRefList =
    (opts.assetRefs || [])
      .map((a, i) => {
        const kindLabel = directorAssetKindLabel(a.kind);
        const gender = inferDirectorAssetGender(a);
        const hasImg = String(a.imageUrl || '').trim() ? '有图' : '无图';
        return `图片${i + 1} | ${kindLabel} | ${a.name} | 性别:${gender} | ${hasImg}`;
      })
      .join('\n') || '（无参考资产）';

  const shotAssetHints = buildDirectorShotAssetHintLines(opts.shots || [], opts.assetRefs || []);

  const shotsJson = JSON.stringify(
    (opts.shots || []).map((s) => ({
      镜号: s['镜号'],
      时长: s['时长'],
      画面描述: s['画面描述'],
      镜头角度: s['镜头角度'],
      焦距: s['焦距'],
      景别: s['景别'],
      光影氛围: s['光影氛围'],
      对白旁白: s['对白旁白'],
      音效: s['音效'],
      运镜: s['运镜'],
    })),
    null,
    2,
  );

  return {
    systemPrompt: fillTemplate(DIRECTOR_PROMPTS_SYSTEM_PROMPT, {
      closeUpFramingGuide: resolveDirectorMvCloseUpFramingGuide(opts.closeUpFraming !== false),
    }),
    userPrompt: fillTemplate(DIRECTOR_PROMPTS_USER_PROMPT_TEMPLATE, {
      globalStyle: String(opts.globalStyle || '').trim() || '（无）',
      assetRefList,
      shotAssetHints,
      shotsJson,
    }),
  };
}
