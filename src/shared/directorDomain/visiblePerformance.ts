/**
 * 情绪三层处理：
 * 1. Emotional Intent（导演意图）：自然语言指令，结构化 emotion 不覆盖不删除
 * 2. Visible Performance（可见表演）：表情/肢体微相等纯物理描述
 * 3. Physical Action（具体动作）：演员做什么
 *
 * 转换规则：emotion → visible performance（允许映射展开），但原始主导情绪必须保留。
 * stripEmotionLabels 现仅清理过程修饰、重复、无效标签；不得删除主导情绪词。
 */

import { stripCameraMotionFromPerformance } from './directorCameraSchema.js';
import type { DramaBeatEndState, DramaEmotion } from './types.js';

/**
 * 把字符串/对象/undefined 形式的 emotion 统一归一化为 DramaEmotion 对象。
 * — 字符串（遗留/用户输入）：按「主情绪 + 次情绪 @强度 #弧线」宽松解析，
 *   例："愤怒(克制) @0.8 #隐忍→爆发"、"紧张,心虚"
 * — 空值：返回 { primary: '', intensity: 0.6 }
 * — 对象：按 DramaEmotion 字段原样复制并兜底默认值
 */
export function coerceDramaEmotion(raw: unknown): DramaEmotion {
  if (raw == null) return { primary: '', intensity: 0.6 };
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const primary = String(obj.primary || '').trim();
    const secondary = String(obj.secondary || '').trim();
    let intensity = Number(obj.intensity);
    if (!Number.isFinite(intensity)) intensity = 0.6;
    intensity = Math.max(0, Math.min(1, intensity));
    const arc = String(obj.arc || '').trim();
    return {
      primary,
      secondary: secondary || undefined,
      intensity,
      arc: arc || undefined,
    };
  }
  const text = String(raw).trim();
  if (!text) return { primary: '', intensity: 0.6 };
  // 提取 @强度
  let intensity = 0.6;
  let rest = text;
  const intMatch = text.match(/@\s*([01](?:\.\d+)?|\d\.\d+)/);
  if (intMatch) {
    const parsed = Number(intMatch[1]);
    if (Number.isFinite(parsed)) intensity = Math.max(0, Math.min(1, parsed));
    rest = rest.replace(intMatch[0], '');
  }
  // 提取 #弧线
  let arc: string | undefined;
  const arcMatch = rest.match(/#([^\s,，()（）]+(?:\s*→\s*[^\s,，()（）]+)?)/);
  if (arcMatch) {
    arc = arcMatch[1].replace(/\s*→\s*/g, '→').trim() || undefined;
    rest = rest.replace(arcMatch[0], '');
  }
  // 拆分主/次：按逗号、顿号、括号、空格
  const tokens = rest
    .replace(/[()（）]/g, ',')
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const primary = tokens[0] || '';
  const secondary = tokens.slice(1).join('、') || undefined;
  return { primary, secondary, intensity, arc };
}

const SPEECH_IN_ACTION_RE =
  /低声交谈|小声说话|交谈|说话|讲话|讨论|回答|喊叫|开口|对白|对话|唱歌|跟唱/;

/**
 * 过程性修饰词 / 无效标签（仅清理这些，不删主导情绪）：
 * - 过渡短语（紧张感初现 / 敌意升高 / 高度戒备）
 * - 冗余名词形式（紧张感 ≈ 紧张，保留主导词「紧张」）
 *
 * 主导情绪词（戒备/敌意/恐慌/悲伤/愤怒/冷峻/克制/紧张）一律保留。
 */
const EMOTION_PROCESS_MODIFIER_RE =
  /紧张感初现|高度戒备|敌意升高|紧张感/g;

/**
 * 抽象情绪词表：仅用于清理纯物理描述文本（Visible Performance）时。
 * 在 Emotional Intent 文本中禁止调用本正则。
 */
