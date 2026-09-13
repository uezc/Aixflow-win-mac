/**
 * P1-A1 真实 LLM 灰度验收（不 Stub）。
 * 走与导演台相同的：程序分析 → FC LLM analyze → normalize/merge → Timeline → 英文 Compiler。
 * 运行：npx tsx src/shared/directorDomain/p1RealLlmAnalyze.acceptance.ts
 *
 * 不改数据讨好测试。质量不好则记录 FAIL 与断点。
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import dotenv from 'dotenv';
import { stripChineseOutsideH3DialogueTags } from '../directorPipeline/composeFinalPrompt.js';
import { extractJsonObject } from '../directorPipeline/normalize.js';
import {
  composeDramaShotH3EnglishPrompt,
  resolveDramaProductionH3Prompt,
} from './composeDramaShotLensPrompt.js';
import { createEmptyDramaEpisodeBible } from './episodeBible.js';
import {
  createEmptyDramaCharacter,
  createEmptyDramaSceneAsset,
  createEmptyDramaSession,
  createEmptyDramaVoice,
} from './factories.js';
import { applyLlmAnalyzeOntoProgramSession } from './mergeDramaVisualEvents.js';
import { normalizeDramaDomainAnalyzeResult } from './normalizeAnalyze.js';
import { analyzeDramaEpisodeOriginal } from './originalScript.js';
import {
  buildDramaDomainAnalyzeCompactMessages,
  buildDramaDomainAnalyzeMessages,
} from './prompts/analyze.js';
import { convertShotSuggestionsToDramaShots } from './session.js';
import { SKIP_LLM_ANALYZE_DEFAULT } from './skipLlmAnalyze.js';
import type { DramaVisualEvent } from './shotPlanning.js';
import { ensureDramaShotTimelineEvents } from './timelineEvent.js';
import type {
  DramaDirectorSession,
  DramaOriginalSegment,
  DramaTimelineEvent,
} from './types.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const INVENTED_CAM = /\b(close-up|push-in|dolly|tracking|OTS|two-shot)\b/i;
const MODEL = 'gpt-4o';

type Verdict = 'PASS' | 'FAIL';

function char(id: string, name: string, voiceId?: string) {
  return createEmptyDramaCharacter({
    character_id: id,
    name,
    voice_id: voiceId || '',
    imageUrl: `https://example.com/${id}.png`,
  });
}

function scene(id: string, name: string) {
  return createEmptyDramaSceneAsset({
    scene_id: id,
    name,
    location: name,
    imageUrl: `https://example.com/${id}.png`,
  });
}

function voice(id: string, characterId: string, label: string) {
  return createEmptyDramaVoice({
    voice_id: id,
    character_id: characterId,
    timbre: label,
    voiceStyle: label,
    sample_text: label,
  });
}

function dTags(text: string): string[] {
  return [...String(text || '').matchAll(/<d>\s*\[Chinese[^\]]*\]\s*([\s\S]*?)<\/d>/gi)].map((m) =>
    String(m[1] || '').trim(),
  );
}

function spokenCanon(s: string): string {
  return String(s || '')
    .replace(/[「」""]/g, '')
    .replace(/^[（(][^）)]{1,24}[）)]\s*/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function fcBaseUrl(): string {
  // 与当前 Electron 默认线路一致：store 默认 beijing。
  const raw =
    process.env.BEIJING_FC_ENDPOINT?.trim() ||
    process.env.ALIYUN_FC_FALLBACK_URL?.trim() ||
    process.env.HK_FC_ENDPOINT?.trim() ||
    process.env.ALIYUN_FC_INIT_USER_URL?.trim() ||
    '';
  const base = raw.replace(/\/init-user\/?$/, '').replace(/\/$/, '');
  if (!base) return '';
  return base.endsWith('/run-task') ? base : `${base}/run-task`;
}

function loadNxAccessToken(): string {
  const p = path.join(process.env.APPDATA || '', 'NEXFLOW', 'nexflow-config.json');
  if (!existsSync(p)) return '';
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as {
      cloudUser?: { nxAccessToken?: string | null };
    };
    return String(j.cloudUser?.nxAccessToken || '').trim();
  } catch {
    return '';
  }
}

