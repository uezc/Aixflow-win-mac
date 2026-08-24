/**
 * AI 短剧导演：剧本解析与剧情表→镜头（自研，不依赖 waoowaoo 代码）。
 */

import {
  createDefaultDirectorPipelineState,
  createEmptyDirectorShot,
  ensureDirectorMvLeadSlots,
  syncDirectorMvCastFromScript,
  type DirectorPipelineState,
  type DirectorShot,
} from './schema.js';
import {
  alignDirectorMvPlotBeatsToCount,
  applyDirectorMvPlotBeatsToShots,
  parseDirectorMvPlotBeatTable,
  type DirectorMvPlotBeatRow,
} from './plotBeatSheet.js';
import type { NormalizeDirectorMvScriptResult } from './normalize.js';

/** 短剧默认目标镜数（无用户指定时） */
export const DIRECTOR_DRAMA_DEFAULT_SHOT_COUNT = 12;

function isEmptyCell(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return !s || s === '—' || s === '-';
}

function extractLabeledChunk(desc: string, labels: string[]): string {
  const re = new RegExp(
    `(?:${labels.join('|')})\\s*[：:]\\s*([^\\n。；;，,]{1,40})`,
  );
  const m = String(desc || '').match(re);
  return String(m?.[1] || '').trim();
}

function stripLabeledChunksFromDesc(desc: string): string {
  return String(desc || '')
    .replace(/(?:场景|地点)\s*[：:]\s*[^\n。；;，,]{1,40}[。．]?/g, '')
    .replace(/(?:出场|出场角色|出场人物)\s*[：:]\s*[^\n。；;]{1,48}[。．]?/g, '')
    .replace(/[。．]{2,}/g, '。')
    .replace(/^[。．\s]+|[。．\s]+$/g, '')
    .trim();
}

function inferIntExt(location: string, desc: string, light: string): string {
  const blob = `${location} ${desc} ${light}`;
  if (/户外|外景|街道|广场|天台|野外|停车场|巷|马路|海边|山顶|露台|屋顶|桥|操场/.test(blob)) {
    return '外';
  }
  if (
    /室内|内景|房间|屋|厅|室|楼梯间|走廊|电梯|办公室|酒吧|咖啡馆|医院|车厢|仓|实验室|地下室|卫生间|厨房|仓库|影院|教室/.test(
      blob,
    )
  ) {
    return '内';
  }
  if (/楼梯|门廊|玄关|窗内/.test(blob)) return '内';
  return '内';
}

function inferDayNight(light: string, desc: string, mood: string): string {
  const blob = `${light} ${desc} ${mood}`;
  if (/凌晨|深夜|黑夜|夜晚|月光|霓虹|应急灯|夜色|夜里|午夜/.test(blob)) return '夜';
  if (/晨|黎明|日出|清晨/.test(blob)) return '晨';
  if (/黄昏|日落|傍晚|暮色/.test(blob)) return '黄昏';
  if (/白天|日光|阳光|正午|午后|日间/.test(blob)) return '日';
  if (/阴郁|压抑|冷蓝|应急/.test(blob)) return '夜';
  return '日';
}

