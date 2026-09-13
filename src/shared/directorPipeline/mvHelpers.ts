/**
 * MV 导演：分镜图 → 剪辑轨图片预览 / 视频替换 的时间轴片段组装。
 */

import {
  computeDirectorShotMusicRangesFromState,
  createEmptyDirectorShot,
  getDirectorMvScenesSectionText,
  getDirectorShotStoryboard,
  normalizeDirectorMvScriptSections,
  parseDirectorMvSceneEntries,
  parseDirectorMvScriptSectionsFromText,
  parseDirectorShotDurationSec,
  type DirectorPipelineState,
  type DirectorShot,
} from './schema.js';
import { packLyricSegmentsIntoShotPacks, classifyDirectorMvPackAudioRole, directorMvPackAudioRoleLabelZh } from './lyricTimeline.js';
import {
  alignDirectorMvPlotBeatsToCount,
  formatDirectorMvPlotBeatTable,
  mapDirectorMvShotIndexToPlotBeat,
  parseDirectorMvPlotBeatTable,
} from './plotBeatSheet.js';

export type DirectorMvTimelineClip = {
  id: string;
  type: 'video' | 'image' | 'audio';
  src: string;
  duration: number;
  startTime: number;
  /** 素材内裁切起点（导演入轨固定 0） */
  trimStart?: number;
  /** 素材内裁切终点 = 规划/音频段时长；成片更长时靠 trim 对齐原曲 */
  trimEnd?: number;
  /**
   * 导演规划裁切锁定：探测不得用更长成片覆盖有效时长，也不得清除 trim。
   * 入轨后 startTime 尽量为 audioStartSec 绝对时间，左吸附勿压缝。
   */
  lockTrim?: boolean;
  name?: string;
  sourceNodeId?: string;
  /** 对应导演镜号，便于生视频后替换 */
  directorShotNo?: string;
};

/** 规划段长：优先人声/音频绑定区间的真实起止差，否则镜头表「时长」 */
function resolveDirectorMvClipPlanDurationSec(
  shot: DirectorShot,
  range: { durationSec?: number; startSec?: number; endSec?: number } | undefined,
  fallbackSec: number,
): number {
  const start = Number(range?.startSec);
  const end = Number(range?.endSec);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start + 0.05) {
    return end - Math.max(0, start);
  }
  const fromRange = Number(range?.durationSec);
  if (Number.isFinite(fromRange) && fromRange > 0.05) return fromRange;
  return parseDirectorShotDurationSec(shot['时长'], fallbackSec);
}

export function buildDirectorMvImagePreviewClips(
  state: DirectorPipelineState,
): { videoClips: DirectorMvTimelineClip[]; audioClips: DirectorMvTimelineClip[] } {
  const videoClips: DirectorMvTimelineClip[] = [];
  let t = 0;
  const shots = state.shots || [];
  const ranges = computeDirectorShotMusicRangesFromState(state);
  shots.forEach((shot, i) => {
    const shotNo = String(shot['镜号'] || i + 1);
    const sb = getDirectorShotStoryboard(state, shotNo);
    const url = String(sb.imageUrl || '').trim();
    if (!url) return;
    const range = ranges[i];
    const dur = resolveDirectorMvClipPlanDurationSec(shot, range, 4);
    const startTime =
      range && Number.isFinite(range.startSec) ? Math.max(0, range.startSec) : t;
    videoClips.push({
      id: `dir-sb-${shotNo}-${i}`,
      type: 'image',
      src: url,
      duration: dur,
      startTime,
      trimStart: 0,
      trimEnd: dur,
      lockTrim: true,
      name: `镜${shotNo}`,
      directorShotNo: shotNo,
      sourceNodeId: `director-sb-placeholder-${shotNo}`,
    });
    t = startTime + dur;
  });

  const audioClips: DirectorMvTimelineClip[] = [];
  const musicUrl = String(state.mvMusic?.url || '').trim();
  if (musicUrl) {
    const musicDur =
      state.mvMusic.durationSec > 0
        ? state.mvMusic.durationSec
        : Math.max(t, 30);
    audioClips.push({
      id: `dir-music-${Date.now().toString(36)}`,
      type: 'audio',
      src: musicUrl,
      duration: musicDur,
      startTime: 0,
      name: state.mvMusic.title || 'MV音乐',
      // 固定占位源 id：勿绑真实音频节点，否则仅导演→剪辑连线时边同步会滤掉原曲
      sourceNodeId: 'director-mv-music',
    });
  }

  return { videoClips, audioClips };
}

