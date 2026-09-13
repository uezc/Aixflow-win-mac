/**
 * H3 视频提示词段级组装器（dense_20s 长视频高密度专用）。
 *
 * 现有 compileDramaShotVideoRequest / h3PromptCompiler 是 per-shot 英文 A–H 八段编译；
 * 本模块是 per-segment 中文节拍骨架组装，把一个 video_segment（内部 4-5 节拍）
 * 直接组装成 H3 可执行的提示词，不破坏旧挡位的 per-shot 链路。
 *
 * H3 硬约束：单次 4-15s 整数秒；≤9 图 + 3 视频 + 3 音频（合计 ≤12）；prompt ≤7000 字符。
 */

// ───────────────────────── 常量 ─────────────────────────

/** H3 单次生成时长上限（秒） */
export const H3_MAX_DURATION_SEC = 15;
/** H3 单次生成时长下限（秒） */
export const H3_MIN_DURATION_SEC = 4;
/** H3 提示词字符上限 */
export const H3_MAX_PROMPT_CHARS = 7000;
/** H3 参考图上限 */
export const H3_MAX_REF_IMAGES = 9;
/** H3 参考视频上限 */
export const H3_MAX_REF_VIDEOS = 3;
/** H3 参考音频上限 */
export const H3_MAX_REF_AUDIOS = 3;
/** H3 参考文件总数上限 */
export const H3_MAX_REFS_TOTAL = 12;
/** H3 单段 hard cut / 急推 上限 */
export const H3_MAX_HARD_CUTS_PER_SEG = 2;
/** H3 对白语速上限（字/秒） */
export const H3_DIALOGUE_CHARS_PER_SEC = 4.5;

/** 慢推禁词（全段命中次数必须 = 0） */
export const H3_SLOW_PUSH_BAN_WORDS: readonly string[] = [
  '缓慢掠过',
  '匀速横移',
  '慢推',
  '呼吸平移',
  '持续压缩',
  '缓推',
  '慢移',
  '慢镜头',
  '慢慢',
] as const;

/** 急推 / 甩切 关键词（单段 ≤ H3_MAX_HARD_CUTS_PER_SEG 处） */
export const H3_QUICK_PUSH_WORDS: readonly string[] = ['急推', '甩切', 'hard cut', 'hardcut'] as const;

/** 骨架段标题（固定顺序，禁止乱序） */
const SECTION = {
  goal: '【目标】',
  ref: '【参考】',
  subject: '【主体】',
  beats: '【节拍】',
  camera: '【摄影】',
  audio: '【音频】',
  invariant: '【不变】',
  endState: '【终态】',
} as const;

// ───────────────────────── 类型 ─────────────────────────

/** 单个节拍 */
export interface H3Beat {
  /** 时间窗，如 "0-4s" */
  window: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** 节拍标签：钩子 / 推进 / 情绪 / 反转 / 收口 */
  beatLabel?: string;
  /** 本节拍新信息点（一句话） */
  infoPoint: string;
  /** 可见物理动作 */
  action: string;
  /** 对白（逐字）；无对白拍为 null */
  dialogue: { speaker: string; line: string } | null;
  /** 物理微相 */
  expression?: string;
  /** 运镜指令：固定机位 / 手持微晃 / 急推 / 甩切 等 */
  camera: string;
  /** 光线 */
  light: string;
  /** 声音 / 音效 */
  sound: string;
}

/** 一个视频段（≤15s，内部 3-5 节拍） */
export interface H3VideoSegment {
  video_id: string;
  /** 段长（秒，≤15） */
  duration: number;
  /** 场次 / 地点 */
  loc: string;
  /** 挡位 */
  gear: string;
  beats: H3Beat[];
  /** 拆分时的首帧衔接提示（前段末帧描述，供下段衔接） */
  first_frame_hint?: string;
  /** cast 名单 */
  cast_names?: string[];
}

/** 参考素材包 */
export interface H3RefBundle {
  characterImages: string[];
  sceneImages: string[];
  motionVideoUrl?: string;
  audioUrl?: string;
}

/** 组装选项 */
export interface H3BuildOpts {
  ratio?: string;
  resolution?: '768P' | '2K';
  fps?: number;
  /** 主体锚点：外貌+服装+身份（写死防漂移），来自角色卡 */
  characterAnchor?: string;
  /** 不变锚点：必须保持不变的元素 */
  invariantAnchor?: string;
}

