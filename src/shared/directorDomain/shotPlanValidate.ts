/**
 * Shot Planning 系统校验：镜数、事件覆盖率、空间/时间连续性。
 * 不信任模型自称「已拆完」。
 */

import {
  normalizeDramaEventId,
  type DramaAnalyzeShotBudget,
  type DramaVisualEvent,
} from './shotPlanning.js';
import type { DramaSceneBeat, DramaShotSuggestion, DramaShotIntent, DramaNarrativeBeat } from './types.js';
import { normalizeDramaShotPlanPaceGear } from './types.js';

export type DramaShotPlanValidation = {
  ok: boolean;
  errors: string[];
  shotCount: number;
  eventCount: number;
  coveredCount: number;
  coverage: number;
  missingEventIds: string[];
  hardEventCount: number;
  hardCoveredCount: number;
  hardCoverage: number;
  missingHardEventIds: string[];
  auxEventCount: number;
  auxCoverage: number;
  missingAuxEventIds: string[];
  /** 对白完整性：原文句数 / 输出句数 / 差值 / 缺失句子预览 */
  dialogueCompleteness?: {
    originalCount: number;
    outputCount: number;
    diff: number;
    missingLines: string[];
  };
};

/** 系统提示音/旁白/拟声词关键词：出现在「」内即判定为非人物对白 */
const SYSTEM_DIALOGUE_HINTS = [
  // 系统/电子音
  '系统提示', '系统音', '电子音', '机械音', '冰冷的声音', '冰冷电子',
  '滴滴', '滴~', '滴！', '叮咚', '叮~', '叮！', '嘟嘟', '嘟~',
  '【系统】', '〔系统〕', '[系统]',
  '宿主', '绑定', '任务', '奖励', '惩罚', '积分', '等级', '属性', '技能',
  '升级', '完成任务', '触发', '解锁', '激活', '加载', '100%', '进度',
  // 弹幕/字幕/小字
  '弹幕', '小字', '字幕', '飘字', '公屏', '评论',
  // 环境/拟声
  '咔嚓', '轰隆', '砰', '啪', '咚', '哐', '唰', '呜', '哇', '叮', '当',
  '脚步声', '开门声', '关门声', '雷鸣', '雨声', '风声', '海浪',
  // 旁白/画外
  '旁白：', '画外音：', 'OS：', '内心：',
];

/** 判断「」内文本是否是系统提示音/拟声词/旁白，而非人物开口对白 */
function isSystemLikeDialogue(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  // 过短（<2字）的纯拟声跳过
  if (t.replace(/\s+/g, '').length < 2) return true;
  // 纯符号/数字
  if (/^[\d\W_]+$/.test(t)) return true;
  const lower = t.toLowerCase();
  for (const hint of SYSTEM_DIALOGUE_HINTS) {
    if (lower.includes(hint.toLowerCase())) return true;
  }
  return false;
}

/**
 * 从原文里抽出「」/"" 包裹的**人物对白句**。
 * 把弯引号 / 半角引号统一成「」再切，兼容中英文混排。
 * 排除：系统提示音、弹幕、拟声词、旁白、设定说明等非人物开口内容。
 */