function speakersFromDialogue(dialogue: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of String(dialogue || '').split(/\n+/)) {
    const m = String(line || '')
      .trim()
      .match(/^([\u4e00-\u9fffA-Za-z0-9·]{1,12})\s*[：:]/);
    const name = String(m?.[1] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function ensureDialogueHasSpeaker(dialogue: string, cast: string): string {
  const d = String(dialogue || '').trim();
  if (!d || d === '—' || d === '-') return '';
  // 已有「角色名：台词」
  if (/^[\u4e00-\u9fffA-Za-z0-9·]{1,12}\s*[：:]/.test(d)) return d;
  const first = String(cast || '')
    .split(/[、,，/／]/)
    .map((x) => x.trim())
    .find((x) => x && x !== '—' && x !== '-');
  if (first) return `${first}：${d}`;
  return d;
}

const SHOT_SIZE_RE = /^(全景|远景|中景|近景|中近景|特写|大特写|中全景|大全景)$/;

function fixAngleIfLooksLikeShotSize(angle: string): string {
  const a = String(angle || '').trim();
  if (!a || a === '—') return '';
  if (SHOT_SIZE_RE.test(a)) return '平视';
  return a;
}

function parseCharacterNames(charactersText: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of String(charactersText || '').split(/\n+/)) {
    const m = String(line || '')
      .trim()
      .match(/^([\u4e00-\u9fffA-Za-z0-9·]{1,16})\s*[：:]/);
    const name = String(m?.[1] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function castMentionedInText(text: string, roster: string[]): string[] {
  const blob = String(text || '');
  return roster.filter((name) => name.length >= 2 && blob.includes(name));
}

function inferProdNotes(shot: DirectorShot, roster: string[]): string {
  const desc = String(shot['画面描述'] || '');
  const cast = String(shot['出场人物'] || '').trim();
  const parts: string[] = [];
  if (cast) parts.push(`妆造/服装对齐角色卡：${cast}`);
  if (/血|伤|灰|泥|湿|泪|汗/.test(desc)) parts.push('脏污/妆面状态与上镜连贯');
  if (/门|枪|刀|手机|信|钥匙|听诊器|消防/.test(desc)) {
    const hit = desc.match(/(消防门|听诊器|手机|钥匙|信件|枪|刀)[^，。；\s]{0,6}/);
    if (hit?.[1]) parts.push(`道具：${hit[1]}`);
  }
  if (!parts.length && roster.length) {
    parts.push('服装化妆按角色卡，无额外特效');
  }
  return parts.join('；').slice(0, 96);
}

function buildRefBind(shot: DirectorShot): string {
  const parts: string[] = [];
  const loc = String(shot['地点'] || '').trim();
  const cast = String(shot['出场人物'] || '').trim();
  if (loc && loc !== '—') parts.push(`场景：${loc}`);
  if (cast && cast !== '—') parts.push(`角色：${cast}`);
  const desc = String(shot['画面描述'] || '');
  if (/消防门/.test(desc)) parts.push('道具：消防门');
  else if (/听诊器/.test(desc)) parts.push('道具：听诊器');
  return parts.join('；');
}

/**
 * 分析后本地补齐场次层 / 镜头层缺项 / 制作层，避免模型漏字段导致表内大量「—」。
 */
export function completeDirectorDramaShotLayers(
  shots: DirectorShot[],
  opts?: { charactersText?: string; beats?: DirectorMvPlotBeatRow[] | null },
): DirectorShot[] {
  const list = (shots || []).map((s, i) => ({
    ...createEmptyDirectorShot(i),
    ...s,
    镜号: String(s['镜号'] || i + 1),
  }));
  if (!list.length) return list;

  const roster = parseCharacterNames(String(opts?.charactersText || ''));
  const beats = opts?.beats || [];

  let filled = list.map((shot, i) => {
    const beat = beats[i];
    let next = beat ? enrichDramaShotFromBeat(shot, beat) : { ...shot };

    const desc0 = String(next['画面描述'] || '');
    const fromDescLoc = extractLabeledChunk(desc0, ['场景', '地点']);
    const fromDescCast = extractLabeledChunk(desc0, ['出场', '出场角色', '出场人物']);

    if (isEmptyCell(next['地点'])) {
      next['地点'] =
        fromDescLoc ||
        (beat?.scene && beat.scene !== '—' ? beat.scene : '') ||
        '';
    }
    if (isEmptyCell(next['出场人物'])) {
      const fromDlg = speakersFromDialogue(String(next['对白旁白'] || '')).join('、');
      const fromRoster = castMentionedInText(
        `${desc0} ${next['对白旁白'] || ''}`,
        roster,
      ).join('、');
      next['出场人物'] =
        fromDescCast ||
        fromDlg ||
        fromRoster ||
        (beat?.cast && beat.cast !== '—' ? beat.cast : '') ||
        '';
    }

    // 空镜：出场人物置空
    if (/空镜|无人物/.test(desc0) || beat?.castType === '空镜') {
      if (!speakersFromDialogue(String(next['对白旁白'] || '')).length) {
        next['出场人物'] = '';
      }
    }

    if (isEmptyCell(next['内外景'])) {
      next['内外景'] = inferIntExt(
        String(next['地点'] || ''),
        desc0,
        String(next['光影氛围'] || ''),
      );
    }
    if (isEmptyCell(next['日夜'])) {
      next['日夜'] = inferDayNight(
        String(next['光影氛围'] || ''),
        desc0,
        String(next['光影氛围'] || ''),
      );
    }

    // 机位被误填成景别时纠正
    if (!isEmptyCell(next['镜头角度'])) {
      next['镜头角度'] = fixAngleIfLooksLikeShotSize(String(next['镜头角度'] || '')) || next['镜头角度'];
    } else if (beat?.angle) {
      next['镜头角度'] = String(beat.angle).trim();
    } else {
      next['镜头角度'] = '平视';
    }

    if (isEmptyCell(next['焦距'])) {
      next['焦距'] = String(beat?.focal || '').trim() || '50mm';
    }
    if (isEmptyCell(next['运镜'])) {
      next['运镜'] = '固定';
    }
    if (isEmptyCell(next['景别'])) {
      next['景别'] = /空镜|无人物/.test(desc0) ? '全景' : '中景';
    }
    if (isEmptyCell(next['时长'])) {
      next['时长'] = String(next['对白旁白'] || '').trim() ? '8s' : '5s';
    }
    if (isEmptyCell(next['光影氛围']) && beat?.mood) {
      next['光影氛围'] = String(beat.mood).trim();
    }
    if (isEmptyCell(next['光影氛围'])) {
      next['光影氛围'] = '情绪贴合剧情，光色跟分镜图';
    }

    next['对白旁白'] = ensureDialogueHasSpeaker(
      String(next['对白旁白'] || ''),
      String(next['出场人物'] || ''),
    );

    if (isEmptyCell(next['音效'])) {
      const blob = `${desc0} ${next['地点'] || ''} ${next['光影氛围'] || ''}`;
      if (/漏水|滴水/.test(blob)) next['音效'] = '漏水声';
      else if (/门/.test(blob)) next['音效'] = '金属门撞击声';
      else if (/脚步|楼梯|走廊/.test(blob)) next['音效'] = '脚步声';
      else if (/雨/.test(blob)) next['音效'] = '雨声';
      else if (/风/.test(blob)) next['音效'] = '风声';
      else if (/空镜|无人物/.test(desc0)) next['音效'] = '环境底噪';
      else next['音效'] = '环境声';
    }

    // 画面动作：去掉已拆到场次列的「场景/出场」前缀
    if (fromDescLoc || fromDescCast) {
      const cleaned = stripLabeledChunksFromDesc(desc0);
      if (cleaned) next['画面描述'] = cleaned;
    }

    if (isEmptyCell(next['参考图绑定'])) {
      next['参考图绑定'] = buildRefBind(next);
    }
    if (isEmptyCell(next['制作备注'])) {
      next['制作备注'] = inferProdNotes(next, roster);
    }

    // 保留已有最终提示词；仅清空「待生成」占位
    const prevFinal = String(shot['最终提示词'] || '').trim();
    next['最终提示词'] = prevFinal && !/^待生成/.test(prevFinal) ? prevFinal : '';
    return next;
  });

  // 场号：同地点连续镜共用一场，换地点递增
  let sceneNo = 0;
  let lastLoc = '';
  filled = filled.map((shot) => {
    const loc = String(shot['地点'] || '').trim();
    if (loc && loc !== lastLoc) {
      sceneNo += 1;
      lastLoc = loc;
    } else if (!sceneNo) {
      sceneNo = 1;
    }
    if (isEmptyCell(shot['场号'])) {
      return { ...shot, 场号: String(sceneNo) };
    }
    return shot;
  });

  // 连贯性：依赖邻镜，第二遍写
  filled = filled.map((shot, i) => {
    if (!isEmptyCell(shot['连贯性'])) return shot;
    if (i === 0) return { ...shot, 连贯性: '开场' };
    const prev = filled[i - 1];
    const prevLoc = String(prev['地点'] || '').trim();
    const curLoc = String(shot['地点'] || '').trim();
    const prevNo = String(prev['镜号'] || i);
    const prevAct = String(prev['画面描述'] || '')
      .replace(/\s+/g, '')
      .slice(0, 18);
    if (prevLoc && curLoc && prevLoc !== curLoc) {
      return { ...shot, 连贯性: `转场：${prevLoc}→${curLoc}` };
    }
    const bits = [`接镜${prevNo}`];
    if (prevAct) bits.push(prevAct);
    const prevCast = String(prev['出场人物'] || '').trim();
    const curCast = String(shot['出场人物'] || '').trim();
    if (prevCast && curCast && prevCast !== curCast) {
      bits.push(`人物：${prevCast}→${curCast}`);
    }
    return { ...shot, 连贯性: bits.join('；').slice(0, 80) };
  });

  return filled;
}

function enrichDramaShotFromBeat(shot: DirectorShot, beat: DirectorMvPlotBeatRow | undefined): DirectorShot {
  if (!beat) return shot;
  const next: DirectorShot = { ...shot };
  const scene = String(beat.scene || '').trim();
  const cast = String(beat.cast || '').trim();
  if (isEmptyCell(next['场号'])) {
    next['场号'] = String(beat.no || '').trim() || String(next['镜号'] || '');
  }
  if (isEmptyCell(next['地点']) && scene && scene !== '—') {
    next['地点'] = scene;
  }
  if (isEmptyCell(next['出场人物']) && cast && cast !== '—') {
    next['出场人物'] = cast;
  }
  if (isEmptyCell(next['镜头角度']) && String(beat.angle || '').trim()) {
    next['镜头角度'] = String(beat.angle).trim();
  }
  if (isEmptyCell(next['焦距']) && String(beat.focal || '').trim()) {
    next['焦距'] = String(beat.focal).trim();
  }
  if (isEmptyCell(next['光影氛围']) && String(beat.mood || '').trim()) {
    next['光影氛围'] = String(beat.mood).trim();
  }
  if (isEmptyCell(next['参考图绑定'])) {
    const parts: string[] = [];
    if (scene && scene !== '—') parts.push(`场景：${scene}`);
    if (cast && cast !== '—') parts.push(`角色：${cast}`);
    if (parts.length) next['参考图绑定'] = parts.join('；');
  }
  if (isEmptyCell(next['时长'])) {
    next['时长'] = /有人声|有对白/.test(String(beat.vocal || '')) ? '6s' : '5s';
  }
  // 对白：有人声且动作里带引号/冒号台词时尽量抽出（角色名：台词）
  if (isEmptyCell(next['对白旁白']) && /有人声|有对白/.test(String(beat.vocal || ''))) {
    const action = String(beat.action || '');
    const quoted =
      action.match(/([\u4e00-\u9fffA-Za-z0-9·]{1,12})\s*[：:]\s*[「『“"]([^」』”"]{1,120})[」』”"]/) ||
      action.match(/([\u4e00-\u9fff]{1,8})\s*[：:]\s*([^\n。；;]{2,60})/) ||
      action.match(/[「『“"]([^」』”"]{2,80})[」』”"]/);
    if (quoted) {
      if (quoted[2]) {
        next['对白旁白'] = `${quoted[1]}：${quoted[2]}`.trim();
      } else if (cast && cast !== '—' && !String(cast).includes('、') && !String(cast).includes(',')) {
        next['对白旁白'] = `${cast}：${quoted[1]}`.trim();
      } else {
        next['对白旁白'] = String(quoted[1] || '').trim();
      }
    }
  }
  if (isEmptyCell(next['音效'])) {
    const mood = String(beat.mood || '');
    const action = String(beat.action || '');
    const blob = `${action} ${mood} ${beat.scene || ''}`;
    if (/键盘|敲击|打字/.test(blob)) next['音效'] = '键盘敲击声';
    else if (/雨|雷/.test(blob)) next['音效'] = '雨声';
    else if (/门/.test(blob)) next['音效'] = '开门声';
    else if (/脚步|走廊|楼梯/.test(blob)) next['音效'] = '脚步声';
    else if (/风/.test(blob)) next['音效'] = '风声';
  }
  // 分析步不预写最终提示词
  next['最终提示词'] = '';
  return next;
}

function dramaShotsCompleteContext(state: DirectorPipelineState): {
  charactersText: string;
  beats: DirectorMvPlotBeatRow[] | null;
} {
  const sections = state.mvStoryAnalysis?.sections;
  const charactersText = String(sections?.characters || '').trim();
  const plot = String(sections?.plot || '').trim();
  const beats = plot ? parseDirectorMvPlotBeatTable(plot) : null;
  return { charactersText, beats };
}

/** 从剧情表生成/回填镜头表（无 AI shots 时的回退） */
export function ensureDirectorDramaShotsFromScript(
  state: DirectorPipelineState,
  opts?: { keepPhase?: boolean; preferExistingShots?: boolean },
): DirectorPipelineState {
  const existing = state.shots || [];
  const filledExisting = existing.filter((s) => String(s['画面描述'] || '').trim()).length;
  const ctx = dramaShotsCompleteContext(state);

  // 已有分析产出的完整镜头表：保留并本地补齐三层字段
  if (opts?.preferExistingShots && filledExisting >= 2) {
    let shots = existing.map((s, i) => ({
      ...createEmptyDirectorShot(i),
      ...s,
      镜号: String(s['镜号'] || i + 1),
      最终提示词:
        String(s['最终提示词'] || '').trim() && !/^待生成/.test(s['最终提示词'])
          ? s['最终提示词']
          : '',
    }));
    shots = completeDirectorDramaShotLayers(shots, {
      charactersText: ctx.charactersText,
      beats: ctx.beats,
    });
    return createDefaultDirectorPipelineState({
      ...state,
      shots,
      phase: opts?.keepPhase ? state.phase : 'shots',
    });
  }

  const sections = state.mvStoryAnalysis?.sections;
  const plot = String(sections?.plot || '').trim();
  const beats = plot ? parseDirectorMvPlotBeatTable(plot) : null;
  if (!beats?.length) {
    if (existing.length > 0) {
      const shots = completeDirectorDramaShotLayers(existing, {
        charactersText: ctx.charactersText,
        beats: null,
      });
      return createDefaultDirectorPipelineState({
        ...state,
        shots,
        phase: opts?.keepPhase ? state.phase : 'shots',
      });
    }
    return createDefaultDirectorPipelineState({
      ...state,
      shots: [createEmptyDirectorShot(0)],
      phase: opts?.keepPhase ? state.phase : 'shots',
    });
  }
  const target = beats.length;
  const aligned = alignDirectorMvPlotBeatsToCount(beats, target) || beats;
  let shots: DirectorShot[] = existing;
  if (shots.length !== aligned.length) {
    shots = aligned.map((_, i) => {
      const prev = shots[i];
      return prev ? { ...createEmptyDirectorShot(i), ...prev, 镜号: String(i + 1) } : createEmptyDirectorShot(i);
    });
  }
  shots = applyDirectorMvPlotBeatsToShots(shots, aligned, { forceDesc: true, forceFraming: true });
  shots = shots.map((shot, i) => enrichDramaShotFromBeat(shot, aligned[i]));
  shots = completeDirectorDramaShotLayers(shots, {
    charactersText: ctx.charactersText,
    beats: aligned,
  });
  // 不预合成最终提示词：分析后保持「待生成提示词」
  return createDefaultDirectorPipelineState({
    ...state,
    shots,
    phase: opts?.keepPhase ? state.phase : 'shots',
  });
}

/** 写入短剧解析结果并同步卡司；若含 shots 则直接落地镜头表 */
export function applyDirectorDramaScriptResult(
  state: DirectorPipelineState,
  normalized: Extract<NormalizeDirectorMvScriptResult, { ok: true }>,
): DirectorPipelineState {
  let next: DirectorPipelineState = {
    ...state,
    scriptText: normalized.script,
    mvStoryAnalysis: {
      ...state.mvStoryAnalysis,
      summary: String(state.mvStoryAnalysis?.summary || '').trim() || '短剧剧本已生成',
      genre: String(state.mvStoryAnalysis?.genre || '').trim() || '短剧',
      emotions: state.mvStoryAnalysis?.emotions || [],
      keywords: state.mvStoryAnalysis?.keywords || [],
      scriptKeywords: normalized.scriptKeywords,
      sections: normalized.sections,
    },
  };
  if (normalized.shots && normalized.shots.length > 0) {
    const charactersText = String(normalized.sections?.characters || '').trim();
    const plot = String(normalized.sections?.plot || '').trim();
    const beats = plot ? parseDirectorMvPlotBeatTable(plot) : null;
    const shots = completeDirectorDramaShotLayers(
      normalized.shots.map((s, i) => ({
        ...createEmptyDirectorShot(i),
        ...s,
        镜号: String(s['镜号'] || i + 1),
        最终提示词: '',
      })),
      { charactersText, beats },
    ).map((s) => ({ ...s, 最终提示词: '' }));
    next = { ...next, shots };
  }
  next = syncDirectorMvCastFromScript(next, 'fill');
  next = ensureDirectorMvLeadSlots(next);
  return createDefaultDirectorPipelineState({
    ...next,
    isGenerating: false,
    error: '',
  });
}
