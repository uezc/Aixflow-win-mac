/**
 * 镜头参数 Schema：最终进入 Prompt 的必须是单值。
 * 禁止「或」、范围焦段、多选数组。
 */

export type DramaPrimaryPurpose =
  | 'establish'
  | 'action'
  | 'discovery'
  | 'reaction'
  | 'dialogue'
  | 'threat'
  | 'escalation'
  | 'result'
  | 'hold';

export type DramaShotSizeId =
  | 'extreme_wide'
  | 'wide'
  | 'full'
  | 'medium'
  | 'medium_close'
  | 'close'
  | 'extreme_close';

export type DramaCameraAngleId = 'eye' | 'high' | 'low' | 'over_shoulder' | 'pov';
export type DramaCameraMovementId =
  | 'static'
  | 'slow_push_in'
  | 'slow_pull_out'
  | 'follow'
  | 'pan'
  | 'handheld'
  | 'orbit';
export type DramaLensMm = 24 | 35 | 50 | 85 | 135;
export type DramaCompositionId =
  | 'center'
  | 'thirds'
  | 'negative_space'
  | 'foreground_obstruction'
  | 'frame_in_frame';

export type DramaLockedCamera = {
  shotSize: DramaShotSizeId;
  cameraAngle: DramaCameraAngleId;
  cameraMovement: DramaCameraMovementId;
  lensMm: DramaLensMm;
  composition: DramaCompositionId;
  continuityReason?: string;
};

export function cameraSignature(cam: DramaLockedCamera): string {
  return [cam.shotSize, cam.cameraAngle, cam.cameraMovement, cam.lensMm, cam.composition].join('|');
}

export const SHOT_SIZE_ZH: Record<DramaShotSizeId, string> = {
  extreme_wide: '大远景',
  wide: '远景',
  full: '全景',
  medium: '中景',
  medium_close: '中近景',
  close: '近景',
  extreme_close: '特写',
};

export const ANGLE_ZH: Record<DramaCameraAngleId, string> = {
  eye: '平视',
  high: '俯拍',
  low: '低机位',
  over_shoulder: '过肩',
  pov: '主观',
};

export const MOVEMENT_ZH: Record<DramaCameraMovementId, string> = {
  static: '固定',
  slow_push_in: '缓慢推入',
  slow_pull_out: '缓慢拉远',
  follow: '跟拍',
  pan: '横移',
  handheld: '手持',
  orbit: '环绕',
};

export const COMPOSITION_ZH: Record<DramaCompositionId, string> = {
  center: '居中构图',
  thirds: '三分构图',
  negative_space: '负空间',
  foreground_obstruction: '前景遮挡',
  frame_in_frame: '框中框',
};

export const PURPOSE_ZH: Record<DramaPrimaryPurpose, string> = {
  establish: '建立',
  action: '动作',
  discovery: '发现',
  reaction: '反应',
  dialogue: '对白',
  threat: '威胁',
  escalation: '加压',
  result: '结果',
  hold: '维持',
};

export function formatLockedCameraLine(cam: DramaLockedCamera): string {
  return `${SHOT_SIZE_ZH[cam.shotSize]}｜${ANGLE_ZH[cam.cameraAngle]}｜${MOVEMENT_ZH[cam.cameraMovement]}｜${cam.lensMm}mm｜${COMPOSITION_ZH[cam.composition]}`;
}

export function inferDramaPrimaryPurpose(input: {
  purpose?: string;
  event?: string;
  action?: string;
  emotion?: string;
  hasDialogue?: boolean;
  index: number;
  total: number;
}): DramaPrimaryPurpose {
  if (input.hasDialogue) return 'dialogue';
  const blob = `${input.purpose || ''} ${input.event || ''} ${input.action || ''} ${input.emotion || ''}`;
  if (/混乱|逃散|四散|结果/.test(blob)) return 'result';
  if (/枪套|威胁|持枪|拔枪|危险源/.test(blob)) return 'threat';
  if (/起身|敌意|爆发|加压|打脸|对峙/.test(blob) || (input.index === input.total - 1 && /升|高/.test(blob))) {
    return 'escalation';
  }
  if (/看见|发现|秘密/.test(blob)) return 'discovery';
  if (/追逐|逃跑|打斗|倒地|爬/.test(blob)) return 'action';
  if (/反应|戒备|停顿|对视/.test(blob)) return 'reaction';
  if (input.index === 0 || /建立|环境|展现|酒馆|铺垫/.test(blob)) return 'establish';
  if (input.index > 0) return 'reaction';
  return 'hold';
}