export function extractDramaSourceDialogueLines(source: string): string[] {
  const s = String(source || '').trim();
  if (!s) return [];
  const norm = s
    .replace(/[""]|[""]/g, '「')
    .replace(/["']|["']/g, '」')
    .replace(/["']/g, '」');
  const chunks = norm.split(/[「」]/);
  const lines: string[] = [];
  chunks.forEach((c, idx) => {
    if (idx % 2 !== 1) return;
    const trimmed = c.trim();
    if (!trimmed) return;
    if (isSystemLikeDialogue(trimmed)) return;
    lines.push(trimmed);
  });
  return lines;
}

/**
 * 从分镜建议表里收集所有对白文本（兼容 dialogue 为字符串 / 数组 / {text} 三种形态）。
 */
export function collectDramaShotDialogueTexts(suggestions: DramaShotSuggestion[]): string[] {
  const out: string[] = [];
  (suggestions || []).forEach((s) => {
    const dl = (s as unknown as { dialogue?: unknown }).dialogue;
    if (Array.isArray(dl)) {
      dl.forEach((d: unknown) => {
        if (d && typeof d === 'object' && 'text' in d) {
          const t = String((d as { text?: unknown }).text || '').trim();
          if (t) out.push(t);
        } else if (typeof d === 'string' && d.trim()) {
          out.push(d.trim());
        }
      });
    } else if (typeof dl === 'string' && dl.trim()) {
      out.push(dl.trim());
    }
  });
  return out;
}

/**
 * 计算对白完整性：原文「」句数 vs 输出对白句数。
 * diff<0 表示输出比原文少（缺对白，最常见）；diff>0 表示输出多出原创对白。
 */
export function computeDramaDialogueCompleteness(
  sourceScript: string,
  suggestions: DramaShotSuggestion[],
): { originalCount: number; outputCount: number; diff: number; missingLines: string[]; extraLines: string[] } {
  const originalLines = extractDramaSourceDialogueLines(sourceScript);
  const outputLines = collectDramaShotDialogueTexts(suggestions);
  // 三级匹配（从严到宽）：完全相等 > 输出含原文整句 > 原文含输出整句。去标点空白后比较，避免前缀误判。
  const stripPunct = (s: string) =>
    String(s || '')
      .replace(/[\s\uFF0C\u3002\uFF01\uFF1F\u3001\uFF1B\uFF1A\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F\uFF08\uFF09()[\]\u3010\u3011\u2026\u2014\-_~`'".,!?;:]/g, '')
      .toLowerCase();
  const normOriginal = originalLines.map(stripPunct);
  const normOutput = outputLines.map(stripPunct);
  const missing: string[] = [];
  for (let i = 0; i < originalLines.length; i += 1) {
    const srcNorm = normOriginal[i];
    if (!srcNorm) continue;
    const hit = normOutput.some((o) => {
      if (!o) return false;
      if (o === srcNorm) return true;
      if (o.includes(srcNorm)) return true;
      if (srcNorm.includes(o)) return true;
      return false;
    });
    if (!hit) missing.push(originalLines[i]);
  }
  const outputMatched = originalLines.length - missing.length;
  const extra = outputLines.length - outputMatched;
  return {
    originalCount: originalLines.length,
    outputCount: outputLines.length,
    diff: outputLines.length - originalLines.length,
    missingLines: missing,
    extraLines: extra > 0 ? outputLines.slice(outputMatched) : [],
  };
}

function locKey(s: string): string {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function spaceFamily(loc: string): string {
  const s = locKey(loc);
  if (!s) return '';
  if (/电梯|走廊|楼层|写字楼|大厅|门口|办公室|1708|十七楼|17楼/.test(s)) return 'office-tower';
  if (/雨夜|街头|街道|车流|马路|滨江/.test(s)) return 'street';
  if (/便利店|超市/.test(s)) return 'store';
  if (/出租|居民楼|小房间|阳台/.test(s)) return 'home';
  if (/草原|平原|晨曦/.test(s)) return 'plain';
  if (/白空间|纯白|神经/.test(s)) return 'white';
  return s;
}

function isConnectedMove(prevLoc: string, curLoc: string): boolean {
  const a = spaceFamily(prevLoc);
  const b = spaceFamily(curLoc);
  if (!a || !b) return true;
  if (a === b) return true;
  const path = `${a}>${b}`;
  return (
    path === 'street>office-tower' ||
    path === 'office-tower>street' ||
    path === 'street>store' ||
    path === 'store>street' ||
    path === 'street>home' ||
    path === 'home>street' ||
    path === 'white>plain' ||
    path === 'plain>white'
  );
}

function purposeOf(shot: DramaShotSuggestion): string {
  return String(shot.dramatic_purpose || shot.purpose || '')
    .trim()
    .toLowerCase();
}

function isEstablishOrTransition(shot: DramaShotSuggestion): boolean {
  const p = purposeOf(shot);
  return /establish|transition|environment|introduce/.test(p) || /建立|转场|空镜|交代/.test(p);
}

function hasSpokenDialogue(shot: DramaShotSuggestion): boolean {
  return dialogueSpokenCount(shot) > 0;
}

/** 对白句数：建议表 dialogue 多为「角色：台词 / 角色：台词」字符串，偶发数组 */
function dialogueSpokenCount(shot: DramaShotSuggestion): number {
  const raw = shot.dialogue as unknown;
  if (Array.isArray(raw)) {
    return raw.filter((x) => String((x as { text?: string })?.text || '').trim()).length;
  }
  const s = String(raw || '').trim();
  if (!s) return 0;
  const parts = s
    .split(/\s*\/\s*|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return Math.max(1, parts.length);
}

/** 服务对话/对峙/反应的镜头（含无台词的反应镜） */
function isDialogueServiceShot(shot: DramaShotSuggestion): boolean {
  if (hasSpokenDialogue(shot)) return true;
  const p = purposeOf(shot);
  if (/dialogue|reaction|emotional|reveal/.test(p) || /对白|对话|反应|对峙|质问|冲突/.test(p)) {
    return true;
  }
  const action = String(shot.action || '');
  const emotion = String(shot.emotion_play || '');
  return /攥拳|喉结|点屏|差评|反应|低头不语/.test(`${action} ${emotion}`);
}

/** 纯赶路/过渡镜（无对白服务） */
function isTravelOrTransitionShot(shot: DramaShotSuggestion): boolean {
  if (isDialogueServiceShot(shot)) return false;
  if (isEstablishOrTransition(shot)) return true;
  const scene = String(shot.scene || '');
  const action = String(shot.action || '');
  return (
    /街头|街道|车流|雨夜|走廊|电梯|大堂|门厅|赶路|马路/.test(scene) ||
    /赶路|穿车|骑行|冲进|电梯|走廊|跟拍走路/.test(action)
  );
}

function coveredIdsOf(shot: DramaShotSuggestion): string[] {
  return (shot.visual_event_ids || []).map((id) => normalizeDramaEventId(id)).filter(Boolean);
}

/** 事件层可接受下限：约为目标的一半。模型给出 30 条而公式要 33 时不应整集作废。 */
export function dramaVisualEventAcceptMin(budget: DramaAnalyzeShotBudget): number {
  return Math.max(6, Math.min(budget.eventsMin, Math.round(budget.eventsTarget * 0.5)));
}

export function validateDramaVisualEventCount(
  events: DramaVisualEvent[],
  budget: DramaAnalyzeShotBudget,
): { ok: boolean; error?: string } {
  const n = events.length;
  const acceptMin = dramaVisualEventAcceptMin(budget);
  if (n < acceptMin) {
    return {
      ok: false,
      error: `视觉事件仅 ${n} 条，低于可接受下限 ${acceptMin}（目标约 ${budget.eventsTarget}）。事件层过短，不能进入分镜。`,
    };
  }
  return { ok: true };
}

/**
 * 镜头数量 + A/B 事件覆盖 + 空间连续性。
 * A 类硬事件必须 100%；B 类默认 ≥80%；短剧挡位 B 可降至 0（砍前戏）。
 */
export function validateDramaShotPlan(opts: {
  suggestions: DramaShotSuggestion[];
  visualEvents: DramaVisualEvent[];
  sceneBeats?: DramaSceneBeat[];
  budget: DramaAnalyzeShotBudget;
  /** 短剧快节奏时放宽 B 类覆盖与空间硬切 */
  paceGear?: import('./types.js').DramaShotPlanPaceGear | string;
  /** 原文剧本（用于对白完整性校验：原文「」句数 vs 输出对白句数，不等则带差值进重试 hint） */
  sourceScript?: string;
  /** v3：Shot Intent 列表（有则做 Beat Coverage 校验） */
  shotIntents?: DramaShotIntent[];
  /** v3：Narrative Beat 列表（有则做 Event Coverage 校验） */
  narrativeBeats?: DramaNarrativeBeat[];
}): DramaShotPlanValidation {
  const suggestions = opts.suggestions || [];
  const events = opts.visualEvents || [];
  const budget = opts.budget;
  const pace = normalizeDramaShotPlanPaceGear(opts.paceGear);
  const shortDrama = pace === 'short_drama';
  const dense15 = pace === 'dense_15s';
  const dense20 = pace === 'dense_20s';
  const auxMin = shortDrama || dense15 || dense20 ? 0 : 0.8;
  const errors: string[] = [];

  const tagged = events.map((e, i) => ({
    id: normalizeDramaEventId(e.event_id || e.index || i + 1),
    priority: e.priority === 'B' ? ('B' as const) : ('A' as const),
  }));
  const uniqueEventIds = [...new Set(tagged.map((x) => x.id).filter(Boolean))];
  const hardIds = [...new Set(tagged.filter((x) => x.priority === 'A' && x.id).map((x) => x.id))];
  const auxIds = [...new Set(tagged.filter((x) => x.priority === 'B' && x.id).map((x) => x.id))];
  const covered = new Set<string>();
  for (const shot of suggestions) {
    for (const id of coveredIdsOf(shot)) covered.add(id);
  }
  const missingEventIds = uniqueEventIds.filter((id) => !covered.has(id));
  const coveredCount = uniqueEventIds.length - missingEventIds.length;
  const coverage = uniqueEventIds.length ? coveredCount / uniqueEventIds.length : 0;
  const missingHardEventIds = hardIds.filter((id) => !covered.has(id));
  const hardCoveredCount = hardIds.length - missingHardEventIds.length;
  const hardCoverage = hardIds.length ? hardCoveredCount / hardIds.length : 1;
  const missingAuxEventIds = auxIds.filter((id) => !covered.has(id));
  const auxCoveredCount = auxIds.length - missingAuxEventIds.length;
  const auxCoverage = auxIds.length ? auxCoveredCount / auxIds.length : 1;

  if (suggestions.length < budget.shotsMin) {
    errors.push(
      `当前仅生成 ${suggestions.length} 个镜头，远低于本集最低镜头数 ${budget.shotsMin}（目标约 ${budget.shotsTarget}）。请基于已有 Visual Events 重新生成完整分镜，不得遗漏事件。`,
    );
  }
  if (suggestions.length > budget.shotsMax) {
    errors.push(
      `镜头 ${suggestions.length} 条超过本集上限 ${budget.shotsMax}（目标约 ${budget.shotsTarget}）。请合并同空间连续动作，不要为切而切。`,
    );
  }

  if (missingHardEventIds.length) {
    const preview = missingHardEventIds.slice(0, 12).join('、');
    errors.push(
      `硬事件覆盖 ${Math.round(hardCoverage * 100)}%（${hardCoveredCount}/${hardIds.length}），必须 100%。未覆盖：${preview}${
        missingHardEventIds.length > 12 ? '…' : ''
      }。人物首次出场、换地点、关键道具/能力、信息揭示、冲突与结果、死伤、升级、关键对白不得漏镜。`,
    );
  }
  if (auxIds.length && auxCoverage < auxMin) {
    const preview = missingAuxEventIds.slice(0, 8).join('、');
    errors.push(
      `辅助事件覆盖 ${Math.round(auxCoverage * 100)}%（${auxCoveredCount}/${auxIds.length}），低于 ${Math.round(
        auxMin * 100,
      )}%。未覆盖：${preview}${
        missingAuxEventIds.length > 8 ? '…' : ''
      }。雨水/车流/走路等可压缩，但不能大段丢掉。`,
    );
  }

  if (!shortDrama && !dense15 && !dense20) {
    for (let i = 1; i < suggestions.length; i += 1) {
      const prev = suggestions[i - 1];
      const cur = suggestions[i];
      if (!prev.scene || !cur.scene) continue;
      if (isConnectedMove(prev.scene, cur.scene)) continue;
      if (isEstablishOrTransition(cur)) continue;
      errors.push(
        `空间跳跃：镜 ${prev.shot || i}「${prev.scene}」直接切到镜 ${cur.shot || i + 1}「${cur.scene}」，中间缺少建立/转场。`,
      );
      break;
    }
  }

  // 短剧快节奏（v3 改造）：长镜优先 + 同场景不拆镜 + 禁止 6/8 秒碎切
  if (shortDrama && suggestions.length >= 1) {
    // 1. 碎镜检测：duration_sec < 8 秒视为碎切，触发重试
    const fragmentedShots = suggestions.filter(
      (s) => Number(s.duration_sec) > 0 && Number(s.duration_sec) < 8,
    );
    if (fragmentedShots.length > 0) {
      errors.push(
        `长镜守则不合格：存在 ${fragmentedShots.length} 个 <8 秒的碎镜（镜 ${fragmentedShots
          .map((s) => s.shot || '?')
          .slice(0, 5)
          .join('、')}${fragmentedShots.length > 5 ? '…' : ''}）。短剧挡位最小 10 秒、优先 15～20 秒、最大 30 秒，禁用 6/8 秒碎切。请把同场景的碎镜合并为一镜，多句对白+多动作+反应微相全部放进同一 shot 的内部时间子窗（[0-5s]…[5-12s]…[12-20s]）。`,
      );
    }

    // 2. 时长上限拦截：duration_sec > 30 秒视为超长违规
    const oversizedShots = suggestions.filter((s) => Number(s.duration_sec) > 30);
    if (oversizedShots.length > 0) {
      errors.push(
        `时长上限拦截：存在 ${oversizedShots.length} 个 >30 秒的超长镜（镜 ${oversizedShots
          .map((s) => s.shot || '?')
          .slice(0, 5)
          .join('、')}）。单镜最大不超过 30 秒，请按场景切换/黑屏硬转场/时空跳转拆为多镜。`,
      );
    }

    // 3. 同场景拆镜检测：连续两镜同场景无硬转场 → 触发合并重试
    for (let i = 1; i < suggestions.length; i++) {
      const prev = suggestions[i - 1];
      const cur = suggestions[i];
      const prevScene = String(prev.scene || prev.shot || '').trim();
      const curScene = String(cur.scene || cur.shot || '').trim();
      const prevTransition = String(prev.transition_out || '').trim();
      // 同场景 + 上镜非黑屏硬转场 → 应该合并进同一 shot
      if (
        prevScene &&
        curScene &&
        prevScene === curScene &&
        !/黑屏|硬转场|fade.*black|cut.*black/i.test(prevTransition)
      ) {
        errors.push(
          `长镜守则不合格：镜 ${prev.shot || '?'} 与镜 ${cur.shot || '?'} 同属场景「${curScene}」且无黑屏硬转场，应合并为同一 shot，把多句对白+多动作+反应微相全部放进内部时间子窗。只有场景切换/黑屏硬转场/时空跳转才允许开新 shot。`,
        );
      }
    }

    // 4. 对话镜配额（放宽：长镜模式下不强制反应镜，原 ≥45% 调到 ≥30%）
    const dialogueService = suggestions.filter(isDialogueServiceShot).length;
    const travel = suggestions.filter(isTravelOrTransitionShot).length;
    const dialogueRatio = dialogueService / suggestions.length;
    const travelRatio = travel / suggestions.length;
    if (dialogueRatio < 0.3) {
      errors.push(
        `短剧节奏不合格：服务对话/对峙的镜头仅 ${dialogueService}/${suggestions.length}（${Math.round(
          dialogueRatio * 100,
        )}%），须 ≥30%。请把室内对白整段合并进长镜（不切反应镜，反应写进同镜 expression 子窗）。`,
      );
    }
    if (travelRatio > 0.5) {
      errors.push(
        `短剧节奏不合格：赶路/过渡镜 ${travel}/${suggestions.length}（${Math.round(
          travelRatio * 100,
        )}%），须 ≤50%。请合并雨夜街头/大堂/电梯/走廊，把镜数还给对话场景。`,
      );
    }
    // v3：删除旧"≥5 句对白压进单镜"校验（新规则鼓励同场景多句对白合并一镜）
  }

  // 15秒高密度：合镜段落 + 镜内时间轴
  if (dense15 && suggestions.length >= 3) {
    const dur15 = suggestions.filter((s) => Number(s.duration_sec) === 15).length;
    const ratio15 = dur15 / suggestions.length;
    if (ratio15 < 0.5) {
      errors.push(
        `15秒高密度不合格：仅 ${dur15}/${suggestions.length} 镜为 15 秒（${Math.round(
          ratio15 * 100,
        )}%），须 ≥50%。请把同地点连续 3～8 个事件合并为 15 秒段落镜。`,
      );
    }
    const sixShots = suggestions.filter((s) => Number(s.duration_sec) === 6).length;
    if (sixShots / suggestions.length > 0.25) {
      errors.push(
        `15秒高密度不合格：6 秒碎镜 ${sixShots}/${suggestions.length}（${Math.round(
          (sixShots / suggestions.length) * 100,
        )}%），须 ≤25%。请合镜，不要快切堆镜。`,
      );
    }
    const thinAction = suggestions.filter(
      (s) => !/\[\d+(\.\d+)?-\d|0-\d+s|\d+-\d+s/.test(String(s.action || '')),
    ).length;
    if (thinAction > Math.ceil(suggestions.length * 0.4)) {
      errors.push(
        `15秒高密度不合格：${thinAction} 镜 action 缺少镜内时间子窗（如 [0-6s]…[6-12s]…）。请按出片密度写镜内时间轴。`,
      );
    }
  }

  // 20秒长视频高密度：视频段 × 5 节拍兼容视图（shots[] 是 beat 粒度，每 5 个 shot 对应一个 20s 段）
  if (dense20 && suggestions.length >= 5) {
    // 兼容视图：shot.video_id 相同的 shots 属于同一个 20s 段。按 video_id 分组。
    const byVid = new Map<string, DramaShotSuggestion[]>();
    suggestions.forEach((s) => {
      const v = String((s as unknown as { video_id?: unknown }).video_id || '').trim();
      const key = v || '__orphan__';
      if (!byVid.has(key)) byVid.set(key, []);
      byVid.get(key)!.push(s);
    });
    let badWindows = 0;
    let slowPushHits = 0;
    let badQuickPush = 0;
    const slowReg = /缓慢掠|匀速横|慢推|呼吸平|持续压|缓推|慢移|慢镜头|慢慢/g;
    const quickPushReg = /急推|甩切/gi;
    byVid.forEach((arr, vid) => {
      if (vid === '__orphan__') return;
      const totalDur = arr.reduce((acc, x) => acc + Number(x.duration_sec || 0), 0);
      if (Math.abs(totalDur - 20) > 2) badWindows += 1;
      // 慢推禁词扫描述
      const segmentText = arr
        .map(
          (x) =>
            `${String((x as unknown as { move?: unknown }).move || '')} ${String(x.action || '')} ${String((x as unknown as { camera?: unknown }).camera || '')}`,
        )
        .join(' ');
      const slowMatch = segmentText.match(slowReg);
      if (slowMatch && slowMatch.length) slowPushHits += slowMatch.length;
      const quickMatch = segmentText.match(quickPushReg);
      if (quickMatch && quickMatch.length > 2) badQuickPush += 1;
    });
    if (badWindows) {
      errors.push(
        `20秒高密度不合格：${badWindows} 个视频段（按 video_id 分组）的 5 节拍兼容视图时长之和 ≠20s（允许±2s误差）。请保持 beats[5] 固定窗口 4/5/4/4/3s。`,
      );
    }
    if (slowPushHits > 0) {
      errors.push(
        `20秒高密度不合格：检测到慢推禁词命中 ${slowPushHits} 次（关键词：缓慢掠/匀速横/慢推/呼吸平/持续压/缓推/慢移）。整条长视频默认固定机位/手持微晃，急推/甩切只放反转节拍。`,
      );
    }
    if (badQuickPush > 0) {
      errors.push(
        `20秒高密度不合格：${badQuickPush} 个视频段的急推/甩切次数 >2 处。单段整条最多 1-2 处「急推/甩切」，且只放在反转节拍(13-17s)。`,
      );
    }
    // 总对白字数限制：所有 shot.dialogue[].text 加总 ≤ 90 字 / video_id 段
    let overSegments = 0;
    byVid.forEach((arr, vid) => {
      if (vid === '__orphan__') return;
      const chars = arr.reduce((acc, s) => {
        const dl = (s as unknown as { dialogue?: unknown }).dialogue;
        if (Array.isArray(dl)) {
          return (
            acc +
            dl.reduce((a: number, d: unknown) => {
              if (d && typeof d === 'object' && 'text' in d) return a + String((d as { text?: unknown }).text || '').length;
              return a;
            }, 0)
          );
        }
        if (typeof dl === 'string') return acc + dl.length;
        return acc;
      }, 0);
      if (chars > 90) overSegments += 1;
    });
    if (overSegments > 0) {
      errors.push(
        `20秒高密度不合格：${overSegments} 个视频段对白 >90 字（4.5字/秒语速上限）。请把超额对白拆到下一段或改写为短句。`,
      );
    }
  }

  // ===== v3 黄金校验 1：Event Coverage（每个 pri=A 的 visual_event 必须 ∈ 某 beat.event_ids）=====
  if (opts.narrativeBeats && opts.narrativeBeats.length > 0) {
    const aEvents = events.filter((e) => (e.priority || 'A') === 'A');
    const allBeatEventIds = new Set<string>();
    for (const nb of opts.narrativeBeats) {
      for (const eid of nb.event_ids || []) allBeatEventIds.add(eid);
    }
    const uncovered = aEvents.filter((e) => !allBeatEventIds.has(e.event_id));
    if (uncovered.length > 0) {
      errors.push(
        `Event Coverage 不合格：${uncovered.length} 个 pri=A 事件未出现在任何 narrative_beat.event_ids 中：${uncovered.map((e) => e.event_id).join(', ')}。必须把所有 A 事件分配到 beat。`,
      );
    }
  }

  // ===== v3 黄金校验 2：Beat Coverage（每 intent ≥1 shot + 每 shot 有 intent_id）=====
  if (opts.shotIntents && opts.shotIntents.length > 0) {
    const intentIds = new Set(opts.shotIntents.map((si) => si.intent_id));
    const shotsWithIntent = suggestions.filter((s) => {
      const iid = String((s as unknown as { intent_id?: unknown }).intent_id || '').trim();
      return iid && intentIds.has(iid);
    });
    // 反向：有 intent_id 但不在 shotIntents 列表里
    const orphanShots = suggestions.filter((s) => {
      const iid = String((s as unknown as { intent_id?: unknown }).intent_id || '').trim();
      return iid && !intentIds.has(iid);
    });
    if (orphanShots.length > 0) {
      errors.push(
        `Beat Coverage 不合格：${orphanShots.length} 个镜头的 intent_id 不在 shot_intents 列表中：${orphanShots.map((s, i) => String((s as unknown as { intent_id?: unknown }).intent_id || `shot#${i}`)).join(', ')}。`,
      );
    }
    // 有 shot_intents 但无任何 shot 关联 → intent 未落镜
    const intentsWithShots = new Set(
      shotsWithIntent.map((s) => String((s as unknown as { intent_id?: unknown }).intent_id || '')),
    );
    const orphanIntents = opts.shotIntents.filter((si) => !intentsWithShots.has(si.intent_id));
    if (orphanIntents.length > 0) {
      errors.push(
        `Beat Coverage 不合格：${orphanIntents.length} 个 shot_intent 未被任何镜头引用：${orphanIntents.map((si) => si.intent_id).join(', ')}。每个 intent 至少要有 1 个镜头关联。`,
      );
    }
  }

  // ===== v3 黄金校验 3：Audience Change Density（连续无新 audience_change → 信息停滞）=====
  // 阈值：dense_15s / dense_20s ≥10s；short_drama ≥6s
  // reaction 镜计为有效（防情绪戏误报）
  {
    const densityThreshold = shortDrama ? 6 : 10;
    let stagnantStart = -1;
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      const dur = Number(s.duration_sec) || 0;
      const purpose = String(s.purpose || s.dramatic_purpose || '').toLowerCase();
      const isReaction = purpose.includes('reaction') || purpose.includes('反应');
      // 有 visual_focus 或是 reaction 镜 → 有信息变化
      const hasInfo = Boolean(String(s.visual_focus || '').trim()) || isReaction;
      if (!hasInfo) {
        if (stagnantStart < 0) stagnantStart = i;
        const stagnantDur = suggestions
          .slice(stagnantStart, i + 1)
          .reduce((a, x) => a + (Number(x.duration_sec) || 0), 0);
        if (stagnantDur >= densityThreshold) {
          errors.push(
            `Audience Change Density 不合格：从镜 #${stagnantStart + 1} 到 #${i + 1} 连续 ${stagnantDur}s 无新 audience_change（信息停滞）。阈值 ${densityThreshold}s。必须在其中插入新信息点或删除空镜。`,
          );
          break; // 只报第一处
        }
      } else {
        stagnantStart = -1;
      }
    }
  }

  // ===== v3 黄金校验 4：Visual Duplicate（同 subject + 同景别 + 同角度 + 同 visual_focus 连续 ≥2 镜）=====
  {
    for (let i = 0; i < suggestions.length - 1; i++) {
      const a = suggestions[i];
      const b = suggestions[i + 1];
      const subjA = (a.cast_names || []).sort().join('|');
      const subjB = (b.cast_names || []).sort().join('|');
      const sizeA = String(a.size || '').trim();
      const sizeB = String(b.size || '').trim();
      const angleA = String(a.camera || '').trim();
      const angleB = String(b.camera || '').trim();
      const focusA = String(a.visual_focus || '').trim();
      const focusB = String(b.visual_focus || '').trim();
      // 正反打（异主体/异景别）不误报
      if (subjA && subjA === subjB && sizeA === sizeB && angleA === angleB && focusA && focusA === focusB) {
        errors.push(
          `Visual Duplicate 不合格：镜 #${i + 1} 与 #${i + 2} 主体/景别/角度/visual_focus 完全相同（视觉卡帧）。请改变景别、角度或 visual_focus。`,
        );
        break; // 只报第一处
      }
    }
  }

  // ===== 对白完整性硬校验（所有挡位 · 进重试 hint 让 AI 自己补齐）=====
  let dialogueCompleteness: DramaShotPlanValidation['dialogueCompleteness'] | undefined;
  const srcScript = String(opts.sourceScript || '').trim();
  if (srcScript) {
    const dc = computeDramaDialogueCompleteness(srcScript, suggestions);
    dialogueCompleteness = {
      originalCount: dc.originalCount,
      outputCount: dc.outputCount,
      diff: dc.diff,
      missingLines: dc.missingLines,
    };
    if (dc.originalCount > 0 && dc.missingLines.length > 0) {
      const preview = dc.missingLines
        .slice(0, 5)
        .map((l, i) => `  ${i + 1}. ${l.slice(0, 50)}${l.length > 50 ? '…' : ''}`)
        .join('\n');
      errors.push(
        `对白完整性不合格：原文有 ${dc.originalCount} 句「」对白，分镜只出现 ${dc.originalCount - dc.missingLines.length} 句，缺 ${dc.missingLines.length} 句。缺失对白：\n${preview}${dc.missingLines.length > 5 ? `\n  …共缺 ${dc.missingLines.length} 句` : ''}\n必须把原文所有「」对白逐字写进对应镜头/节拍的 dialogue，不得遗漏、不得改写、不得合并成一句。`,
      );
    } else if (dc.originalCount > 0 && dc.extraLines.length > 0) {
      errors.push(
        `对白完整性不合格：分镜比原文多出 ${dc.extraLines.length} 句原创对白（原文没有的台词）。请只保留原文「」内对白，删除自行新增的台词。`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    shotCount: suggestions.length,
    eventCount: uniqueEventIds.length,
    coveredCount,
    coverage,
    missingEventIds,
    hardEventCount: hardIds.length,
    hardCoveredCount,
    hardCoverage,
    missingHardEventIds,
    auxEventCount: auxIds.length,
    auxCoverage,
    missingAuxEventIds,
    dialogueCompleteness,
  };
}

/** 容错收下：硬事件必须 100%；短剧可略降镜数下限。节奏配额（对话≥45%/赶路≤35%）不可容错。 */
export function dramaShotPlanIsAcceptable(
  v: DramaShotPlanValidation,
  budget: DramaAnalyzeShotBudget,
  paceGear?: string,
): boolean {
  if (v.ok) return true;
  const pace = normalizeDramaShotPlanPaceGear(paceGear);
  const shortDrama = pace === 'short_drama';
  const dense15 = pace === 'dense_15s';
  const dense20 = pace === 'dense_20s';
  if (shortDrama && v.errors.some((e) => e.includes('短剧节奏不合格'))) return false;
  if (dense15 && v.errors.some((e) => e.includes('15秒高密度不合格'))) return false;
  if (dense20 && v.errors.some((e) => e.includes('20秒高密度不合格'))) return false;
  // 对白完整性缺失：任何挡位都不可容错收下，必须让 AI 补齐
  if (v.errors.some((e) => e.includes('对白完整性不合格'))) return false;
  const minShots = dense20
    ? Math.max(5, Math.floor(budget.shotsMin * 0.5))
    : dense15
      ? Math.max(3, Math.floor(budget.shotsMin * 0.65))
      : shortDrama
        ? Math.max(4, Math.floor(budget.shotsMin * 0.7))
        : Math.max(8, budget.shotsMin);
  return v.hardCoverage >= 1 && v.shotCount >= minShots;
}

export function formatDramaShotPlanValidationError(v: DramaShotPlanValidation): string {
  if (v.ok) return '';
  return v.errors.join('\n');
}