async function callFcChat(messages: Array<{ role: string; content: string }>, jsonMode: boolean): Promise<string> {
  const url = fcBaseUrl();
  const token = String(process.env.ALIYUN_FC_TOKEN || '').trim();
  if (!url) throw new Error('未配置 HK_FC_ENDPOINT / ALIYUN_FC_INIT_USER_URL');
  if (!token) throw new Error('未配置 ALIYUN_FC_TOKEN');
  const access = loadNxAccessToken();
  const body = {
    model: MODEL,
    messages,
    stream: false,
    temperature: 0.35,
    max_tokens: 8192,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'x-nexflow-token': token,
  };
  if (access) headers.Authorization = `Bearer ${access}`;
  const payload = {
    taskId: randomUUID(),
    type: 'llm',
    billing: 'charge',
    body,
  };
  try {
    const { data } = await axios.post(url, payload, { headers, timeout: 180_000, proxy: false });
    const root = data?.data && (data.data.choices || data.data.message) ? data.data : data;
    const choice = root?.choices?.[0];
    const message = choice?.message ?? root?.message ?? null;
    let content = '';
    if (typeof message?.content === 'string') content = message.content;
    else if (Array.isArray(message?.content)) {
      content = message.content.map((p: { text?: string }) => String(p?.text || '')).join('\n');
    }
    if (!content) content = String(root?.text || root?.output || root?.result || '').trim();
    if (!content) {
      throw new Error(`FC LLM 空响应 finish=${choice?.finish_reason || root?.finish_reason || '?'}`);
    }
    return content;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const data = err.response?.data;
      const detail =
        data && typeof data === 'object'
          ? String((data as { message?: string; error?: string }).message || (data as { error?: string }).error || '').slice(0, 200)
          : '';
      throw new Error(`FC LLM HTTP ${status || err.code || 'ERR'}: ${detail || err.message}`);
    }
    throw err;
  }
}

async function runAnalyzeChat(sys: string, user: string): Promise<string> {
  try {
    return await callFcChat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      true,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/response_format|json_object|unsupported|不支持/i.test(msg)) {
      return await callFcChat(
        [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        false,
      );
    }
    throw err;
  }
}

const LIVE = `## 1. 内景 电竞直播间 - 夜

RGB灯条在昏暗房间里闪烁。江澈靠在电竞椅上，左手键盘右手鼠标。

他打了个哈欠，拿起一罐汽水灌了一大口，气泡声嗞——。

江澈
（慵懒）
家人们，这把打完就下播了啊。明天冲峡谷之巅第一，目前差三百分。

【弹幕浮字：澈神今天又杀疯了！／全能王名不虚传！／给别人留点活路吧！】

江澈
（打个汽水嗝）
播啊，怎么不播。

窗外雷声由远及近。一道白光闪过，屏幕炸开蓝光。

第二道雷直接劈进电脑屏幕，蓝光炸裂。江澈浑身一麻，眼睛瞪大。

江澈
我操——

画面切黑。
`;

const PEAK = `## 1. 外景 云霄峰山门外 - 晨

江澈走向云霄峰。

江澈走两步回头。

江澈
对了老爷子，这地方哪里能充电？

赵铁柱
小子你谁啊。

苏挽月
江澈，你来了。
`;

const GATE = `## 1. 内景 入门测试台 - 日

江澈站在台前。

苏挽月
准备好了吗？

赵铁柱
开始。

江澈
来了。
`;

const ACTION_ONLY = `## 1. 内景 房间 - 夜

江澈拿起汽水，望向远处。
`;

const GAZE = `## 1. 内景 灵根殿 - 日

青衫少年看向江澈。

少年：
“你为什么不说话？”

江澈没有回答，转头看向执事长老。

执事长老：
“开始吧。”
`;

type ScriptCase = {
  label: string;
  source: string;
  extraChars: ReturnType<typeof char>[];
};

const CASES: ScriptCase[] = [
  { label: 'A纯动作', source: ACTION_ONLY, extraChars: [] },
  { label: '电竞直播间', source: LIVE, extraChars: [] },
  {
    label: 'C谁看谁',
    source: GAZE,
    extraChars: [],
  },
  {
    label: '云霄峰',
    source: PEAK,
    extraChars: [char('c-zhao', '赵铁柱', 'v-zhao'), char('c-su', '苏挽月', 'v-su')],
  },
  {
    label: '入门测试台',
    source: GATE,
    extraChars: [char('c-zhao', '赵铁柱', 'v-zhao'), char('c-su', '苏挽月', 'v-su')],
  },
];

