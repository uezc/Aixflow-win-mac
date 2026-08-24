/**
 * AI 短剧导演 — 影视级视觉风格库（10 预设）
 * 用户只选卡片；VisualDNA 参数隐藏在后台。
 */

import type { VisualStylePreset } from './types.js';
import {
  createEmptyDramaProjectVisualBible,
  visualDnaFromStylePreset,
} from './visualDna.js';
import type { DramaProjectVisualBible } from './types.js';

export type VisualStylePresetId =
  | 'film_cinematic'
  | 'korean_clear'
  | 'japanese_healing'
  | 'cyber_neon'
  | 'noir_suspense'
  | 'retro_hk'
  | 'guofeng_ink'
  | 'anime_comic'
  | 'luxury_chic'
  | 'realist_doc';

function dna(
  partial: VisualStylePreset['visualDNA'],
): VisualStylePreset['visualDNA'] {
  return partial;
}

/** 内置 10 个影视级视觉风格预设 */
export const VISUAL_STYLE_PRESETS: readonly VisualStylePreset[] = [
  {
    id: 'film_cinematic',
    name: '电影质感',
    nameEn: 'Cinematic Look',
    coverImage: '',
    previewVideo: '',
    description: '低饱和、强对比、暗部层次、电影镜头感',
    descriptionEn: 'Low saturation, strong contrast, layered shadows, cinematic framing.',
    tags: ['都市', '悬疑', '商战'],
    accent: '#8b9bb4',
    visualDNA: dna({
      color: { temperature: -6, saturation: 28, contrast: 78, blackLevel: 14 },
      camera: { lens: 35, depthOfField: 48, anamorphic: true, movement: 'motivated push-in' },
      lighting: { style: 'cinematic motivated key', direction: 'side key with soft fill', contrast: 72 },
      texture: { filmGrain: 42, filmStock: 'Kodak Vision3 500T', sharpness: 62 },
      mood: { emotion: 'tense sophistication', atmosphere: 'urban night drama' },
      promptTemplate:
        'cinematic film look, low saturation, strong contrast, deep shadow layers, anamorphic cinema framing, urban suspense grade',
      promptTemplateZh:
        '电影质感，低饱和，强对比，暗部层次，变形宽银幕镜头感，都市悬疑调色',
    }),
  },
  {
    id: 'korean_clear',
    name: '韩式清透',
    nameEn: 'Korean Clear',
    coverImage: '',
    previewVideo: '',
    description: '柔光、肤色通透、干净背景、清新色调',
    descriptionEn: 'Soft light, clear skin tones, clean backgrounds, fresh palette.',
    tags: ['甜宠', '校园', '爱情'],
    accent: '#7eb8d4',
    visualDNA: dna({
      color: { temperature: 8, saturation: 48, contrast: 42, blackLevel: 38 },
      camera: { lens: 50, depthOfField: 72, anamorphic: false, movement: 'gentle gimbal' },
      lighting: { style: 'beauty soft key', direction: 'front soft wrap', contrast: 32 },
      texture: { filmGrain: 10, filmStock: 'clean digital beauty', sharpness: 70 },
      mood: { emotion: 'sweet clarity', atmosphere: 'bright clean romance' },
      promptTemplate:
        'Korean drama clear look, soft beauty light, translucent skin tones, clean background, fresh airy grade',
      promptTemplateZh:
        '韩式清透，柔光美颜，肤色通透，干净背景，清新通透调色',
    }),
  },
  {
    id: 'japanese_healing',
    name: '日系治愈',
    nameEn: 'Japanese Healing',
    coverImage: '',
    previewVideo: '',
    description: '柔和自然光、低对比、温暖市井感',
    descriptionEn: 'Soft natural light, low contrast, warm everyday street mood.',
    tags: ['青春', '生活', '情感'],
    accent: '#e8b4a0',
    visualDNA: dna({
      color: { temperature: 28, saturation: 42, contrast: 36, blackLevel: 44 },
      camera: { lens: 85, depthOfField: 78, anamorphic: false, movement: 'gentle drift' },
      lighting: { style: 'soft window natural light', direction: 'front soft key', contrast: 26 },
      texture: { filmGrain: 22, filmStock: 'Fuji Pro 400H', sharpness: 45 },
      mood: { emotion: 'tender nostalgia', atmosphere: 'warm slice-of-life streets' },
      promptTemplate:
        'Japanese healing drama, soft natural light, low contrast, warm everyday city life, intimate close-ups',
      promptTemplateZh:
        '日系治愈，柔和自然光，低对比，温暖市井日常，亲密特写',
    }),
  },
  {
    id: 'cyber_neon',
    name: '赛博霓虹',
    nameEn: 'Cyber Neon',
    coverImage: '',
    previewVideo: '',
    description: '蓝紫霓虹、高反差、未来感光影',
    descriptionEn: 'Blue-purple neon, high contrast, futuristic light play.',
    tags: ['科幻', '逆袭', '都市异能'],
    accent: '#5b8def',
    visualDNA: dna({
      color: { temperature: -55, saturation: 72, contrast: 78, blackLevel: 18 },
      camera: { lens: 24, depthOfField: 48, anamorphic: true, movement: 'gliding steadicam' },
      lighting: { style: 'neon practicals', direction: 'multi-color rim', contrast: 74 },
      texture: { filmGrain: 16, filmStock: 'digital clean', sharpness: 82 },
      mood: { emotion: 'electrified ambition', atmosphere: 'rainy neon megacity' },
      promptTemplate:
        'cyberpunk neon, teal magenta and violet neon, high contrast, futuristic light reflections, rain-slick streets',
      promptTemplateZh:
        '赛博霓虹，青品红与蓝紫霓虹，高反差，未来感光影反射，雨夜湿街',
    }),
  },
  {
    id: 'noir_suspense',
    name: '暗黑悬疑',
    nameEn: 'Dark Suspense',
    coverImage: '',
    previewVideo: '',
    description: '冷黑灰、局部红光、压迫感构图',
    descriptionEn: 'Cold black-grey, isolated red accents, oppressive framing.',
    tags: ['犯罪', '复仇', '惊悚'],
    accent: '#8a8f98',
    visualDNA: dna({
      color: { temperature: -12, saturation: 12, contrast: 88, blackLevel: 8 },
      camera: { lens: 50, depthOfField: 55, anamorphic: false, movement: 'locked-off tension' },
      lighting: { style: 'noir hard light with red accent', direction: 'side slash + red practical', contrast: 90 },
      texture: { filmGrain: 55, filmStock: 'Ilford HP5 push', sharpness: 62 },
      mood: { emotion: 'paranoid dread', atmosphere: 'cold crime night' },
      promptTemplate:
        'dark suspense thriller, cold black-grey grade, isolated red light accents, oppressive framing, neo-noir',
      promptTemplateZh:
        '暗黑悬疑，冷黑灰调，局部红光点缀，压迫感构图，新黑色电影',
    }),
  },
  {
    id: 'retro_hk',
    name: '复古港风',
    nameEn: 'Retro Hong Kong',
    coverImage: '',
    previewVideo: '',
    description: '暖色胶片、颗粒感、经典港剧光影',
    descriptionEn: 'Warm film tones, grain, classic Hong Kong drama lighting.',
    tags: ['年代', '商战', '情仇'],
    accent: '#c4a574',
    visualDNA: dna({
      color: { temperature: 42, saturation: 52, contrast: 62, blackLevel: 22 },
      camera: { lens: 35, depthOfField: 50, anamorphic: false, movement: 'classic tracking' },
      lighting: { style: 'classic HK drama practicals', direction: 'warm key + tungsten fill', contrast: 58 },
      texture: { filmGrain: 58, filmStock: 'warm 35mm film', sharpness: 52 },
      mood: { emotion: 'nostalgic rivalry', atmosphere: '1980s Hong Kong night streets' },
      promptTemplate:
        'retro Hong Kong drama look, warm film stock, visible grain, classic Cantonese cinema lighting, period urban mood',
      promptTemplateZh:
        '复古港风，暖色胶片，可见颗粒，经典港剧光影，年代都市氛围',
    }),
  },
  {
    id: 'guofeng_ink',
    name: '国风写意',
    nameEn: 'Guofeng Ink',
    coverImage: '',
    previewVideo: '',
    description: '水墨感、淡雅色系、东方美学构图',
    descriptionEn: 'Ink-wash feel, elegant muted palette, Eastern aesthetic framing.',
    tags: ['古装', '玄幻', '历史'],
    accent: '#3d9b8f',
    visualDNA: dna({
      color: { temperature: -8, saturation: 38, contrast: 48, blackLevel: 34 },
      camera: { lens: 35, depthOfField: 58, anamorphic: false, movement: 'floating lyrical drift' },
      lighting: { style: 'misty soft dawn key', direction: 'backlit haze', contrast: 36 },
      texture: { filmGrain: 26, filmStock: 'soft cinema grain', sharpness: 46 },
      mood: { emotion: 'poetic stillness', atmosphere: 'ink-wash oriental landscape' },
      promptTemplate:
        'Chinese guofeng ink aesthetic, pale elegant palette, Eastern composition, poetic wuxia cinema mist',
      promptTemplateZh:
        '国风写意，淡雅色系，东方美学构图，诗意武侠薄雾影像',
    }),
  },
  {
    id: 'anime_comic',
    name: '二次元漫感',
    nameEn: 'Anime Comic',
    coverImage: '',
    previewVideo: '',
    description: '高饱和、人物精致、漫画分镜感',
    descriptionEn: 'High saturation, refined characters, comic-panel framing.',
    tags: ['甜宠', '奇幻', '青春'],
    accent: '#d4a5c9',
    visualDNA: dna({
      color: { temperature: 18, saturation: 78, contrast: 58, blackLevel: 36 },
      camera: { lens: 50, depthOfField: 68, anamorphic: false, movement: 'dynamic comic push' },
      lighting: { style: 'cel-shaded soft key', direction: 'front beauty + color rim', contrast: 52 },
      texture: { filmGrain: 8, filmStock: 'clean anime-inspired digital', sharpness: 80 },
      mood: { emotion: 'bright fantasy romance', atmosphere: 'stylized comic panels' },
      promptTemplate:
        'anime comic aesthetic, high saturation, refined character detail, manga panel framing, stylized youth fantasy',
      promptTemplateZh:
        '二次元漫感，高饱和，人物精致，漫画分镜感，风格化青春奇幻',
    }),
  },
  {
    id: 'luxury_chic',
    name: '轻奢高级',
    nameEn: 'Luxury Chic',
    coverImage: '',
    previewVideo: '',
    description: '金黑 / 米白配色、空间质感、柔光高调',
    descriptionEn: 'Gold-black / ivory palette, spatial texture, soft high-key light.',
    tags: ['总裁', '豪门', '都市'],
    accent: '#d4a017',
    visualDNA: dna({
      color: { temperature: 16, saturation: 42, contrast: 55, blackLevel: 30 },
      camera: { lens: 50, depthOfField: 65, anamorphic: false, movement: 'smooth luxury glide' },
      lighting: { style: 'soft high-key beauty', direction: 'front three-quarter soft', contrast: 42 },
      texture: { filmGrain: 12, filmStock: 'clean premium digital', sharpness: 74 },
      mood: { emotion: 'polished desire', atmosphere: 'gold-black penthouse elegance' },
      promptTemplate:
        'luxury chic short drama, gold-black and ivory palette, premium interior texture, soft high-key lighting, CEO romance gloss',
      promptTemplateZh:
        '轻奢高级，金黑与米白配色，空间质感，柔光高调，总裁豪门光泽',
    }),
  },
  {
    id: 'realist_doc',
    name: '真实纪实',
    nameEn: 'Realist Documentary',
    coverImage: '',
    previewVideo: '',
    description: '自然光线、手持感、生活化场景',
    descriptionEn: 'Natural light, handheld feel, everyday lived-in scenes.',
    tags: ['社会', '现实', '职业剧'],
    accent: '#7a8a7a',
    visualDNA: dna({
      color: { temperature: 2, saturation: 38, contrast: 48, blackLevel: 30 },
      camera: { lens: 35, depthOfField: 42, anamorphic: false, movement: 'observational handheld' },
      lighting: { style: 'available natural light', direction: 'motivated practicals', contrast: 44 },
      texture: { filmGrain: 36, filmStock: 'documentary 16mm feel', sharpness: 58 },
      mood: { emotion: 'observant empathy', atmosphere: 'raw real-world workplaces' },
      promptTemplate:
        'realist documentary look, natural light, subtle handheld, lived-in social drama scenes, honest grade',
      promptTemplateZh:
        '真实纪实，自然光线，轻微手持感，生活化社会剧场景，诚实调色',
    }),
  },
] as const;

