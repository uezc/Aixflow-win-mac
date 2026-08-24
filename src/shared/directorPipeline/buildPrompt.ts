import {
  DIRECTOR_ASSETS_SYSTEM_PROMPT,
  DIRECTOR_ASSETS_USER_PROMPT_TEMPLATE,
  DIRECTOR_MV_SCRIPT_SYSTEM_PROMPT,
  DIRECTOR_MV_SCRIPT_USER_PROMPT_TEMPLATE,
  DIRECTOR_MV_SCRIPT_PLOT_CONTINUE_SYSTEM_PROMPT,
  DIRECTOR_MV_SCRIPT_PLOT_CONTINUE_USER_PROMPT_TEMPLATE,
  DIRECTOR_DRAMA_SCRIPT_SYSTEM_PROMPT,
  DIRECTOR_DRAMA_SCRIPT_USER_PROMPT_TEMPLATE,
  DIRECTOR_MV_STORY_ANALYZE_SYSTEM_PROMPT,
  DIRECTOR_MV_STORY_ANALYZE_USER_PROMPT_TEMPLATE,
  DIRECTOR_MV_STORY_OUTLINE_SYSTEM_PROMPT,
  DIRECTOR_MV_STORY_OUTLINE_USER_PROMPT_TEMPLATE,
  DIRECTOR_MV_SHOTS_SYSTEM_PROMPT,
  DIRECTOR_MV_SHOTS_USER_PROMPT_TEMPLATE,
  DIRECTOR_PROMPTS_SYSTEM_PROMPT,
  DIRECTOR_PROMPTS_USER_PROMPT_TEMPLATE,
  DIRECTOR_SHOTS_SYSTEM_PROMPT,
  DIRECTOR_SHOTS_USER_PROMPT_TEMPLATE,
} from './prompts.js';
import {
  resolveDirectorMvCloseUpFramingGuide,
  resolveDirectorMvPlotExampleRows,
  resolveDirectorMvShotChangePaceGuide,
  getDirectorMvShotChangePacePreset,
  DIRECTOR_MV_H3_ZH_PROMPT_FORMAT_GUIDE,
  DIRECTOR_MV_PERFORMANCE_DYNAMICS_GUIDE,
} from './cinematicCameraLanguage.js';
import { formatDirectorMvStoryPrefsForPrompt } from './mvStoryPrefs.js';
import type { DirectorAsset, DirectorPipelineState, DirectorShot } from './schema.js';
import {
  extractDirectorMvReferencePersonNames,
  formatDirectorMvLockedCastForPrompt,
  formatDirectorMvLockedCastForStoryPrompt,
} from './schema.js';
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
      shotChangePaceGuide: resolveDirectorMvShotChangePaceGuide(state.mvMusic?.shotChangePace),
    }),
    userPrompt: fillTemplate(DIRECTOR_MV_SHOTS_USER_PROMPT_TEMPLATE, {
      styleHint: String(state.globalStyle || '').trim() || '（未指定）',
      shotCountHint,
      mvIntentText: buildMvShotsIntentText(state),
    }),
  };
}

