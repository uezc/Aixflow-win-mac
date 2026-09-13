/**
 * Visual DNA — 后台电影视觉参数工厂与 Prompt 合成
 * 普通用户不直接调参；由 VisualStylePreset 注入。
 */

import { dramaNewId } from './ids.js';
import type {
  DramaProjectVisualBible,
  DramaVisualConsistencyScore,
  DramaVisualDNA,
  DramaVisualDnaCamera,
  DramaVisualDnaColor,
  DramaVisualDnaLighting,
  DramaVisualDnaMood,
  DramaVisualDnaReferenceImage,
  DramaVisualDnaTexture,
  DramaVisualLensMm,
  VisualStylePreset,
} from './types.js';
import {
  isScenicAtmospherePhrase,
  scrubVisualStyleToLookAndColor,
} from './visualStyleLookColor.js';

const LENSES: DramaVisualLensMm[] = [18, 24, 35, 50, 85, 135];

export function normalizeDramaVisualLens(raw: unknown): DramaVisualLensMm {
  const n = Number(raw);
  if ((LENSES as number[]).includes(n)) return n as DramaVisualLensMm;
  return 35;
}

export function clamp01to100(n: unknown, fallback = 50): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function clampTemperature(n: unknown, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(-100, Math.min(100, Math.round(v)));
}

export function createEmptyDramaVisualDnaColor(
  partial?: Partial<DramaVisualDnaColor>,
): DramaVisualDnaColor {
  return {
    temperature: clampTemperature(partial?.temperature, 0),
    saturation: clamp01to100(partial?.saturation, 45),
    contrast: clamp01to100(partial?.contrast, 55),
    blackLevel: clamp01to100(partial?.blackLevel, 25),
  };
}

export function createEmptyDramaVisualDnaCamera(
  partial?: Partial<DramaVisualDnaCamera> & { cameraMovement?: string },
): DramaVisualDnaCamera {
  const movement =
    String(partial?.movement || (partial as { cameraMovement?: string })?.cameraMovement || '')
      .trim() || 'subtle handheld';
  return {
    lens: normalizeDramaVisualLens(partial?.lens),
    depthOfField: clamp01to100(partial?.depthOfField, 55),
    anamorphic: !!partial?.anamorphic,
    movement,
  };
}

export function createEmptyDramaVisualDnaLighting(
  partial?: Partial<DramaVisualDnaLighting> & { softness?: number },
): DramaVisualDnaLighting {
  // 兼容旧字段 softness：硬光≈高对比
  let contrast = partial?.contrast;
  if (contrast == null && partial?.softness != null) {
    contrast = 100 - clamp01to100(partial.softness, 45);
  }
  return {
    style: String(partial?.style || 'cinematic').trim(),
    direction: String(partial?.direction || 'side key').trim(),
    contrast: clamp01to100(contrast, 55),
  };
}

export function createEmptyDramaVisualDnaTexture(
  partial?: Partial<DramaVisualDnaTexture> & { lensFlare?: number },
): DramaVisualDnaTexture {
  // 兼容旧 lensFlare → 默认锐度
  let sharpness = partial?.sharpness;
  if (sharpness == null && (partial as { lensFlare?: number })?.lensFlare != null) {
    sharpness = 55;
  }
  return {
    filmGrain: clamp01to100(partial?.filmGrain, 35),
    filmStock: String(partial?.filmStock || 'Kodak Vision3').trim(),
    sharpness: clamp01to100(sharpness, 55),
  };
}

export function createEmptyDramaVisualDnaMood(
  partial?: Partial<DramaVisualDnaMood>,
): DramaVisualDnaMood {
  return {
    emotion: String(partial?.emotion || '').trim(),
    atmosphere: String(partial?.atmosphere || '').trim(),
  };
}

export function createEmptyDramaVisualDnaReferenceImage(
  partial?: Partial<DramaVisualDnaReferenceImage>,
): DramaVisualDnaReferenceImage {
  return {
    id: partial?.id || dramaNewId('vdna_ref'),
    kind: partial?.kind === 'generated' ? 'generated' : 'original',
    url: String(partial?.url || '').trim(),
    label: String(partial?.label || '').trim(),
    created_at: Number(partial?.created_at) || Date.now(),
  };
}

/**
 * 根据 Visual DNA 参数生成「画风 + 色彩基调」铅字。
 * 不含题材/地点/场景氛围（场景以 Picture 为准）。
 */