const ABSTRACT_EMOTION_WORDS_RE =
  /隐忍|焦虑|冷漠|麻木|愤怒|疲惫|无奈|悲伤|恐慌|惊恐|恐惧|害怕|慌|心虚|慌张|躲闪|冷峻|冷静|克制|戒备|敌意|紧张|震怒|暴怒|失落|绝望/g;

const VISUAL_BIBLE_LEAK_RE = /烟雾缭绕|昏暗灯光|低饱和|胶片颗粒|变形宽银幕/g;

const PERFORMANCE_MAP: Array<{ key: RegExp; text: string }> = [
  { key: /惊恐|恐惧|害怕|慌/, text: '眼神睁大，身体后缩，动作停住，视线快速寻找危险' },
  { key: /愤怒|暴怒|怒/, text: '眉压低，下颌收紧，目光锁定对方，身体前倾后停住' },
  { key: /悲伤|绝望|失落/, text: '眼神下沉，动作放慢，呼吸加重，肩线微垂' },
  { key: /心虚|慌张|躲闪/, text: '视线短暂躲开，手部停顿，身体重量后移' },
  { key: /冷峻|冷静|克制/, text: '表情很少变化，动作稳定，目光直接，几乎没有多余手势' },
  { key: /高度戒备|威胁|枪套/, text: '手掌压住枪套，目光锁定对方，身体保持不动' },
  { key: /敌意|起身|加压/, text: '缓慢起身，身体转向对方，站定后目光持续锁定' },
  { key: /戒备/, text: '停止手中动作，握紧酒杯，目光转向对方' },
  { key: /紧张|初现|试探/, text: '三人保持原位，肩颈绷紧，视线彼此短暂试探' },
];

export function stripSpeechFromSilentAction(text: string): string {
  return String(text || '')
    .replace(/低声交谈/g, '端杯停顿')
    .replace(/小声说话/g, '嘴唇闭合停顿')
    .replace(/低声交谈|小声说话|交谈|说话|讲话|讨论|回答|喊叫|开口|对白|对话|唱歌|跟唱/g, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,\s]+|[，,\s]+$/g, '')
    .trim();
}

export function stripEmotionLabels(text: string): string {
  return String(text || '')
    .replace(EMOTION_PROCESS_MODIFIER_RE, '')
    .replace(/用可看见的身体与眼神完成，不写抽象心情词。?/g, '')
    .replace(/[：:]\s*/g, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,。\s]+|[，,。\s]+$/g, '')
    .trim();
}

/**
 * 仅用于 Visible Performance（纯物理描述）字段：清理其中混入的抽象情绪词，
 * 让「压抑的愤怒」「冷峻」这类词不在「物理微相」段出现，下沉到 Emotional Intent 层。
 * 处理 Emotional Intent（导演意图）文本时禁止调用本函数。
 */
export function stripAbstractEmotionFromPhysicalText(text: string): string {
  return String(text || '')
    .replace(ABSTRACT_EMOTION_WORDS_RE, ' ')
    .replace(/[，,]{2,}/g, '，')
    .replace(/\s+/g, ' ')
    .replace(/^[，,。\s]+|[，,。\s]+$/g, '')
    .trim();
}

export function stripVisualBibleLeak(text: string): string {
  return String(text || '')
    .replace(VISUAL_BIBLE_LEAK_RE, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,\s]+|[，,\s]+$/g, '')
    .trim();
}

const CONCRETE_PHYSICAL_RE =
  /电动车|摩托|停车|头盔|写字楼|骑|下车|摘下|抬头看/;

const LOCATION_GAZE: Array<{ re: RegExp; id: string; label: string; facing: string }> = [
  { re: /写字楼(?:的)?(?:入口|大门|门口)?|大楼入口|楼门口/, id: 'building_entrance', label: '写字楼入口', facing: '写字楼' },
];

export function locationGazeLabel(id: string | undefined): string {
  if (!id) return '';
  return LOCATION_GAZE.find((r) => r.id === id)?.label || '';
}

