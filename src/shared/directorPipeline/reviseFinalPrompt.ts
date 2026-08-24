/**
 * MV 视频步：按用户意见改写单镜「最终提示词」的 system/user 模板。
 */

/** 用户意见是否要求整段重写（而非局部微调） */
export function isDirectorFinalPromptFullRewriteOpinion(opinion: string | undefined | null): boolean {
  const t = String(opinion || '').trim();
  if (!t) return false;
  if (
    /全部重写|整段重写|整体重写|彻底重写|重新写|重写全部|重写整段|换成全新|另起炉灶|不要原文|无视原文|从零写|完全改成|整段改成|全部改成|重做提示词|重新生成提示词/i.test(
      t,
    )
  ) {
    return true;
  }
  // 意见很长且像在描述整镜新内容 → 按整段重写处理
  if (t.length >= 80 && /(?:主体定义|概述|详细描述|画风|镜头|场景|人物)/.test(t)) {
    return true;
  }
  return false;
}

export const DIRECTOR_REVISE_FINAL_PROMPT_SYSTEM = `你是 MV / 短视频分镜提示词改写助手。用户会给出「当前最终提示词」与「调整意见」。

【改写模式·二选一】
A. 局部调整（默认）：意见只改局部时，在现有提示词上改对应信息，保留未点名的内容。
B. 整段重写：当用户明确要求「全部重写 / 整段改成 / 重新写 / 换成全新…」，或意见本身是完整新版提示词描述时——允许彻底重写全部正文，不要被原文束缚；可丢弃原文中与意见冲突的描写。

硬性要求（两种模式都遵守）：
1. 输出必须是可直接用于视频生成的完整提示词正文；优先保持 MiniMax-H3 中文六段式：
   主体定义： / 概述： / 内容保留分析： / 详细描述： / 整体声景： / 非剧情配乐：
   详细描述须含 MM:SS.mmm 毫秒时轴（如 00:00.000至00:01.200）；不要压成一句笼统「画风：」散文。
2. 若原文含 @图片N / 参考图绑定：局部调整时务必保留；整段重写时若意见未要求去掉参考图，仍尽量保留原有 @图片N 序号与绑定句。
3. 对口型由客户端开关管理：对口型=开 → 仅指定主角跟唱，可保留/补全 <d>[中文]…</d> 与 <音频1>；对口型=关 → 全员闭嘴，去掉跟唱与 <d>。
4. 画面禁止字幕/歌词叠字；精炼，避免同义约束重复堆叠。
5. 只输出提示词正文；禁止 markdown、禁止前后解释、禁止标题或列表包裹。`;

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
  const fullRewrite = isDirectorFinalPromptFullRewriteOpinion(opinion);

  const userPrompt = [
    fullRewrite
      ? '【改写模式】整段重写——以用户意见为主重写全部正文；原文仅作参考，冲突处以意见为准。'
      : '【改写模式】局部调整——只改意见点到的部分，其余尽量保留。',
    '',
    '【当前最终提示词】',
    current || '（空）',
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
    fullRewrite
      ? '请输出完整新版最终提示词（六段式 + 毫秒时轴），覆盖本镜时长。'
      : '若调整涉及表演/动作：请按本镜时长保持或补全毫秒时轴（00:00.000至…）。',
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
      // 六段式不要误裁成单段
      if (!/主体定义\s*[：:]/.test(s) && longest.length >= Math.min(40, s.length * 0.4)) {
        s = longest;
      }
    }
  }

  return s.trim();
}
