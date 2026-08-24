/**
 * 情绪 → 可拍摄表演。最终 Prompt 只写可见动作，不写情绪标签。
 */

import { stripCameraMotionFromPerformance } from './directorCameraSchema.js';
import type { DramaBeatEndState } from './types.js';

const SPEECH_IN_ACTION_RE =
  /低声交谈|小声说话|交谈|说话|讲话|讨论|回答|喊叫|开口|对白|对话|唱歌|跟唱/;

const EMOTION_LABEL_RE =
  /紧张感初现|高度戒备|敌意升高|紧张感|戒备|敌意|恐慌|悲伤|愤怒|冷峻|克制|紧张/g;

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
    .replace(EMOTION_LABEL_RE, '')
    .replace(/用可看见的身体与眼神完成，不写抽象心情词。?/g, '')
    .replace(/[：:]\s*/g, '')
    .replace(/[，,]{2,}/g, '，')
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
    const cleaned = stripEmotionLabels(stripSpeechFromSilentAction(stripCameraMotionFromPerformance(act)));
    if (cleaned) return cleaned;
  }
  const blob = `${emotion} ${act}`;
  for (const row of PERFORMANCE_MAP) {
    if (row.key.test(blob)) return row.text;
  }
  const cleaned = stripEmotionLabels(
    stripSpeechFromSilentAction(stripCameraMotionFromPerformance(act || emotion)),
  );
  if (cleaned) return cleaned;
  return '保持现有姿态，只有呼吸和眼神微动';
}

export function sanitizeSilentCharacterText(text: string): string {
  return stripVisualBibleLeak(
    stripEmotionLabels(stripSpeechFromSilentAction(stripCameraMotionFromPerformance(text))),
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
