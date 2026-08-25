/**
 * H3 Compiler 回归：合成 Session 走 Case A–E（不碰真实工程文件）。
 */
import { createEmptyDramaSession, createEmptyDramaCharacter, createEmptyDramaSceneAsset, createEmptyDramaVoice, createEmptyDramaShot } from '../src/shared/directorDomain/factories.ts';
import { compileDramaShotVideoRequest } from '../src/shared/directorDomain/compileDramaShotVideoRequest.ts';
import { ensureDirectorDramaVideoPromptGuards } from '../src/shared/directorPipeline/composeFinalPrompt.ts';
import {
  scrubH3EnvironmentAudio,
  scrubH3SpeechLeak,
  shouldSendDramaH3AudioReference,
} from '../src/shared/directorDomain/h3DialogueMode.ts';
import {
  applyDramaDirectingEnhancePatch,
  parseDramaDirectingEnhancePatch,
  revertDramaDirectingEnhance,
} from '../src/shared/directorDomain/directingEnhance.ts';

function shotBase() {
  return createEmptyDramaShot({
    shot_id: 'shot-1',
    shot_no: '1',
    duration_sec: 10,
    size: '近景',
    angle: '平视',
    move: '固定',
    character_ids: ['c1', 'c2', 'c3'],
    scene_asset_id: 'sc1',
    final_prompt: '【旧final_prompt】主体定义：这是历史缓存不应出片',
    adapter_prompt_cache: '旧缓存',
    timeline_events: [
      {
        event_id: 'e1',
        start_sec: 0,
        end_sec: 3,
        character_ids: ['c1', 'c2'],
        visual_action: '两人相对而立',
        character_state: '克制',
        position: '中景',
        expression: '压抑',
        eyeline: '对视',
        dialogue: '',
        dialogue_character_id: '',
        environment_audio: ['酒杯碰撞'],
        lip_sync: false,
        camera_action: '近景固定',
      },
      {
        event_id: 'e2',
        start_sec: 3,
        end_sec: 7,
        character_ids: ['c1', 'c2'],
        visual_action: 'c2开口',
        character_state: '质问',
        position: '过肩',
        expression: '冷',
        eyeline: '看向c1',
        dialogue: '你为什么还要来找我',
        dialogue_character_id: 'c2',
        environment_audio: ['低语声'],
        lip_sync: true,
        camera_action: '过肩',
      },
      {
        event_id: 'e3',
        start_sec: 7,
        end_sec: 10,
        character_ids: ['c1', 'c2', 'c3'],
        visual_action: 'c3在后方经过',
        character_state: '旁观',
        position: '背景',
        expression: '平静',
        eyeline: '看向门口',
        dialogue: '',
        dialogue_character_id: '',
        environment_audio: ['脚步声'],
        lip_sync: false,
        camera_action: '微拉',
      },
    ],
  });
}