export function getVisualStylePreset(id: string | undefined | null): VisualStylePreset | null {
  const key = String(id || '').trim();
  if (!key) return null;
  return VISUAL_STYLE_PRESETS.find((p) => p.id === key) || null;
}

/** 旧预设 id → 新库映射（含更早 5 预设与上一版 10 预设） */
const LEGACY_PRESET_MAP: Record<string, VisualStylePresetId> = {
  dark_western: 'film_cinematic',
  western_revenge: 'film_cinematic',
  film_noir: 'noir_suspense',
  noir_thriller: 'noir_suspense',
  sci_fi_neon: 'cyber_neon',
  cyber_future: 'cyber_neon',
  epic_costume: 'guofeng_ink',
  fantasy_china: 'guofeng_ink',
  jp_healing: 'japanese_healing',
  japanese_drama: 'japanese_healing',
  horror_sci_fi: 'noir_suspense',
  commercial_drama: 'luxury_chic',
  documentary: 'realist_doc',
  dream_fantasy: 'anime_comic',
  epic_cinema: 'film_cinematic',
};

export function resolveVisualStylePresetId(raw: string | undefined | null): string {
  const key = String(raw || '').trim();
  if (!key || key === 'custom' || key === 'unset') return '';
  if (getVisualStylePreset(key)) return key;
  return LEGACY_PRESET_MAP[key] || '';
}

