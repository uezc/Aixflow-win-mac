/**
 * 导演拆戏层验收：帮众惊恐对白镜 + 酒馆混乱镜。
 */

import {
  createEmptyDramaBible,
  createEmptyDramaCharacter,
  createEmptyDramaDialogueLine,
  createEmptyDramaSession,
  createEmptyDramaShot,
} from './factories.js';
import {
  applyDramaDirectingBreakdownToShot,
  formatDramaDirectingBreakdownDisplay,
} from './directingBreakdown.js';
import { compileDramaH3Prompt } from './h3PromptCompiler.js';
import { createEmptyDramaTimelineEvent } from './timelineEvent.js';
import { cameraSignature } from './directorCameraSchema.js';
import type { DramaDirectorSession, DramaShot } from './types.js';

function miniSession(shots: DramaShot[]): DramaDirectorSession {
  return createEmptyDramaSession({
    bible: createEmptyDramaBible({
      characters: [
        createEmptyDramaCharacter({ character_id: 'snake_a', name: '响尾蛇帮众甲', speaker_id: 'S1' }),
        createEmptyDramaCharacter({ character_id: 'tommy', name: '汤米', speaker_id: 'S2' }),
      ],
    }),
    shots,
  });
}

export function buildTommyTavernExampleShots(): { fear: DramaShot; chaos: DramaShot } {
  const fear = createEmptyDramaShot({
    shot_id: 'ex-fear',
    shot_no: '1',
    duration_sec: 10,
    purpose: '发现枪并惊恐说出真相',
    action: '帮众倒地试图爬起，看见汤米手里的枪，惊恐说话',
    expression: '惊恐',
    size: '中近景',
    angle: '正面',
    move: '固定',
    character_ids: ['snake_a', 'tommy'],
    dialogue: [
      createEmptyDramaDialogueLine({
        character_id: 'snake_a',
        character_name: '响尾蛇帮众甲',
        text: '那把枪……是托马斯的枪！',
      }),
    ],
    sfx: '尖叫声',
    cast: [
      { character_id: 'snake_a', screen_position: 'left', action: '倒地', emotion: '惊恐', performance: '', dialogue_ids: [], voice_id: '' },
      { character_id: 'tommy', screen_position: 'right', action: '持枪站立', emotion: '冷峻', performance: '', dialogue_ids: [], voice_id: '' },
    ],
  });
  const chaos = createEmptyDramaShot({
    shot_id: 'ex-chaos',
    shot_no: '2',
    duration_sec: 10,
    purpose: '酒馆陷入混乱，汤米冷峻扫视',
    action: '酒馆混乱，帮众四散逃开，桌椅被撞翻，汤米站在中央缓慢扫视',
    expression: '冷峻',
    size: '中远景',
    angle: '正面',
    move: '缓慢拉远',
    character_ids: ['snake_a', 'tommy'],
    dialogue: [],
    sfx: '桌椅翻倒声、慌乱脚步声',
    cast: [
      { character_id: 'snake_a', screen_position: 'left', action: '逃开', emotion: '惊恐', performance: '', dialogue_ids: [], voice_id: '' },
      { character_id: 'tommy', screen_position: 'right', action: '站立注视', emotion: '冷峻', performance: '', dialogue_ids: [], voice_id: '' },
    ],
  });
  return { fear, chaos };
}

export type DirectingBreakdownCheckResult = {
  ok: boolean;
  failures: string[];
  fearDisplay: string;
  chaosDisplay: string;
  fearPromptHasLipsyncWindow: boolean;
  chaosPromptForbidsSpeech: boolean;
  salonPrompt?: string;
  salonQaOk?: boolean;
  rainPrompt?: string;
  rainQaOk?: boolean;
};

