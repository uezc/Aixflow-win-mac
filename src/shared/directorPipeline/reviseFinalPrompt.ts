/**
 * MV 视频步：按用户意见改写单镜「最终提示词」的 system/user 模板。
 */

export const DIRECTOR_REVISE_FINAL_PROMPT_SYSTEM = `你是 MV / 短视频分镜提示词改写助手。用户会给出「当前最终提示词」与「调整意见」。

硬性要求：
1. 只在现有提示词基础上按意见改写，不要另起炉灶丢掉无关但重要的内容。
2. 尽量保留：@图片N / 参考图序号说明、镜头语言（景别/角度/焦距/运镜）、光影、人物一致性、无字幕/无水印等若原稿已有的约束。
3. 若该镜开启对口型：保留口型可见、演唱/说话相关表述；若关闭对口型或原稿明确空镜：不要强行加对口型。
4. 输出纯文本一条可直接用于视频生成的提示词正文；禁止 markdown、禁止前后解释、禁止标题或列表包裹。
5. 尽量精炼，避免无意义重复。`;

export type DirectorReviseFinalPromptContext = {
  currentPrompt: string;
  opinion: string;
  shotNo?: string;
  duration?: string;
  angle?: string;
  cameraMove?: string;
  dialogue?: string;
  lipsyncOn?: boolean;
  styleSummary?: string;
};

export function buildDirectorReviseFinalPromptMessages(
  ctx: DirectorReviseFinalPromptContext,
): { systemPrompt: string; userPrompt: string } {
  const shotNo = String(ctx.shotNo || '').trim() || '—';
  const duration = String(ctx.duration || '').trim() || '—';
  const angle = String(ctx.angle || '').trim() || '—';
  const cameraMove = String(ctx.cameraMove || '').trim() || '—';
  const dialogue = String(ctx.dialogue || '').trim() || '（无）';
  const lipsync = ctx.lipsyncOn ? '开' : '关';
  const style = String(ctx.styleSummary || '').trim() || '—';
  const current = String(ctx.currentPrompt || '').trim();
  const opinion = String(ctx.opinion || '').trim();

  const userPrompt = [
    '【当前最终提示词】',
    current,
    '',
    '【用户调整意见】',
    opinion,
    '',
    '【镜头上下文】',
    `镜号：${shotNo}`,
    `时长：${duration}`,
    `机位/角度：${angle}`,
    `运镜：${cameraMove}`,
    `对白/旁白：${dialogue}`,
    `对口型：${lipsync}`,
    `风格摘要：${style}`,
    '',
    '请只输出改写后的最终提示词正文。',
  ].join('\n');

  return {
    systemPrompt: DIRECTOR_REVISE_FINAL_PROMPT_SYSTEM,
    userPrompt,
  };
}

/** 解析模型返回：去围栏/常见前缀，只留提示词正文 */
export function parseDirectorRevisedFinalPrompt(text: unknown): string {
  let s = typeof text === 'string' ? text : text == null ? '' : String(text);
  s = s.trim();
  if (!s) return '';

  const fenced = s.match(/^```(?:[\w-]*)?\s*([\s\S]*?)```\s*$/);
  if (fenced) s = fenced[1].trim();
  else {
    s = s.replace(/^```(?:[\w-]*)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  s = s
    .replace(/^(?:最终提示词|改写后(?:的)?(?:最终)?提示词|Final\s*prompt)\s*[:：]\s*/i, '')
    .trim();

  // 若模型仍夹带简短前后说明，尽量取最长非空段
  if (s.includes('\n\n') && s.length > 80) {
    const parts = s
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const longest = parts.reduce((a, b) => (b.length > a.length ? b : a), parts[0]);
      if (longest.length >= Math.min(40, s.length * 0.4)) s = longest;
    }
  }

  return s.trim();
}