/** 组装产物 */
export interface H3CompiledRequest {
  prompt: string;
  /** 按顺序排列的参考图 URL（与 prompt【参考】段一一对应） */
  refImages: string[];
  params: {
    durationSec: number;
    ratio: string;
    resolution: '768P' | '2K';
    fps: number;
  };
  audit: {
    promptChars: number;
    refCount: number;
    beatCount: number;
    dialogueChars: number;
    slowPushHits: number;
    quickPushHits: number;
  };
}

// ───────────────────────── 聚合：shots → segment ─────────────────────────

/**
 * 把 shots（兼容视图，每 beat 一个 shot）按 video_id 聚合成 H3VideoSegment[]。
 * 兼容 DramaShotSuggestion（dialogue:string / sound / cast_names）
 * 与 DramaShot（dialogue:array / sfx / character_ids）两种形态。
 * dense_20s 下每 5 条 shot 对应一个 20s 段；此处按 video_id 分组。
 */
export function aggregateShotsToH3Segments(
  shots: readonly unknown[],
): H3VideoSegment[] {
  const byVid = new Map<string, H3Beat[]>();
  const vidOrder: string[] = [];
  const vidLoc = new Map<string, string>();
  const vidCast = new Map<string, string[]>();

  for (const raw of shots || []) {
    const s = raw as Record<string, unknown>;
    const vid = String(s.video_id || '').trim();
    if (!vid) continue;
    if (!byVid.has(vid)) {
      byVid.set(vid, []);
      vidOrder.push(vid);
      vidLoc.set(vid, String(s.scene || '').trim());
      vidCast.set(vid, [...(s.cast_names as string[] || [])]);
    }
    const dur = Number(s.duration_sec) || 0;
    const beats = byVid.get(vid)!;
    const startSec = beats.reduce((a, b) => a + b.durationSec, 0);
    const endSec = startSec + dur;
    const dw = String(s.duration_why || '').trim();
    // 对白兼容：string "角色：台词" / 数组 [{text}] / 数组 [{speaker,line}]
    const dlg = parseShotDialogueField(s.dialogue);
    beats.push({
      window: `${startSec}-${endSec}s`,
      startSec,
      endSec,
      durationSec: dur,
      beatLabel: dw || undefined,
      infoPoint: String(s.visual_focus || s.purpose || '').trim(),
      action: String(s.action || '').trim(),
      dialogue: dlg,
      expression: String(s.emotion_play || '').trim() || undefined,
      camera: String(s.move || s.camera || '').trim(),
      light: String(s.lighting || '').trim(),
      sound: String(s.sound || s.sfx || '').trim(),
    });
    // 合并 cast（兼容 cast_names / character_ids）
    const cast = (s.cast_names as string[]) || (s.character_ids as string[]) || [];
    for (const c of cast) {
      if (!vidCast.get(vid)!.includes(c)) vidCast.get(vid)!.push(c);
    }
  }

  return vidOrder.map((vid) => {
    const beats = byVid.get(vid)!;
    const duration = beats.reduce((a, b) => a + b.durationSec, 0);
    return {
      video_id: vid,
      duration,
      loc: vidLoc.get(vid) || '',
      gear: 'dense_20s',
      beats,
      cast_names: vidCast.get(vid),
    };
  });
}

/**
 * 解析对白字段，兼容三种形态：
 * - string "角色：台词" / "角色:台词" / 纯台词
 * - 数组 [{text:"台词"}]（DramaShotSuggestion 归一化后）
 * - 数组 [{speaker,line}]（DramaShot）
 */
function parseShotDialogueField(raw: unknown): { speaker: string; line: string } | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    const m = s.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (m) return { speaker: m[1].trim(), line: m[2].trim() };
    return { speaker: '', line: s };
  }
  if (Array.isArray(raw)) {
    const first = raw.find((d) => d && typeof d === 'object') as Record<string, unknown> | undefined;
    if (!first) return null;
    const line = String(first.line || first.text || '').trim();
    if (!line) return null;
    return { speaker: String(first.speaker || first.name || '').trim(), line };
  }
  return null;
}

// ───────────────────────── buildH3VideoPrompt ─────────────────────────

/**
 * 把一个 video_segment 组装成 H3 可执行的提示词（中文节拍骨架）。
 * 输出固定顺序：【目标】【参考】【主体】【节拍】【摄影】【音频】【不变】【终态】。
 */