export function runDirectingBreakdownSelfCheck(): DirectingBreakdownCheckResult {
  const { fear, chaos } = buildTommyTavernExampleShots();
  const session0 = miniSession([fear, chaos]);
  const fearOut = applyDramaDirectingBreakdownToShot(session0, fear, null, {
    force: true,
    llm: {
      answers: {
        story: '帮众发现枪并惊恐指认',
        purpose: '把枪的身份变成公开威胁',
        visualSubject: 'snake_a',
        emotion: '惊恐',
        emotionTrend: 'rise',
        keyInfo: '那把枪是托马斯的枪',
        seeFirst: '倒地挣扎',
        seeNext: '看见枪并说话',
        hasDialogue: true,
        needsLipsync: true,
        nextHandoff: '保持惊恐仰视，承接酒馆混乱',
      },
      beats: [
        { purpose: '动作', event: '倒地挣扎起身', action: '倒地后试图撑起身体', emotion: '惊恐', emotionIntensity: 6, characters: ['snake_a'], environmentSound: '身体摩擦地面' },
        { purpose: '发现', event: '看见枪', action: '看见汤米手中的枪，动作停顿', emotion: '惊恐', emotionIntensity: 8, characters: ['snake_a', 'tommy'] },
        { purpose: '反应', event: '惊恐抬头', action: '惊恐抬头仰视汤米', emotion: '惊恐', emotionIntensity: 8, characters: ['snake_a'] },
        {
          purpose: '对白',
          event: '指认枪',
          action: '仰视汤米说出真相',
          emotion: '惊恐',
          emotionIntensity: 9,
          characters: ['snake_a', 'tommy'],
          dialogue: '那把枪……是托马斯的枪！',
          dialogueCharacterId: 'snake_a',
          environmentSound: '尖叫声',
          continuityOut: '保持惊恐仰视',
        },
        { purpose: '反应', event: '说完后的惊恐', action: '收口，保持仰视', emotion: '惊恐', emotionIntensity: 8, characters: ['snake_a'] },
      ],
    },
  });
  const session1 = miniSession([fearOut, chaos]);
  const chaosOut = applyDramaDirectingBreakdownToShot(session1, chaos, fearOut, {
    force: true,
    llm: {
      answers: {
        story: '酒馆大乱，汤米冷峻扫视',
        purpose: '释放发现枪之后的混乱结果',
        visualSubject: 'tommy',
        emotion: '冷峻',
        emotionTrend: 'hold',
        keyInfo: '帮众逃散，汤米仍站在中央',
        seeFirst: '人群逃散',
        seeNext: '汤米注视',
        hasDialogue: false,
        needsLipsync: false,
        nextHandoff: '汤米站立注视',
      },
      beats: [
        {
          purpose: '结果',
          event: '酒馆混乱',
          action: '帮众四散逃开，桌椅被撞翻，汤米站在中央缓慢扫视',
          emotion: '冷峻',
          emotionIntensity: 6,
          characters: ['tommy', 'snake_a'],
          environmentSound: '桌椅翻倒声、慌乱脚步声',
          continuityIn: '承接惊恐仰视后的爆发',
          continuityOut: '汤米站立注视',
        },
      ],
    },
  });

  const failures: string[] = [];
  const fearDlg = fearOut.directing_breakdown?.beats.filter((b) => b.lipSync) || [];
  if (!fearDlg.length) failures.push('惊恐镜应有口型开节拍');
  if (fearDlg.some((b) => !b.dialogue)) failures.push('口型开节拍必须带对白');
  const fearSilent = fearOut.directing_breakdown?.beats.filter((b) => !b.lipSync) || [];
  if (!fearSilent.length) failures.push('对白前后应有口型关的反应拍');
  if (chaosOut.directing_breakdown?.beats.some((b) => b.lipSync)) failures.push('混乱镜不得口型开');
  if (chaosOut.directing_breakdown?.answers.needsLipsync) failures.push('混乱镜 needsLipsync 应为 false');

  const fearPrompt = compileDramaH3Prompt(session1, fearOut, 'h3-multi').final_prompt;
  const chaosPrompt = compileDramaH3Prompt(miniSession([fearOut, chaosOut]), chaosOut, 'h3-multi').final_prompt;
  const fearPromptHasLipsyncWindow = /口型开/.test(fearPrompt) && /那把枪/.test(fearPrompt);
  const chaosHasSilentLip = /口型关/.test(chaosPrompt) && /无对白/.test(chaosPrompt);
  const chaosPromptForbidsSpeech = chaosHasSilentLip && !/面对镜头唱歌/.test(chaosPrompt);
  if (!fearPromptHasLipsyncWindow) failures.push('惊恐镜最终 Prompt 应含对白/口型窗');
  if (!chaosHasSilentLip) failures.push('混乱镜最终 Prompt 应含口型关与无对白');
  if (/面对镜头唱歌/.test(chaosPrompt)) failures.push('混乱镜最终 Prompt 不得出现面对镜头唱歌');
  const chaosCam = chaosOut.directing_breakdown?.beats[0];
  if (chaosCam && !/全景|远景/.test(chaosCam.shotType || '')) failures.push('混乱镜应为全景/远景');
  if (chaosCam && !/拉远/.test(chaosCam.movement)) failures.push('混乱镜运镜应为拉远');
  const fearDlgBeat = fearOut.directing_breakdown?.beats.find((b) => b.lipSync);
  if (fearDlgBeat && fearSilent.length && fearDlgBeat.audioStart <= (fearSilent[0]?.audioStart || 0)) {
    failures.push('对白口型窗不应占满开头，前面应有反应拍');
  }

  const salon = runSalonTavernCompilerCheck();
  failures.push(...salon.failures);
  const rain = runRainOfficeCompilerCheck();
  failures.push(...rain.failures);

  return {
    ok: failures.length === 0,
    failures,
    fearDisplay: formatDramaDirectingBreakdownDisplay(fearOut.directing_breakdown!),
    chaosDisplay: formatDramaDirectingBreakdownDisplay(chaosOut.directing_breakdown!),
    fearPromptHasLipsyncWindow,
    chaosPromptForbidsSpeech,
    salonPrompt: salon.prompt,
    salonQaOk: salon.qaOk,
    rainPrompt: rain.prompt,
    rainQaOk: rain.qaOk,
  };
}

