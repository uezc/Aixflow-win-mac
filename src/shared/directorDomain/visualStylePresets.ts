/**
 * AI 短剧导演 — 视觉风格：画风（媒介）+ 色调
 * 用户只选两层；合成 Look / Grade 铅字写入 Project Visual Bible。
 * 禁止题材/地点/场景渗入 H3。
 */

import type { VisualStylePreset } from './types.js';
import {
  createEmptyDramaProjectVisualBible,
  visualDnaFromStylePreset,
} from './visualDna.js';
import type { DramaProjectVisualBible } from './types.js';

export type VisualLookId =
  | 'live'
  | 'cg'
  | 'cartoon'
  | 'anime'
  | 'ink'
  | 'oil'
  | 'clay'
  | 'sketch'
  | 'pixel'
  | 'illustration';
export type VisualGradeId =
  | 'dark_cyan'
  | 'cold_blue'
  | 'warm_amber'
  | 'muted_gray'
  | 'noir'
  | 'soft_pastel'
  | 'golden_hour'
  | 'neon_night'
  | 'earthy'
  | 'clean_white';

export type VisualStylePresetId = `${VisualLookId}__${VisualGradeId}`;

export type VisualLookOption = {
  id: VisualLookId;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  /** H3 Look 铅字 */
  lookEn: string;
  lookZh: string;
  accent: string;
};

export type VisualGradeOption = {
  id: VisualGradeId;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  /** H3 Grade 铅字 */
  gradeEn: string;
  gradeZh: string;
  accent: string;
  color: VisualStylePreset['visualDNA']['color'];
};

/** 画风：10 选 1（与色调同卡尺寸布局） */
export const VISUAL_LOOK_OPTIONS: readonly VisualLookOption[] = [
  {
    id: 'live',
    name: '真实风格',
    nameEn: 'Live-action',
    description: '真人实拍',
    descriptionEn: 'Photoreal',
    lookEn: 'photoreal live-action',
    lookZh: '真实风格',
    accent: '#7a8a7a',
  },
  {
    id: 'cg',
    name: 'CG风格',
    nameEn: 'CG',
    description: '三维渲染',
    descriptionEn: '3D CGI',
    lookEn: '3D CGI render',
    lookZh: 'CG风格',
    accent: '#5b8def',
  },
  {
    id: 'cartoon',
    name: '卡通风格',
    nameEn: 'Cartoon',
    description: '卡通造型',
    descriptionEn: 'Cartoon',
    lookEn: 'stylized cartoon',
    lookZh: '卡通风格',
    accent: '#e8b4a0',
  },
  {
    id: 'anime',
    name: '动漫风格',
    nameEn: 'Anime',
    description: '日式赛璐珞',
    descriptionEn: 'Anime cel',
    lookEn: 'Japanese anime',
    lookZh: '动漫风格',
    accent: '#d4a5c9',
  },
  {
    id: 'ink',
    name: '水墨风格',
    nameEn: 'Ink Wash',
    description: '水墨笔触',
    descriptionEn: 'Ink wash',
    lookEn: 'ink-wash painting',
    lookZh: '水墨风格',
    accent: '#6b7c8a',
  },
  {
    id: 'oil',
    name: '油画风格',
    nameEn: 'Oil Paint',
    description: '厚涂油画',
    descriptionEn: 'Oil paint',
    lookEn: 'oil painting',
    lookZh: '油画风格',
    accent: '#b8956c',
  },
  {
    id: 'clay',
    name: '粘土风格',
    nameEn: 'Claymation',
    description: '定格粘土',
    descriptionEn: 'Claymation',
    lookEn: 'claymation stop-motion',
    lookZh: '粘土风格',
    accent: '#c47a5a',
  },
  {
    id: 'sketch',
    name: '素描风格',
    nameEn: 'Sketch',
    description: '铅笔线稿',
    descriptionEn: 'Pencil sketch',
    lookEn: 'pencil sketch line art',
    lookZh: '素描风格',
    accent: '#9aa3ad',
  },
  {
    id: 'pixel',
    name: '像素风格',
    nameEn: 'Pixel',
    description: '像素块面',
    descriptionEn: 'Pixel art',
    lookEn: 'pixel art',
    lookZh: '像素风格',
    accent: '#6ecf8e',
  },
  {
    id: 'illustration',
    name: '插画风格',
    nameEn: 'Illustration',
    description: '平面插画',
    descriptionEn: 'Illustration',
    lookEn: 'flat illustration',
    lookZh: '插画风格',
    accent: '#8b7ec8',
  },
] as const;