export function buildH3VideoPrompt(
  segment: H3VideoSegment,
  refs: H3RefBundle,
  opts: H3BuildOpts = {},
): H3CompiledRequest {
  const refImages = collectRefImages(refs);
  const ratio = opts.ratio || '9:16';
  const resolution = opts.resolution || '768P';
  const fps = opts.fps || 24;

  const sections: string[] = [
    buildGoalSection(segment),
    buildRefSection(refImages),
    buildSubjectSection(segment, opts),
    buildBeatsSection(segment),
    buildCameraSection(segment),
    buildAudioSection(segment),
    buildInvariantSection(segment, opts),
    buildEndStateSection(segment),
  ];

  const prompt = sections.filter(Boolean).join('\n') + '\n';

  const audit = {
    promptChars: prompt.length,
    refCount: refImages.length,
    beatCount: segment.beats.length,
    dialogueChars: segment.beats.reduce(
      (a, b) => a + (b.dialogue ? b.dialogue.line.length : 0),
      0,
    ),
    slowPushHits: countSlowPushHits(segment),
    quickPushHits: countQuickPushHits(segment),
  };

  return {
    prompt,
    refImages,
    params: { durationSec: segment.duration, ratio, resolution, fps },
    audit,
  };
}

/** 收集参考图 URL（按 character → scene → motion 截帧 顺序，≤9 张） */
function collectRefImages(refs: H3RefBundle): string[] {
  const out: string[] = [];
  for (const u of refs.characterImages || []) {
    const url = String(u || '').trim();
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= H3_MAX_REF_IMAGES) return out;
  }
  for (const u of refs.sceneImages || []) {
    const url = String(u || '').trim();
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= H3_MAX_REF_IMAGES) return out;
  }
  // motionVideoUrl 作为视频参考不进 refImages（图列表），但可在 prompt【参考】里标注
  return out;
}

function buildGoalSection(segment: H3VideoSegment): string {
  const info = segment.beats
    .map((b) => b.infoPoint)
    .filter(Boolean)
    .slice(0, 3)
    .join('；');
  return `${SECTION.goal}${info || segment.loc}`;
}

function buildRefSection(refImages: string[]): string {
  if (!refImages.length) return `${SECTION.ref}（无参考图）`;
  const lines = refImages.map((url, i) => `图${i + 1}=${url}`);
  return `${SECTION.ref}按顺序：${lines.join('；')}`;
}

function buildSubjectSection(segment: H3VideoSegment, opts: H3BuildOpts): string {
  const anchor = String(opts.characterAnchor || '').trim();
  const cast = (segment.cast_names || []).join('、');
  const subject = anchor || cast || segment.loc;
  return `${SECTION.subject}${subject}`;
}

function buildBeatsSection(segment: H3VideoSegment): string {
  const lines = segment.beats.map((b, i) => {
    const move = b.camera || '固定机位';
    const dlg = b.dialogue ? `：「${b.dialogue.line}」` : '';
    const action = b.action || b.infoPoint || '';
    return `  ${i + 1}. [${move}] ${action}${dlg} ${b.window}`;
  });
  return `${SECTION.beats}\n${lines.join('\n')}`;
}

function buildCameraSection(segment: H3VideoSegment): string {
  const quickCount = countQuickPushHits(segment);
  const hasTwist = segment.beats.some(
    (b) => (b.beatLabel || '').includes('反转') || (b.beatLabel || '').includes('twist'),
  );
  const twistNote = hasTwist
    ? `；反转节拍允许一次 hard cut / 急推`
    : '';
  const quickNote =
    quickCount <= H3_MAX_HARD_CUTS_PER_SEG
      ? `（本段急推 ${quickCount} 处）`
      : `（本段急推 ${quickCount} 处，超限！）`;
  return `${SECTION.camera}全段默认固定/手持微晃${twistNote}${quickNote}；禁止缓慢掠过/匀速横移/慢推/呼吸平移/持续压缩`;
}

function buildAudioSection(segment: H3VideoSegment): string {
  const dlgLines = segment.beats
    .filter((b) => b.dialogue)
    .map((b) => `${b.dialogue!.speaker || '角色'}：「${b.dialogue!.line}」`)
    .join(' ');
  const sfxTimeline = segment.beats
    .map((b) => `${b.window}:${b.sound}`)
    .filter((x) => !x.endsWith(':'))
    .join('；');
  const parts = [
    dlgLines ? `对白逐字：${dlgLines}` : '',
    sfxTimeline ? `音效时序：${sfxTimeline}` : '',
  ].filter(Boolean);
  return `${SECTION.audio}${parts.join('；') || '（无对白/音效）'}`;
}

function buildInvariantSection(segment: H3VideoSegment, opts: H3BuildOpts): string {
  const anchor = String(opts.invariantAnchor || '').trim();
  if (anchor) return `${SECTION.invariant}${anchor}`;
  const loc = segment.loc || '';
  return `${SECTION.invariant}角色外貌/服装/场景「${loc}」/道具位置保持一致`;
}