/**
 * 已生成视频 → 剪辑轨：按镜头表顺序铺视频轨，原曲铺音轨。
 * 仅包含有成片 URL 的镜头；时长优先用音频绑定段 / 镜头表；
 * 强制 trimStart=0、trimEnd=规划时长、lockTrim，startTime 优先 audioStartSec。
 */
export function normalizeDirectorShotNoKey(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  // 「01」「1」「镜1」统一到可比对 key
  const digits = s.replace(/^镜\s*/i, '').replace(/^0+(\d)/, '$1');
  return digits || s;
}

export function buildDirectorMvVideoPreviewClips(
  state: DirectorPipelineState,
  shotVideos: Array<{ shotNo: string; videoUrl: string; sourceNodeId?: string }>,
): { videoClips: DirectorMvTimelineClip[]; audioClips: DirectorMvTimelineClip[] } {
  const byNo = new Map<
    string,
    { shotNo: string; videoUrl: string; sourceNodeId?: string }
  >();
  for (const v of shotVideos) {
    const shotNo = String(v.shotNo || '').trim();
    const videoUrl = String(v.videoUrl || '').trim();
    if (!shotNo || !videoUrl) continue;
    byNo.set(normalizeDirectorShotNoKey(shotNo), {
      shotNo,
      videoUrl,
      sourceNodeId: v.sourceNodeId,
    });
  }
  const videoClips: DirectorMvTimelineClip[] = [];
  let t = 0;
  const shots = state.shots || [];
  const ranges = computeDirectorShotMusicRangesFromState(state);
  shots.forEach((shot, i) => {
    const shotNo = String(shot['镜号'] || i + 1).trim();
    const hit = byNo.get(normalizeDirectorShotNoKey(shotNo));
    if (!hit) return;
    const range = ranges[i];
    const dur = resolveDirectorMvClipPlanDurationSec(shot, range, 4);
    const startTime =
      range && Number.isFinite(range.startSec) ? Math.max(0, range.startSec) : t;
    videoClips.push({
      id: `dir-vid-${shotNo}-${i}`,
      type: 'video',
      src: hit.videoUrl,
      duration: dur,
      startTime,
      trimStart: 0,
      trimEnd: dur,
      lockTrim: true,
      name: `镜${shotNo}`,
      directorShotNo: shotNo,
      sourceNodeId: hit.sourceNodeId || `director-video-${shotNo}`,
    });
    t = startTime + dur;
  });
  // 镜头表对不上时：按镜号铺轨，仍尽量用 ranges / 分镜冻结时间，避免一律从 0 累加与原曲错位
  if (videoClips.length === 0 && byNo.size > 0) {
    const ordered = [...byNo.values()].sort((a, b) => {
      const na = Number(normalizeDirectorShotNoKey(a.shotNo));
      const nb = Number(normalizeDirectorShotNoKey(b.shotNo));
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return String(a.shotNo).localeCompare(String(b.shotNo), 'zh');
    });
    ordered.forEach((hit, i) => {
      const shotIdx = shots.findIndex(
        (s, si) =>
          normalizeDirectorShotNoKey(String(s['镜号'] || si + 1)) ===
          normalizeDirectorShotNoKey(hit.shotNo),
      );
      const range = shotIdx >= 0 ? ranges[shotIdx] : undefined;
      const dur =
        range && Number.isFinite(range.durationSec) && range.durationSec > 0.05
          ? range.durationSec
          : 5;
      const startTime =
        range && Number.isFinite(range.startSec) ? Math.max(0, range.startSec) : t;
      videoClips.push({
        id: `dir-vid-fallback-${hit.shotNo}-${i}`,
        type: 'video',
        src: hit.videoUrl,
        duration: dur,
        startTime,
        trimStart: 0,
        trimEnd: dur,
        lockTrim: true,
        name: `镜${hit.shotNo}`,
        directorShotNo: hit.shotNo,
        sourceNodeId: hit.sourceNodeId || `director-video-${hit.shotNo}`,
      });
      t = startTime + dur;
    });
  }

  const audioClips: DirectorMvTimelineClip[] = [];
  const musicUrl = String(state.mvMusic?.url || '').trim();
  if (musicUrl) {
    const musicDur =
      state.mvMusic.durationSec > 0 ? state.mvMusic.durationSec : Math.max(t, 30);
    audioClips.push({
      id: `dir-music-${Date.now().toString(36)}`,
      type: 'audio',
      src: musicUrl,
      duration: musicDur,
      startTime: 0,
      name: state.mvMusic.title || 'MV音乐',
      sourceNodeId: 'director-mv-music',
    });
  }

  return { videoClips, audioClips };
}

