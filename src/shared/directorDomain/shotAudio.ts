/**
 * 短剧本镜声音：豆包 1.0 文本提示 + 角色参考音收集（最多 3 路）。
 */

import { formatDramaDialogueLines } from './factories.js';
import { formatDramaTimelineEventDisplay } from './timelineEvent.js';
import type { DramaCharacter, DramaDirectorSession, DramaShot, DramaVoice } from './types.js';

export type DramaShotVoiceRef = {
  character_id: string;
  character_name: string;
  voice_id: string;
  sample_url: string;
};

/** 本镜有台词的角色（按对白顺序，去重） */
export function listDramaShotDialogueCharacters(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaCharacter[] {
  const out: DramaCharacter[] = [];
  const seen = new Set<string>();
  for (const line of shot.dialogue || []) {
    const id = String(line.character_id || '').trim();
    const name = String(line.character_name || '').trim();
    let ch =
      (id && session.bible.characters.find((c) => c.character_id === id)) ||
      (name && session.bible.characters.find((c) => c.name === name)) ||
      null;
    if (!ch) continue;
    if (seen.has(ch.character_id)) continue;
    seen.add(ch.character_id);
    out.push(ch);
  }
  if (!out.length) {
    for (const cid of shot.character_ids || []) {
      const ch = session.bible.characters.find((c) => c.character_id === cid);
      if (ch && !seen.has(ch.character_id)) {
        seen.add(ch.character_id);
        out.push(ch);
      }
    }
  }
  return out;
}

export function resolveDramaVoiceForCharacter(
  session: DramaDirectorSession,
  ch: DramaCharacter,
): DramaVoice | null {
  return (
    session.bible.voices.find((v) => v.voice_id === ch.voice_id) ||
    session.bible.voices.find((v) => v.character_id === ch.character_id) ||
    null
  );
}

/**
 * 收集本镜可用参考音（最多 3 段，供 Doubao audio_url）。
 * 优先使用镜头显式 voice_ids（支持分镜卡手动增删）；为空时回退对白/出场人物启发式。
 */
export function collectDramaShotVoiceRefUrls(
  session: DramaDirectorSession,
  shot: DramaShot,
  max = 3,
): DramaShotVoiceRef[] {
  const limit = Math.max(1, Math.min(3, max));
  const refs: DramaShotVoiceRef[] = [];
  const seenUrl = new Set<string>();
  const pushVoice = (voice: DramaVoice | null | undefined, ch?: DramaCharacter | null) => {
    if (!voice || refs.length >= limit) return;
    const url = String(voice.identity?.reference_audio || voice.sample_url || '').trim();
    if (!url || seenUrl.has(url)) return;
    seenUrl.add(url);
    const character =
      ch ||
      session.bible.characters.find((c) => c.character_id === voice.character_id) ||
      null;
    refs.push({
      character_id: character?.character_id || voice.character_id || '',
      character_name: character?.name || voice.character_id || '角色',
      voice_id: voice.voice_id || '',
      sample_url: url,
    });
  };

  for (const vid of shot.voice_ids || []) {
    if (refs.length >= limit) break;
    const voice = session.bible.voices.find((v) => v.voice_id === String(vid || '').trim());
    pushVoice(voice || null);
  }
  if (refs.length) return refs;

  const chars = listDramaShotDialogueCharacters(session, shot);
  for (const ch of chars) {
    if (refs.length >= limit) break;
    pushVoice(resolveDramaVoiceForCharacter(session, ch), ch);
  }
  return refs;
}

/** 当前镜头应展示的参考音 id 列表（显式或启发式物化） */
export function resolveDramaShotVoiceIds(
  session: DramaDirectorSession,
  shot: DramaShot,
  max = 3,
): string[] {
  if ((shot.voice_ids || []).length) {
    return (shot.voice_ids || []).map(String).filter(Boolean).slice(0, max);
  }
  return collectDramaShotVoiceRefUrls(session, shot, max)
    .map((r) => r.voice_id)
    .filter(Boolean);
}

/**
 * 豆包 Seed Audio 1.0：本镜「对白 + 环境音效」一体化 text_prompt。
 * 主参考 = 导演分段时间轴话术；对白原文与参考音色作硬约束。
 */
export function buildDramaShotDoubaoAudioPrompt(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts?: { durationSec?: number; refNames?: string[] },
): string {
  const dur =
    opts?.durationSec != null && Number.isFinite(opts.durationSec) && opts.durationSec > 0
      ? opts.durationSec
      : Number(shot.duration_sec) > 0
        ? Number(shot.duration_sec)
        : 8;
  const sfx = String(shot.sfx || '').trim();
  const dialogueLines = (shot.dialogue || [])
    .map((d) => {
      const name =
        String(d.character_name || '').trim() ||
        session.bible.characters.find((c) => c.character_id === d.character_id)?.name ||
        '角色';
      const text = String(d.text || '').trim();
      return text ? `${name}：「${text}」` : '';
    })
    .filter(Boolean);
  const dialogueBlock =
    dialogueLines.length > 0
      ? dialogueLines.join('\n')
      : formatDramaDialogueLines(shot.dialogue) || '';
  const hasVoice = dialogueLines.length > 0 || !!dialogueBlock;

  const timelineLines = (shot.timeline_events || [])
    .map((ev) => formatDramaTimelineEventDisplay(ev))
    .map((t) => t.trim())
    .filter(Boolean);
  const timelineBlock = timelineLines.join('\n');
  const hasTimeline = timelineLines.length > 0;

  const refHint =
    opts?.refNames && opts.refNames.length
      ? `参考音频对应角色音色：${opts.refNames.join('、')}。请按参考音克隆对应说话人的音色与口吻。`
      : hasVoice
        ? '若未提供参考音，请用自然中文对白音色区分角色。'
        : '';

  const parts: string[] = [
    `生成一段约 ${Math.round(dur)} 秒的短剧本镜连续音轨（纯音频）。`,
    '声轨内容必须包含：环境底噪/物理动作音效' +
      (hasVoice ? ' + 角色对白（清晰可辨、口型可同步）' : '（本镜无对白）') +
      '。',
    '严禁背景音乐、配乐、BGM、哼唱、器乐铺底；不要旁白播报说明文字。',
  ];

  if (hasTimeline) {
    parts.push(
      '【主参考·多段视听事件】以下 timeline_events 是本镜声音的权威依据：请严格按各段起止秒对齐环境音、动作音与对白时机；有对白且口型开的段落须清晰人声，口型关段落禁止说话声。',
      timelineBlock,
    );
  } else {
    // 无时间轴时的弱兜底
    const scene =
      session.bible.scenes.find((sc) => sc.scene_id === shot.scene_asset_id) || null;
    const where = [scene?.name, scene?.location, shot.environment]
      .filter(Boolean)
      .join(' · ');
    if (where) parts.push(`场景地点：${where}`);
    if (shot.action) parts.push(`画面动作参考：${shot.action}`);
    if (sfx) parts.push(`环境音效：${sfx}`);
  }

  if (hasVoice) {
    parts.push(
      '【对白硬约束】台词必须按下面原文清晰说出（可与时间轴时段对齐，勿改写语义）：',
      dialogueBlock || dialogueLines.join('\n'),
    );
  } else {
    parts.push('本镜无对白：不要生成说话声。');
  }

  if (hasTimeline && sfx) {
    parts.push(`补充音效关键词（须融入对应时段，勿另起无关层）：${sfx}`);
  }

  if (refHint) parts.push(refHint);
  parts.push(
    '输出一条可直接挂到成片上的完整音轨，对白与环境音混在同一段里，音量平衡、无刺耳爆音。',
  );

  let text = parts.filter(Boolean).join('\n');
  // 优先保住时间轴：超长时先砍兜底句，再截断尾部
  if (text.length > 3200) {
    text = `${text.slice(0, 3180)}…`;
  }
  return text;
}

export function dramaShotNeedsAudioContent(shot: DramaShot): boolean {
  const hasDlg = (shot.dialogue || []).some((d) => String(d.text || '').trim());
  const hasSfx = !!String(shot.sfx || '').trim();
  return hasDlg || hasSfx;
}