function cameraForPurpose(purpose: DramaPrimaryPurpose, intensity: number): DramaLockedCamera {
  switch (purpose) {
    case 'establish':
      return {
        shotSize: 'medium',
        cameraAngle: 'eye',
        cameraMovement: 'slow_push_in',
        lensMm: 35,
        composition: 'thirds',
      };
    case 'action':
      return {
        shotSize: 'full',
        cameraAngle: 'eye',
        cameraMovement: 'follow',
        lensMm: 24,
        composition: 'thirds',
      };
    case 'discovery':
      return {
        shotSize: 'medium_close',
        cameraAngle: 'eye',
        cameraMovement: 'slow_push_in',
        lensMm: 50,
        composition: 'thirds',
      };
    case 'reaction':
      return {
        shotSize: 'medium_close',
        cameraAngle: 'eye',
        cameraMovement: 'static',
        lensMm: 50,
        composition: 'thirds',
      };
    case 'dialogue':
      return {
        shotSize: intensity >= 7 ? 'medium_close' : 'medium',
        cameraAngle: 'eye',
        cameraMovement: 'static',
        lensMm: intensity >= 7 ? 85 : 50,
        composition: 'thirds',
      };
    case 'threat':
      return {
        shotSize: 'close',
        cameraAngle: 'eye',
        cameraMovement: 'slow_push_in',
        lensMm: 85,
        composition: 'thirds',
      };
    case 'escalation':
      return {
        shotSize: 'medium_close',
        cameraAngle: 'low',
        cameraMovement: 'static',
        lensMm: 50,
        composition: 'center',
      };
    case 'result':
      return {
        shotSize: 'full',
        cameraAngle: 'eye',
        cameraMovement: 'slow_pull_out',
        lensMm: 35,
        composition: 'thirds',
      };
    default:
      return {
        shotSize: 'medium',
        cameraAngle: 'eye',
        cameraMovement: 'static',
        lensMm: 35,
        composition: 'thirds',
      };
  }
}

const ALT_FOR_DUP: DramaLockedCamera[] = [
  {
    shotSize: 'medium',
    cameraAngle: 'eye',
    cameraMovement: 'static',
    lensMm: 35,
    composition: 'thirds',
  },
  {
    shotSize: 'close',
    cameraAngle: 'eye',
    cameraMovement: 'static',
    lensMm: 85,
    composition: 'thirds',
  },
  {
    shotSize: 'medium_close',
    cameraAngle: 'low',
    cameraMovement: 'static',
    lensMm: 50,
    composition: 'center',
  },
  {
    shotSize: 'full',
    cameraAngle: 'high',
    cameraMovement: 'slow_pull_out',
    lensMm: 35,
    composition: 'thirds',
  },
];

/** 按戏剧目的选镜头；与上一镜签名相同时才换，不为变化而变化。 */
export function decideLockedCamera(input: {
  purpose: DramaPrimaryPurpose;
  emotionIntensity?: number;
  prev?: DramaLockedCamera | null;
  allowRepeatReason?: string;
}): DramaLockedCamera {
  const intensity = Math.max(1, Math.min(10, Math.round(Number(input.emotionIntensity) || 5)));
  let cam = cameraForPurpose(input.purpose, intensity);
  if (input.prev && cameraSignature(cam) === cameraSignature(input.prev)) {
    if (input.allowRepeatReason) {
      return { ...cam, continuityReason: input.allowRepeatReason };
    }
    const alt = ALT_FOR_DUP.find((c) => cameraSignature(c) !== cameraSignature(input.prev!));
    cam = alt || {
      ...cam,
      cameraMovement: cam.cameraMovement === 'static' ? 'slow_push_in' : 'static',
    };
  }
  return cam;
}

export function normalizeLensMm(raw: string | number | undefined): DramaLensMm {
  const n = Number(String(raw || '').replace(/[^\d.].*$/, ''));
  if (n <= 26) return 24;
  if (n <= 42) return 35;
  if (n <= 67) return 50;
  if (n <= 110) return 85;
  if (Number.isFinite(n)) return 135;
  const s = String(raw || '');
  if (/特写|近景|85/.test(s)) return 85;
  if (/全景|远景|24|18/.test(s)) return 24;
  if (/50/.test(s)) return 50;
  return 35;
}

export function normalizeShotSize(raw: string | undefined): DramaShotSizeId {
  const s = String(raw || '');
  if (/大远|extreme\s*wide/i.test(s)) return 'extreme_wide';
  if (/远景|wide/.test(s) && !/中远/.test(s)) return 'wide';
  if (/中远|全景|full/.test(s)) return /中远/.test(s) ? 'full' : 'full';
  if (/特写|extreme\s*close/i.test(s)) return 'extreme_close';
  if (/近景|close/.test(s) && !/中近/.test(s)) return 'close';
  if (/中近|medium[_\s-]?close/i.test(s)) return 'medium_close';
  if (/中景|medium/.test(s)) return 'medium';
  return 'medium';
}

export function normalizeAngle(raw: string | undefined): DramaCameraAngleId {
  const s = String(raw || '');
  if (/俯|高机|high/.test(s)) return 'high';
  if (/仰|低机|low/.test(s)) return 'low';
  if (/过肩|shoulder/.test(s)) return 'over_shoulder';
  if (/主观|pov/i.test(s)) return 'pov';
  return 'eye';
}