/** 色调：单选（名称即精简铅字） */
export const VISUAL_GRADE_OPTIONS: readonly VisualGradeOption[] = [
  {
    id: 'dark_cyan',
    name: '暗青色调',
    nameEn: 'Dark Cyan',
    description: '冷青',
    descriptionEn: 'Cool teal',
    gradeEn: 'dark cyan grade',
    gradeZh: '暗青色调',
    accent: '#3d9b8f',
    color: { temperature: -28, saturation: 42, contrast: 68, blackLevel: 16 },
  },
  {
    id: 'cold_blue',
    name: '冷蓝色调',
    nameEn: 'Cold Blue',
    description: '冷蓝',
    descriptionEn: 'Cold blue',
    gradeEn: 'cold blue grade',
    gradeZh: '冷蓝色调',
    accent: '#7eb8d4',
    color: { temperature: -42, saturation: 38, contrast: 62, blackLevel: 20 },
  },
  {
    id: 'warm_amber',
    name: '暖琥珀色调',
    nameEn: 'Warm Amber',
    description: '琥珀暖',
    descriptionEn: 'Warm amber',
    gradeEn: 'warm amber grade',
    gradeZh: '暖琥珀色调',
    accent: '#c4a574',
    color: { temperature: 36, saturation: 48, contrast: 52, blackLevel: 28 },
  },
  {
    id: 'muted_gray',
    name: '灰雾色调',
    nameEn: 'Muted Gray',
    description: '低饱和',
    descriptionEn: 'Muted',
    gradeEn: 'muted gray grade',
    gradeZh: '灰雾色调',
    accent: '#8b9bb4',
    color: { temperature: -6, saturation: 22, contrast: 58, blackLevel: 22 },
  },
  {
    id: 'noir',
    name: '高反差黑白',
    nameEn: 'Noir Mono',
    description: '黑白',
    descriptionEn: 'Mono',
    gradeEn: 'high-contrast monochrome',
    gradeZh: '高反差黑白',
    accent: '#8a8f98',
    color: { temperature: 0, saturation: 4, contrast: 88, blackLevel: 8 },
  },
  {
    id: 'soft_pastel',
    name: '柔和粉彩',
    nameEn: 'Soft Pastel',
    description: '粉彩',
    descriptionEn: 'Pastel',
    gradeEn: 'soft pastel grade',
    gradeZh: '柔和粉彩',
    accent: '#d4a5c9',
    color: { temperature: 14, saturation: 52, contrast: 38, blackLevel: 40 },
  },
  {
    id: 'golden_hour',
    name: '金色时段',
    nameEn: 'Golden Hour',
    description: '金暖光',
    descriptionEn: 'Golden hour',
    gradeEn: 'golden-hour grade',
    gradeZh: '金色时段',
    accent: '#d4a017',
    color: { temperature: 48, saturation: 55, contrast: 58, blackLevel: 24 },
  },
  {
    id: 'neon_night',
    name: '霓虹夜色',
    nameEn: 'Neon Night',
    description: '霓虹',
    descriptionEn: 'Neon',
    gradeEn: 'neon night grade',
    gradeZh: '霓虹夜色',
    accent: '#5b8def',
    color: { temperature: -55, saturation: 72, contrast: 78, blackLevel: 14 },
  },
  {
    id: 'earthy',
    name: '泥土暖褐',
    nameEn: 'Earthy',
    description: '暖褐',
    descriptionEn: 'Earthy',
    gradeEn: 'earthy brown grade',
    gradeZh: '泥土暖褐',
    accent: '#a67c52',
    color: { temperature: 22, saturation: 40, contrast: 50, blackLevel: 26 },
  },
  {
    id: 'clean_white',
    name: '干净浅亮',
    nameEn: 'Clean Bright',
    description: '浅亮',
    descriptionEn: 'Bright',
    gradeEn: 'clean bright grade',
    gradeZh: '干净浅亮',
    accent: '#c8d0d8',
    color: { temperature: 4, saturation: 32, contrast: 42, blackLevel: 48 },
  },
] as const;