/**
 * 短剧成片：按镜头表顺序首尾相接铺视频轨（跳过未出片），不绑原曲、不按 MV 乐句时间轴。
 */
export function buildDirectorDramaSequentialVideoClips(
  state: DirectorPipelineState,
  shotVideos: Array<{ shotNo: string; videoUrl: string; sourceNodeId?: string }>,
): { videoClips: DirectorMvTimelineClip[]; audioClips: DirectorMvTimelineClip[] } {
  const byNo = new Map<
    string,
    { shotNo: string; videoUrl: string; sourceNodeId?: string }
  >();
  for (const v of shotVideos) {
    const shotNo = String(v.shotNo || '').trim();
    const videoUrl = String(v.videoUrl || '').trim();
    if (!shotNo || !videoUrl) continue;
    byNo.set(normalizeDirectorShotNoKey(shotNo), {
      shotNo,
      videoUrl,
      sourceNodeId: v.sourceNodeId,
    });
  }
  const videoClips: DirectorMvTimelineClip[] = [];
  let t = 0;
  const shots = state.shots || [];
  const used = new Set<string>();
  shots.forEach((shot, i) => {
    const shotNo = String(shot['镜号'] || i + 1).trim();
    const key = normalizeDirectorShotNoKey(shotNo);
    const hit = byNo.get(key);
    if (!hit) return;
    used.add(key);
    const dur = parseDirectorShotDurationSec(shot['时长'], 5);
    videoClips.push({
      id: `dir-drama-vid-${shotNo}-${i}`,
      type: 'video',
      src: hit.videoUrl,
      duration: dur,
      startTime: t,
      trimStart: 0,
      trimEnd: dur,
      lockTrim: true,
      name: `镜${shotNo}`,
      directorShotNo: shotNo,
      sourceNodeId: hit.sourceNodeId || `director-video-${shotNo}`,
    });
    t += dur;
  });
  if (videoClips.length === 0 && byNo.size > 0) {
    const ordered = [...byNo.values()].sort((a, b) => {
      const na = Number(normalizeDirectorShotNoKey(a.shotNo));
      const nb = Number(normalizeDirectorShotNoKey(b.shotNo));
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return String(a.shotNo).localeCompare(String(b.shotNo), 'zh');
    });
    ordered.forEach((hit, i) => {
      const dur = 5;
      videoClips.push({
        id: `dir-drama-vid-fallback-${hit.shotNo}-${i}`,
        type: 'video',
        src: hit.videoUrl,
        duration: dur,
        startTime: t,
        trimStart: 0,
        trimEnd: dur,
        lockTrim: true,
        name: `镜${hit.shotNo}`,
        directorShotNo: hit.shotNo,
        sourceNodeId: hit.sourceNodeId || `director-video-${hit.shotNo}`,
      });
      t += dur;
    });
  } else if (used.size < byNo.size) {
    const leftovers = [...byNo.values()]
      .filter((v) => !used.has(normalizeDirectorShotNoKey(v.shotNo)))
      .sort((a, b) => {
        const na = Number(normalizeDirectorShotNoKey(a.shotNo));
        const nb = Number(normalizeDirectorShotNoKey(b.shotNo));
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return String(a.shotNo).localeCompare(String(b.shotNo), 'zh');
      });
    leftovers.forEach((hit, i) => {
      const dur = 5;
      videoClips.push({
        id: `dir-drama-vid-extra-${hit.shotNo}-${i}`,
        type: 'video',
        src: hit.videoUrl,
        duration: dur,
        startTime: t,
        trimStart: 0,
        trimEnd: dur,
        lockTrim: true,
        name: `镜${hit.shotNo}`,
        directorShotNo: hit.shotNo,
        sourceNodeId: hit.sourceNodeId || `director-video-${hit.shotNo}`,
      });
      t += dur;
    });
  }
  return { videoClips, audioClips: [] };
}