export function isLocationGazeTarget(id: string | undefined): boolean {
  return !!id && LOCATION_GAZE.some((r) => r.id === id);
}

export function expandVisiblePerformance(emotion: string, action: string): string {
  const act = collapseDuplicateActionText(String(action || '').trim());
  if (CONCRETE_PHYSICAL_RE.test(act)) {
    const cleaned = stripAbstractEmotionFromPhysicalText(
      stripEmotionLabels(stripSpeechFromSilentAction(stripCameraMotionFromPerformance(act))),
    );
    if (cleaned) return cleaned;
  }
  const blob = `${emotion} ${act}`;
  for (const row of PERFORMANCE_MAP) {
    if (row.key.test(blob)) return row.text;
  }
  const cleaned = stripAbstractEmotionFromPhysicalText(
    stripEmotionLabels(
      stripSpeechFromSilentAction(stripCameraMotionFromPerformance(act || emotion)),
    ),
  );
  if (cleaned) return cleaned;
  return '保持现有姿态，只有呼吸和眼神微动';
}

/**
 * 结构化情绪 → 自然语言导演指令。用于 H3 Prompt [EMOTIONAL INTENT] 段。
 * 不使用孤立标签「愤怒」，而写为「本镜情绪基调：压抑中的愤怒，中强强度，从克制逐渐加剧」
 * 这样避免被视频模型误判为画面元素（短剧禁字幕规则的延伸）。
 */
export function renderEmotionAsDirectorDirective(emotion: DramaEmotion | undefined | null): string {
  if (!emotion) return '';
  const primary = String(emotion.primary || '').trim();
  if (!primary) return '';
  const secondary = String(emotion.secondary || '').trim();
  const intensity = Number(emotion.intensity);
  const arc = String(emotion.arc || '').trim();
  let intensityLabel = '中等';
  if (Number.isFinite(intensity)) {
    if (intensity <= 0.25) intensityLabel = '轻微';
    else if (intensity <= 0.45) intensityLabel = '中弱';
    else if (intensity <= 0.6) intensityLabel = '中等';
    else if (intensity <= 0.8) intensityLabel = '中强';
    else intensityLabel = '极强';
  }
  const parts: string[] = [];
  if (secondary) parts.push(`${secondary}的${primary}`);
  else parts.push(primary);
  parts.push(`${intensityLabel}强度`);
  if (arc) parts.push(`从${arc.replace(/→/, '逐渐过渡到') || arc}`);
  return `本镜情绪基调：${parts.join('，')}`;
}

/** 强度数字 → 自然语言等级标签（前端 UI 展示用） */
export function emotionIntensityToLabel(intensity: number | undefined | null): string {
  if (!Number.isFinite(Number(intensity))) return '中等';
  const v = Number(intensity);
  if (v <= 0.25) return '轻微';
  if (v <= 0.45) return '中弱';
  if (v <= 0.6) return '中等';
  if (v <= 0.8) return '中强';
  return '极强';
}

/** 结构化情绪 → 前端一行短展示，例：「压抑的愤怒 · 中强 · 克制→加剧」 */
export function renderEmotionShortDisplay(emotion: DramaEmotion | undefined | null): string {
  if (!emotion) return '';
  const primary = String(emotion.primary || '').trim();
  if (!primary) return '';
  const secondary = String(emotion.secondary || '').trim();
  const intensityLabel = emotionIntensityToLabel(emotion.intensity);
  const arc = String(emotion.arc || '').trim();
  const head = secondary ? `${secondary}的${primary}` : primary;
  const parts = [head, intensityLabel];
  if (arc) parts.push(arc);
  return parts.join(' · ');
}

export function sanitizeSilentCharacterText(text: string): string {
  return stripVisualBibleLeak(
    stripAbstractEmotionFromPhysicalText(
      stripEmotionLabels(stripSpeechFromSilentAction(stripCameraMotionFromPerformance(text))),
    ),
  );
}