export function buildSalonTavernEstablishShot(): DramaShot {
  return createEmptyDramaShot({
    shot_id: 'salon-01',
    shot_no: '1',
    duration_sec: 10,
    purpose: '建立酒馆气氛，紧张开始浮现',
    action: '镜头缓慢推入酒馆，帮众甲低声交谈后起身',
    expression: '紧张感初现',
    character_ids: ['gang', 'gang_a', 'gunner'],
    dialogue: [],
    timeline_events: [
      createEmptyDramaTimelineEvent({
        start_sec: 0,
        end_sec: 2.7,
        character_ids: ['gang', 'gang_a', 'gunner'],
        visual_action: '镜头缓慢推入，展现酒馆烟雾缭绕的环境',
        character_state: '紧张感初现',
        environment_audio: ['低沉嘈杂声', '酒杯碰撞声'],
        lip_sync: false,
      }),
      createEmptyDramaTimelineEvent({
        start_sec: 2.7,
        end_sec: 5.4,
        character_ids: ['gang_a'],
        visual_action: '低声交谈，手握酒杯，镜头继续推入',
        character_state: '戒备',
        environment_audio: ['隐约低语声'],
        lip_sync: false,
      }),
      createEmptyDramaTimelineEvent({
        start_sec: 5.4,
        end_sec: 8.1,
        character_ids: ['gunner'],
        visual_action: '手按腰间枪套，目光警惕',
        character_state: '高度戒备',
        environment_audio: ['隐约低语声'],
        lip_sync: false,
      }),
      createEmptyDramaTimelineEvent({
        start_sec: 8.1,
        end_sec: 10,
        character_ids: ['gang_a'],
        visual_action: '起身，目光敌意',
        character_state: '敌意升高',
        environment_audio: ['酒杯碰撞声'],
        lip_sync: false,
      }),
    ],
  });
}