function mvStoryPromptVars(
  state: DirectorPipelineState,
  directorNotes?: string,
  opts?: { /** 仅故事生成使用参考；剧本生成应传 false */ includeReference?: boolean },
): Record<string, string> {
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
  const targetN = Math.max(0, Math.round(Number(targetSegmentCount) || 0));
  const plotBrevityGuide =
    targetN >= 18
      ? [
          `【输出体积·硬性】本曲目标段数 ${targetN} 较大：`,
          '· 「动作与画面」每段 ≤28 字；「对口型动作」有人声主角行用短句（≤18 字），其余「—」；',
          '· 禁止长散文；禁止重复同一套空话；必须仍输出恰好该段数的完整 plot 数组；',
          '· 优先对象数组，禁止把整表写成带大量 \\n 的超长字符串。',
        ].join('\n')
      : '【输出体积】plot 优先对象数组；「动作与画面」保持可拍短句即可。';
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
  const includeReference = opts?.includeReference !== false;
  const confirmedStory =
    String(state.mvStoryOutline || '').trim() || '（尚未确认故事，请先生成并确认故事大纲）';
  const closeUpOn = state.mvCloseUpFraming !== false;
  const pacePreset = getDirectorMvShotChangePacePreset(music?.shotChangePace);
  return {
    title: String(music?.title || '').trim() || '（未命名）',
    durationSec: String(Math.round(Number(music?.durationSec) || 0) || 0),
    targetSegmentCount,
    styleHint,
    directorNotes: includeReference
      ? notesFromArg || notesFromState || '（无额外参考）'
      : '（无额外参考·剧本阶段不使用参考文）',
    confirmedStory,
    lyrics: String(music?.lyrics || '').trim() || '（无歌词，请根据曲名/情绪合理推断）',
    analysisSummary: String(analysis?.summary || music?.summary || '').trim() || '（尚未分析）',
    genre: String(analysis?.genre || '').trim() || '（未标注）',
    emotions: (analysis?.emotions || []).join('、') || String(music?.moodHint || '').trim() || '（未标注）',
    keywords: (analysis?.keywords || []).join('、') || '（未标注）',
    lockedCast: formatDirectorMvLockedCastForStoryPrompt(state),
    storyPrefs: formatDirectorMvStoryPrefsForPrompt({
      genreType: state.mvStoryGenreType,
      toneStyle: state.mvStoryToneStyle,
      endingType: state.mvStoryEndingType,
    }),
    audioStructure,
    closeUpFramingGuide: resolveDirectorMvCloseUpFramingGuide(closeUpOn),
    plotExampleRows: resolveDirectorMvPlotExampleRows(closeUpOn),
    plotBrevityGuide,
    shotChangePaceGuide: resolveDirectorMvShotChangePaceGuide(pacePreset.id),
    h3ZhPromptFormatGuide: DIRECTOR_MV_H3_ZH_PROMPT_FORMAT_GUIDE,
    performanceDynamicsGuide: DIRECTOR_MV_PERFORMANCE_DYNAMICS_GUIDE,
    shotChangePaceLabel: `${pacePreset.labelZh}（${pacePreset.moodZh}）`,
    shotChangePaceSec: String(pacePreset.recommendSec),
    shotChangePaceMood: pacePreset.moodZh,
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

function extractDirectorMvOutlineRoleNames(story: string): string[] {
  const s = String(story || '');
  const block = s.match(/【\s*角色\s*】([\s\S]*?)(?=【|$)/);
  const chunk = block ? String(block[1] || '') : s.slice(0, 220);
  const found = chunk.match(/[\u4e00-\u9fff]{2,3}(?=，|。|：|:|（|\(|｜|、|\s|$)/g) || [];
  const stop = /^(角色|男性|女性|岁|都市|公路|背景|主线)$/;
  return [...new Set(found.map((n) => n.trim()).filter((n) => n && !stop.test(n)))].slice(0, 6);
}

/** MV 剧本步：生成故事大纲（确认前）——轻量输入，避免把整首超长歌词/分段表塞进故事请求 */
export function buildDirectorMvStoryOutlineMessages(
  state: DirectorPipelineState,
  directorNotes?: string,
): { systemPrompt: string; userPrompt: string } {
  const vars = mvStoryPromptVars(state, directorNotes);
  const clipLyrics = (raw: string, max = 900) => {
    const t = String(raw || '').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max)}\n…（歌词已截断，故事只需抓住情绪与主旨）`;
  };
  const clipText = (raw: string, max: number) => {
    const t = String(raw || '').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max)}…`;
  };
  // 故事步：视觉风格只保留短光影提示，避免「车窗/公路」等标签把仙侠改写成都市
  const styleRaw = String(vars.styleHint || '').trim();
  const styleHint = /车窗|公路|车内|霓虹|街舞|都市夜景|海岸/.test(styleRaw)
    ? '电影感光影与浅景深（世界观以用户故事类型为准）'
    : clipText(styleRaw, 60);
  const hasPrev = !!String(state.mvStoryOutline || '').trim();
  const notesText = String(vars.directorNotes || '').trim();
  const hasNotes = !!notesText && !/^（无额外/.test(notesText);
  const refNames = extractDirectorMvReferencePersonNames(String(state.mvScriptReference || ''));
  const refNameSet = new Set(refNames);
  const prevNames = extractDirectorMvOutlineRoleNames(String(state.mvStoryOutline || '')).filter(
    (n) => !refNameSet.has(n),
  );
  const regenLine = hasPrev
    ? [
        '【重新生成·硬性】必须写出全新一版，禁止复述或微调上一版。',
        refNames.length ? `本轮必须使用参考姓名：${refNames.join('、')}。` : '',
        prevNames.length ? `上一版其它姓名作废，禁止再用：${prevNames.join('、')}。` : '',
        !refNames.length && !prevNames.length ? '必须更换人物姓名、动机与主线转折。' : '主线转折与职业设定必须重写。',
        hasNotes ? '本轮人物与关系必须落实「用户参考」，不得沿用歌曲分析里的主角。' : '',
      ]
        .filter(Boolean)
        .join('')
    : refNames.length
      ? `【硬性】主角姓名必须用：${refNames.join('、')}。`
      : '';
  return {
    systemPrompt: DIRECTOR_MV_STORY_OUTLINE_SYSTEM_PROMPT,
    userPrompt: fillTemplate(DIRECTOR_MV_STORY_OUTLINE_USER_PROMPT_TEMPLATE, {
      ...vars,
      lyrics: clipLyrics(vars.lyrics),
      analysisSummary: hasNotes
        ? '（已提供用户参考：分析总结中的人名与具体情节一律作废，只可借用情绪气质。）'
        : clipText(vars.analysisSummary, 360),
      keywords: hasNotes
        ? '（仅调情绪；禁止把沙漠电台、公路货车等分析情节写成主线。）'
        : vars.keywords,
      directorNotes: clipText(vars.directorNotes, 800),
      styleHint,
      regenLine,
    }),
  };
}

/** MV 剧本步：精简输入；大段数可按批（batchFrom..batchTo）避免一次截断 */
export function buildDirectorMvScriptMessages(
  state: DirectorPipelineState,
  _directorNotes?: string,
  opts?: { batchFrom?: number; batchTo?: number; totalSegments?: number },
): { systemPrompt: string; userPrompt: string } {
  const vars = mvStoryPromptVars(state, undefined, { includeReference: false });
  const total = Math.max(
    1,
    Math.round(Number(opts?.totalSegments ?? vars.targetSegmentCount) || 0) ||
      Math.round(Number(vars.targetSegmentCount) || 0) ||
      1,
  );
  const batchFrom = Math.max(1, Math.round(Number(opts?.batchFrom) || 1));
  const batchTo = Math.min(total, Math.max(batchFrom, Math.round(Number(opts?.batchTo) || total)));
  const batchCount = batchTo - batchFrom + 1;
  const plotBrevityGuide = [
    `【输出体积·硬性】本批 ${batchCount} 段（全片 ${total}）：`,
    '· 「动作与画面」每段 ≤20 字；「对口型动作」有人声主角 ≤12 字，其余「—」；',
    '· 禁止 H3 六段式、禁止毫秒时轴、禁止长散文；',
    `· plot 必须对象数组且恰好 ${batchCount} 行；段号 ${batchFrom}..${batchTo}。`,
  ].join('\n');
  const batchNote =
    batchCount < total
      ? `【分批·硬性】全片共 ${total} 段；本请求只输出第 ${batchFrom}–${batchTo} 段（恰好 ${batchCount} 行）。人物库/场景库仍写完整。后续段另请求续写。`
      : '';
  // 系统规则压到短句，降低首包耗时（H3/长时轴已不在本步）
  const closeUpShort = String(vars.closeUpFramingGuide || '').includes('已开启')
    ? '【近景特写·开】有人主角镜仅特写/大特写；路人/空镜不限。'
    : '【近景特写·关】景别与运镜不限。';
  const paceShort = `【镜头变化】${vars.shotChangePaceLabel}，推荐转换 ${vars.shotChangePaceSec}s。`;
  const confirmedStory = (() => {
    const t = String(vars.confirmedStory || '').trim();
    const max = total >= 24 ? 700 : 1100;
    if (t.length <= max) return t;
    return `${t.slice(0, max)}…`;
  })();
  const slimUserVars = {
    durationSec: vars.durationSec,
    targetSegmentCount: String(batchCount),
    styleHint: vars.styleHint,
    confirmedStory,
    lockedCast: vars.lockedCast,
    emotions: vars.emotions,
    keywords: vars.keywords,
    plotBrevityGuide,
    shotChangePaceLabel: vars.shotChangePaceLabel,
    shotChangePaceSec: vars.shotChangePaceSec,
    shotChangePaceMood: vars.shotChangePaceMood,
    batchNote,
  };
  return {
    systemPrompt: fillTemplate(DIRECTOR_MV_SCRIPT_SYSTEM_PROMPT, {
      durationSec: vars.durationSec,
      targetSegmentCount: String(batchCount),
      closeUpFramingGuide: closeUpShort,
      plotBrevityGuide,
      shotChangePaceGuide: paceShort,
    }),
    userPrompt: fillTemplate(DIRECTOR_MV_SCRIPT_USER_PROMPT_TEMPLATE, slimUserVars),
  };
}

/** 大段数续写 plot */
export function buildDirectorMvScriptPlotContinueMessages(
  state: DirectorPipelineState,
  opts: {
    batchFrom: number;
    batchTo: number;
    totalSegments: number;
    priorPlotTail: string;
    sceneNames?: string;
  },
): { systemPrompt: string; userPrompt: string } {
  const vars = mvStoryPromptVars(state, undefined, { includeReference: false });
  const batchFrom = Math.max(1, Math.round(Number(opts.batchFrom) || 1));
  const batchTo = Math.max(batchFrom, Math.round(Number(opts.batchTo) || batchFrom));
  const batchCount = batchTo - batchFrom + 1;
  const confirmedStory = (() => {
    const t = String(vars.confirmedStory || '').trim();
    if (t.length <= 900) return t;
    return `${t.slice(0, 900)}…`;
  })();
  return {
    systemPrompt: DIRECTOR_MV_SCRIPT_PLOT_CONTINUE_SYSTEM_PROMPT,
    userPrompt: fillTemplate(DIRECTOR_MV_SCRIPT_PLOT_CONTINUE_USER_PROMPT_TEMPLATE, {
      totalSegmentCount: String(Math.max(batchTo, Math.round(Number(opts.totalSegments) || batchTo))),
      batchFrom: String(batchFrom),
      batchTo: String(batchTo),
      batchCount: String(batchCount),
      confirmedStory,
      lockedCast: vars.lockedCast,
      sceneNames: String(opts.sceneNames || '').trim() || '（沿用已有场景库短名）',
      priorPlotTail: String(opts.priorPlotTail || '').trim() || '（无）',
      emotions: vars.emotions,
      keywords: vars.keywords,
      shotChangePaceLabel: vars.shotChangePaceLabel,
      shotChangePaceSec: vars.shotChangePaceSec,
    }),
  };
}

/** AI 短剧：根据小说/剧本草稿生成小剧本 */
export function buildDirectorDramaScriptMessages(
  state: DirectorPipelineState,
  sourceText?: string,
  targetSegmentCount?: number,
): { systemPrompt: string; userPrompt: string } {
  const n = Math.max(
    4,
    Math.min(24, Math.round(Number(targetSegmentCount) || 10) || 10),
  );
  const styleHint =
    String(state.globalStyle || '').trim() ||
    String(state.stylePresetId || '').trim() ||
    '电影感写实短剧';
  const source =
    String(sourceText || '').trim() ||
    String(state.mvScriptReference || '').trim() ||
    String(state.scriptText || '').trim() ||
    '（用户未粘贴草稿，请按常见都市情感短剧结构创作一版可拍大纲）';
  const vars = {
    title: String(state.title || '').trim() || '短剧',
    targetSegmentCount: String(n),
    styleHint,
    lockedCast: formatDirectorMvLockedCastForPrompt(state) || '（未锁定主角，请自行设定 1–3 名主角）',
    sourceText: source,
  };
  return {
    systemPrompt: fillTemplate(DIRECTOR_DRAMA_SCRIPT_SYSTEM_PROMPT, {
      targetSegmentCount: vars.targetSegmentCount,
    }),
    userPrompt: fillTemplate(DIRECTOR_DRAMA_SCRIPT_USER_PROMPT_TEMPLATE, vars),
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
  /** 镜头变化档 */
  shotChangePace?: string | null;
  styleUrl?: string | null;
  leadAssetIds?: string[];
}): { systemPrompt: string; userPrompt: string } {
  const pacePreset = getDirectorMvShotChangePacePreset(opts.shotChangePace);
  const assetRefList =
    (opts.assetRefs || [])
      .map((a) => {
        const kindLabel = directorAssetKindLabel(a.kind);
        const gender = inferDirectorAssetGender(a);
        const hasImg = String(a.imageUrl || '').trim() ? '有图' : '无图';
        return `资产「${a.name}」| ${kindLabel} | 性别:${gender} | ${hasImg}`;
      })
      .join('\n') || '（无参考资产）';

  const shotAssetHints = buildDirectorShotAssetHintLines(
    opts.shots || [],
    (opts.assetRefs || []).map((a) => ({ ...a, id: '', gender: undefined })),
    {
      styleUrl: opts.styleUrl,
      leadAssetIds: opts.leadAssetIds,
    },
  );

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
      shotChangePaceGuide: resolveDirectorMvShotChangePaceGuide(pacePreset.id),
    }),
    userPrompt: fillTemplate(DIRECTOR_PROMPTS_USER_PROMPT_TEMPLATE, {
      globalStyle: String(opts.globalStyle || '').trim() || '（无）',
      assetRefList,
      shotAssetHints,
      shotsJson,
      shotChangePaceLabel: `${pacePreset.labelZh}（${pacePreset.moodZh}）·推荐转换时长 ${pacePreset.recommendSec}s`,
    }),
  };
}
