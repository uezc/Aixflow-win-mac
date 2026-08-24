/**
 * 短剧导演分镜：按用户意见改写时间轴切段画面提示（visual_action / camera_action）。
 * 默认在原文上局部调整，禁止整段替换；仅当用户明确要求重写时才整段重写。
 */

import { isDirectorFinalPromptFullRewriteOpinion } from './reviseFinalPrompt.js';

export const DIRECTOR_REVISE_DRAMA_CUT_SYSTEM = `你是短剧分镜切段提示词改写助手。用户会给出当前切段的画面提示、机位，以及「修改思路」。

【改写模式·二选一】
A. 局部调整（默认，必须遵守）：在【当前画面提示】和【当前机位】原文上改意见点到的部分。未点名的字句、前缀【】、表演细节一律原样保留。禁止另起一句全新提示词覆盖原文。
B. 整段重写：仅当用户明确要求「全部重写 / 整段改成 / 重新写 / 换成全新」时，才允许重写全部正文。

硬性要求：
1. 只改当前切段的「画面提示」和必要时的「机位/运镜」。不要输出 MiniMax-H3 六段式全文。
2. 局部调整时：先复制原文，再按修改思路插入/替换对应短语。例如思路是「改成侧脸近景」→ 只改景别/朝向相关字，保留「表情很少变化…」等未点名内容。
3. 不要编造新情节、新人物、新地点；不要改对白原文。
4. 机位仅当修改思路要求改景别/角度/运镜时才更新；否则必须原样返回当前机位。
5. 只输出 JSON，不要 markdown、不要解释。`;

export const DIRECTOR_REVISE_DRAMA_CUT_BATCH_SYSTEM = `你是短剧分镜切段提示词改写助手。用户会给出本镜全部切段，以及「修改思路」。

【改写模式】默认局部调整：每一段都以该段原文为底，只改意见点到的部分，或只把景别可见信息拉开。禁止把各段都换成全新一句表演。
仅当用户明确要求全部重写时，才允许重写各段正文。

硬性要求：
1. 为每一段输出 visual_action 与 camera_action。未要求改机位的段，camera_action 必须原样返回。
2. 默认分化：禁止各段正文整句重复。全景只写空间/站位；中景只写上半身与手部落点；近景/特写只写脸、眼、嘴的微相。可共用同一表演事件，但每段可见信息必须不同。
3. 不要编造新情节；不要改对白；不要输出 H3 六段式全文。
4. 只输出 JSON，不要 markdown、不要解释。`;

export type DramaCutReviseContext = {
  shotNo?: string;
  purpose?: string;
  size?: string;
  durationLabel?: string;
  currentVisual: string;
  currentCamera: string;
  dialogue?: string;
  envAudio?: string;
  startSec?: number;
  endSec?: number;
  opinion: string;
  siblingCuts: Array<{
    event_id: string;
    range: string;
    visual_action: string;
    camera_action: string;
  }>;
};

export type DramaCutReviseResult = {
  visual_action: string;
  camera_action?: string;
};