/** 应用风格卡片 → 冻结 Project Visual Bible */
export function applyVisualStylePreset(
  presetId: string,
  prev?: Partial<DramaProjectVisualBible>,
): DramaProjectVisualBible {
  const resolved = resolveVisualStylePresetId(presetId) || String(presetId || '').trim();
  const preset = getVisualStylePreset(resolved);
  if (!preset) {
    return createEmptyDramaProjectVisualBible({
      ...prev,
      presetId: 'unset',
      selected_at: 0,
    });
  }
  const visualDNA = visualDnaFromStylePreset(preset);
  // 保留用户上传的参考图
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

/**
 * AI 推荐视觉方案占位（暂不接模型）
 * 根据剧本关键词做简单启发式，固定返回 3 个预设 id。
 */
export function recommendVisualStylePresets(opts?: {
  scriptText?: string;
  keywords?: string[];
}): VisualStylePreset[] {
  const blob = `${opts?.scriptText || ''} ${(opts?.keywords || []).join(' ')}`.toLowerCase();
  const scored = VISUAL_STYLE_PRESETS.map((p) => {
    let score = 0;
    for (const tag of p.tags) {
      if (blob.includes(tag.toLowerCase()) || blob.includes(p.nameEn.toLowerCase())) score += 3;
    }
    if (/都市|悬疑|商战|电影/.test(blob) && p.id === 'film_cinematic') score += 5;
    if (/甜宠|校园|爱情|韩式|清透/.test(blob) && p.id === 'korean_clear') score += 5;
    if (/治愈|日系|青春|生活|情感/.test(blob) && p.id === 'japanese_healing') score += 5;
    if (/科幻|霓虹|逆袭|异能|cyber/.test(blob) && p.id === 'cyber_neon') score += 5;
    if (/悬疑|犯罪|复仇|惊悚|noir/.test(blob) && p.id === 'noir_suspense') score += 5;
    if (/港风|年代|情仇|港剧/.test(blob) && p.id === 'retro_hk') score += 5;
    if (/古装|玄幻|历史|国风|仙侠|水墨/.test(blob) && p.id === 'guofeng_ink') score += 5;
    if (/二次元|漫画|奇幻|漫感|anime/.test(blob) && p.id === 'anime_comic') score += 5;
    if (/总裁|豪门|轻奢|霸总/.test(blob) && p.id === 'luxury_chic') score += 5;
    if (/纪录|真实|社会|职业|现实/.test(blob) && p.id === 'realist_doc') score += 5;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((x) => x.score > 0).slice(0, 3).map((x) => x.p);
  if (top.length >= 3) return top;
  const fallbackIds: VisualStylePresetId[] = [
    'film_cinematic',
    'luxury_chic',
    'japanese_healing',
  ];
  const out = [...top];
  for (const id of fallbackIds) {
    if (out.length >= 3) break;
    const p = getVisualStylePreset(id);
    if (p && !out.some((x) => x.id === p.id)) out.push(p);
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

export function applyDramaVisualDnaPreset(presetId: string, prev?: { referenceImages?: DramaProjectVisualBible['visualDNA']['referenceImages'] }) {
  const bible = applyVisualStylePreset(presetId, {
    visualDNA: prev?.referenceImages
      ? ({ referenceImages: prev.referenceImages } as any)
      : undefined,
  });
  return bible.visualDNA;
}