export function getVisualLookOption(id: string | undefined | null): VisualLookOption | null {
  const key = String(id || '').trim();
  return VISUAL_LOOK_OPTIONS.find((p) => p.id === key) || null;
}

export function getVisualGradeOption(id: string | undefined | null): VisualGradeOption | null {
  const key = String(id || '').trim();
  return VISUAL_GRADE_OPTIONS.find((p) => p.id === key) || null;
}

export function composeVisualStylePresetId(lookId: string, gradeId: string): VisualStylePresetId | '' {
  const look = getVisualLookOption(lookId);
  const grade = getVisualGradeOption(gradeId);
  if (!look || !grade) return '';
  return `${look.id}__${grade.id}` as VisualStylePresetId;
}

export function parseVisualStyleLookGrade(raw: string | undefined | null): {
  lookId: VisualLookId | '';
  gradeId: VisualGradeId | '';
} {
  const key = String(raw || '').trim();
  if (!key) return { lookId: '', gradeId: '' };
  const m = key.match(/^([a-z_]+)__([a-z_]+)$/i);
  if (m) {
    const look = getVisualLookOption(m[1]);
    const grade = getVisualGradeOption(m[2]);
    return {
      lookId: (look?.id || '') as VisualLookId | '',
      gradeId: (grade?.id || '') as VisualGradeId | '',
    };
  }
  // 兼容：仅画风 id
  const lookOnly = getVisualLookOption(key);
  if (lookOnly) return { lookId: lookOnly.id, gradeId: '' };
  return { lookId: '', gradeId: '' };
}

function dnaForLookGrade(
  look: VisualLookOption,
  grade: VisualGradeOption,
): VisualStylePreset['visualDNA'] {
  // 权威铅字用中文；promptTemplate 保留英文对照供调试/旧路径
  const promptTemplateZh = `${look.lookZh}，${grade.gradeZh}`;
  const promptTemplate = promptTemplateZh;
  const cameraByLook: Record<VisualLookId, VisualStylePreset['visualDNA']['camera']> = {
    live: { lens: 35, depthOfField: 48, anamorphic: false, movement: '轻微动机运镜' },
    cg: { lens: 35, depthOfField: 55, anamorphic: false, movement: '平滑滑移' },
    cartoon: { lens: 50, depthOfField: 62, anamorphic: false, movement: '轻推镜头' },
    anime: { lens: 50, depthOfField: 68, anamorphic: false, movement: '动感漫画推镜' },
    ink: { lens: 50, depthOfField: 45, anamorphic: false, movement: '缓慢横移' },
    oil: { lens: 50, depthOfField: 52, anamorphic: false, movement: '缓慢推镜' },
    clay: { lens: 35, depthOfField: 58, anamorphic: false, movement: '定格步进' },
    sketch: { lens: 50, depthOfField: 40, anamorphic: false, movement: '轻推镜头' },
    pixel: { lens: 35, depthOfField: 30, anamorphic: false, movement: '方块步进' },
    illustration: { lens: 50, depthOfField: 55, anamorphic: false, movement: '平滑滑移' },
  };
  const grainByLook: Record<VisualLookId, number> = {
    live: 28,
    cg: 8,
    cartoon: 6,
    anime: 6,
    ink: 12,
    oil: 18,
    clay: 10,
    sketch: 8,
    pixel: 4,
    illustration: 6,
  };
  return {
    color: { ...grade.color },
    camera: cameraByLook[look.id],
    lighting: {
      style: '动机主光',
      direction: '侧主光+柔辅光',
      contrast: grade.color.contrast,
    },
    texture: {
      filmGrain: grainByLook[look.id],
      filmStock: look.id === 'live' ? '干净数码胶片' : '干净数码',
      sharpness: look.id === 'anime' || look.id === 'cg' || look.id === 'pixel' ? 78 : 62,
    },
    mood: { emotion: '', atmosphere: '' },
    promptTemplate,
    promptTemplateZh,
  };
}

