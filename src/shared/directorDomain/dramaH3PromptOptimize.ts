/**
 * 「H3提示词优化」内部 = 导演增强：LLM 输出 JSON Patch，不写整篇 Prompt。
 */

import { resolveDramaShotAudioTimeline, speakerIdForCharacter } from './migrateH3Compiler.js';
import { formatDramaDialogueLines } from './factories.js';
import { formatDramaTimelineEventDisplay } from './timelineEvent.js';
import type { DramaDirectorSession, DramaShot } from './types.js';

export function buildDramaShotH3SourceBrief(
  session: DramaDirectorSession,
  shot: DramaShot,
): string {
  const events = shot.timeline_events || [];
  const timeline = events.length
    ? events.map((ev) => formatDramaTimelineEventDisplay(ev)).join('\n')
    : '—';
  const audio = resolveDramaShotAudioTimeline(session, shot);
  const speakers = (session.bible.characters || [])
    .filter((c) => (shot.character_ids || []).includes(c.character_id))
    .map((c) => `${c.speaker_id || speakerIdForCharacter(session, c.character_id) || '?'} ${c.character_id} ${c.name}`)
    .join('\n');
  const audioLines = audio.length
    ? audio
        .map(
          (a) =>
            `${a.start_sec.toFixed(2)}–${a.end_sec.toFixed(2)} ${a.speaker_id} ${a.character_id}：「${a.text}」`,
        )
        .join('\n')
    : '（无对白事件）';

  return [
    `【镜号】${shot.shot_no}  【时长】${shot.duration_sec}s  【shot_id】${shot.shot_id}`,
    `【机位事实·只读】景别=${shot.size || '—'} 构图=${shot.framing || '—'} 角度=${shot.angle || shot.camera || '—'} 运镜=${shot.move || '—'}`,
    `【说话人表·只读】\n${speakers || '—'}`,
    `【AudioTimeline·只读·禁止修改起止/说话人/台词】\n${audioLines}`,
    `【画面切段·只读】\n${timeline}`,
    `【对白原文·只读】${formatDramaDialogueLines(shot.dialogue) || '—'}`,
    `【已有用户表演】\n${
      (shot.performance_plan || [])
        .filter((b) => b.source === 'user')
        .map((b) => JSON.stringify(b))
        .join('\n') || '（无）'
    }`,
  ].join('\n\n');
}

export function shotHasRefAudio(session: DramaDirectorSession, shot: DramaShot): boolean {
  for (const vid of shot.voice_ids || []) {
    const v = session.bible.voices.find((x) => x.voice_id === vid);
    if (v?.sample_url) return true;
  }
  for (const id of shot.character_ids || []) {
    const c = session.bible.characters.find((x) => x.character_id === id);
    if (!c) continue;
    const v =
      session.bible.voices.find((x) => x.voice_id === c.voice_id) ||
      session.bible.voices.find((x) => x.character_id === c.character_id);
    if (v?.sample_url) return true;
  }
  return false;
}

const ENHANCE_SYSTEM = `你是短剧分镜的「导演增强」助手，不是 Prompt 写手。
只输出一个 JSON 对象，不要 markdown，不要六段式，不要主体定义/详细描述长文。

schema 必须是：
{
  "schema": "drama-directing-enhance.v1",
  "shot_id": "...",
  "performance_plan": [
    {
      "character_id": "已有角色 id",
      "audio_event_id": "可选，对应只读 AudioTimeline.event_id",
      "timeline_event_id": "可选",
      "facial_expression": "",
      "eye_direction": "",
      "mouth_state": "speaking|closed|natural",
      "breathing": "",
      "head_movement": "",
      "body_movement": "",
      "hand_movement": "",
      "emotional_change": "",
      "post_dialogue_reaction": ""
    }
  ],
  "directing_enhance": {
    "camera_movement": "",
    "focus_behavior": "",
    "subtle_environment_action": ""
  }
}

硬性禁止修改（出现即无效）：speakerId、character 身份、dialogue 文本、audio start/end、audio URL、参考图、参考音、Visual Bible、H3 mode、服装锁、场景锁。
你只能加细表演与镜头微动作。
不要覆盖用户已填写的表演字段。
AudioTimeline 原样理解：谁在何时说什么，你不得改时间或说话人。
无对白时段不要写「全员双唇紧闭/蜡像」；应允许呼吸、吞咽、自然微动，只禁止说话口型。
character_id 必须来自输入的说话人表。`;

export function buildDramaShotH3OptimizeMessages(
  session: DramaDirectorSession,
  shot: DramaShot,
  _guides?: { skillMd: string; guide: string },
): { systemPrompt: string; userPrompt: string } {
  const brief = buildDramaShotH3SourceBrief(session, shot);
  return {
    systemPrompt: ENHANCE_SYSTEM,
    userPrompt: `请为本镜输出导演增强 JSON（schema=drama-directing-enhance.v1）。shot_id=${shot.shot_id}\n\n${brief}`,
  };
}