export function collapseDuplicateActionText(text: string, names: string[] = []): string {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const escapeRe = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameAlt = names.map((n) => String(n || '').trim()).filter((n) => n.length >= 2).map(escapeRe);
  if (nameAlt.length) {
    t = t.replace(new RegExp(`(?:^|[\\s，,])(?:${nameAlt.join('|')})`, 'g'), '，');
  }
  t = t.replace(/<主体\d+>(?:「[^」]*」)?(?:（[^）]*）)?/g, '').replace(/\s+/g, ' ').trim();
  const parts = t.split(/[，,。]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.replace(/\s+/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join('，');
}

export function mergeActionAndEvent(action: string, event: string): string {
  const a = collapseDuplicateActionText(action);
  const e = collapseDuplicateActionText(event);
  if (!e || e === a) return a;
  if (!a) return e;
  if (a.includes(e) || e.includes(a)) return a.length >= e.length ? a : e;
  return collapseDuplicateActionText(`${a} ${e}`);
}

type FoldedActionState = {
  pose?: string;
  locomotion?: 'stationary' | 'moving';
  gaze?: string;
  gazeTarget?: string;
  facing?: string;
  lookAction?: boolean;
  vehicleState?: string;
  helmetState?: string;
  propState?: string;
  helmetRemoved?: boolean;
  standingAction?: boolean;
  lookAtBuilding?: boolean;
};

export function foldActionChain(blob: string): FoldedActionState {
  const t = String(blob || '');
  const riding = /骑(?:着)?(?:电动车|摩托|单车|车)|驾车/.test(t);
  const stopped = /停下(?:电动车|摩托|单车|车)|停车|熄火|刹车停住/.test(t);
  const dismount = /下车|下车后|迈下车|从车上下来/.test(t);
  const stand = /站立|站定|站在|起身|步行|走入|走进/.test(t);
  const lookUp = /抬头/.test(t);
  const loc = LOCATION_GAZE.find((r) => r.re.test(t));
  const lookAction = /看向|抬头看|目光锁定|视线锁定|面向/.test(t);
  const helmetRemoved = /摘(?:下|掉)?头盔/.test(t);
  const helmetWorn = /戴(?:着|上)?头盔/.test(t) && !helmetRemoved;
  const out: FoldedActionState = {
    lookAction,
    lookAtBuilding: !!loc || /看向写字楼|抬头看向写字楼/.test(t),
    helmetRemoved,
    standingAction: stand || dismount || !!(stopped && (helmetRemoved || lookUp || loc)),
  };
  if (/倒地/.test(t)) out.pose = 'down';
  else if (out.standingAction) out.pose = 'standing';
  else if (riding && !stopped && !dismount) out.pose = 'seated';
  else if (/坐|端杯/.test(t) && !stand) out.pose = 'seated';

  if (stopped || dismount) out.vehicleState = 'stopped';
  else if (riding) out.vehicleState = 'moving';

  if (helmetRemoved) out.helmetState = 'removed';
  else if (helmetWorn) out.helmetState = 'worn';

  if (loc) {
    out.gazeTarget = loc.id;
    out.gaze = 'toward_location';
    out.facing = loc.facing;
  }
  if (/枪套/.test(t)) out.propState = 'hand_near_holster';
  else if (/杯/.test(t)) out.propState = 'holding_glass';

  const moving = /走|逃|追|爬|骑/.test(t) && !stopped && !dismount && !stand;
  out.locomotion = moving ? 'moving' : 'stationary';
  return out;
}

export function inferBeatEndState(
  action: string,
  performance: string,
  prev?: DramaBeatEndState | null,
  gazeTarget?: string,
): DramaBeatEndState {
  const blob = `${action} ${performance}`;
  const folded = foldActionChain(blob);
  const pose = folded.pose || prev?.pose || (folded.vehicleState === 'moving' ? 'seated' : '');
  let nextGazeTarget = folded.gazeTarget || '';
  if (!nextGazeTarget && folded.lookAction) {
    nextGazeTarget = gazeTarget || '';
  } else if (!folded.lookAction) {
    nextGazeTarget = folded.gazeTarget || gazeTarget || prev?.gazeTarget || '';
  } else {
    nextGazeTarget = folded.gazeTarget || gazeTarget || '';
  }
  return {
    pose: pose || 'unspecified',
    action:
      folded.vehicleState === 'moving'
        ? 'moving'
        : folded.vehicleState === 'stopped'
          ? 'stationary'
          : folded.locomotion || 'stationary',
    gaze: folded.gaze || (nextGazeTarget
      ? isLocationGazeTarget(nextGazeTarget)
        ? 'toward_location'
        : 'toward_other'
      : prev?.gaze || 'around'),
    gazeTarget: nextGazeTarget,
    propState: folded.propState || prev?.propState || 'none',
    spatialState: prev?.spatialState || 'same_space',
    vehicleState: folded.vehicleState || prev?.vehicleState || 'none',
    helmetState: folded.helmetState || prev?.helmetState || 'none',
    facing: folded.facing || prev?.facing || '',
  };
}

export function formatEndState(
  state: DramaBeatEndState,
  nameById?: Map<string, string>,
): string {
  const poseZh =
    state.pose === 'standing'
      ? '站立'
      : state.pose === 'down'
        ? '倒地'
        : state.pose === 'seated'
          ? '坐姿'
          : '';
  const vehicleZh =
    state.vehicleState === 'stopped' ? '车辆已停' : state.vehicleState === 'moving' ? '车辆行驶中' : '';
  const helmetZh =
    state.helmetState === 'removed' ? '头盔已摘下' : state.helmetState === 'worn' ? '仍戴头盔' : '';
  const facingZh = state.facing ? `面向${state.facing}` : '';
  const locLabel = locationGazeLabel(state.gazeTarget);
  const targetName = state.gazeTarget ? nameById?.get(state.gazeTarget) || '' : '';
  const gazeZh = locLabel
    ? `视线锁定${locLabel}`
    : state.gazeTarget
      ? targetName
        ? `目光锁定「${targetName}」`
        : isLocationGazeTarget(state.gazeTarget)
          ? ''
          : '目光锁定对方'
      : state.gaze === 'toward_other'
        ? '目光锁定对方'
        : state.gaze === 'offscreen'
          ? '看向画外'
          : state.gaze === 'toward_location'
            ? ''
            : '视线在场内';
  const propZh =
    state.propState === 'hand_near_holster'
      ? '手靠近枪套'
      : state.propState === 'holding_glass'
        ? '仍握酒杯'
        : '';
  const actZh =
    state.pose === 'standing' || state.vehicleState === 'stopped'
      ? ''
      : state.vehicleState === 'moving' || state.action === 'moving'
        ? '仍在移动'
        : poseZh
          ? '停住'
          : '';
  return [poseZh, helmetZh, vehicleZh, facingZh, gazeZh, propZh, actZh].filter(Boolean).join('，');
}

export function inferGazeTargetId(input: {
  selfIds: string[];
  shotCharacterIds: string[];
  prevPrimaryIds?: string[];
  prevGazeTarget?: string;
  blob: string;
  nameById?: Map<string, string>;
  mutual?: boolean;
}): string {
  const blob = String(input.blob || '');
  const loc = LOCATION_GAZE.find((r) => r.re.test(blob));
  if (loc) return loc.id;
  const lookAction = /看向|抬头看|目光锁定|视线锁定/.test(blob);
  if (input.mutual && !lookAction) return '';
  const self = new Set((input.selfIds || []).filter(Boolean));
  const others = (input.shotCharacterIds || []).filter((id) => id && !self.has(id));
  const nameById = input.nameById || new Map<string, string>();
  for (const id of others) {
    const name = nameById.get(id) || '';
    if (name && blob.includes(name)) return id;
    const short = name.replace(/响尾蛇|巴洛矿场/g, '');
    if (short.length >= 2 && blob.includes(short)) return id;
  }
  if (/枪手/.test(blob)) {
    const hit = [...nameById.entries()].find(
      ([id, name]) => name.includes('枪手') && !self.has(id),
    );
    if (hit) return hit[0];
  }
  if (lookAction && isLocationGazeTarget(input.prevGazeTarget)) {
    return '';
  }
  if (input.prevGazeTarget && self.has(input.prevGazeTarget)) {
    const lookBack = (input.prevPrimaryIds || []).find((id) => others.includes(id));
    if (lookBack) return lookBack;
  }
  const prevOther = [...(input.prevPrimaryIds || [])]
    .reverse()
    .find((id) => others.includes(id));
  if (prevOther) return prevOther;
  return others[others.length - 1] || '';
}

export function applyGazeTargetInText(
  text: string,
  gazeTargetId: string | undefined,
  subjectNo?: number,
  name?: string,
): string {
  const id = String(gazeTargetId || '').trim();
  if (!id) return String(text || '');
  if (isLocationGazeTarget(id)) {
    const label = locationGazeLabel(id) || name || '';
    if (!label) return String(text || '');
    return String(text || '')
      .replace(/抬头看向写字楼/g, `抬头，视线锁定${label}`)
      .replace(/看向写字楼/g, `视线锁定${label}`)
      .replace(/看向(?:对面|对方)/g, `视线锁定${label}`);
  }
  const tag = subjectNo && subjectNo > 0 ? `<主体${subjectNo}>` : name ? `「${name}」` : '';
  if (!tag) return String(text || '');
  let t = String(text || '');
  t = t.replace(/目光(锁定|转向)对方/g, `目光$1${tag}`);
  t = t.replace(/看向(?:对面|对方)/g, `目光锁定${tag}`);
  t = t.replace(/身体转向对方/g, `身体转向${tag}`);
  t = t.replace(/目光持续锁定(?!<|「)/g, `目光持续锁定${tag}`);
  if (name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`目光(锁定|转向)「${esc}」`, 'g'), `目光$1${tag}`);
  }
  return t;
}