function stripFence(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  s = s.trim();
  if (!s) return '';
  const fenced = s.match(/^```(?:[\w-]*)?\s*([\s\S]*?)```\s*$/);
  if (fenced) s = fenced[1].trim();
  else s = s.replace(/^```(?:[\w-]*)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return s;
}

function extractJsonObject(s: string): unknown {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function buildDirectorReviseDramaCutMessages(ctx: DramaCutReviseContext): {
  systemPrompt: string;
  userPrompt: string;
} {
  const opinion = String(ctx.opinion || '').trim();
  const fullRewrite = isDirectorFinalPromptFullRewriteOpinion(opinion);
  const siblings = (ctx.siblingCuts || [])
    .map(
      (c) =>
        `- ${c.range} 机位：${c.camera_action || '—'} 画面：${c.visual_action || '—'}`,
    )
    .join('\n');
  const currentVisual = String(ctx.currentVisual || '').trim() || '（空）';
  const currentCamera = String(ctx.currentCamera || '').trim() || '—';
  const userPrompt = [
    fullRewrite
      ? '【改写模式】整段重写——以用户意见为主重写画面提示；原文仅作参考。'
      : '【改写模式】局部调整——必须以【当前画面提示】为底稿，只改意见点到的词句，其余原文照抄。禁止整段换成新句子。',
    '',
    '【当前切段】',
    `镜号：${String(ctx.shotNo || '').trim() || '—'}`,
    `时段：${Number(ctx.startSec) || 0}–${Number(ctx.endSec) || 0}秒`,
    `镜头目的：${String(ctx.purpose || '').trim() || '—'}`,
    `整镜景别：${String(ctx.size || '').trim() || '—'}`,
    `时长：${String(ctx.durationLabel || '').trim() || '—'}`,
    `对白：${String(ctx.dialogue || '').trim() || '无'}`,
    `环境音：${String(ctx.envAudio || '').trim() || '无'}`,
    '',
    '【当前机位/运镜】（未点名则原样返回）',
    currentCamera,
    '',
    '【当前画面提示】（底稿，局部调整必须基于此）',
    currentVisual,
    '',
    '【本镜其它切段（参考，不要把当前段改成它们）】',
    siblings || '（无）',
    '',
    '【用户修改思路】',
    opinion,
    '',
    '请只输出 JSON：{"visual_action":"...","camera_action":"..."}',
    fullRewrite
      ? '可按意见重写 visual_action。'
      : 'visual_action 必须能看出原文主干仍在；只把修改思路对应的短语改掉。camera_action 若无需改动，原样返回当前机位。',
  ].join('\n');
  return { systemPrompt: DIRECTOR_REVISE_DRAMA_CUT_SYSTEM, userPrompt };
}

export function buildDirectorReviseDramaCutBatchMessages(ctx: {
  shotNo?: string;
  purpose?: string;
  size?: string;
  opinion: string;
  cuts: Array<{
    event_id: string;
    range: string;
    visual_action: string;
    camera_action: string;
  }>;
}): { systemPrompt: string; userPrompt: string } {
  const opinion = String(ctx.opinion || '').trim();
  const fullRewrite = isDirectorFinalPromptFullRewriteOpinion(opinion);
  const cuts = (ctx.cuts || [])
    .map(
      (c) =>
        `- event_id=${c.event_id} ${c.range} 机位：${c.camera_action || '—'} 画面：${c.visual_action || '—'}`,
    )
    .join('\n');
  const userPrompt = [
    fullRewrite
      ? '【改写模式】整段重写——各段可按意见重写。'
      : '【改写模式】局部调整——每一段必须以该段原文为底稿，只改意见点到的部分或景别前缀；禁止把表演整句换成全新内容。',
    '',
    `镜号：${String(ctx.shotNo || '').trim() || '—'}`,
    `镜头目的：${String(ctx.purpose || '').trim() || '—'}`,
    `整镜景别：${String(ctx.size || '').trim() || '—'}`,
    '',
    '【本镜全部切段原文】',
    cuts || '（空）',
    '',
    '【用户修改思路】',
    opinion ||
      '默认：禁止各段正文整句重复。按全景=空间站位、中景=肢体手部、近景=面部眼神拆开可见信息；保留同一表演事件，不要另编情节。',
    '',
    '请只输出 JSON：{"cuts":[{"event_id":"...","visual_action":"...","camera_action":"..."}]}',
    '必须覆盖上面每一个 event_id。未要求改机位则 camera_action 原样返回。',
  ].join('\n');
  return { systemPrompt: DIRECTOR_REVISE_DRAMA_CUT_BATCH_SYSTEM, userPrompt };
}

export function parseDirectorRevisedDramaCut(text: unknown): DramaCutReviseResult | null {
  const s = stripFence(text);
  if (!s) return null;
  const obj = extractJsonObject(s);
  if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    const visual = String(rec.visual_action || rec.画面提示 || rec.prompt || '').trim();
    const camera = String(rec.camera_action || rec.机位 || rec.camera || '').trim();
    if (visual) return { visual_action: visual, ...(camera ? { camera_action: camera } : {}) };
  }
  const plain = s
    .replace(/^(?:画面提示|visual_action)\s*[:：]\s*/i, '')
    .trim();
  return plain ? { visual_action: plain } : null;
}

export function parseDirectorRevisedDramaCutBatch(
  text: unknown,
): Array<{ event_id: string; visual_action: string; camera_action?: string }> | null {
  const s = stripFence(text);
  if (!s) return null;
  const obj = extractJsonObject(s);
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const list = Array.isArray(rec.cuts) ? rec.cuts : Array.isArray(rec) ? rec : null;
  if (!list?.length) return null;
  const out: Array<{ event_id: string; visual_action: string; camera_action?: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const event_id = String(row.event_id || '').trim();
    const visual_action = String(row.visual_action || row.画面提示 || '').trim();
    const camera_action = String(row.camera_action || row.机位 || '').trim();
    if (!event_id || !visual_action) continue;
    out.push({ event_id, visual_action, ...(camera_action ? { camera_action } : {}) });
  }
  return out.length ? out : null;
}