function llmVisualEventsFromRaw(raw: string): DramaVisualEvent[] {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const list = (parsed as { visual_events?: unknown }).visual_events;
  return Array.isArray(list) ? (list as DramaVisualEvent[]) : [];
}

function inventedSegmentIds(llmVes: DramaVisualEvent[], allowed: Set<string>): string[] {
  const bad: string[] = [];
  for (const ve of llmVes) {
    const ids = Array.isArray(ve.source_segment_ids) ? ve.source_segment_ids : [];
    for (const id of ids) {
      const s = String(id || '').trim();
      if (!s) continue;
      const compact = s.replace(/[-_\s]/g, '').toUpperCase();
      const ok = [...allowed].some((a) => a.replace(/[-_\s]/g, '').toUpperCase() === compact);
      if (!ok) bad.push(s);
    }
  }
  return [...new Set(bad)];
}

type ScriptReport = {
  label: string;
  llm: Verdict;
  originalSegment: Verdict;
  veMerge: Verdict;
  shotSuggestions: Verdict;
  timeline: Verdict;
  eyeline: Verdict;
  position: Verdict;
  emotion: Verdict;
  dialogue: Verdict;
  environment: Verdict;
  camera: Verdict;
  compiler: Verdict;
  h3: Verdict;
  notes: string[];
  counts: Record<string, number>;
  timelineSamples: DramaTimelineEvent[];
  dialogueChecks: Array<{ original: string; timeline: string; dtag: string; ok: boolean }>;
  breakpoint: string;
};

