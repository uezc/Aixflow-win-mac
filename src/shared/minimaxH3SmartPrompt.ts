/**
 * MiniMax-H3 智能提示词：中文草稿整理 + 六段式输出解析。
 */

import {
  MINIMAX_H3_FULL_REF_SYSTEM_PROMPT,
  MINIMAX_H3_FULL_REF_USER_SUFFIX,
} from './minimaxH3FullRefPrompt';

export type MinimaxH3SmartPromptSlot = {
  /** 用户填写的说明，如「角色B（红衣服女人）」 */
  description: string;
  /** 勾选：用参考音频1的音色说话（当前产品仅 1 路参考音） */
  useRefAudioTimbre: boolean;
};

export type BuildMinimaxH3SmartPromptDraftInput = {
  slots: MinimaxH3SmartPromptSlot[];
  plot: string;
  /** 参考图张数（按当前已连图顺序；仅输出有图槽） */
  imageCount: number;
};

/** 整理槽位 + 剧情为中文草稿（发给 LLM 的 user 正文主体） */
export function buildMinimaxH3SmartPromptDraft(
  input: BuildMinimaxH3SmartPromptDraftInput,
): string {
  const n = Math.max(0, Math.floor(Number(input.imageCount) || 0));
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const slot = input.slots[i] || { description: '', useRefAudioTimbre: false };
    const desc = String(slot.description || '').trim() || '（未填写说明）';
    let line = `图${i + 1}：${desc}`;
    if (slot.useRefAudioTimbre) {
      line += '。参考音频1的音色说话';
    }
    if (!line.endsWith('。') && !line.endsWith('.')) line += '。';
    lines.push(line);
  }
  const plot = String(input.plot || '').trim();
  const parts = [lines.join('\n')];
  if (plot) {
    parts.push('', '剧情：', plot);
  }
  return parts.join('\n').trim();
}

export function buildMinimaxH3SmartPromptMessages(draft: string): {
  systemPrompt: string;
  userPrompt: string;
} {
  const body = String(draft || '').trim();
  const userPrompt = [body, '', MINIMAX_H3_FULL_REF_USER_SUFFIX].join('\n');
  return {
    systemPrompt: MINIMAX_H3_FULL_REF_SYSTEM_PROMPT,
    userPrompt,
  };
}

/** 解析模型返回：去围栏/前后说明，尽量只留六段式正文 */
export function parseMinimaxH3FullRefPrompt(text: unknown): string {
  let s = typeof text === 'string' ? text : text == null ? '' : String(text);
  s = s.trim();
  if (!s) return '';

  const fenced = s.match(/^```(?:[\w-]*)?\s*([\s\S]*?)```\s*$/);
  if (fenced) s = fenced[1].trim();
  else {
    s = s.replace(/^```(?:[\w-]*)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  const startIdx = s.search(/subject_definitions\s*:/i);
  if (startIdx >= 0) s = s.slice(startIdx).trim();

  // 截到 non_diegetic_music 段之后的常见尾注之前
  const musicIdx = s.search(/non_diegetic_music\s*:/i);
  if (musicIdx >= 0) {
    const after = s.slice(musicIdx);
    const nextSection = after.search(/\n(?:#{1,3}\s|\*{1,2}|Note:|说明[:：])/i);
    if (nextSection > 0) {
      s = s.slice(0, musicIdx + nextSection).trim();
    }
  }

  return s.trim();
}

export function isMinimaxH3FullRefPrompt(text: string): boolean {
  return /^\s*subject_definitions\s*:/i.test(String(text || ''));
}