export function buildCinematicPromptFromVisualDna(
  dna: Pick<DramaVisualDNA, 'color' | 'camera' | 'lighting' | 'texture' | 'mood'>,
  promptTemplate?: string,
): string {
  const tpl = scrubVisualStyleToLookAndColor(String(promptTemplate || '').trim());
  const parts: string[] = [];
  if (tpl) parts.push(tpl);

  const lens = dna.camera.lens;
  parts.push(
    `${lens}mm ${dna.camera.anamorphic ? 'anamorphic ' : ''}lens`.replace(/\s+/g, ' ').trim(),
  );

  if (dna.camera.depthOfField >= 70) parts.push('shallow depth of field, creamy bokeh');
  else if (dna.camera.depthOfField <= 30) parts.push('deep focus');
  else parts.push('moderate depth of field');

  if (dna.camera.anamorphic) parts.push('anamorphic flares, oval bokeh');
  // 运镜属分镜/机位，不进风格铅字（避免漂浮诗意等题材暗示）

  const temp = dna.color.temperature;
  if (temp <= -35) parts.push('cool blue cinematic grading');
  else if (temp >= 35) parts.push('warm amber cinematic grading');
  else if (Math.abs(temp) < 15 && dna.color.saturation <= 20) parts.push('desaturated noir grading');
  else parts.push('balanced cinematic color grade');

  if (dna.color.saturation <= 20) parts.push('low saturation');
  else if (dna.color.saturation >= 70) parts.push('vivid saturated colors');

  if (dna.color.contrast >= 70) parts.push('high contrast');
  else if (dna.color.contrast <= 35) parts.push('soft contrast');

  if (dna.color.blackLevel >= 55) parts.push('lifted blacks, milky shadows');
  else if (dna.color.blackLevel <= 25) parts.push('deep crushed blacks');

  if (dna.lighting.style) parts.push(`${dna.lighting.style} lighting`);
  if (dna.lighting.direction) parts.push(`${dna.lighting.direction}`);
  if (dna.lighting.contrast >= 65) parts.push('hard dramatic light');
  else if (dna.lighting.contrast <= 35) parts.push('soft diffused light');

  if (dna.texture.filmGrain >= 20) {
    const stock = dna.texture.filmStock || 'film';
    parts.push(`${stock} film grain`);
  }
  if (dna.texture.sharpness >= 70) parts.push('crisp detail');
  else if (dna.texture.sharpness <= 35) parts.push('soft organic sharpness');

  // mood.atmosphere 常含地点/题材，风格铅字一律不注入
  if (dna.mood.emotion && !isScenicAtmospherePhrase(dna.mood.emotion)) {
    parts.push(`${dna.mood.emotion} mood`);
  }

  parts.push('cinematic still, movie lighting, photoreal');
  return scrubVisualStyleToLookAndColor(
    parts
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .join(', '),
  );
}

/**
 * 中文对照版：仅画风 + 色彩基调。
 */
