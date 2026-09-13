/**
 * MiniMax H3 全能参考（Ref2VA）中文官方六段式提示词。
 * 字段顺序对齐官方英文指南：subject_definitions → summary → retention_analysis →
 * detailed_description → overall_soundscape → non_diegetic_music。
 * 时轴用 MM:SS.mmm（如 00:00.000至00:01.700）；对口型可写 <d>[中文]…</d>。
 * 参考图标签用 <图片N> / <图N> / <主体N>，与提交顺序 1:1。
 */

import type { DirectorAssetKind, DirectorShot } from './schema.js';
import { parseDirectorShotDurationSec } from './schema.js';
import {
  directorAssetKindLabel,
  inferDirectorAssetGender,
  DIRECTOR_PIC1_COLOR_FRONT,
  DIRECTOR_PIC1_VISUAL_ANCHOR,
  DIRECTOR_PIC1_LOOK_NEGATIVE_LINE,
} from './bindAssetRefs.js';
import { getDirectorMvShotChangePacePreset } from './cinematicCameraLanguage.js';
import { formatDirectorStyleFromRefImageHint } from './stylePresets.js';
import {
  DIRECTOR_EMPTY_SHOT_FRONT_BANNER,
  DIRECTOR_EMPTY_SHOT_NEGATIVE_LINE,
} from './lyricTimeline.js';

function isH3ZhSixSectionPrompt(text: string): boolean {
  const t = String(text || '');
  return (
    /主体定义\s*[：:]/.test(t) &&
    /详细描述\s*[：:]/.test(t) &&
    /整体声景\s*[：:]/.test(t)
  );
}

function stripH3DialogueTags(text: string): string {
  return String(text || '')
    .replace(/<d>\s*\[[^\]]*\][\s\S]*?<\/d>/gi, '')
    .replace(/<d>[\s\S]*?<\/d>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripLabeledDialogueLines(text: string): string {
  return String(text || '')
    .replace(/(?:^|[。；;\n])\s*对白\s*[/／]?\s*旁白\s*[：:]\s*[^。；;\n]*/gi, '')
    .replace(/(?:^|[。；;\n])\s*对白旁白\s*[：:]\s*[^。；;\n]*/gi, '')
    .replace(/[。]{2,}/g, '。')
    .trim();
}

function extractSubjectMotion(desc: string): string {
  let t = String(desc || '').trim();
  if (!t) return '';
  t = t
    .replace(/（\s*场景\s*[：:][^）]*）/g, '')
    .replace(/\(\s*场景\s*[：:][^)]*\)/gi, '')
    .replace(/(?:^|[。；;\n，,])\s*场景\s*[：:]\s*[^。；;\n，,]*/gi, '')
    .replace(/空镜\s*[/／]\s*无人物[。．.\s]*/gi, '')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。；;，,\s]+|[。；;，,\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}

export type MinimaxH3ZhRefImageSlot = {
  url: string;
  /** style | storyboard | character | scene | prop | creature */
  role: 'style' | 'storyboard' | DirectorAssetKind;
  name?: string;
};

const ROLE_ZH: Record<MinimaxH3ZhRefImageSlot['role'], string> = {
  style: '风格',
  storyboard: '分镜',
  character: '角色',
  scene: '场景',
  prop: '道具',
  creature: '生物',
};