/** 用已生成视频 URL 替换同镜号的图片占位（保留 startTime/duration/trim/lockTrim） */
export function replaceDirectorMvPlaceholdersWithVideos(
  existingVideoClips: DirectorMvTimelineClip[],
  shotVideos: Array<{ shotNo: string; videoUrl: string; sourceNodeId?: string }>,
): DirectorMvTimelineClip[] {
  const byNo = new Map(
    shotVideos.map((v) => [normalizeDirectorShotNoKey(String(v.shotNo)), v] as const),
  );
  return existingVideoClips.map((clip) => {
    const no = String(clip.directorShotNo || '').trim();
    if (!no) return clip;
    const hit = byNo.get(normalizeDirectorShotNoKey(no)) || byNo.get(no);
    if (!hit?.videoUrl) return clip;
    return {
      ...clip,
      type: 'video' as const,
      src: hit.videoUrl,
      name: clip.name || `镜${no}`,
      sourceNodeId: hit.sourceNodeId || clip.sourceNodeId,
      // 换 src 后仍锁定规划裁切，避免探测/压缝打乱与原曲对齐
      lockTrim: clip.lockTrim ?? true,
      trimStart: clip.trimStart ?? 0,
      trimEnd:
        clip.trimEnd != null && clip.trimEnd > (clip.trimStart ?? 0)
          ? clip.trimEnd
          : clip.duration,
    };
  });
}