export function normalizeMovement(raw: string | undefined): DramaCameraMovementId {
  const s = String(raw || '');
  if (/拉远|pull/.test(s)) return 'slow_pull_out';
  if (/推|push/.test(s)) return 'slow_push_in';
  if (/跟拍|follow/.test(s)) return 'follow';
  if (/横移|pan/.test(s)) return 'pan';
  if (/手持|handheld/.test(s)) return 'handheld';
  if (/环绕|orbit/.test(s)) return 'orbit';
  return 'static';
}

export function normalizeComposition(raw: string | undefined): DramaCompositionId {
  const s = String(raw || '');
  if (/负空间/.test(s)) return 'negative_space';
  if (/前景/.test(s)) return 'foreground_obstruction';
  if (/框中框/.test(s)) return 'frame_in_frame';
  if (/居中|center/.test(s)) return 'center';
  return 'thirds';
}

export function lockedCameraFromLoose(raw: {
  shotType?: string;
  angle?: string;
  movement?: string;
  lens?: string;
  composition?: string;
}): DramaLockedCamera {
  return {
    shotSize: normalizeShotSize(raw.shotType),
    cameraAngle: normalizeAngle(raw.angle),
    cameraMovement: normalizeMovement(raw.movement),
    lensMm: normalizeLensMm(raw.lens),
    composition: normalizeComposition(raw.composition),
  };
}

export function applyLockedCameraToBeatFields(cam: DramaLockedCamera): {
  shotType: string;
  camera: string;
  lens: string;
  composition: string;
  movement: string;
} {
  return {
    shotType: SHOT_SIZE_ZH[cam.shotSize],
    camera: formatLockedCameraLine(cam),
    lens: `${cam.lensMm}mm`,
    composition: COMPOSITION_ZH[cam.composition],
    movement: MOVEMENT_ZH[cam.cameraMovement],
  };
}

/** 人物表演里的镜头运动词。cameraMovement 才是运镜唯一事实，表演段不得再写镜头怎么动。 */
const CAMERA_MOTION_IN_ACTION_RE =
  /镜头(?:继续|再次|仍在|保持)?(?:缓慢|轻轻|轻微)?(?:向前|往前)?(?:推入|推近|推进|拉远|拉出|摇镜|跟拍|横移|环绕|移动)|(?:继续|再次)(?:缓慢|轻轻)?(?:推入|推近|推进|拉远)|(?:缓慢|轻轻)?推入(?:酒馆|场景|画面)?|移动镜头|镜头向前|镜头往前|镜头移动|镜头继续|固定或轻微移动/g;

const STATIC_CAMERA_PHRASE_RE = /固定机位|机位固定|镜头固定/g;

const CAMERA_MOTION_CONFLICT_RE =
  /(?:镜头(?:继续|再次|仍在)?)?(?:缓慢|轻轻|轻微)?(?:向前|往前)?(?:推入|推近|推进|拉远|拉出)|摇镜|跟拍|移动镜头|镜头向前|镜头往前|镜头移动|镜头继续/;

function tidyCameraStrip(text: string): string {
  return String(text || '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,。\s]+|[，,。\s]+$/g, '')
    .trim();
}

/** 从人物动作/环境句中删除镜头运动描述，避免与 lockedCamera 冲突。 */
export function stripCameraMotionFromPerformance(text: string): string {
  return tidyCameraStrip(
    String(text || '')
      .replace(CAMERA_MOTION_IN_ACTION_RE, '')
      .replace(/镜头缓慢推入[，,]?/g, ''),
  );
}

/**
 * Schema 优先：表演/自由文本不得再声明运镜。
 * static 禁止任何推拉摇移；slow_push_in 禁止「固定机位」。
 */
export function stripConflictingCameraLanguage(
  text: string,
  movement: DramaCameraMovementId | undefined,
): string {
  let t = stripCameraMotionFromPerformance(text);
  if (movement && movement !== 'static') {
    t = t.replace(STATIC_CAMERA_PHRASE_RE, '');
  }
  return tidyCameraStrip(t);
}

export function cameraLanguageConflicts(
  text: string,
  movement: DramaCameraMovementId | undefined,
): boolean {
  const t = String(text || '');
  if (!movement) return false;
  if (movement === 'static') return CAMERA_MOTION_CONFLICT_RE.test(t);
  if (movement === 'slow_push_in' || movement === 'slow_pull_out') {
    return STATIC_CAMERA_PHRASE_RE.test(t);
  }
  return false;
}

/** 从完整镜头段里取出「景别｜角度｜运镜｜焦段｜构图」之后的正文。 */
export function shotBlockBodyAfterCameraLine(block: string): string {
  const t = String(block || '');
  const m = t.match(/[^。\n]*｜[^。\n]*mm｜[^。\n]*/);
  if (!m || m.index == null) return t.replace(/^\[镜头\d+\][^.。]*[。.】]?/, '');
  return t.slice(m.index + m[0].length).replace(/^[。.]\s*/, '');
}