export function buildCinematicPromptZhFromVisualDna(
  dna: Pick<DramaVisualDNA, 'color' | 'camera' | 'lighting' | 'texture' | 'mood'>,
  promptTemplateZh?: string,
): string {
  const tpl = scrubVisualStyleToLookAndColor(String(promptTemplateZh || '').trim());
  const parts: string[] = [];
  if (tpl) parts.push(tpl);

  const lens = dna.camera.lens;
  parts.push(`${lens}mm${dna.camera.anamorphic ? ' 变形宽银幕' : ''}镜头`);

  if (dna.camera.depthOfField >= 70) parts.push('浅景深、奶油虚化');
  else if (dna.camera.depthOfField <= 30) parts.push('深景深、全清晰');
  else parts.push('中等景深');

  if (dna.camera.anamorphic) parts.push('变形镜头光晕、椭圆焦外');

  const temp = dna.color.temperature;
  if (temp <= -35) parts.push('冷蓝电影调色');
  else if (temp >= 35) parts.push('暖琥珀电影调色');
  else if (Math.abs(temp) < 15 && dna.color.saturation <= 20) parts.push('低饱和黑色电影调色');
  else parts.push('均衡电影调色');

  if (dna.color.saturation <= 20) parts.push('低饱和');
  else if (dna.color.saturation >= 70) parts.push('高饱和鲜明色彩');

  if (dna.color.contrast >= 70) parts.push('高对比');
  else if (dna.color.contrast <= 35) parts.push('柔和对比');

  if (dna.color.blackLevel >= 55) parts.push('抬升黑位、乳状暗部');
  else if (dna.color.blackLevel <= 25) parts.push('深沉压黑');

  const lightStyleMap: Record<string, string> = {
    cinematic: '电影光',
    'cinematic motivated key': '电影动机主光',
    'motivated key': '动机主光',
    动机主光: '动机主光',
    'beauty soft key': '美颜柔光主光',
    'soft window natural light': '窗边自然柔光',
    'neon practicals': '霓虹实景光',
    'noir hard light with red accent': '黑色电影硬光与局部红光',
    'classic HK drama practicals': '经典暖调实景光',
    'misty soft dawn key': '薄雾柔主光',
    'cel-shaded soft key': '赛璐珞感柔主光',
    'soft high-key beauty': '柔和高调美光',
    'available natural light': '现成自然光',
  };
  if (dna.lighting.style) {
    const mapped = lightStyleMap[dna.lighting.style] || dna.lighting.style;
    parts.push(/光效$|光$/.test(mapped) ? mapped : `${mapped}光效`);
  }

  const lightDirMap: Record<string, string> = {
    'side key': '侧主光',
    'side key with soft fill': '侧主光+柔辅光',
    '侧主光+柔辅光': '侧主光+柔辅光',
    'front soft wrap': '正面柔光包裹',
    'front soft key': '正面柔主光',
    'multi-color rim': '多色轮廓光',
    'side slash + red practical': '侧切光+红色实景光',
    'warm key + tungsten fill': '暖主光+钨丝辅光',
    'backlit haze': '逆光薄雾',
    'front beauty + color rim': '正面美光+彩色轮廓',
    'front three-quarter soft': '正面四分之三柔光',
    'motivated practicals': '动机性实景光',
  };
  if (dna.lighting.direction) {
    parts.push(lightDirMap[dna.lighting.direction] || dna.lighting.direction);
  }
  if (dna.lighting.contrast >= 65) parts.push('硬戏剧光');
  else if (dna.lighting.contrast <= 35) parts.push('柔漫射光');

  if (dna.texture.filmGrain >= 20) {
    const stockMap: Record<string, string> = {
      'Kodak Vision3': '柯达 Vision3',
      'Kodak Vision3 500T': '柯达 Vision3 500T',
      'Fuji Pro 400H': '富士 Pro 400H',
      'Ilford HP5 push': '伊尔福 HP5 增感',
      'clean digital beauty': '干净数码美颜',
      'digital clean': '干净数码',
      'clean digital': '干净数码',
      'clean digital film': '干净数码胶片',
      干净数码: '干净数码',
      干净数码胶片: '干净数码胶片',
      'warm 35mm film': '暖调 35mm 胶片',
      'soft cinema grain': '柔和电影颗粒',
      'clean anime-inspired digital': '干净动漫数码',
      'clean premium digital': '干净高端数码',
      'documentary 16mm feel': '纪录 16mm 质感',
    };
    const stock = dna.texture.filmStock || '胶片';
    const mapped = stockMap[stock] || stock;
    parts.push(/颗粒$/.test(mapped) ? mapped : `${mapped}颗粒`);
  }
  if (dna.texture.sharpness >= 70) parts.push('锐利细节');
  else if (dna.texture.sharpness <= 35) parts.push('柔和有机锐度');

  const emotionMap: Record<string, string> = {
    'tense sophistication': '紧绷精致',
    'sweet clarity': '清甜通透',
    'tender nostalgia': '温柔怀旧',
    'electrified ambition': '带电野心',
    'paranoid dread': '偏执恐惧',
    'nostalgic rivalry': '怀旧张力',
    'poetic stillness': '诗意静谧',
    'bright fantasy romance': '明快浪漫',
    'polished desire': '精致欲望',
    'observant empathy': '观察式共情',
  };
  if (dna.mood.emotion && !isScenicAtmospherePhrase(dna.mood.emotion)) {
    parts.push(`${emotionMap[dna.mood.emotion] || dna.mood.emotion}情绪`);
  }

  parts.push('电影静帧、电影布光、写实影像');
  return scrubVisualStyleToLookAndColor(
    parts
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .join('，'),
  );
}

export function createEmptyDramaVisualDNA(
  partial?: Partial<DramaVisualDNA> & {
    camera?: Partial<DramaVisualDnaCamera> & { cameraMovement?: string };
    lighting?: Partial<DramaVisualDnaLighting> & { softness?: number };
    texture?: Partial<DramaVisualDnaTexture> & { lensFlare?: number };
  },
): DramaVisualDNA {
  const color = createEmptyDramaVisualDnaColor(partial?.color);
  const camera = createEmptyDramaVisualDnaCamera(partial?.camera);
  const lighting = createEmptyDramaVisualDnaLighting(partial?.lighting);
  const texture = createEmptyDramaVisualDnaTexture(partial?.texture);
  const mood = createEmptyDramaVisualDnaMood(partial?.mood);
  const base: DramaVisualDNA = {
    color,
    camera,
    lighting,
    texture,
    mood,
    presetId: String(partial?.presetId || '').trim() || 'unset',
    referenceImages: Array.isArray(partial?.referenceImages)
      ? partial!.referenceImages.map((r) => createEmptyDramaVisualDnaReferenceImage(r))
      : [],
    generatedPrompt: String(partial?.generatedPrompt || '').trim(),
    updated_at: Number(partial?.updated_at) || Date.now(),
  };
  if (!base.generatedPrompt) {
    base.generatedPrompt = buildCinematicPromptFromVisualDna(base);
  }
  return base;
}

