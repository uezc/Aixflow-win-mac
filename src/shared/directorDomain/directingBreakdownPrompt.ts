/**
 * 导演拆戏 LLM：只输出结构化 JSON，禁止写最终视频 Prompt。
 */

import { formatDramaDialogueLines } from './factories.js';
import { dramaShotDirectingFingerprint } from './directingBreakdown.js';
import { formatDramaTimelineEventDisplay } from './timelineEvent.js';
import type { DramaDirectorSession, DramaShot } from './types.js';
import { DRAMA_H3_TIMING_SOUND_BREAKDOWN_RULES } from './prompts/h3TimingSoundHandbook.js';

export const DRAMA_DIRECTING_BREAKDOWN_SYSTEM = `你是影视导演，不是 Prompt 写手。
只输出一个 JSON 对象，不要 markdown，不要六段式提示词，不要主体定义/详细描述长文。

schema:
{
  "schema": "drama-directing-breakdown.v1",
  "shot_id": "...",
  "answers": {
    "story": "本镜讲什么",
    "purpose": "叙事目的",
    "visualSubject": "character_id 或空",
    "emotion": "情绪",
    "emotionTrend": "rise|hold|fall",
    "keyInfo": "最重要信息",
    "seeFirst": "先看到什么",
    "seeNext": "后看到什么",
    "hasDialogue": true,
    "needsLipsync": true,
    "nextHandoff": "下一镜承接的动作/视线/情绪"
  },
  "beats": [
    {
      "purpose": "发现|反应|对白|动作|铺垫",
      "event": "发生了什么",
      "emotion": "可拍摄的情绪",
      "emotionIntensity": 7,
      "characters": ["character_id"],
      "action": "可执行动作，禁止只写很害怕",
      "dialogue": "有对白才填原文",
      "dialogueCharacterId": "说话人 character_id",
      "environmentSound": "底噪Loop｜同步Foley（禁止台词）",
      "continuityIn": "从上一拍什么状态进入",
      "continuityOut": "本拍结束状态"
    }
  ]
}

硬规则：
- 禁止平均切时间。对白是硬锚点；说话人变化、对白情绪变化必须另起一拍。
- 一个 beat 只承担一个主要戏剧动作。禁止走路+说话+看手机+情绪变化塞进同一拍。
- 先识别必须被看见的视觉事件，再合并连续同目的同空间的拍。信息揭示与人物反应不要合并。
- 无对白则 needsLipsync=false，beats.lipSync 视为关（不要写开口唱歌）。
- 有对白必须单独一拍给口型，前后留反应。
- 不要发明剧本没有的人物/道具/对白。
- 不要输出最终视频 Prompt。
- beats 数量：6 秒镜 2–4 拍；10 秒镜 3–6 拍；15 秒镜 4–8 拍。宁可多拍，不要一拍演完整段对白。

${DRAMA_H3_TIMING_SOUND_BREAKDOWN_RULES}

【拍摄执行表 QA · 强制】
1. 人物/威胁源切换必须有转场拍：若上一拍是 A 逼近/敲门/喊话，下一拍切到 B 交谈，必须在 answers.nextHandoff 与 beats.continuityIn 写清「A 离开/被拒/淡出 → 时间跳切 N 秒 → B 入画或一直在场但此前未交代」。禁止无因果硬切。
2. 极端天气（雨夜车内/窗外水花）：sfx 写清「雨声 Loop + 可选 ADR」；action 不要假设同期收音可用；备注级信息写入 environmentSound（如「雨声后期叠加，对白 ADR」）。
3. 短时连续特写：每拍 expression/action 只保留 1 个主微相 + 最多 1 个肢体，禁止同一 2～3 秒内堆「眉心+咬牙+胸脯+颊肌」全套；宏表演留给排练，特写只抓关键瞬间。
4. 悬念结尾：最后一拍 answers.nextHandoff 必须写「留悬念接下一场：…」，黑屏/熄屏类结尾禁止空 handoff。`;

export function buildDramaDirectingBreakdownMessages(
  session: DramaDirectorSession,
  shot: DramaShot,
  prev: DramaShot | null,
): { systemPrompt: string; userPrompt: string } {
  const names = (shot.character_ids || [])
    .map((id) => (session.bible?.characters || []).find((c) => c.character_id === id))
    .filter(Boolean)
    .map((c) => `${c!.character_id} ${c!.name}`)
    .join('、');
  const prevEnd = prev
    ? `上一镜结束：动作=${prev.action || '—'}；情绪=${prev.expression || '—'}；出画=${prev.directing_breakdown?.answers.nextHandoff || prev.continuity_notes || '—'}`
    : '无上一镜';
  const timeline = (shot.timeline_events || [])
    .map((e) => formatDramaTimelineEventDisplay(e))
    .join('\n');
  return {
    systemPrompt: DRAMA_DIRECTING_BREAKDOWN_SYSTEM,
    userPrompt: [
      `shot_id=${shot.shot_id} 镜号=${shot.shot_no} 时长=${shot.duration_sec}s fingerprint=${dramaShotDirectingFingerprint(shot)}`,
      `目的=${shot.purpose || '—'}`,
      `动作=${shot.action || '—'}`,
      `出场=${names || '—'}`,
      `对白=${formatDramaDialogueLines(shot.dialogue) || '无'}`,
      prevEnd,
      `现有时间轴（可重切节拍，但不得改对白原文与说话人）：\n${timeline || '（空）'}`,
      '请输出导演拆戏 JSON。',
    ].join('\n'),
  };
}