export function runSalonTavernCompilerCheck(): {
  failures: string[];
  prompt: string;
  qaOk: boolean;
  qaIssues: string[];
  beats: Array<{
    purpose?: string;
    camera?: string;
    performance?: string;
    gazeTarget?: string;
    endState?: string;
    lipSync: boolean;
    start: number;
    end: number;
  }>;
} {
  const failures: string[] = [];
  const shot0 = buildSalonTavernEstablishShot();
  const session = createEmptyDramaSession({
    bible: createEmptyDramaBible({
      characters: [
        createEmptyDramaCharacter({ character_id: 'gang', name: '响尾蛇帮众', speaker_id: 'S4' }),
        createEmptyDramaCharacter({ character_id: 'gang_a', name: '响尾蛇帮众甲', speaker_id: 'S8' }),
        createEmptyDramaCharacter({ character_id: 'gunner', name: '巴洛矿场枪手', speaker_id: 'S5' }),
      ],
    }),
    shots: [shot0],
  });
  const shot = applyDramaDirectingBreakdownToShot(session, shot0, null, { force: true });
  const compiled = compileDramaH3Prompt({ ...session, shots: [shot] }, shot, 'h3-multi');
  const prompt = compiled.final_prompt;
  const beats = shot.directing_breakdown?.beats || [];
  const sigs = beats.map((b) => (b.lockedCamera ? cameraSignature(b.lockedCamera) : ''));
  if (beats.some((b) => /交谈|说话/.test(b.action) || /交谈|说话/.test(b.visiblePerformance || ''))) {
    failures.push('QA：无对白节拍仍含说话动作');
  }
  if (beats.some((b) => /或/.test(b.movement || '') || /或/.test(b.camera || ''))) {
    failures.push('QA：镜头参数含「或」');
  }
  if (beats.some((b) => /\d+\s*[–-]\s*\d+/.test(b.lens || ''))) {
    failures.push('QA：焦段仍是范围');
  }
  if (sigs.length >= 3 && sigs[1] === sigs[2] && sigs[2] === sigs[3]) {
    failures.push('QA：连续三镜签名相同');
  }
  if (/低声交谈/.test(prompt)) failures.push('最终 Prompt 仍含低声交谈');
  if (/固定或轻微移动/.test(prompt)) failures.push('最终 Prompt 仍含固定或轻微移动');
  if (/\d+\s*[–-]\s*\d+\s*mm/.test(prompt)) failures.push('最终 Prompt 仍含范围焦段');
  if (/紧张感初现|高度戒备|敌意升高/.test(prompt)) failures.push('最终 Prompt 仍含情绪标签');
  if (/镜头继续推入|镜头向前|移动镜头/.test(prompt)) failures.push('最终 Prompt 含与 cameraMovement 冲突的运镜句');
  const shot2 = prompt.match(/\[镜头2\][\s\S]*?(?=\n\[镜头3\]|$)/)?.[0] || '';
  if (/｜固定｜/.test(shot2) && /推入|推近|拉远/.test(shot2.replace(/[^。\n]*｜[^。\n]*mm｜[^。\n]*/, ''))) {
    failures.push('镜头2 固定机位后仍有推拉运动描述');
  }
  if (beats[1] && !beats[1].gazeTarget) failures.push('镜头2 缺少 gazeTarget');
  if (beats[2] && !beats[2].gazeTarget) failures.push('镜头3 缺少 gazeTarget');
  if (beats[3] && !beats[3].endState?.pose) failures.push('镜头4 缺少 EndState');
  if (!/目光(?:锁定|转向)<主体\d+>/.test(prompt)) failures.push('最终 Prompt 未把视线编译为主体编号');
  if (!compiled.qa?.ok) {
    failures.push(`Compiler QA 失败：${(compiled.qa?.issues || []).map((i) => i.code).join(',')}`);
  }
  return {
    failures,
    prompt,
    qaOk: !!compiled.qa?.ok,
    qaIssues: (compiled.qa?.issues || []).map((i) => `${i.severity}:${i.code}:${i.message}`),
    beats: beats.map((b) => ({
      purpose: b.primaryPurpose,
      camera: b.camera,
      performance: b.visiblePerformance,
      gazeTarget: b.gazeTarget,
      endState: b.continuityOut,
      lipSync: b.lipSync,
      start: b.audioStart,
      end: b.audioEnd,
    })),
  };
}