/** 从风格预设生成冻结 Visual DNA（画风/色调铅字固定中文、精简） */
export function visualDnaFromStylePreset(preset: VisualStylePreset): DramaVisualDNA {
  const dnaCore = preset.visualDNA;
  const dna = createEmptyDramaVisualDNA({
    color: dnaCore.color,
    camera: dnaCore.camera,
    lighting: dnaCore.lighting,
    texture: dnaCore.texture,
    mood: dnaCore.mood,
    presetId: preset.id,
    generatedPrompt: '',
  });
  // 权威铅字只要「画风 + 色调」短句，不展开镜头/光效长文
  dna.generatedPrompt = scrubVisualStyleToLookAndColor(
    dnaCore.promptTemplateZh || dnaCore.promptTemplate || '',
  );
  dna.updated_at = Date.now();
  return dna;
}

export function createEmptyDramaProjectVisualBible(
  partial?: Partial<DramaProjectVisualBible>,
): DramaProjectVisualBible {
  const visualDNA = createEmptyDramaVisualDNA(partial?.visualDNA);
  return {
    presetId: String(partial?.presetId || visualDNA.presetId || '').trim() || 'unset',
    presetName: String(partial?.presetName || '').trim(),
    coverImage: String(partial?.coverImage || '').trim(),
    tags: Array.isArray(partial?.tags) ? partial!.tags.map(String) : [],
    description: String(partial?.description || '').trim(),
    visualDNA,
    stylePrompt: String(partial?.stylePrompt || visualDNA.generatedPrompt || '').trim(),
    recommendedPresetIds: Array.isArray(partial?.recommendedPresetIds)
      ? partial!.recommendedPresetIds.map(String)
      : [],
    selected_at: Number(partial?.selected_at) || 0,
  };
}

/**
 * 一致性规则：视频 Prompt 必须组合 Shot + Character + Scene + Visual Bible
 * 禁止单独生成镜头。
 */
export function composeDramaVisualLockedPrompt(opts: {
  shotPrompt: string;
  characterBible?: string;
  sceneBible?: string;
  visualBiblePrompt: string;
}): string {
  const shot = String(opts.shotPrompt || '').trim();
  const character = String(opts.characterBible || '').trim();
  const scene = String(opts.sceneBible || '').trim();
  const visual = String(opts.visualBiblePrompt || '').trim();
  if (!shot || !visual) {
    throw new Error('禁止单独生成镜头：必须同时提供 Shot Prompt 与 Visual Bible');
  }
  return [
    shot,
    character ? `Character Bible: ${character}` : '',
    scene ? `Scene Bible: ${scene}` : '',
    `Visual Bible: ${visual}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 视觉一致性评分占位（暂不接模型） */
export function createEmptyDramaVisualConsistencyScore(
  partial?: Partial<DramaVisualConsistencyScore>,
): DramaVisualConsistencyScore {
  return {
    color: clamp01to100(partial?.color, 0),
    lighting: clamp01to100(partial?.lighting, 0),
    camera: clamp01to100(partial?.camera, 0),
    filmTexture: clamp01to100(partial?.filmTexture, 0),
    overall: clamp01to100(partial?.overall, 0),
    notes: Array.isArray(partial?.notes) ? partial!.notes.map(String) : [],
    scored_at: Number(partial?.scored_at) || 0,
  };
}

// —— 兼容旧 API（旧 5 预设 → 映射到新风格库 id）——

/** @deprecated 使用 VISUAL_STYLE_PRESETS */
export type DramaVisualDnaPresetId = string;

/** @deprecated */
export function refreshDramaVisualDnaPrompt(dna: DramaVisualDNA): DramaVisualDNA {
  return {
    ...dna,
    generatedPrompt: buildCinematicPromptFromVisualDna(dna),
    updated_at: Date.now(),
  };
}

/** @deprecated 用户不再调参；保留供内部合并 */
export function patchDramaVisualDna(
  prev: DramaVisualDNA,
  patch: Partial<DramaVisualDNA>,
): DramaVisualDNA {
  const merged = createEmptyDramaVisualDNA({
    ...prev,
    ...patch,
    color: { ...prev.color, ...(patch.color || {}) },
    camera: { ...prev.camera, ...(patch.camera || {}) },
    lighting: { ...prev.lighting, ...(patch.lighting || {}) },
    texture: { ...prev.texture, ...(patch.texture || {}) },
    mood: { ...prev.mood, ...(patch.mood || {}) },
    referenceImages: patch.referenceImages ?? prev.referenceImages,
    presetId:
      patch.presetId !== undefined
        ? String(patch.presetId || 'unset').trim() || 'unset'
        : prev.presetId || 'unset',
  });
  return refreshDramaVisualDnaPrompt(merged);
}