export function buildVisualStylePreset(lookId: string, gradeId: string): VisualStylePreset | null {
  const look = getVisualLookOption(lookId);
  const grade = getVisualGradeOption(gradeId);
  if (!look || !grade) return null;
  const id = composeVisualStylePresetId(look.id, grade.id);
  if (!id) return null;
  return {
    id,
    name: `${look.name} · ${grade.name}`,
    nameEn: `${look.nameEn} · ${grade.nameEn}`,
    coverImage: '',
    previewVideo: '',
    description: `${look.description}；${grade.description}`,
    descriptionEn: `${look.descriptionEn}; ${grade.descriptionEn}`,
    tags: [look.name, grade.name],
    accent: grade.accent || look.accent,
    visualDNA: dnaForLookGrade(look, grade),
  };
}

/** 画风×色调笛卡尔积（供 resolve / 兼容旧遍历） */
export const VISUAL_STYLE_PRESETS: readonly VisualStylePreset[] = VISUAL_LOOK_OPTIONS.flatMap((look) =>
  VISUAL_GRADE_OPTIONS.map((grade) => buildVisualStylePreset(look.id, grade.id)!),
);

export function getVisualStylePreset(id: string | undefined | null): VisualStylePreset | null {
  const key = String(id || '').trim();
  if (!key) return null;
  const parsed = parseVisualStyleLookGrade(key);
  if (parsed.lookId && parsed.gradeId) {
    return buildVisualStylePreset(parsed.lookId, parsed.gradeId);
  }
  return VISUAL_STYLE_PRESETS.find((p) => p.id === key) || null;
}

/** 旧 10 风格卡 → 新 画风+色调 */
const LEGACY_PRESET_MAP: Record<string, VisualStylePresetId> = {
  film_cinematic: 'live__muted_gray',
  korean_clear: 'live__soft_pastel',
  japanese_healing: 'live__warm_amber',
  cyber_neon: 'cg__neon_night',
  noir_suspense: 'live__noir',
  retro_hk: 'live__warm_amber',
  guofeng_ink: 'ink__dark_cyan',
  anime_comic: 'anime__soft_pastel',
  luxury_chic: 'live__golden_hour',
  realist_doc: 'live__earthy',
  dark_western: 'live__muted_gray',
  western_revenge: 'live__muted_gray',
  film_noir: 'live__noir',
  noir_thriller: 'live__noir',
  sci_fi_neon: 'cg__neon_night',
  cyber_future: 'cg__neon_night',
  epic_costume: 'ink__dark_cyan',
  fantasy_china: 'ink__dark_cyan',
  jp_healing: 'live__warm_amber',
  japanese_drama: 'live__warm_amber',
  horror_sci_fi: 'live__noir',
  commercial_drama: 'live__golden_hour',
  documentary: 'live__earthy',
  dream_fantasy: 'illustration__soft_pastel',
  epic_cinema: 'live__muted_gray',
};

export function resolveVisualStylePresetId(raw: string | undefined | null): string {
  const key = String(raw || '').trim();
  if (!key || key === 'custom' || key === 'unset') return '';
  if (getVisualStylePreset(key)) return getVisualStylePreset(key)!.id;
  return LEGACY_PRESET_MAP[key] || '';
}

/** 应用画风 + 色调 → 冻结 Project Visual Bible */
export function applyVisualStyleLookGrade(
  lookId: string,
  gradeId: string,
  prev?: Partial<DramaProjectVisualBible>,
): DramaProjectVisualBible {
  const preset = buildVisualStylePreset(lookId, gradeId);
  if (!preset) {
    return createEmptyDramaProjectVisualBible({
      ...prev,
      presetId: 'unset',
      selected_at: 0,
    });
  }
  const visualDNA = visualDnaFromStylePreset(preset);
  if (prev?.visualDNA?.referenceImages?.length) {
    visualDNA.referenceImages = prev.visualDNA.referenceImages;
  }
  return createEmptyDramaProjectVisualBible({
    ...prev,
    presetId: preset.id,
    presetName: preset.name,
    coverImage: preset.coverImage,
    tags: [...preset.tags],
    description: preset.description,
    visualDNA,
    stylePrompt: visualDNA.generatedPrompt,
    recommendedPresetIds: prev?.recommendedPresetIds || [],
    selected_at: Date.now(),
  });
}