export function buildMvShotsIntentText(state: DirectorPipelineState): string {
  const music = state.mvMusic;
  const analysis = state.mvStoryAnalysis;
  const castNames = (state.assets.characters || [])
    .map((c) => String(c.name || '').trim())
    .filter(Boolean);
  let sceneNames = (state.assets.scenes || [])
    .map((s) => String(s.name || '').trim())
    .filter(Boolean);
  if (!sceneNames.length) {
    sceneNames = parseDirectorMvSceneEntries(getDirectorMvScenesSectionText(state))
      .map((e) => String(e.name || '').trim())
      .filter(Boolean);
  }
  const packs = packLyricSegmentsIntoShotPacks(music?.lyricSegments || [], {
    clipLengthMode: music?.clipLengthMode,
  });
  const sections = normalizeDirectorMvScriptSections(
    analysis?.sections || parseDirectorMvScriptSectionsFromText(String(state.scriptText || '')),
  );
  const rawPlotBeats = parseDirectorMvPlotBeatTable(sections.plot);
  // 拆镜意图：剧情段先对齐到音频 pack 数，保证「每镜对应剧情段」1:1
  const plotBeats =
    packs.length > 0 && rawPlotBeats?.length && rawPlotBeats.length !== packs.length
      ? alignDirectorMvPlotBeatsToCount(rawPlotBeats, packs.length)
      : rawPlotBeats;
  const shotCountForMap = packs.length > 0 ? packs.length : plotBeats?.length || 0;
  const packBlock =
    packs.length > 0
      ? [
          `人声时间轴镜头包（共 ${packs.length} 镜；时长档 ${music?.clipLengthMode === 'short' ? '短镜严格 4/5/6s（含纯音乐；句间大间隔拆段）' : '长镜 10/15s'}，按歌词边界切满全曲；禁止改时长）：`,
          '【音频-画面匹配】每镜已标注「有人声」或「前奏/间奏/尾奏/无人声」。无人声≠无人、无主角≠无人：可有路人/群众；禁止拿麦演唱/对口型/开麦，并明确禁止开口、闭嘴沉默。有人声可对口型，但禁止把歌词/台词写进画面描述。画面内容优先服从下方「每镜对应剧情段」。',
          ...packs.map((p, i) => {
            const clock = (sec: number) => {
              const s = Math.max(0, Math.floor(sec));
              return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
            };
            const dur = Math.max(1, Math.round(p.durationSec));
            const lyric = p.text || '（间奏/过门）';
            const role = classifyDirectorMvPackAudioRole(packs, i);
            const roleZh = directorMvPackAudioRoleLabelZh(role);
            const beat = plotBeats?.length
              ? mapDirectorMvShotIndexToPlotBeat(i, packs.length, plotBeats)
              : null;
            const beatHint = beat
              ? `|剧本段${beat.no}|${beat.section}|${beat.castType}|场景:${beat.scene}|角色:${beat.cast}|动作:${beat.action}|情绪:${beat.mood}`
              : '';
            return `镜${i + 1}|时长 ${dur}s|${clock(p.startSec)}-${clock(p.endSec)}|${roleZh}|${lyric}${beatHint}`;
          }),
        ].join('\n')
      : '';
  const perShotBeatBlock =
    plotBeats?.length && shotCountForMap > 0
      ? [
          `每镜对应剧情段（硬性对照；画面描述/景别/运镜须按此填写）：`,
          ...Array.from({ length: shotCountForMap }, (_, i) => {
            const beat = mapDirectorMvShotIndexToPlotBeat(i, shotCountForMap, plotBeats);
            if (!beat) return `镜${i + 1}|（无对应剧情段）`;
            return `镜${i + 1}|段${beat.no}|${beat.section}|人声:${beat.vocal}|${beat.castType}|场景:${beat.scene}|角色:${beat.cast}|角度:${beat.angle}|焦距:${beat.focal}|动作:${beat.action}|情绪:${beat.mood}`;
          }),
        ].join('\n')
      : '';
  const plotBlock = plotBeats?.length
    ? [
        `剧情规划明细表（步骤四剧本；共 ${plotBeats.length} 段${
          packs.length > 0 ? `，已对齐音频片段 ${packs.length}` : ''
        }；拆镜镜数必须 = 此段数，且落实场景/角色/镜头角度/焦距/动作/空镜有人）：`,
        formatDirectorMvPlotBeatTable(plotBeats),
      ].join('\n')
    : state.scriptText
      ? `剧本故事：\n${state.scriptText}`
      : '';
  const restScript =
    plotBeats?.length && state.scriptText
      ? [
          sections.worldView ? `世界观：${sections.worldView}` : '',
          sections.relationships ? `人物关系：${sections.relationships}` : '',
          sections.characters ? `人物库：\n${sections.characters}` : '',
          sections.scenes ? `场景库：\n${sections.scenes}` : '',
          sections.props ? `道具库：\n${sections.props}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '';
  const parts = [
    music.title ? `曲名：${music.title}` : '',
    music.durationSec > 0 ? `时长：约 ${Math.round(music.durationSec)} 秒` : '',
    analysis?.summary || music.summary ? `分析总结：${analysis?.summary || music.summary}` : '',
    analysis?.genre ? `曲风：${analysis.genre}` : '',
    (analysis?.emotions || []).length
      ? `主要情绪：${analysis.emotions.join('、')}`
      : music.moodHint
        ? `情绪/主题：${music.moodHint}`
        : '',
    (analysis?.keywords || []).length ? `歌曲关键词：${analysis.keywords.join('、')}` : '',
    (analysis?.scriptKeywords || []).length
      ? `剧本关键词：${analysis.scriptKeywords.join('、')}`
      : '',
    packBlock,
    perShotBeatBlock,
    music.lyrics ? `歌词：\n${music.lyrics}` : '',
    plotBlock,
    restScript,
    `画幅：${state.mvAspectRatio || '16:9'}`,
    `全篇风格：${state.globalStyle || ''}`,
    castNames.length ? `出场角色（须使用这些称呼）：${castNames.join('、')}` : '',
    sceneNames.length
      ? `已确认场景库（须全部用到，画面描述须写出场景短名）：${sceneNames.join('、')}`
      : '',
  ].filter(Boolean);
  return parts.join('\n') || '（请根据流行 MV 节奏拆镜）';
}

/**
 * 确保镜头表「画面描述」覆盖全部已确认场景名：未出现的场景会写入若干镜头描述，便于绑定与展示。
 */
export function ensureMvShotsCoverSceneNames(
  shots: DirectorShot[],
  sceneNames: string[],
): DirectorShot[] {
  const names = (sceneNames || []).map((n) => String(n || '').trim()).filter(Boolean);
  if (!shots.length || !names.length) return shots;

  const mentioned = new Set<string>();
  for (const shot of shots) {
    const blob = [
      shot['画面描述'],
      shot['光影氛围'],
      shot['对白旁白'],
      shot['运镜'],
    ]
      .map((x) => String(x || ''))
      .join('\n');
    for (const name of names) {
      if (blob.includes(name)) mentioned.add(name);
    }
  }
  const missing = names.filter((n) => !mentioned.has(n));
  if (missing.length === 0) return shots;

  const out = shots.map((s) => ({ ...s }));
  const n = out.length;
  // 均匀落点，避免全挤在开头；绝不把「场景：」单独写入全空的手动新行
  for (let i = 0; i < missing.length; i++) {
    const name = missing[i];
    const preferred = Math.min(n - 1, Math.round(((i + 0.5) * n) / missing.length));
    let slot = -1;
    for (let k = 0; k < n; k++) {
      const idx = (preferred + k) % n;
      const desc = String(out[idx]['画面描述'] || '').trim();
      if (desc && desc !== '—' && !desc.includes(name)) {
        slot = idx;
        break;
      }
    }
    if (slot < 0) continue;
    const desc = String(out[slot]['画面描述'] || '').trim();
    out[slot] = {
      ...out[slot],
      画面描述: `${desc}（场景：${name}）`,
    };
  }
  return out;
}

/** 按约 5 秒一镜估算镜头数（与成片常见 5/6/10s 对齐），夹在 4–60 */
export function estimateShotCountFromMusicDuration(durationSec: number): number {
  const total = Math.round(Number(durationSec) || 0);
  if (total <= 0) return 8;
  return Math.max(4, Math.min(60, Math.round(total / 5) || 1));
}

/**
 * MV「音频片段数」真源：lyric packs 数；若尚无时间轴则用已同步分镜数，再否则按曲长估算。
 * 剧本段数 / 拆镜数均应对齐此值。
 */
export function resolveDirectorMvAudioClipCount(
  state: Pick<DirectorPipelineState, 'mvMusic' | 'shots'>,
): number {
  const packs = packLyricSegmentsIntoShotPacks(state.mvMusic?.lyricSegments || [], {
    clipLengthMode: state.mvMusic?.clipLengthMode,
  });
  if (packs.length > 0) return packs.length;
  const shotLen = (state.shots || []).length;
  if (shotLen > 0) return shotLen;
  return estimateShotCountFromMusicDuration(Number(state.mvMusic?.durationSec) || 0);
}

/**
 * 将总时长分配到 n 镜：仅用 i2v 友好档 5/10/15，避免 4/6 与生成档错位累计漂移。
 * 余量不足一档时宁可略短于整曲（入轨 trim / audioStartSec 仍以音频段为准）。
 */
export function planMvShotDurationsForCount(totalSec: number, shotCount: number): number[] {
  const n = Math.max(1, Math.round(Number(shotCount) || 1));
  const total = Math.max(0, Math.round(Number(totalSec) || 0));
  if (total <= 0) return Array.from({ length: n }, () => 5);

  const durations = Array.from({ length: n }, () => 5);
  let rem = total - 5 * n;
  let i = 0;
  while (rem >= 5 && i < n * 24) {
    const idx = i % n;
    if (durations[idx] === 5) {
      durations[idx] = 10;
      rem -= 5;
    } else if (durations[idx] === 10) {
      durations[idx] = 15;
      rem -= 5;
    }
    i += 1;
  }
  return durations;
}

/**
 * 规划 MV 各镜时长（秒）：按 5s 估镜数后分配。
 */
export function planMvShotDurations(totalSec: number): number[] {
  const total = Math.max(0, Math.round(Number(totalSec) || 0));
  const n = estimateShotCountFromMusicDuration(total || 0);
  return planMvShotDurationsForCount(total, n);
}

/** 合计镜头表「时长」字段（秒） */
export function sumDirectorShotsDurationSec(shots: DirectorShot[]): number {
  return (shots || []).reduce(
    (acc, s) => acc + parseDirectorShotDurationSec(s['时长'], 0),
    0,
  );
}

/**
 * 按歌曲时长把镜头数补到约「每镜 5 秒」，再分配 5/10/15 时长。
 * 镜数过少时循环扩展已有镜头内容（避免单镜 30s+）。
 */
export function ensureMvShotsMatchMusicDuration(
  shots: DirectorShot[],
  totalMusicSec: number,
): DirectorShot[] {
  const total = Math.max(0, Math.round(Number(totalMusicSec) || 0));
  if (!shots.length || total <= 0) return shots;

  const target = estimateShotCountFromMusicDuration(total);
  let list = shots.map((s, i) => ({ ...s, 镜号: String(i + 1) }));

  if (list.length < target) {
    let i = 0;
    while (list.length < target) {
      const src = shots[i % shots.length];
      const idx = list.length;
      const desc = String(src['画面描述'] || '').trim();
      list.push({
        ...createEmptyDirectorShot(idx),
        ...src,
        镜号: String(idx + 1),
        画面描述: desc ? `${desc}（续）` : desc,
        最终提示词: String(src['最终提示词'] || '').trim(),
      });
      i += 1;
    }
  }

  list = list.map((s, i) => ({ ...s, 镜号: String(i + 1) }));
  return distributeShotDurations(list, total, { preferMvFiveOrTen: true });
}

export function distributeShotDurations(
  shots: DirectorShot[],
  totalMusicSec: number,
  opts?: { preferMvFiveOrTen?: boolean },
): DirectorShot[] {
  if (!shots.length) return shots;
  const total = Math.max(0, Math.round(Number(totalMusicSec) || 0));
  if (total <= 0) return shots;
  if (opts?.preferMvFiveOrTen) {
    const durations = planMvShotDurationsForCount(total, shots.length);
    return shots.map((s, i) => ({
      ...s,
      时长: `${durations[i] ?? 5}s`,
    }));
  }
  const durations = planMvShotDurationsForCount(total, shots.length);
  return shots.map((s, i) => {
    const parsed = parseDirectorShotDurationSec(s['时长'], 0);
    if (parsed > 0) return s;
    return { ...s, 时长: `${durations[i] ?? 5}s` };
  });
}