async function runOne(c: ScriptCase): Promise<ScriptReport> {
  const notes: string[] = [];
  const fail = (bp: string): ScriptReport => ({
    label: c.label,
    llm: 'FAIL',
    originalSegment: 'FAIL',
    veMerge: 'FAIL',
    shotSuggestions: 'FAIL',
    timeline: 'FAIL',
    eyeline: 'FAIL',
    position: 'FAIL',
    emotion: 'FAIL',
    dialogue: 'FAIL',
    environment: 'FAIL',
    camera: 'FAIL',
    compiler: 'FAIL',
    h3: 'FAIL',
    notes,
    counts: {},
    timelineSamples: [],
    dialogueChecks: [],
    breakpoint: bp,
  });

  const characters = [
    char('c-jiang', '江澈', 'v-jiang'),
    char('boy', '少年', 'v-boy'),
    char('c-elder', '执事长老', 'v-elder'),
    ...c.extraChars,
  ];
  const scenes = [
    scene('sc-room', '电竞直播间'),
    scene('sc-peak', '云霄峰山门外'),
    scene('sc-gate', '入门测试台'),
  ];
  const voices = [
    voice('v-jiang', 'c-jiang', '男声'),
    voice('v-boy', 'boy', '少年'),
    voice('v-elder', 'c-elder', '长老'),
    ...c.extraChars.map((ch) => voice(ch.voice_id || `v-${ch.character_id}`, ch.character_id, ch.name)),
  ];
  const epId = `ep-${c.label}`;
  const analysis = analyzeDramaEpisodeOriginal({
    source: c.source,
    episodeId: epId,
    characters,
    scenes,
    voices,
  });
  const segsBefore = (analysis.original_segments || []).map((s) => s.segment_id);
  if (!segsBefore.length) {
    notes.push('程序分析 original_segments=0');
    return fail('A OriginalSegment 分析前为空');
  }
  const programSession = createEmptyDramaSession({
    active_episode_id: epId,
    bible: { characters, scenes, voices },
    episode_bibles: {
      [epId]: createEmptyDramaEpisodeBible({
        episode_id: epId,
        original_scenes: analysis.original_scenes,
        original_segments: analysis.original_segments,
        visual_events: analysis.visual_events,
        shot_suggestions: analysis.shot_suggestions,
        official_scene_beats: analysis.scene_beats,
      }),
    },
  });
  const originalSegments = analysis.original_segments || [];
  const msgs = buildDramaDomainAnalyzeMessages({
    sourceText: c.source,
    title: `短剧 · ${c.label}`,
    styleHint: '电影感写实',
    existingCharacterNames: characters.map((x) => x.name),
    existingSceneNames: scenes.map((x) => x.name),
    originalSegments,
  });
  let raw = '';
  try {
    raw = await runAnalyzeChat(msgs.systemPrompt, msgs.userPrompt);
    let normalized = normalizeDramaDomainAnalyzeResult(raw, programSession);
    if (!normalized.ok) {
      const compact = buildDramaDomainAnalyzeCompactMessages({
        sourceText: c.source,
        title: `短剧 · ${c.label}`,
        styleHint: '电影感写实',
        originalSegments,
      });
      raw = await runAnalyzeChat(compact.systemPrompt, compact.userPrompt);
      normalized = normalizeDramaDomainAnalyzeResult(raw, programSession);
    }
    if (!normalized.ok) {
      notes.push(normalized.error);
      return fail(`LLM normalize 失败：${normalized.error}`);
    }
    const mergedSession = applyLlmAnalyzeOntoProgramSession(programSession, normalized.session);
    const bible = mergedSession.episode_bibles?.[epId];
    const segsAfter = (bible?.original_segments || []).map((s: DramaOriginalSegment) => s.segment_id);
    const llmVes = llmVisualEventsFromRaw(raw);
    const mergedVes = bible?.visual_events || [];
    const converted = convertShotSuggestionsToDramaShots(mergedSession, bible?.shot_suggestions);
    const withShots: DramaDirectorSession = {
      ...mergedSession,
      shots: converted.shots,
      scene_beats: converted.scene_beats,
    };
    const shots = converted.shots.map((s) => ensureDramaShotTimelineEvents(s, withShots));
    const session: DramaDirectorSession = { ...withShots, shots };
    const tes = shots.flatMap((s) => s.timeline_events || []);
    const enPrompts = shots.map((s) => composeDramaShotH3EnglishPrompt(session, s));
    const prodPrompts = shots.map((s) => resolveDramaProductionH3Prompt(session, s));
    const stripped = enPrompts.map((p) => stripChineseOutsideH3DialogueTags(p));
    const allEn = enPrompts.join('\n');
    const allD = stripped.flatMap(dTags);

    const allowed = new Set(segsBefore);
    const fakeIds = inventedSegmentIds(llmVes, allowed);
    const sameSegs =
      segsBefore.length === segsAfter.length && segsBefore.every((id, i) => id === segsAfter[i]);

    const dlgSegs = originalSegments.filter((s) => s.type === 'dialogue' || s.type === 'system');
    const dialogueChecks = dlgSegs.slice(0, 5).map((seg) => {
      const original = String(seg.original_text || '').trim();
      const hit = tes.find((e) => spokenCanon(e.dialogue) && spokenCanon(original).includes(spokenCanon(e.dialogue)))
        || tes.find((e) => spokenCanon(e.dialogue) === spokenCanon(original));
      const timeline = hit?.dialogue || '';
      const dtag = allD.find((t) => spokenCanon(t) === spokenCanon(timeline)) || '';
      const ok =
        !!spokenCanon(original) &&
        spokenCanon(timeline) === spokenCanon(original) &&
        spokenCanon(dtag) === spokenCanon(original);
      return { original, timeline, dtag, ok };
    });

    const envEvents = tes.filter((e) => (e.environment_audio || []).length);
    const envInD = allD.some((t) => /雷声|脚步|门响|底噪|气泡/.test(t));
    const hasThunder = tes.some((e) => (e.environment_audio || []).some((x) => /雷声/.test(x)));
    const camNonEmpty = tes.filter((e) => String(e.camera_action || '').trim());
    const camInvented = INVENTED_CAM.test(allEn) && camNonEmpty.length === 0;
    const prodIsCompiler = shots.every((_, i) => prodPrompts[i] === enPrompts[i]);
    const eyelineNonEmpty = tes.filter((e) => String(e.eyeline || '').trim());
    const posNonEmpty = tes.filter((e) => String(e.position || '').trim());
    const stateNonEmpty = tes.filter((e) => String(e.character_state || '').trim());
    const defaultEye = tes.some((e) => /^(camera|viewer|lens)$/i.test(String(e.eyeline || '')));
    const lookJiang = tes.filter((e) => /江澈/.test(`${e.visual_action} ${e.eyeline}`) || e.eyeline === 'c-jiang');
    const lookElder = tes.filter((e) => e.eyeline === 'c-elder' || /执事长老/.test(e.eyeline));

    if (fakeIds.length) notes.push(`虚构 source_segment_ids: ${fakeIds.join(',')}`);
    if (!sameSegs) notes.push('segment_id 在 LLM 后发生变化');
    if (!(bible?.shot_suggestions || []).length) notes.push('shot_suggestions 被清空');
    if (!tes.length) notes.push('Timeline 为空');
    if (camInvented) notes.push('Compiler 出现 analyze 未写入的运镜词');
    if (envInD) notes.push('环境声进入 <d>');
    if (defaultEye) notes.push('eyeline 默认 camera/viewer');
    if (!lookJiang.length && /看向江澈|望向/.test(c.source)) notes.push('谁看谁未绑定到 c-jiang');
    if (!stateNonEmpty.length) notes.push('character_state 全空（LLM 可能未给 emotion）');
    if (!posNonEmpty.length) notes.push('position 全空（允许：无法可靠推断）');
    if (tes.some((e) => /脑海中|意识中|意识空间/.test(String(e.eyeline || '')))) {
      notes.push('eyeline 出现脑海中/意识中');
    }
    if (tes.some((e) => /背影镜头|特写镜头|正面镜头/.test(e.visual_action))) {
      notes.push('visual_action 混入机位脏词');
    }
    if (allD.some((t) => /^系统[:：]/.test(t) || /^系统\s/.test(t))) {
      notes.push('系统标签进入 <d>');
    }

    const originalSegment: Verdict = segsBefore.length && segsAfter.length && sameSegs ? 'PASS' : 'FAIL';
    const veMerge: Verdict = mergedVes.length > 0 && !fakeIds.length ? 'PASS' : 'FAIL';
    const shotSuggestions: Verdict = (bible?.shot_suggestions || []).length > 0 && shots.length > 0 ? 'PASS' : 'FAIL';
    const timeline: Verdict = tes.length > 0 ? 'PASS' : 'FAIL';
    const dialogue: Verdict =
      dlgSegs.length === 0
        ? 'PASS'
        : dialogueChecks.length && dialogueChecks.every((x) => x.ok)
          ? 'PASS'
          : 'FAIL';
    const environment: Verdict = envInD ? 'FAIL' : c.label === '电竞直播间' ? (hasThunder ? 'PASS' : 'FAIL') : 'PASS';
    const camera: Verdict = camNonEmpty.length === 0 && !camInvented ? 'PASS' : 'FAIL';
    const compiler: Verdict = /two-shot push-pull|choke dolly|medium shot/.test(allEn) ? 'FAIL' : 'PASS';
    const h3: Verdict = prodIsCompiler ? 'PASS' : 'FAIL';
    const eyeline: Verdict = defaultEye ? 'FAIL' : eyelineNonEmpty.length ? 'PASS' : 'FAIL';
    const position: Verdict = 'PASS';
    const emotion: Verdict = stateNonEmpty.length ? 'PASS' : 'FAIL';

    return {
      label: c.label,
      llm: 'PASS',
      originalSegment,
      veMerge,
      shotSuggestions,
      timeline,
      eyeline,
      position,
      emotion,
      dialogue,
      environment,
      camera,
      compiler,
      h3,
      notes,
      counts: {
        original_segments: segsAfter.length,
        program_ve: analysis.visual_events.length,
        llm_ve: llmVes.length,
        merged_ve: mergedVes.length,
        shots: shots.length,
        timeline_events: tes.length,
        dialogue: tes.filter((e) => e.dialogue).length,
        environment_audio: envEvents.length,
        eyeline: eyelineNonEmpty.length,
        position: posNonEmpty.length,
        character_state: stateNonEmpty.length,
        camera_action: camNonEmpty.length,
      },
      timelineSamples: tes.slice(0, 3),
      dialogueChecks,
      breakpoint:
        originalSegment === 'FAIL'
          ? 'OriginalSegment 丢失或 ID 变化'
          : veMerge === 'FAIL'
            ? 'VE merge / 虚构 segment ID'
            : shotSuggestions === 'FAIL'
              ? 'shot_suggestions 被清空'
              : timeline === 'FAIL'
                ? 'Timeline 为空'
                : dialogue === 'FAIL'
                  ? '对白未逐字'
                  : camera === 'FAIL'
                    ? 'camera_action 被 LLM/Compiler 污染'
                    : h3 === 'FAIL'
                      ? '生产 Prompt 不是英文 Compiler'
                      : '',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(msg);
    return fail(`LLM 调用失败：${msg.slice(0, 240)}`);
  }
}

function line(label: string, r: ScriptReport): string {
  return [
    label,
    `LLM：${r.llm}`,
    `OriginalSegment：${r.originalSegment}`,
    `VE Merge：${r.veMerge}`,
    `ShotSuggestions：${r.shotSuggestions}`,
    `Timeline：${r.timeline}`,
    `Eyeline：${r.eyeline}`,
    `Position：${r.position}`,
    `Emotion/State：${r.emotion}`,
    `Dialogue：${r.dialogue}`,
    `Environment Audio：${r.environment}`,
    `Camera：${r.camera}`,
    `Compiler：${r.compiler}`,
    `H3 Prompt：${r.h3}`,
  ].join('\n');
}

async function main() {
  console.log(`SKIP_LLM_ANALYZE_DEFAULT=${SKIP_LLM_ANALYZE_DEFAULT} (灰度临时 false)`);
  console.log(`FC configured=${Boolean(fcBaseUrl() && process.env.ALIYUN_FC_TOKEN)}`);
  console.log(`JWT present=${Boolean(loadNxAccessToken())}`);
  const reports: ScriptReport[] = [];
  const only = process.argv.slice(2).filter((x) => !x.startsWith('-'));
  const selected = only.length ? CASES.filter((c) => only.includes(c.label)) : CASES;
  if (only.length && !selected.length) {
    throw new Error(`未知场次：${only.join(', ')}`);
  }
  for (const c of selected) {
    console.log(`\n===== 开始真实 LLM：${c.label} =====`);
    const r = await runOne(c);
    reports.push(r);
    console.log(JSON.stringify({ label: r.label, counts: r.counts, notes: r.notes, breakpoint: r.breakpoint }, null, 2));
    console.log('--- timeline samples ---');
    console.log(JSON.stringify(r.timelineSamples, null, 2));
    console.log('--- dialogue checks ---');
    console.log(JSON.stringify(r.dialogueChecks, null, 2));
  }

  const hardYes = (key: keyof ScriptReport) => reports.every((r) => r[key] === 'PASS');
  const realLlm = reports.every((r) => r.llm === 'PASS') && hardYes('originalSegment') && hardYes('shotSuggestions') && hardYes('timeline') && hardYes('camera') && hardYes('h3');

  console.log('\n==============================');
  console.log('P1-A1 REAL LLM ACCEPTANCE');
  console.log('==============================\n');
  for (const r of reports) {
    console.log(line(r.label, r));
    if (r.notes.length) console.log(`notes: ${r.notes.join(' | ')}`);
    if (r.breakpoint) console.log(`breakpoint: ${r.breakpoint}`);
    console.log('');
  }
  console.log('==============================');
  console.log('GLOBAL');
  console.log('==============================');
  console.log('P0 Regression：PENDING_IN_PARENT');
  console.log('P1 Protection：PENDING_IN_PARENT');
  console.log('P1 Director Timeline Stub：PENDING_IN_PARENT');
  console.log(`P1 Real LLM：${realLlm ? 'PASS' : 'FAIL'}`);
  console.log(`OriginalSegment 保留：${hardYes('originalSegment') ? 'YES' : 'NO'}`);
  console.log(`shot_suggestions 保留：${hardYes('shotSuggestions') ? 'YES' : 'NO'}`);
  console.log(`Timeline 非空：${hardYes('timeline') ? 'YES' : 'NO'}`);
  console.log(`对白逐字一致：${hardYes('dialogue') ? 'YES' : 'NO'}`);
  console.log(`环境声不进 <d>：${hardYes('environment') ? 'YES' : 'NO'}`);
  console.log(`LLM 是否生成非法 Camera：${reports.some((r) => r.camera === 'FAIL') ? 'YES' : 'NO'}`);
  console.log(`Compiler 是否二次导演：${reports.some((r) => r.compiler === 'FAIL') ? 'YES' : 'NO'}`);
  console.log(`Skill 是否绕过 Compiler：${reports.some((r) => r.h3 === 'FAIL') ? 'YES' : 'NO'}`);
  console.log('SKIP_LLM_ANALYZE：');
  console.log('TEMPORARILY FALSE FOR TEST ONLY');
  console.log('是否建议正式关闭 SKIP：');
  console.log(realLlm && hardYes('dialogue') && hardYes('eyeline') ? 'YES' : 'NO');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