export function buildRainOfficeEstablishShot(): DramaShot {
  return createEmptyDramaShot({
    shot_id: 'rain-office-01',
    shot_no: '1',
    duration_sec: 10,
    purpose: '雨夜骑行至写字楼下停车抬头',
    action: '周一川骑电动车穿过车流，车灯映在积水中',
    expression: '疲惫克制',
    character_ids: ['zhou'],
    dialogue: [],
    timeline_events: [
      createEmptyDramaTimelineEvent({
        start_sec: 0,
        end_sec: 3.3,
        character_ids: ['zhou'],
        visual_action: '骑电动车穿过车流，车灯映在积水中 周一川骑电动车穿过车流，车灯映在积水中',
        character_state: '疲惫',
        environment_audio: ['雨声', '车流声'],
        lip_sync: false,
      }),
      createEmptyDramaTimelineEvent({
        start_sec: 3.3,
        end_sec: 6.6,
        character_ids: ['zhou'],
        visual_action: '电动车减速，靠近写字楼门口',
        character_state: '克制',
        environment_audio: ['雨声'],
        lip_sync: false,
      }),
      createEmptyDramaTimelineEvent({
        start_sec: 6.6,
        end_sec: 10,
        character_ids: ['zhou'],
        visual_action: '停下电动车，摘下头盔，抬头看向写字楼',
        character_state: '停住',
        environment_audio: ['雨声', '远处车流'],
        lip_sync: false,
      }),
    ],
  });
}

export function runRainOfficeCompilerCheck(): {
  failures: string[];
  prompt: string;
  qaOk: boolean;
  beats: Array<{
    purpose?: string;
    camera?: string;
    performance?: string;
    gazeTarget?: string;
    endState?: string;
    pose?: string;
    helmetState?: string;
    vehicleState?: string;
  }>;
} {
  const failures: string[] = [];
  const shot0 = buildRainOfficeEstablishShot();
  const session = createEmptyDramaSession({
    bible: createEmptyDramaBible({
      characters: [
        createEmptyDramaCharacter({ character_id: 'zhou', name: '周一川', speaker_id: 'S1' }),
      ],
    }),
    shots: [shot0],
  });
  const shot = applyDramaDirectingBreakdownToShot(session, shot0, null, { force: true });
  const compiled = compileDramaH3Prompt({ ...session, shots: [shot] }, shot, 'h3-multi');
  const prompt = compiled.final_prompt;
  const beats = shot.directing_breakdown?.beats || [];
  const last = beats[beats.length - 1];
  const shot3 = prompt.match(/\[镜头3\][\s\S]*?(?=\n\[镜头\d+\]|\n本镜无对白|\n【|$)/)?.[0] || '';
  if (/坐姿/.test(shot3) || last?.endState?.pose === 'seated') {
    failures.push('镜头3 EndState 不得为坐姿');
  }
  if (last?.endState?.pose !== 'standing') failures.push('镜头3 pose 应为 standing');
  if (last?.endState?.helmetState !== 'removed') failures.push('镜头3 helmetState 应为 removed');
  if (last?.gazeTarget !== 'building_entrance') failures.push('镜头3 gazeTarget 应为 building_entrance');
  if (!/站立/.test(last?.continuityOut || '')) failures.push('镜头3 EndState 文案应含站立');
  if (!/头盔已摘下/.test(last?.continuityOut || '')) failures.push('镜头3 EndState 文案应含头盔已摘下');
  if (!/面向写字楼/.test(last?.continuityOut || '')) failures.push('镜头3 EndState 文案应含面向写字楼');
  if (!/视线锁定写字楼入口/.test(last?.continuityOut || '')) {
    failures.push('镜头3 EndState 文案应含视线锁定写字楼入口');
  }
  if (/周一川骑电动车穿过车流，车灯映在积水中.*周一川骑电动车穿过车流/.test(prompt)) {
    failures.push('最终 Prompt 重复输出同一骑行动作');
  }
  const shot1 = prompt.match(/\[镜头1\][^\n]+/)?.[0] || '';
  const rideCount = (shot1.match(/穿过车流/g) || []).length;
  if (rideCount > 1) failures.push('镜头1 穿过车流出现超过一次');
  if (!compiled.qa?.ok) {
    failures.push(`Compiler QA 失败：${(compiled.qa?.issues || []).map((i) => i.code).join(',')}`);
  }
  return {
    failures,
    prompt,
    qaOk: !!compiled.qa?.ok,
    beats: beats.map((b) => ({
      purpose: b.primaryPurpose,
      camera: b.camera,
      performance: b.visibleAction || b.visiblePerformance,
      gazeTarget: b.gazeTarget,
      endState: b.continuityOut,
      pose: b.endState?.pose,
      helmetState: b.endState?.helmetState,
      vehicleState: b.endState?.vehicleState,
    })),
  };
}