export function actionRespectsEndState(action: string, prev: DramaBeatEndState | null | undefined): string {
  let next = String(action || '').trim();
  if (prev?.pose === 'standing') {
    next = next.replace(/从坐姿起身|坐着起身|倒地后试图撑起/g, '保持站立');
    if (/起身/.test(next) && !/继续/.test(next)) {
      next = next.replace(/缓慢起身[，,]?/g, '').replace(/起身[，,]?/g, '站定，');
    }
  }
  return next.replace(/^[，,\s]+/, '').trim();
}

export function hasSilentSpeechVerb(text: string): boolean {
  return SPEECH_IN_ACTION_RE.test(String(text || ''));
}

export function hasEmotionLabel(text: string): boolean {
  return /紧张感初现|高度戒备|敌意升高|用可看见的身体与眼神完成/.test(String(text || ''));
}

export function qaActionEndStateConflicts(
  action: string,
  performance: string,
  end: DramaBeatEndState | undefined,
): string[] {
  const issues: string[] = [];
  const folded = foldActionChain(`${action} ${performance}`);
  if (!end) {
    issues.push('缺少 EndState');
    return issues;
  }
  if (folded.standingAction && end.pose === 'seated') {
    issues.push('动作已站立/下车，但 EndState 仍是坐姿');
  }
  if (folded.helmetRemoved && end.helmetState !== 'removed') {
    issues.push('动作已摘头盔，但 helmetState 不是 removed');
  }
  if (folded.lookAtBuilding && end.gazeTarget !== 'building_entrance') {
    issues.push('动作看向写字楼，但 gazeTarget 不是 building_entrance');
  }
  return issues;
}