/** 应用风格卡片 → 冻结 Project Visual Bible（兼容复合 id / 旧 id） */
export function applyVisualStylePreset(
  presetId: string,
  prev?: Partial<DramaProjectVisualBible>,
): DramaProjectVisualBible {
  const resolved = resolveVisualStylePresetId(presetId) || String(presetId || '').trim();
  const parsed = parseVisualStyleLookGrade(resolved);
  if (parsed.lookId && parsed.gradeId) {
    return applyVisualStyleLookGrade(parsed.lookId, parsed.gradeId, prev);
  }
  return createEmptyDramaProjectVisualBible({
    ...prev,
    presetId: 'unset',
    selected_at: 0,
  });
}

/**
 * AI 推荐占位：返回 3 个 画风+色调 组合
 */
export function recommendVisualStylePresets(opts?: {
  scriptText?: string;
  keywords?: string[];
}): VisualStylePreset[] {
  const blob = `${opts?.scriptText || ''} ${(opts?.keywords || []).join(' ')}`.toLowerCase();
  let look: VisualLookId = 'live';
  if (/二次元|动漫|anime|漫画/.test(blob)) look = 'anime';
  else if (/卡通|cartoon/.test(blob)) look = 'cartoon';
  else if (/cg|三维|3d|渲染/.test(blob)) look = 'cg';

  const gradePool: VisualGradeId[] = ['dark_cyan', 'muted_gray', 'warm_amber'];
  if (/霓虹|科幻|夜|neon/.test(blob)) gradePool.unshift('neon_night');
  if (/黑白|悬疑|noir|犯罪/.test(blob)) gradePool.unshift('noir');
  if (/甜|粉|治愈|pastel/.test(blob)) gradePool.unshift('soft_pastel');
  if (/金|暖|日落|golden/.test(blob)) gradePool.unshift('golden_hour');

  const seen = new Set<string>();
  const out: VisualStylePreset[] = [];
  for (const g of gradePool) {
    const p = buildVisualStylePreset(look, g);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
    if (out.length >= 3) break;
  }
  for (const g of VISUAL_GRADE_OPTIONS) {
    if (out.length >= 3) break;
    const p = buildVisualStylePreset(look, g.id);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out.slice(0, 3);
}

/** 兼容旧导出名 */
export const DRAMA_VISUAL_DNA_PRESETS = VISUAL_STYLE_PRESETS.map((p) => ({
  id: p.id,
  labelZh: p.name,
  labelEn: p.nameEn,
  blurbZh: p.tags.join(' · '),
  blurbEn: p.tags.join(' · '),
  accent: p.accent,
  dna: {
    color: p.visualDNA.color,
    camera: p.visualDNA.camera,
    lighting: {
      style: p.visualDNA.lighting.style,
      direction: p.visualDNA.lighting.direction,
      softness: 100 - p.visualDNA.lighting.contrast,
    },
    texture: {
      filmGrain: p.visualDNA.texture.filmGrain,
      filmStock: p.visualDNA.texture.filmStock,
      lensFlare: 10,
    },
    mood: p.visualDNA.mood,
  },
}));

export function getDramaVisualDnaPreset(id: string | undefined | null) {
  const p = getVisualStylePreset(resolveVisualStylePresetId(id) || String(id || ''));
  if (!p) return null;
  return DRAMA_VISUAL_DNA_PRESETS.find((x) => x.id === p.id) || null;
}

export function applyDramaVisualDnaPreset(
  presetId: string,
  prev?: { referenceImages?: DramaProjectVisualBible['visualDNA']['referenceImages'] },
) {
  const bible = applyVisualStylePreset(presetId, {
    visualDNA: prev?.referenceImages
      ? ({ referenceImages: prev.referenceImages } as any)
      : undefined,
  });
  return bible.visualDNA;
}