function buildEndStateSection(segment: H3VideoSegment): string {
  const last = segment.beats[segment.beats.length - 1];
  if (!last) return `${SECTION.endState}画面收口`;
  const state = last.infoPoint || last.action || '悬念收口';
  return `${SECTION.endState}${state}；画面/声音收口`;
}

function countSlowPushHits(segment: H3VideoSegment): number {
  const text = segment.beats
    .map((b) => `${b.camera} ${b.action}`)
    .join(' ');
  let count = 0;
  for (const w of H3_SLOW_PUSH_BAN_WORDS) {
    const re = new RegExp(escapeRegex(w), 'g');
    const m = text.match(re);
    if (m) count += m.length;
  }
  return count;
}

function countQuickPushHits(segment: H3VideoSegment): number {
  const text = segment.beats.map((b) => b.camera).join(' ');
  let count = 0;
  for (const w of H3_QUICK_PUSH_WORDS) {
    const re = new RegExp(escapeRegex(w), 'gi');
    const m = text.match(re);
    if (m) count += m.length;
  }
  return count;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ───────────────────────── splitSegmentForH3 ─────────────────────────

/**
 * H3 单次 ≤15s、内部 hard cut ≤2 处的强制拆分。
 * - duration > 15 → 按 15s 截断拆多段（尾帧衔接）
 * - 段内急推/hard cut > 2 → 在多余标记处切新段
 * - 每段 beats 3-5；拆完重新编号与时长重算
 */
export function splitSegmentForH3(segment: H3VideoSegment): H3VideoSegment[] {
  if (segment.duration <= H3_MAX_DURATION_SEC && countQuickPushHits(segment) <= H3_MAX_HARD_CUTS_PER_SEG) {
    return [segment];
  }

  const result: H3VideoSegment[] = [];
  let currentBeats: H3Beat[] = [];
  let currentDur = 0;
  let currentQuick = 0;

  const flush = (hint?: string) => {
    if (currentBeats.length < 3) {
      // 不足 3 拍不独立成段，回灌到下一段
      return;
    }
    const dur = currentBeats.reduce((a, b) => a + b.durationSec, 0);
    if (dur < H3_MIN_DURATION_SEC) {
      return; // 太短不成段
    }
    const seg: H3VideoSegment = {
      video_id: `${segment.video_id}p${result.length + 1}`,
      duration: dur,
      loc: segment.loc,
      gear: segment.gear,
      beats: renumberBeats(currentBeats),
      cast_names: segment.cast_names,
    };
    if (hint) seg.first_frame_hint = hint;
    result.push(seg);
    currentBeats = [];
    currentDur = 0;
    currentQuick = 0;
  };

  for (const beat of segment.beats) {
    const beatQuick = countBeatQuickPush(beat);
    const beatDur = beat.durationSec;

    // 累加后超 15s → 先 flush 当前段
    if (currentDur + beatDur > H3_MAX_DURATION_SEC && currentBeats.length >= 3) {
      // 尾帧衔接：把当前段最后一拍描述传给下段
      const lastBeat = currentBeats[currentBeats.length - 1];
      flush(lastBeat ? `${lastBeat.action}（末帧）` : undefined);
    }

    // 累加后急推超限 → 先 flush
    if (currentQuick + beatQuick > H3_MAX_HARD_CUTS_PER_SEG && currentBeats.length >= 3) {
      const lastBeat = currentBeats[currentBeats.length - 1];
      flush(lastBeat ? `${lastBeat.action}（末帧）` : undefined);
    }

    currentBeats.push(beat);
    currentDur += beatDur;
    currentQuick += beatQuick;
  }
  // 收尾 flush
  flush();

  // 如果拆分后只剩一段（没真正拆开），返回原段
  if (result.length <= 1) {
    return [segment];
  }
  return result;
}

function countBeatQuickPush(beat: H3Beat): number {
  const text = beat.camera || '';
  let count = 0;
  for (const w of H3_QUICK_PUSH_WORDS) {
    const re = new RegExp(escapeRegex(w), 'gi');
    const m = text.match(re);
    if (m) count += m.length;
  }
  return count;
}

/** 重新编号 beats 的 window（从 0 开始连续） */
function renumberBeats(beats: H3Beat[]): H3Beat[] {
  let cursor = 0;
  return beats.map((b) => {
    const startSec = cursor;
    const endSec = cursor + b.durationSec;
    cursor = endSec;
    return {
      ...b,
      startSec,
      endSec,
      window: `${startSec}-${endSec}s`,
    };
  });
}

// ───────────────────────── validateH3Prompt ─────────────────────────

export type H3PromptValidation = {
  ok: boolean;
  issues: string[];
};

/**
 * H3 提示词自检。
 * - 长度 ≤ 7000
 * - 无慢推禁词
 * - 每拍对白逐字（与 sourceText 比对，可选）
 * - 窗口时长和 = 段长（可选，传 segment 时校验）
 * - 急推 ≤ 2
 * - 参考图与【参考】段一一对应（可选，传 refCount 时校验）
 */
export function validateH3Prompt(
  prompt: string,
  opts: {
    sourceText?: string;
    segment?: H3VideoSegment;
    refCount?: number;
  } = {},
): H3PromptValidation {
  const issues: string[] = [];
  const text = String(prompt || '');

  // 1. 长度
  if (text.length > H3_MAX_PROMPT_CHARS) {
    issues.push(`提示词超长：${text.length} > ${H3_MAX_PROMPT_CHARS} 字符`);
  }

  // 2. 慢推禁词
  for (const w of H3_SLOW_PUSH_BAN_WORDS) {
    if (text.includes(w)) {
      issues.push(`慢推禁词命中：「${w}」`);
    }
  }

  // 3. 急推 ≤ 2
  let quickCount = 0;
  for (const w of H3_QUICK_PUSH_WORDS) {
    const re = new RegExp(escapeRegex(w), 'gi');
    const m = text.match(re);
    if (m) quickCount += m.length;
  }
  if (quickCount > H3_MAX_HARD_CUTS_PER_SEG) {
    issues.push(`急推/甩切超限：${quickCount} > ${H3_MAX_HARD_CUTS_PER_SEG} 处`);
  }

  // 4. 窗口时长和 = 段长
  if (opts.segment) {
    const sumDur = opts.segment.beats.reduce((a, b) => a + b.durationSec, 0);
    if (Math.abs(sumDur - opts.segment.duration) > 0.5) {
      issues.push(
        `节拍窗口时长和(${sumDur}s) ≠ 段长(${opts.segment.duration}s)`,
      );
    }
    // 每拍必须有 infoPoint
    const emptyInfo = opts.segment.beats.filter((b) => !b.infoPoint);
    if (emptyInfo.length) {
      issues.push(`${emptyInfo.length} 个节拍缺少 info_point`);
    }
    // 对白总量 ≤ 4.5 字/秒 × 段长
    const dlgChars = opts.segment.beats.reduce(
      (a, b) => a + (b.dialogue ? b.dialogue.line.length : 0),
      0,
    );
    const maxChars = Math.floor(H3_DIALOGUE_CHARS_PER_SEC * opts.segment.duration);
    if (dlgChars > maxChars) {
      issues.push(`对白超载：${dlgChars} > ${maxChars} 字（${H3_DIALOGUE_CHARS_PER_SEC}字/秒×${opts.segment.duration}s）`);
    }
  }

  // 5. 对白逐字（与原文比对）
  if (opts.sourceText) {
    const srcLines = extractSourceDialogueLines(opts.sourceText);
    for (const src of srcLines) {
      // 容错：原文一句可能在 prompt 里被「」包裹，取前 8 字符做前缀匹配
      const prefix = src.slice(0, Math.min(8, src.length));
      if (!text.includes(prefix)) {
        issues.push(`对白缺失：「${src.slice(0, 30)}${src.length > 30 ? '…' : ''}」未出现在提示词中`);
      }
    }
  }

  // 6. 参考图一一对应
  if (typeof opts.refCount === 'number') {
    const refMatches = text.match(/图\d+/g);
    const refInPrompt = refMatches ? refMatches.length : 0;
    if (refInPrompt !== opts.refCount) {
      issues.push(`参考图数量不匹配：提示词引用 ${refInPrompt} 张，实际传入 ${opts.refCount} 张`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/** 从原文提取「」包裹的对白句（与 shotPlanValidate 同口径，独立实现避免循环依赖） */
function extractSourceDialogueLines(source: string): string[] {
  const s = String(source || '').trim();
  if (!s) return [];
  const norm = s
    .replace(/[""]|[""]/g, '「')
    .replace(/["']|["']/g, '」')
    .replace(/["']/g, '」');
  const chunks = norm.split(/[「」]/);
  const lines: string[] = [];
  chunks.forEach((c, idx) => {
    if (idx % 2 === 1 && c.trim()) lines.push(c.trim());
  });
  return lines;
}