/** H3 毫秒时码：00:00.000 */
export function formatDirectorH3Timecode(sec: number): string {
  const x = Math.max(0, Number(sec) || 0);
  const totalMs = Math.round(x * 1000);
  const mm = Math.floor(totalMs / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const mmm = totalMs % 1000;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(mmm).padStart(3, '0')}`;
}

/** H3 时段：00:00.000至00:01.700 */
export function formatDirectorH3TimeRange(startSec: number, endSec: number): string {
  return `${formatDirectorH3Timecode(startSec)}至${formatDirectorH3Timecode(endSec)}`;
}

function roleUse(role: MinimaxH3ZhRefImageSlot['role']): string {
  if (role === 'style') return '全片光色锁（画风固定真人写实）';
  if (role === 'storyboard') return '构图、场景、画风与光色锁（优先级高于文字风格）';
  if (role === 'character') return '角色身份锁';
  if (role === 'scene') return '场景环境锁';
  if (role === 'prop') return '道具外观锁';
  return '生物外观锁';
}

function genderForSlot(slot: MinimaxH3ZhRefImageSlot): string {
  if (slot.role === 'style') return '风格';
  if (slot.role === 'storyboard') return '分镜';
  if (slot.role === 'scene') return '场景';
  if (slot.role === 'prop') return '道具';
  if (slot.role === 'creature') return '生物';
  return inferDirectorAssetGender({
    name: slot.name || '',
    kind: 'character',
    prompt: '',
  });
}

function cleanDialogueLyric(raw: string): string {
  return String(raw || '')
    .replace(/^[^：:]{1,24}[：:]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 按推荐转换时长切本镜相对时轴端点（秒） */
export function buildDirectorH3BeatEdges(durationSec: number, paceSec: number): number[] {
  const dur = Math.max(0.5, Number(durationSec) || 5);
  const pace = Math.max(0.4, Number(paceSec) || 1.2);
  const edges = [0];
  let t = pace;
  while (t < dur - Math.min(0.25, pace * 0.35)) {
    edges.push(Number(t.toFixed(3)));
    t += pace;
  }
  if (edges[edges.length - 1] !== dur) edges.push(Number(dur.toFixed(3)));
  return edges;
}

/** 从画面描述里尽量抽出已有时轴段文案 */
function extractTimelineSegmentBodies(
  motion: string,
  expectedCount: number,
  emptyShot?: boolean,
): string[] {
  let t = String(motion || '').trim();
  // 去掉已拼进头段的画风/守卫，避免每段再复述
  t = t
    .replace(/^目标视频画风须同时作用在人物与场景[：:]?[^\n]*/i, '')
    .replace(/画风\s*[：:][^\n。]*/gi, '')
    .replace(/口型约束[：:][^\n]*/gi, '')
    .replace(/全员双唇紧闭[^。\n]*/gi, '')
    .replace(/【非对口型硬性】[^。\n]*/gi, '')
    .replace(/Mouth closed for everyone[^。\n]*/gi, '')
    .replace(/画面内禁止出现任何文字[^。\n]*/gi, '')
    .replace(/No on-screen text[^。\n]*/gi, '')
    .trim();
  if (!t) return Array.from({ length: expectedCount }, () => '');
  const parts = t
    .split(/(?:；|;|\n)+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s
        .replace(
          /^\s*(?:\d+(?:\.\d+)?\s*[–\-〜~到至]\s*\d+(?:\.\d+)?\s*s?|00:\d{2}\.\d{3}\s*至\s*00:\d{2}\.\d{3})\s*[｜|]\s*/i,
          '',
        )
        .replace(/^\[镜头\d+\]\s*/i, '')
        .replace(/^动作时轴[^：:]*[：:]\s*/i, '')
        .replace(/全员双唇紧闭[^。]*/g, '')
        .trim(),
    )
    .filter(Boolean);
  if (parts.length >= expectedCount) return parts.slice(0, expectedCount);
  const emptyContinue = '运镜继续变化，画风仍参考第1张分镜图';
  if (parts.length === 1) {
    const one = parts[0].slice(0, 120);
    return Array.from({ length: expectedCount }, (_, i) =>
      i === 0 ? one : emptyShot ? emptyContinue : `承接上段：${one.slice(0, 40)}`,
    );
  }
  while (parts.length < expectedCount) {
    parts.push(emptyShot ? emptyContinue : parts[parts.length - 1] || '人物微动，环境光影缓变');
  }
  return parts.slice(0, expectedCount);
}

function looksLikeMsTimeline(text: string): boolean {
  return /00:\d{2}\.\d{3}\s*至\s*00:\d{2}\.\d{3}/.test(String(text || ''));
}

/**
 * 生成本镜详细描述内的秒级（毫秒）动作时轴；对口型开启且有歌词时写入 <d>。
 */
export function composeDirectorH3ZhDetailedTimeline(opts: {
  durationSec: number;
  paceSec?: number;
  motionText?: string;
  lipsync?: boolean;
  lipsyncSubjectLabel?: string;
  dialogue?: string;
  angle?: string;
  focal?: string;
  size?: string;
  move?: string;
  style?: string;
  stylePictureIndex?: number;
  styleHint?: string;
  emptyShot?: boolean;
}): string {
  const durationSec = Math.max(0.5, Number(opts.durationSec) || 5);
  const paceSec = Math.max(0.4, Number(opts.paceSec) || 1.2);
  const edges = buildDirectorH3BeatEdges(durationSec, paceSec);
  const segCount = Math.max(1, edges.length - 1);
  const bodies = extractTimelineSegmentBodies(String(opts.motionText || ''), segCount, !!opts.emptyShot);
  const dialogue = cleanDialogueLyric(String(opts.dialogue || ''));
  const lipsync = !!opts.lipsync && !!dialogue && !opts.emptyShot;
  const subjectLabel = String(opts.lipsyncSubjectLabel || '<主体1>（S1）').trim();

  const styleHint =
    String(opts.styleHint || '').trim() ||
    formatDirectorStyleFromRefImageHint(opts.stylePictureIndex);
  const headBits = [
    opts.emptyShot
      ? '目标视频画风跟第1张分镜图画面；仅环境与静物，严禁人物、人形雕像与疑似人形阴影。'
      : `目标视频画风须同时作用在人物与场景：${styleHint}`,
    [opts.angle, opts.focal, opts.size, opts.move].filter(Boolean).join('，'),
  ]
    .filter(Boolean)
    .join(' ');

  const shotLines: string[] = [];
  for (let i = 0; i < segCount; i++) {
    const start = edges[i];
    const end = edges[i + 1];
    const range = formatDirectorH3TimeRange(start, end);
    const body = String(
      bodies[i] || (opts.emptyShot ? '镜头缓缓推进' : '人物微动，表情与光影缓慢变化'),
    );
    const shotNo = i + 1;
    const cutPrefix =
      i === 0
        ? `[镜头${shotNo}]`
        : `[镜头${shotNo}] ${formatDirectorH3Timecode(start)}处，画面继续推进。`;

    if (opts.emptyShot) {
      shotLines.push(
        `${cutPrefix} ${range}区间，画风参考第1张分镜图，运镜可变化。环境时轴：${body}。严禁任何人、人脸、人形、雕像、尸体与疑似人形阴影。`,
      );
      continue;
    }

    if (lipsync && i === 0) {
      shotLines.push(
        `${cutPrefix} 参照构图展开。${range}区间，${subjectLabel}口型与<音频1>精准同步；says ${
          dialogue ? `<d>[Chinese] ${dialogue}</d>` : ''
        } Speak only those <d> words. 唇形与音频一致。Visual-only: ${body}`,
      );
    } else if (lipsync) {
      shotLines.push(`${cutPrefix} ${range}区间，${subjectLabel}持续跟随<音频1>口型。表演要点：${body}`);
    } else {
      // 闭嘴约束只写一次（段末），避免每个 [镜头N] 重复堆叠
      shotLines.push(`${cutPrefix} ${range}区间，${body}`);
    }
  }

  const mouthOnce = lipsync
    ? '口型约束：仅指定主体（S1）跟随<音频1>张嘴；其余出场人物双唇紧闭，禁止跟唱。'
    : opts.emptyShot
      ? '口型约束：空镜禁止任何人出镜。'
      : '口型约束：全员保持沉默、不要说话，双唇紧闭，禁止开口（本段只声明一次）。';

  return `${headBits}\n${shotLines.join('\n')}${mouthOnce ? `\n${mouthOnce}` : ''}`.trim();
}

/** 无参考图槽时，用出场人物拼主体定义草稿 */
function composeTextOnlySubjectDefs(castOn: string, desc: string): string[] {
  const names = String(castOn || '')
    .split(/[、,，/｜|与和及\s]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '—' && !/^路人|群众|人群/.test(s));
  if (!names.length) {
    if (/空镜|无人物/.test(desc)) {
      return [
        '（本镜为空镜：无人物主体。严禁任何人、人脸、人形、雕像与疑似人形阴影。环境与画风以第1张分镜图画面为准；文字只写运镜与场景动态。）',
      ];
    }
    return ['（本镜角色外貌以画面描述为准；分镜/选角参考图绑定后由客户端补齐 <图片N>。）'];
  }
  return names.slice(0, 4).map((name, i) => {
    const sn = i + 1;
    return `<主体${sn}>为「${name}」，保留可识别面部特征、发型、服装与气质；身份须跨镜一致。`;
  });
}

/**
 * 组装完整中文六段式（可无图；有图时与提交槽位 1:1）。
 */
export function composeMinimaxH3ChineseOfficialRefPrompt(opts: {
  shot: Partial<DirectorShot>;
  globalStyle?: string;
  slots: MinimaxH3ZhRefImageSlot[];
  durationSec?: number;
  lipsync?: boolean;
  /** 是否已挂本镜对口型参考音（客户端会作为 <音频1> 提交） */
  hasLipsyncAudio?: boolean;
  /** 镜头变化档：影响切段密度 */
  shotChangePace?: string | null;
  /** 风格参考图是第几张（默认第 1 张） */
  stylePictureIndex?: number | null;
  stylePictureLabel?: string | null;
  /** 本镜明确空镜：出场与主体定义不得再写未选手 */
  emptyShot?: boolean;
}): string {
  const slots = (opts.slots || []).filter((s) => String(s.url || '').trim());
  const durationSec =
    opts.durationSec != null && Number.isFinite(Number(opts.durationSec))
      ? Math.max(0.5, Number(opts.durationSec))
      : parseDirectorShotDurationSec(opts.shot['时长'], 5);
  const paceSec = getDirectorMvShotChangePacePreset(opts.shotChangePace).recommendSec;
  const lipsync = !!opts.lipsync;
  const hasLipsyncAudio = lipsync && opts.hasLipsyncAudio !== false;
  const dialogue = String(opts.shot['对白旁白'] || '').trim();
  const desc = String(opts.shot['画面描述'] || '').trim();
  const light = String(opts.shot['光影氛围'] || '').trim();
  const location = String(opts.shot['地点'] || '').trim();
  const slotCastNames = slots
    .filter((s) => s.role === 'character')
    .map((s) => String(s.name || '').trim())
    .filter((n) => n && n !== '—');
  const castOn = opts.emptyShot
    ? ''
    : slotCastNames.join('、') || String(opts.shot['出场人物'] || '').trim();
  const angle = String(opts.shot['镜头角度'] || '').trim();
  const focal = String(opts.shot['焦距'] || '').trim();
  const size = String(opts.shot['景别'] || '').trim();
  const move = String(opts.shot['运镜'] || '').trim();
  const emptyShot =
    !!opts.emptyShot || /空镜|无人物/.test(desc) || (!castOn && /无人/.test(desc));
  const styleSlotIdx = slots.findIndex((s) => s.role === 'style');
  const storyboardSlotIdx = slots.findIndex((s) => s.role === 'storyboard');
  const stylePicNo =
    styleSlotIdx >= 0
      ? styleSlotIdx + 1
      : storyboardSlotIdx >= 0
        ? storyboardSlotIdx + 1
        : opts.stylePictureIndex != null && Number(opts.stylePictureIndex) >= 1
          ? Math.floor(Number(opts.stylePictureIndex))
          : 1;
  const styleHint =
    styleSlotIdx >= 0
      ? formatDirectorStyleFromRefImageHint(stylePicNo)
      : `构图、画风与光色参考第${stylePicNo}张分镜图`;

  const existingFinal = String(opts.shot['最终提示词'] || '').trim();
  const assumeStoryboardPic1 = !slots.some((s) => s.role === 'style' || s.role === 'storyboard');
  const pic1LookLock = `<图${stylePicNo}>（[镜头1]分镜）：完整保留——构图、场景、画风与光色（以该图画面为准）。文字只描述镜头运动；不要另写日照或另一套光影，不要另起材质或另一套场景。`;
  // 已是合格毫秒六段式且无新参考图槽：保留正文，仅在缺音频定义时补一行
  // 旧稿若写「无参考图/按文字描述生成」必须重拼，否则模型会另造场景
  if (
    isH3ZhSixSectionPrompt(existingFinal) &&
    looksLikeMsTimeline(existingFinal) &&
    slots.length === 0 &&
    !/无参考图|按文字描述生成/.test(existingFinal)
  ) {
    let keep = existingFinal;
    if (!lipsync) keep = stripH3DialogueTags(keep);
    if (hasLipsyncAudio && !/<音频1>/.test(keep)) {
      keep = keep.replace(
        /(主体定义：\s*\n)/,
        `$1<音频1>为已上传的时长${durationSec.toFixed(4).replace(/\.?0+$/, '')}秒的同步音轨，专属对应指定主角（S1）。完整保留原始音频信号、时长停顿与情绪。\n`,
      );
    }
    keep = keep
      .replace(/画面风格参考所选风格图片(?:「[^」]*」)?/g, styleHint)
      .replace(
        /画风\s*[：:]\s*(?!画面风格参考所选风格图片)[^\n。]*/g,
        `画风：${styleHint}`,
      )
      .replace(
        /目标视频画风须同时作用在人物与场景[：:][^\n]*/g,
        `目标视频画风须同时作用在人物与场景：${styleHint}`,
      );
    return keep.trim();
  }

  const defLines: string[] = [];
  let subjectN = 0;
  let lipsyncSubjectN = 0;
  let lipsyncSubjectName = '';
  const pictureAlias: string[] = [];

  slots.forEach((slot, i) => {
    const pic = i + 1;
    const roleZh = ROLE_ZH[slot.role] || '参考';
    const name = String(slot.name || '').trim() || `${roleZh}${pic}`;
    if (slot.role === 'style') {
      defLines.push(
        `<图片${pic}>是全片风格参考图，只参考光色与色调；画风固定真人写实摄影，禁止照抄插画/卡通/二次元/三维CG画风。`,
      );
      return;
    }
    if (slot.role === 'storyboard') {
      defLines.push(
        `<图片${pic}>为本镜分镜图，构图、场景、画风与光色参考该图（以画面为准，不要用文字描述画风或色温，不要另写日照）；亦可写作 <图${pic}>。`,
      );
      pictureAlias.push(`<图${pic}>`);
      return;
    }
    subjectN += 1;
    const kindLabel = directorAssetKindLabel(slot.role);
    if (slot.role === 'character') {
      defLines.push(
        `<主体${subjectN}>为图${pic}中出现的${kindLabel}「${name}」，只锁可识别面部、发型与服装身份；画风跟分镜图，不要用角色图的画风。用途：${roleUse(slot.role)}。`,
      );
      if (lipsyncSubjectN === 0) {
        lipsyncSubjectN = subjectN;
        lipsyncSubjectName = name;
        defLines[defLines.length - 1] += `该主体是说话人/歌手（S1）。`;
      }
    } else {
      defLines.push(
        `<主体${subjectN}>为来自 <图片${pic}> 的${kindLabel}「${name}」，须保持外观身份一致；用途：${roleUse(slot.role)}。`,
      );
    }
  });

  if (!slots.length) {
    defLines.push(...composeTextOnlySubjectDefs(castOn, desc));
    if (hasLipsyncAudio) {
      lipsyncSubjectN = 1;
      lipsyncSubjectName = castOn.split(/[、,，]/)[0]?.trim() || '指定主角';
    }
  }
  if (assumeStoryboardPic1) {
    defLines.unshift(
      `<图片${stylePicNo}>为本镜分镜图，构图、场景、画风与光色参考该图（以画面为准，不要用文字描述画风或色温，不要另写日照）；亦可写作 <图${stylePicNo}>。`,
    );
    pictureAlias.unshift(`<图${stylePicNo}>`);
  }

  if (hasLipsyncAudio) {
    const durLabel = Number(durationSec.toFixed(4));
    if (lipsyncSubjectN > 0) {
      defLines.push(
        `<音频1>为已上传的时长${durLabel}秒的同步音轨。人声专属对应<主体${lipsyncSubjectN}>（S1）${
          lipsyncSubjectName ? `「${lipsyncSubjectName}」` : ''
        }。完整保留原始音频信号、时长停顿、情绪；口型须与该主体同步，其余人物双唇紧闭。`,
      );
    } else {
      defLines.push(
        `<音频1>为已上传的时长${durLabel}秒的同步音轨，专属对应指定主角（S1）。完整保留原始音频信号、时长停顿与情绪；其余人物双唇紧闭。`,
      );
    }
  }

  const bindingClauses = slots.map((slot, i) => {
    const n = i + 1;
    const roleZh = ROLE_ZH[slot.role] || '参考';
    const name = String(slot.name || '').trim() || `${roleZh}${n}`;
    return `@图片${n} 作为第${n}张参考图｜${roleZh}｜${name}｜性别：${genderForSlot(slot)}｜用途：${roleUse(slot.role)}`;
  });

  const subjectMentions = slots
    .map((slot, i) => {
      if (slot.role === 'style' || slot.role === 'storyboard') return '';
      const name = String(slot.name || '').trim();
      return name ? `「${name}」(<图片${i + 1}>)` : `<图片${i + 1}>`;
    })
    .filter(Boolean)
    .join('、');

  const summaryBits = [
    hasLipsyncAudio ? '【参考素材生成+音频复用】' : '【参考生成】',
    `目标约${Math.round(durationSec)}秒。`,
    location ? `地点：${location}。` : '',
    castOn ? `出场：${castOn}。` : emptyShot ? '空镜无人物。' : '',
    `画风：${styleHint}。`,
    subjectMentions ? `参考：${subjectMentions}。` : '',
    pictureAlias.length ? `构图：${pictureAlias.join('、')}。` : '',
    hasLipsyncAudio
      ? lipsyncSubjectN > 0
        ? `对口型仅 <主体${lipsyncSubjectN}> (S1)+<音频1>。`
        : '对口型仅指定主角 (S1)+<音频1>。'
      : emptyShot
        ? '空镜禁止任何人、人脸、人形、雕像与疑似人形阴影出镜。'
        : '不对口型：全员保持沉默、不要说话，双唇紧闭。',
  ]
    .filter(Boolean)
    .join('');

  const retentionLines: string[] = [];
  let retainSubjectN = 0;
  slots.forEach((slot, i) => {
    const n = i + 1;
    if (slot.role === 'style') {
      retentionLines.push(
        `<图片${n}>（全片）：只保留光色——${formatDirectorStyleFromRefImageHint(n)}。`,
      );
      return;
    }
    if (slot.role === 'storyboard') {
      retentionLines.push(pic1LookLock.replace(`<图${stylePicNo}>`, `<图${n}>`));
      return;
    }
    retainSubjectN += 1;
    const name = String(slot.name || '').trim() || ROLE_ZH[slot.role];
    retentionLines.push(
      `<主体${retainSubjectN}>（出镜于[镜头1]）：仅保留「${name}」可识别五官、发型与服装身份；画风跟分镜图，不要用角色图的画风。`,
    );
  });
  if (!slots.length && castOn) {
    retentionLines.push(`出场人物（${castOn}）：完整保留——身份与服装气质跨时段一致。`);
  }
  if (hasLipsyncAudio) {
    retentionLines.push(
      lipsyncSubjectN > 0
        ? `<音频1>：部分沿用——完整复刻<音频1>人声、停顿、情绪与时间轴，环境音可另行生成；口型仅驱动 <主体${lipsyncSubjectN}> (S1)。`
        : `<音频1>：部分沿用——完整复刻人声时间轴；口型仅驱动指定主角 (S1)。`,
    );
  }
  if (assumeStoryboardPic1) {
    retentionLines.unshift(pic1LookLock);
  }
  if (!retentionLines.length) retentionLines.push(pic1LookLock);

  // 已有六段式但缺毫秒时轴：抽出 detailed 正文再重写时轴
  let motionSeed = '';
  if (isH3ZhSixSectionPrompt(existingFinal)) {
    const m = existingFinal.match(/详细描述[：:]\s*([\s\S]*?)(?:\n\s*整体声景[：:]|$)/);
    motionSeed = String(m?.[1] || '').trim();
    if (!lipsync) motionSeed = stripH3DialogueTags(motionSeed);
  } else if (existingFinal && !isH3ZhSixSectionPrompt(existingFinal)) {
    if (/integrated_multimodal_description|subject_definitions\s*:/i.test(existingFinal)) {
      motionSeed = extractSubjectMotion(desc);
    } else {
      motionSeed = stripLabeledDialogueLines(existingFinal);
    }
  }
  if (!motionSeed) {
    motionSeed = extractSubjectMotion(desc);
  }
  motionSeed = motionSeed
    .replace(/画风\s*[：:]\s*(?!画面风格参考所选风格图片)[^\n。]*/g, '')
    .replace(/目标视频画风须同时作用在人物与场景[：:][^\n]*/g, '')
    .replace(/\blive[- ]action\b/gi, '')
    .replace(/\bphotoreal\w*\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const lipsyncSubjectLabel =
    lipsyncSubjectN > 0
      ? `<主体${lipsyncSubjectN}>（S1）`
      : lipsyncSubjectName
        ? `「${lipsyncSubjectName}」（S1）`
        : '<主体1>（S1）';

  let detailed = composeDirectorH3ZhDetailedTimeline({
    durationSec,
    paceSec,
    motionText: motionSeed,
    lipsync: hasLipsyncAudio,
    lipsyncSubjectLabel,
    dialogue,
    angle: angle !== '—' ? angle : '',
    focal: focal !== '—' ? focal : '',
    size: size !== '—' ? size : '',
    move: move !== '—' ? move : '',
    stylePictureIndex: stylePicNo,
    styleHint,
    emptyShot,
  });
  if (light) {
    detailed += emptyShot
      ? `\n情绪：${light}。光色以第1张分镜图画面为准，不要另写日照或另一套光影。`
      : `\n情绪氛围：${light}`;
  }
  detailed +=
    '\n画风与光色以第1张分镜图画面为准，不要用文字描述画风或色温，不要另起一套日照。';
  if (emptyShot) {
    detailed +=
      '\n场景物仅限本镜地点、画面描述与第1张分镜图已有之物；禁止另编机械、电线、玻璃、藤蔓等不应景道具。';
    detailed +=
      '\n空镜每一时段都严禁任何人、人脸、人形、雕像、尸体与疑似人形阴影，不要加路人、流浪者或人形雕塑。画风跟第1张分镜图画面本身，不要改成三维CG。';
  }
  if (bindingClauses.length) detailed += `\n参考图绑定：${bindingClauses.join('，')}`;

  const soundscape = hasLipsyncAudio
    ? `完整保留<音频1>人声音轨；可轻混与场景匹配的环境底噪与物理动作音，音效不得掩盖人声；严禁画面出现字幕、歌词叠字或对话气泡（对白只在音频）。`
    : (() => {
        const dlg = cleanDialogueLyric(String(opts.shot['对白旁白'] || '').trim());
        const sfx = String(opts.shot['音效'] || '').trim();
        if (dlg) {
          return `须在音频轨生成清晰角色台词（仅口型与听觉，严禁烧录字幕），内容：「${dlg.slice(0, 180)}」；说话者口型与台词同步；环境音效${sfx ? `：${sfx.slice(0, 100)}` : '与场景匹配'}；严禁即兴 BGM/配乐/歌曲/哼唱；画面零文字。`;
        }
        return `仅环境底噪与物理动作音${sfx ? `（${sfx}）` : ''}；无对白则人物闭嘴；严禁即兴 BGM/配乐/歌曲；画面零文字、零字幕。`;
      })();

  const noSubLine =
    '【禁字幕】画面不得出现任何字幕、台词叠字、对话气泡、caption 或烧录文字；对白只存在于音频轨。';

  const lines = [
    '主体定义：',
    ...(defLines.length
      ? defLines
      : [`构图、场景、画风与光色以第${stylePicNo}张分镜图画面为准；文字只写运镜与运动。`]),
    '',
    '概述：',
    `${noSubLine}${summaryBits || '【参考生成】短剧单镜参考生成。'}`,
    '',
    '内容保留分析：',
    ...retentionLines,
    '',
    '详细描述：',
    `${noSubLine}\n${detailed}`,
    '',
    '整体声景：',
    soundscape,
    '',
    '非剧情配乐：',
    hasLipsyncAudio ? '无（主声轨已由 <音频1> 完整复用）' : '无（严禁生成任何配乐/BGM）',
  ];

  const composed = lines.join('\n').trim();
  if (!emptyShot) return composed;
  return `${DIRECTOR_PIC1_COLOR_FRONT}\n${DIRECTOR_PIC1_VISUAL_ANCHOR}\n${DIRECTOR_PIC1_LOOK_NEGATIVE_LINE}\n${DIRECTOR_EMPTY_SHOT_FRONT_BANNER}\n${DIRECTOR_EMPTY_SHOT_NEGATIVE_LINE}\n\n${composed}`;
}

/**
 * 组装本镜视频参考图槽。
 * 默认仅分镜 + 角色；短剧全量参考可传 onlyStoryboardAndCharacters: false。
 */
export function buildMinimaxH3ZhRefImageSlots(opts: {
  styleReferenceImageUrl?: string;
  storyboardImageUrl?: string;
  /** 本镜已匹配的有图资产（任意顺序） */
  matchedAssets: Array<{ imageUrl: string; name?: string; kind?: string; asset_id?: string }>;
  maxImages?: number;
  /** 视频提示词默认只要分镜图和角色图 */
  onlyStoryboardAndCharacters?: boolean;
}): MinimaxH3ZhRefImageSlot[] {
  const max = Math.max(1, Math.min(9, opts.maxImages ?? 9));
  const onlyCast = opts.onlyStoryboardAndCharacters !== false;
  const out: MinimaxH3ZhRefImageSlot[] = [];
  const seen = new Set<string>();
  const push = (slot: MinimaxH3ZhRefImageSlot, assetId?: string) => {
    const url = String(slot.url || '').trim();
    if (!url || out.length >= max) return;
    const aid = String(assetId || '').trim();
    // 按 role+asset 去重：同 URL 多角色各占一槽，禁止末角色覆盖场景槽
    const key = aid
      ? `${slot.role}::${aid}`
      : `url::${slot.role}::${url}::${String(slot.name || '').trim()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...slot, url });
  };

  const styleUrl = String(opts.styleReferenceImageUrl || '').trim();
  if (styleUrl && !onlyCast) push({ url: styleUrl, role: 'style', name: '全片风格' });

  const sbUrl = String(opts.storyboardImageUrl || '').trim();
  if (sbUrl) push({ url: sbUrl, role: 'storyboard', name: '本镜分镜' });

  const matched = opts.matchedAssets || [];
  const byKind = (kind: string) =>
    matched.filter((a) => String(a.kind || '') === kind && String(a.imageUrl || '').trim());

  if (!onlyCast) {
    for (const a of byKind('scene')) {
      push(
        { url: String(a.imageUrl).trim(), role: 'scene', name: a.name },
        String(a.asset_id || '').trim() || undefined,
      );
    }
  }
  for (const a of byKind('character')) {
    push(
      { url: String(a.imageUrl).trim(), role: 'character', name: a.name },
      String(a.asset_id || '').trim() || undefined,
    );
  }
  if (!onlyCast) {
    for (const a of byKind('prop')) {
      push(
        { url: String(a.imageUrl).trim(), role: 'prop', name: a.name },
        String(a.asset_id || '').trim() || undefined,
      );
    }
    for (const a of byKind('creature')) {
      push(
        { url: String(a.imageUrl).trim(), role: 'creature', name: a.name },
        String(a.asset_id || '').trim() || undefined,
      );
    }
    for (const a of matched) {
      const kind = String(a.kind || '');
      if (kind === 'scene' || kind === 'character' || kind === 'prop' || kind === 'creature') continue;
      push(
        {
          url: String(a.imageUrl).trim(),
          role: 'character',
          name: a.name,
        },
        String(a.asset_id || '').trim() || undefined,
      );
    }
  }

  return out;
}