function buildSession(opts?: { audioUrl?: string }) {
  const c1 = createEmptyDramaCharacter({
    character_id: 'c1',
    name: '阿衡',
    gender: 'female',
    imageUrl: 'https://example.com/c1.jpg',
    voice_id: 'v1',
  });
  const c2 = createEmptyDramaCharacter({
    character_id: 'c2',
    name: '顾深',
    gender: 'male',
    imageUrl: 'https://example.com/c2.jpg',
    voice_id: 'v2',
  });
  const c3 = createEmptyDramaCharacter({
    character_id: 'c3',
    name: '林初',
    gender: 'male',
    imageUrl: 'https://example.com/c3.jpg',
    voice_id: 'v3',
  });
  const scene = createEmptyDramaSceneAsset({
    scene_id: 'sc1',
    name: '沙漠酒馆',
    imageUrl: 'https://example.com/sc.jpg',
    lighting: '昏暗灯光',
    color_palette: '低饱和暖褐',
  });
  const voices = [
    createEmptyDramaVoice({ voice_id: 'v1', character_id: 'c1', sample_url: 'https://example.com/v1.mp3' }),
    createEmptyDramaVoice({ voice_id: 'v2', character_id: 'c2', sample_url: 'https://example.com/v2.mp3' }),
    createEmptyDramaVoice({ voice_id: 'v3', character_id: 'c3', sample_url: 'https://example.com/v3.mp3' }),
  ];
  const shot = shotBase();
  if (opts?.audioUrl) shot.audio_url = opts.audioUrl;
  return createEmptyDramaSession({
    bible: {
      characters: [c1, c2, c3],
      scenes: [scene],
      voices,
    } as never,
    shots: [shot],
  });
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sessionA = buildSession();
const shotA = sessionA.shots[0];
assert(sessionA.bible.characters[0].speaker_id === 'S1', 'CaseE speaker S1');
assert(shotA.audio_timeline && shotA.audio_timeline.length === 1, 'migrate audio timeline');
assert(shotA.audio_timeline?.[0].text === '你为什么还要来找我', 'dialogue kept');
assert(shotA.final_prompt.includes('旧final_prompt'), 'legacy final_prompt kept');

const compiledA = compileDramaShotVideoRequest(sessionA, shotA, {
  mode: 'h3-multi',
  model: 'minimax-h3-multi',
});
assert(compiledA.mode === 'h3-multi', 'A mode');
assert(compiledA.inputAudios.length === 3, `A 角色参考音 ${compiledA.inputAudios.length}`);
assert(!compiledA.prompt.includes('旧final_prompt'), 'A 不用 final_prompt');
assert(
  compiledA.prompt.includes('【短剧禁字幕·硬性】') ||
    /Spoken-words lock|No burned-in subtitles/i.test(compiledA.prompt),
  'A 禁字幕',
);
assert(/严禁即兴/.test(compiledA.prompt) || /BGM/.test(compiledA.prompt), 'A 禁 BGM');
assert(compiledA.prompt.includes('你为什么还要来找我'), 'A 对白按轴');
assert(compiledA.prompt.includes('酒杯碰撞') || compiledA.prompt.includes('环境音'), 'A 环境音');
assert(compiledA.debug.provenance.sections.length === 8, 'A-H 八段');
assert(compiledA.debug.provenance.sections[0].title === '系统规则', '中文分段标题');
assert(!/cinematic film look/i.test(compiledA.prompt), '中文编译不用英文视觉圣经主干');
assert(!/System Rules/.test(compiledA.debug.provenance.sections.map((s) => s.title).join('|')), '标题非英文');
assert(!/写实真人电影拍摄风格/.test(compiledA.debug.provenance.sections.find((s) => s.id === 'E')?.text || ''), 'E 不重复全局风格词过多');

const sessionB = buildSession({ audioUrl: 'https://example.com/shot.mp3' });
const compiledB = compileDramaShotVideoRequest(sessionB, sessionB.shots[0], {
  mode: 'h3-audio',
  model: 'minimax-h3-audio',
});
assert(compiledB.inputAudios.length === 1, 'B 仅本镜音');
assert(compiledB.inputAudios[0].includes('shot.mp3'), 'B 复用本镜音');
assert(compiledB.prompt.includes('完整保留'), 'B 完整复用');
assert(compiledB.prompt.includes('禁止另') || compiledB.prompt.includes('勿再生成'), 'B 不另配环境');
assert(compiledB.debug.constraints.generate_dialogue === false, 'B 不生成对白');
assert(
  compiledB.prompt.includes('允许自然呼吸') ||
    /natural (breathing|mouth)|Naturally closed/i.test(compiledB.prompt) ||
    compiledB.prompt.includes('闭嘴'),
  'B 非蜡像',
);

const shotC = {
  ...shotA,
  duration_sec: 15,
  timeline_events: shotA.timeline_events.map((e) => ({
    ...e,
    start_sec: e.start_sec * 1.5,
    end_sec: e.end_sec * 1.5,
    dialogue: e.event_id === 'e2' ? '你还回来做什么' : e.dialogue,
  })),
  audio_timeline: undefined,
};
const compiledC = compileDramaShotVideoRequest(sessionA, shotC, {
  mode: 'h3-multi',
  model: 'minimax-h3-multi',
});
assert(compiledC.prompt.includes('你还回来做什么'), 'C 改对白后重编译');
assert(!compiledC.prompt.includes('旧final_prompt'), 'C 仍不用旧 prompt');
assert(compiledC.durationSec === 15, 'C 时长 15');

const llmRaw = JSON.stringify({
  schema: 'drama-directing-enhance.v1',
  shot_id: shotA.shot_id,
  speaker_id: 'S9',
  performance_plan: [
    {
      character_id: 'c2',
      facial_expression: '说完后强忍哽咽',
      breathing: '轻微呼气',
      post_dialogue_reaction: '抿嘴',
    },
  ],
  directing_enhance: { camera_movement: 'slow_push_in' },
});
const parsed = parseDramaDirectingEnhancePatch(llmRaw, shotA.shot_id);
assert(parsed.blocked.some((b) => /speaker/i.test(b.path) || b.reason.includes('禁止')), 'D 禁止字段丢弃');
const applied = applyDramaDirectingEnhancePatch(shotA, parsed.patch, parsed.blocked);
assert(!(applied.shot.performance_plan || []).some((b) => b.speaker_id === 'S9' && b.source === 'llm_enhanced' && !b.character_id), 'D 不改 speaker 事实');
assert(applied.shot.final_prompt === shotA.final_prompt, 'D 不覆盖 final_prompt');
assert(applied.shot.performance_plan?.some((b) => b.facial_expression?.includes('哽咽')), 'D 写入表演');
const compiledD = compileDramaShotVideoRequest(sessionA, applied.shot, {
  mode: 'h3-multi',
  model: 'minimax-h3-multi',
});
assert(compiledD.prompt.includes('哽咽') || compiledD.prompt.includes('呼气') || compiledD.prompt.includes('抿嘴'), 'D Compiler 吃表演');
const reverted = revertDramaDirectingEnhance(applied.shot);
assert(!(reverted.performance_plan || []).some((b) => b.source === 'llm_enhanced'), 'D 可撤销');

const userLocked = applyDramaDirectingEnhancePatch(
  {
    ...shotA,
    directing_enhance: { source: 'user', camera_movement: 'fixed' },
  },
  parsed.patch,
  [],
);
assert(userLocked.shot.directing_enhance?.camera_movement === 'fixed', 'D 用户运镜不被 LLM 覆盖');

const dupAction =
  '周一川骑电动车穿过车流，雨水溅起。周一川停车，抬头看向写字楼玻璃门';
const shotF = {
  ...shotA,
  duration_sec: 15,
  dialogue: [],
  audio_timeline: [],
  timeline_events: [
    {
      event_id: 'f1',
      start_sec: 0,
      end_sec: 3.4,
      character_ids: ['c1'],
      visual_action: dupAction,
      character_state: '专注。平静',
      position: '车流中',
      expression: '专注。凝视',
      eyeline: '看向前方',
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: ['雨声', '车流声', '电动车引擎声'],
      lip_sync: false,
      camera_action: '俯拍·缓慢推入',
    },
    {
      event_id: 'f2',
      start_sec: 3.4,
      end_sec: 6.6,
      character_ids: ['c1'],
      visual_action: dupAction,
      character_state: '专注。平静',
      position: '车流中',
      expression: '专注。凝视',
      eyeline: '看向前方',
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: ['雨声', '车流声', '电动车引擎声'],
      lip_sync: false,
      camera_action: '俯拍·缓慢推入',
    },
    {
      event_id: 'f3',
      start_sec: 6.6,
      end_sec: 10,
      character_ids: ['c1'],
      visual_action: dupAction,
      character_state: '专注。平静',
      position: '门口',
      expression: '凝视',
      eyeline: '看向玻璃门',
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: ['雨声', '电动车引擎声'],
      lip_sync: false,
      camera_action: '俯拍·缓慢推入',
    },
    {
      event_id: 'f4',
      start_sec: 10,
      end_sec: 15,
      character_ids: ['c1'],
      visual_action: '周一川下车，扶起电动车走向门口',
      character_state: '平静',
      position: '门口',
      expression: '专注',
      eyeline: '看向门',
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: ['雨声', '脚步声'],
      lip_sync: false,
      camera_action: '俯拍·缓慢推入',
    },
  ],
};
const compiledF = compileDramaShotVideoRequest(sessionA, shotF, {
  mode: 'h3-audio',
  model: 'minimax-h3-audio',
  locale: 'zh',
});
const fPrompt = compiledF.prompt;
assert((fPrompt.match(/骑电动车穿过车流/g) || []).length <= 1, 'F 不把同一骑车动作写进每个镜头');
assert(
  fPrompt.includes('机位保持') || fPrompt.includes('Camera holds') || /缓慢推入|俯拍/.test(fPrompt),
  'F 机位变化才重写',
);
assert(fPrompt.includes('下车') || fPrompt.includes('扶起电动车'), 'F 末段动作独立');
assert(fPrompt.includes('【Audio Timeline】'), 'F 编译 Audio Timeline');
assert(fPrompt.includes('【环境轴】') && fPrompt.includes('雨声'), 'F 环境轴进镜头时间窗');
assert((fPrompt.match(/本时间段无对白/g) || []).length <= 1, 'F 不把长无对白规则贴进每个镜头');
assert(compiledF.debug.audio_timeline.length === 0, 'F 无对白事实时 AudioTimeline 为空');

assert(compiledA.prompt.includes('说话中') || compiledA.prompt.includes('正在说') || compiledA.prompt.includes('says') || compiledA.prompt.includes('<d>[Chinese]'), 'A 对白编进说话窗');
assert(compiledA.prompt.includes('说话前') || compiledA.prompt.includes('说完后') || compiledA.prompt.includes('after speech') || compiledA.prompt.includes('says'), 'A 表演分说话前/后');
assert(compiledA.audit.dialogue === true, 'A dialogue=true');
assert(compiledA.audit.audioReferenceSent === true, 'A 有对白仍传参考音');
assert(compiledA.prompt.includes('<d>[Chinese] 你为什么还要来找我'), 'A 台词只在 <d>');

{
  const scrubbedVisual = scrubH3SpeechLeak(
    '急促道歉「对不起，对不起，我赶时间！」司机继续抱怨「现在这些送外卖的，命都不要了！」',
  );
  assert(!scrubbedVisual.includes('对不起'), 'scrub 去掉道歉台词');
  assert(!/道歉|抱怨/.test(scrubbedVisual), 'scrub 去掉语言行为');
  const env = scrubH3EnvironmentAudio(['司机的谩骂声「想死啊？看不看路啊？」', '暴雨声', '轮胎摩擦']);
  assert(env.every((x) => !x.includes('想死啊')), '环境音去掉谩骂台词');
  assert(env.some((x) => x.includes('暴雨') || x.includes('轮胎') || x.includes('周围车辆')), '环境音保留 Foley');
  assert(
    shouldSendDramaH3AudioReference({ mode: 'h3-multi', hasDialogue: false }) === false,
    '无对白不传 h3-multi 参考音',
  );
  assert(
    shouldSendDramaH3AudioReference({ mode: 'h3-multi', hasDialogue: true }) === true,
    '有对白可传 h3-multi 参考音',
  );
}

const silentVoice = createEmptyDramaVoice({
  voice_id: 'v1',
  character_id: 'c1',
  sample_url: 'https://example.com/v1.mp3',
});
const silentShot = createEmptyDramaShot({
  shot_id: 'shot-silent',
  shot_no: '1',
  duration_sec: 6,
  character_ids: ['c1'],
  scene_asset_id: 'sc1',
  dialogue: [],
  audio_timeline: [],
  timeline_events: [
    {
      event_id: 's1',
      start_sec: 0,
      end_sec: 2.3,
      character_ids: ['c1'],
      visual_action: '人物骑车穿过雨夜车流，动作稳定',
      character_state: '',
      position: '',
      expression: '',
      eyeline: '',
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: ['暴雨声', '车流声'],
      lip_sync: false,
      camera_action: '全景｜侧面｜固定｜35mm',
    },
    {
      event_id: 's2',
      start_sec: 2.3,
      end_sec: 4.5,
      character_ids: ['c1'],
      visual_action: '紧急刹车，车轮打滑',
      character_state: '',
      position: '',
      expression: '',
      eyeline: '',
      dialogue: '',
      dialogue_character_id: '',
      environment_audio: ['司机的谩骂声「想死啊？看不看路啊？」'],
      lip_sync: false,
      camera_action: '中近景｜平视｜固定｜35mm',
    },
    {
      event_id: 's3',
      start_sec: 4.5,
      end_sec: 6,
      character_ids: ['c1'],
      visual_action: '急促道歉「对不起，对不起，我赶时间！」司机继续抱怨「现在这些送外卖的，命都不要了！」',
      character_state: '',
      position: '',
      expression: '',
      eyeline: '',
      dialogue: '对不起，对不起，我赶时间！',
      dialogue_character_id: '',
      environment_audio: ['轮胎摩擦'],
      lip_sync: false,
      camera_action: '中景｜平视｜固定｜35mm',
    },
  ],
});
const sessionSilent = createEmptyDramaSession({
  bible: {
    characters: [createEmptyDramaCharacter({ character_id: 'c1', name: '周一川', voice_id: 'v1', imageUrl: 'https://example.com/c1.jpg' })],
    scenes: [createEmptyDramaSceneAsset({ scene_id: 'sc1', name: '雨夜张江', imageUrl: 'https://example.com/sc.jpg' })],
    voices: [silentVoice],
  } as never,
  shots: [silentShot],
});
const compiledSilent = compileDramaShotVideoRequest(sessionSilent, silentShot, {
  mode: 'h3-multi',
  model: 'minimax-h3-multi',
});
const silentForbidden = [
  '想死啊？看不看路啊',
  '对不起，对不起，我赶时间',
  '现在这些送外卖的，命都不要了',
  '司机骂道',
  '成片音频须包含角色台词',
];
for (const line of silentForbidden) {
  assert(!compiledSilent.prompt.includes(line), `无对白不得出现：${line}`);
}
assert(!compiledSilent.prompt.includes('<d>'), '无对白不得出现 <d>');
assert(compiledSilent.audit.dialogue === false, '无对白 dialogue=false');
assert(compiledSilent.audit.dialogue_mode === 'NO_DIALOGUE_MODE', 'NO_DIALOGUE_MODE');
assert(compiledSilent.inputAudios.length === 0, '无对白不传角色参考音');
assert(compiledSilent.audit.audioReferenceSent === false, 'audioReferenceSent=false');
assert(compiledSilent.prompt.includes('[NO_DIALOGUE]'), '无对白单次规则');
assert(compiledSilent.debug.prompt_version === 'h3-no-dialogue-v2', 'prompt_version=h3-no-dialogue-v2');
assert((compiledSilent.debug.dialogue_events || []).length === 0, 'dialogueEvents=[]');
assert(!compiledSilent.prompt.includes('急促道歉'), '无对白去掉道歉行为');
assert(!compiledSilent.prompt.includes('司机继续抱怨'), '无对白去掉抱怨行为');
assert(!compiledSilent.prompt.includes('司机的谩骂'), '无对白去掉谩骂声描述');
assert(!compiledSilent.prompt.includes('可不说话'), '无对白不写可不说话');
assert(!compiledSilent.prompt.includes('Visual-only (do not speak)'), '无对白不套 Visual-only');
assert(!compiledSilent.prompt.includes('出场人物'), '无对白不写出场人物套话');
assert(!compiledSilent.prompt.includes('周一川'), '无对白镜头段不写中文名');
assert(
  /rain|traffic|tire/i.test(compiledSilent.prompt),
  '无对白环境音走英文 Foley',
);
{
  const wrapped = ensureDirectorDramaVideoPromptGuards(compiledSilent.prompt, {
    skipDialogueSfxFlatten: true,
    dialogue: '对不起，对不起，我赶时间！',
    sfx: '暴雨声',
  });
  assert(!wrapped.includes('成片音频须包含'), '出片封装不得再追加成片须包含台词');
  const leaked = `${compiledSilent.prompt}【短剧声景硬性】成片音频须包含：①按本镜对白清晰可辨的角色台词`;
  const stripped = ensureDirectorDramaVideoPromptGuards(leaked, { skipDialogueSfxFlatten: true });
  assert(!stripped.includes('成片音频须包含'), '已带 [NO_DIALOGUE] 时清掉冲突声景句');
}

const compiledSpoken = compileDramaShotVideoRequest(sessionA, shotA, {
  mode: 'h3-multi',
  model: 'minimax-h3-multi',
});
assert(compiledSpoken.inputAudios.length > 0, '有对白仍传参考音');
assert(compiledSpoken.prompt.includes('<d>[Chinese] 你为什么还要来找我'), '有对白仍输出 <d>');
assert(compiledSpoken.audit.dialogue === true, '有对白 dialogue=true');
assert(compiledSpoken.debug.prompt_version === 'h3-dialogue-v1', 'prompt_version=h3-dialogue-v1');

console.log('H3 Compiler Case A–E 合成回归通过');
console.log(
  JSON.stringify(
    {
      A: {
        mode: compiledA.mode,
        audios: compiledA.inputAudios.length,
        images: compiledA.inputImages.length,
        sections: compiledA.debug.provenance.sections.map((s) => s.id),
      },
      B: {
        mode: compiledB.mode,
        audios: compiledB.inputAudios.length,
        generate_dialogue: compiledB.debug.constraints.generate_dialogue,
        generate_environment: compiledB.debug.constraints.generate_environment,
      },
      C: { duration: compiledC.durationSec, hasNewDlg: compiledC.prompt.includes('你还回来做什么') },
      D: { blocked: parsed.blocked.map((b) => b.path), reverted: !reverted.directing_enhance_revision?.accepted },
      E: { speakers: sessionA.bible.characters.map((c) => c.speaker_id), legacyKept: !!shotA.final_prompt },
    },
    null,
    2,
  ),
);
