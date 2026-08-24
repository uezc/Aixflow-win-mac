/** 导演流水线全篇风格预设：贯穿镜头光色、资产图、最终提示词；风格参考图只锁光色，画风固定真人写实 */

export type DirectorStylePresetId =
  | 'custom'
  | 'street_crew'
  | 'urban_car'
  | 'rainy_bus'
  | 'stage_mic'
  | 'mansion_gold'
  | 'beach_sunset'
  | 'guitar_studio'
  | 'city_blonde'
  | 'leather_cool'
  | 'rain_action'
  | 'meadow_breeze'
  | 'industrial_mood'
  | 'pink_sweet'
  | 'coastal_drive'
  | 'vintage_sofa'
  | 'window_gaze'
  | 'neon_night'
  | 'cyber_neon'
  | 'lake_guitar'
  | 'desert_road'
  | 'neon_corridor'
  | 'sea_window'
  | 'stage_rim'
  | 'rain_night'
  | 'jar_glow'
  | 'graffiti_tunnel'
  | 'city_railing'
  | 'xianxia_snow'
  /** @deprecated 旧预设 id，加载时映射到新预设 */
  | 'jp_anime'
  | 'cn_guofeng'
  | 'cg_render'
  | 'cinematic'
  | 'photoreal'
  | 'watercolor'
  | 'cyberpunk'
  | 'candy_paradise'
  | 'dark_flame'
  | 'american_comic'
  | 'mist_realm'
  | 'night_mirage'
  | 'lazy_noon'
  | 'afternoon_time'
  | 'holiday_film'
  | 'flashlight'
  | 'street_dance'
  | 'retro_nostalgic'
  | 'hot_blood'
  | 'urban_night'
  | 'minimal_luxe'
  | 'film_narrative'
  | 'lively_sweet'
  | 'cyber_stage'
  | 'dark_emotion'
  | 'fresh_natural';

export type DirectorStylePreset = {
  id: DirectorStylePresetId;
  labelZh: string;
  labelEn: string;
  /** 写入 globalStyle / 提示词的完整风格描述；custom 为空 */
  prompt: string;
  /**
   * public/director-style-presets 下文件名；无图则为空（如 custom）
   * 渲染侧用 directorStylePresetImageUrl() 解析
   */
  imageFile?: string;
};

/** 旧预设 / 标签 → 当前系统预设（尽量近义） */
const LEGACY_STYLE_PRESET_MAP: Record<string, DirectorStylePresetId> = {
  jp_anime: 'pink_sweet',
  cn_guofeng: 'xianxia_snow',
  cg_render: 'neon_night',
  cinematic: 'industrial_mood',
  photoreal: 'meadow_breeze',
  watercolor: 'beach_sunset',
  cyberpunk: 'cyber_neon',
  candy_paradise: 'pink_sweet',
  dark_flame: 'stage_mic',
  american_comic: 'leather_cool',
  mist_realm: 'rainy_bus',
  night_mirage: 'neon_night',
  lazy_noon: 'guitar_studio',
  afternoon_time: 'beach_sunset',
  holiday_film: 'urban_car',
  flashlight: 'stage_mic',
  street_dance: 'street_crew',
  retro_nostalgic: 'rainy_bus',
  hot_blood: 'rain_action',
  urban_night: 'urban_car',
  minimal_luxe: 'vintage_sofa',
  film_narrative: 'coastal_drive',
  lively_sweet: 'pink_sweet',
  cyber_stage: 'cyber_neon',
  dark_emotion: 'industrial_mood',
  fresh_natural: 'meadow_breeze',
};

export const DIRECTOR_STYLE_PRESETS: readonly DirectorStylePreset[] = [
  {
    id: 'street_crew',
    labelZh: '街舞潮流风',
    labelEn: 'Street Crew',
    imageFile: 'style-01-street-crew.png',
    prompt:
      '街舞潮流视觉风格：街头舞团齐舞姿态，工装潮牌与棒球帽，高密度城市场景，冷调电影感与青春能量，统一街舞潮流氛围',
  },
  {
    id: 'urban_car',
    labelZh: '都市车窗风',
    labelEn: 'Urban Night Car',
    imageFile: 'style-02-urban-car.png',
    prompt:
      '都市夜景视觉风格：夜间车窗人像，霓虹与车流散景，冷暖对比与浅景深，情绪化都市叙事，统一都市夜景氛围',
  },
  {
    id: 'rainy_bus',
    labelZh: '复古怀旧风',
    labelEn: 'Rainy Bus',
    imageFile: 'style-03-rainy-bus.png',
    prompt:
      '复古怀旧视觉风格：雨窗巴士人像，胶片颗粒与低饱和冷调，耳机与窗外雨滴，文艺忧郁叙事，统一复古怀旧氛围',
  },
  {
    id: 'stage_mic',
    labelZh: '舞台燃情风',
    labelEn: 'Stage Spotlight',
    imageFile: 'style-04-stage-mic.png',
    prompt:
      '舞台燃情视觉风格：演唱姿态与手持麦克风，追光轮廓与烟雾体积光，暖金暗调现场感，统一舞台燃情氛围',
  },
  {
    id: 'mansion_gold',
    labelZh: '轻奢日光风',
    labelEn: 'Golden Mansion',
    imageFile: 'style-05-mansion-gold.png',
    prompt:
      '轻奢日光视觉风格：金色小时光人像，庄园建筑与绿篱背景，精致配饰与柔和侧光，统一轻奢日光氛围',
  },
  {
    id: 'beach_sunset',
    labelZh: '海边柔光风',
    labelEn: 'Beach Sunset',
    imageFile: 'style-06-beach-sunset.png',
    prompt:
      '海边柔光视觉风格：落日海滩回眸人像，暖橙粉霞与海浪虚化，逆光发丝轮廓，统一海边柔光氛围',
  },
  {
    id: 'guitar_studio',
    labelZh: '独立音乐风',
    labelEn: 'Indie Studio',
    imageFile: 'style-07-guitar-studio.png',
    prompt:
      '独立音乐视觉风格：暖灯吉他演奏人像，室内乐器与桌灯层次，低照度琥珀色调，统一独立音乐氛围',
  },
  {
    id: 'city_blonde',
    labelZh: '夜色时尚风',
    labelEn: 'Night Fashion',
    imageFile: 'style-08-city-blonde.png',
    prompt:
      '夜色时尚视觉风格：都市夜街正面人像，金属质感外套与霓虹散景，冷暖高对比电影调色，统一夜色时尚氛围',
  },
  {
    id: 'leather_cool',
    labelZh: '车内酷感风',
    labelEn: 'Leather Cool',
    imageFile: 'style-09-leather-cool.png',
    prompt:
      '街头酷感视觉风格：墨镜皮夹克车内人像，红色座椅与夜景散景，冷峻潮流姿态，统一街头酷感氛围',
  },
  {
    id: 'rain_action',
    labelZh: '热血燃炸风',
    labelEn: 'Rain Action',
    imageFile: 'style-10-rain-action.png',
    prompt:
      '热血燃炸视觉风格：雨夜高能动作人像，肌肉张力与坚定神情，城市夜景散景与雨丝，高对比燃情光影，统一热血燃炸氛围',
  },
  {
    id: 'meadow_breeze',
    labelZh: '清新自然风',
    labelEn: 'Meadow Breeze',
    imageFile: 'style-11-meadow.png',
    prompt:
      '清新自然视觉风格：户外草地山丘与蓝天白云，自然光人像回眸，通透空气感与柔和对比，统一清新自然氛围',
  },
  {
    id: 'industrial_mood',
    labelZh: '暗黑情绪风',
    labelEn: 'Industrial Mood',
    imageFile: 'style-12-industrial.png',
    prompt:
      '暗黑情绪视觉风格：冷灰工业空间回眸人像，低饱和高对比，忧郁沉静光影，统一暗黑情绪氛围',
  },
  {
    id: 'pink_sweet',
    labelZh: '活泼甜美风',
    labelEn: 'Pink Sweet',
    imageFile: 'style-13-pink-sweet.png',
    prompt:
      '活泼甜美视觉风格：高饱和粉色梦幻棚拍，少女笑容与双马尾，明亮柔光与甜美道具，统一活泼甜美氛围',
  },
  {
    id: 'coastal_drive',
    labelZh: '海岸车窗风',
    labelEn: 'Coastal Drive',
    imageFile: 'style-14-coastal-drive.png',
    prompt:
      '海岸车窗视觉风格：车窗框中框人像，海岸公路与山海远景，低饱和电影调色与浅景深，统一沉浸车窗叙事氛围',
  },
  {
    id: 'vintage_sofa',
    labelZh: '复古室内风',
    labelEn: 'Vintage Sofa',
    imageFile: 'style-15-vintage-sofa.png',
    prompt:
      '复古室内视觉风格：暖橙台灯与木墙沙发人像，复古风扇与生活细节，胶片感暗调，统一复古室内氛围',
  },
  {
    id: 'window_gaze',
    labelZh: '车窗沉思风',
    labelEn: 'Window Gaze',
    imageFile: 'style-16-warm-room.png',
    prompt:
      '窗景沉思视觉风格：车窗侧颜人像，山海暮色虚化背景，冷静情绪与电影构图，统一窗景沉思氛围',
  },
  {
    id: 'neon_night',
    labelZh: '霓虹夜色风',
    labelEn: 'Neon Night',
    imageFile: 'style-17-neon-cyber.png',
    prompt:
      '霓虹夜色视觉风格：都市霓虹与湿润街道，冷蓝粉紫光影，时尚人像回眸，统一霓虹夜色氛围',
  },
  {
    id: 'cyber_neon',
    labelZh: '赛博朋克风',
    labelEn: 'Cyber Neon',
    imageFile: 'style-18-final.png',
    prompt:
      '赛博朋克视觉风格：霓虹都市夜街人像，高对比冷蓝与品红，潮酷妆造与湿路面反射，统一赛博朋克氛围',
  },
  {
    id: 'lake_guitar',
    labelZh: '湖畔吉他风',
    labelEn: 'Lake Guitar',
    imageFile: 'style-19-lake-guitar.png',
    prompt:
      '湖畔吉他视觉风格：金色小时光户外原声吉他，湖水草地与逆光暖调，独立民谣电影感，统一湖畔吉他氛围',
  },
  {
    id: 'desert_road',
    labelZh: '沙漠公路风',
    labelEn: 'Desert Road',
    imageFile: 'style-20-desert-road.png',
    prompt:
      '沙漠公路视觉风格：荒漠山脉与公路旅行，墨镜牛仔外套侧颜，橙青电影调色与浅景深，统一沙漠公路氛围',
  },
  {
    id: 'neon_corridor',
    labelZh: '霓虹走廊风',
    labelEn: 'Neon Corridor',
    imageFile: 'style-21-neon-corridor.png',
    prompt:
      '霓虹走廊视觉风格：粉蓝霓虹通道回眸人像，高饱和赛博夜店感，金属反光与浅景深，统一霓虹走廊氛围',
  },
  {
    id: 'sea_window',
    labelZh: '海边窗景风',
    labelEn: 'Sea Window',
    imageFile: 'style-22-sea-window.png',
    prompt:
      '海边窗景视觉风格：窗边望海侧颜，暖阳针织与海天柔光，低对比治愈叙事，统一海边窗景氛围',
  },
  {
    id: 'stage_rim',
    labelZh: '舞台逆光风',
    labelEn: 'Stage Rim Light',
    imageFile: 'style-23-stage-rim.png',
    prompt:
      '舞台逆光视觉风格：演唱会侧颜与麦克风，强背光星芒与冷蓝烟雾，高对比现场张力，统一舞台逆光氛围',
  },
  {
    id: 'rain_night',
    labelZh: '雨夜沉思风',
    labelEn: 'Rainy Night',
    imageFile: 'style-24-rain-night.png',
    prompt:
      '雨夜沉思视觉风格：夜雨仰望人像，湿发与雨丝高光，冷暗情绪电影调色，统一雨夜沉思氛围',
  },
  {
    id: 'jar_glow',
    labelZh: '暖光拾梦风',
    labelEn: 'Jar Glow',
    imageFile: 'style-25-jar-glow.png',
    prompt:
      '暖光拾梦视觉风格：双手捧光人像，琥珀暖调与室内绿植虚化，梦幻亲密电影感，统一暖光拾梦氛围',
  },
  {
    id: 'graffiti_tunnel',
    labelZh: '涂鸦隧道风',
    labelEn: 'Graffiti Tunnel',
    imageFile: 'style-26-graffiti-tunnel.png',
    prompt:
      '涂鸦隧道视觉风格：地下通道正面人像，涂鸦墙与纵深灯光散景，都市潮酷电影感，统一涂鸦隧道氛围',
  },
  {
    id: 'city_railing',
    labelZh: '城市夜桥风',
    labelEn: 'City Railing',
    imageFile: 'style-27-city-railing.png',
    prompt:
      '城市夜桥视觉风格：夜景栏杆侧颜人像，楼宇灯光与暖冷对比，沉静都市电影感，统一城市夜桥氛围',
  },
  {
    id: 'xianxia_snow',
    labelZh: '仙侠飞雪风',
    labelEn: 'Xianxia Snow',
    // 无专属参考图：选中后请上传古风/飞雪参考，或直接用下方文案约束生成
    imageFile: '',
    prompt:
      '仙侠古风视觉风格：飞雪山河与断崖冰湖，素白仙袍与冷清眉眼，水墨电影感与浅景深，古典光影与绢帛材质；禁止汽车、公路、方向盘、车窗、摩天楼、霓虹等现代元素，统一仙侠虐恋氛围',
  },
  {
    id: 'custom',
    labelZh: '自定义',
    labelEn: 'Custom',
    prompt: '',
  },
] as const;

const DEFAULT_STYLE_PRESET_ID: DirectorStylePresetId = 'street_crew';

export function normalizeDirectorStylePresetId(
  id: string | undefined | null,
): DirectorStylePresetId {
  const raw = String(id || '').trim();
  if (!raw) return DEFAULT_STYLE_PRESET_ID;
  const mapped = LEGACY_STYLE_PRESET_MAP[raw] || raw;
  if (DIRECTOR_STYLE_PRESETS.some((p) => p.id === mapped)) {
    return mapped as DirectorStylePresetId;
  }
  return DEFAULT_STYLE_PRESET_ID;
}

export function getDirectorStylePreset(id: string | undefined | null): DirectorStylePreset {
  const normalized = normalizeDirectorStylePresetId(id);
  const found = DIRECTOR_STYLE_PRESETS.find((p) => p.id === normalized);
  if (found) return found;
  return DIRECTOR_STYLE_PRESETS.find((p) => p.id === DEFAULT_STYLE_PRESET_ID) || DIRECTOR_STYLE_PRESETS[0];
}

/** 渲染进程：public 风格参考图相对路径（Vite base: './'） */
export function directorStylePresetImageUrl(imageFile: string | undefined | null): string {
  const file = String(imageFile || '').trim();
  if (!file) return '';
  return `./director-style-presets/${file}`;
}

export function resolveDirectorStylePrompt(
  stylePresetId: string | undefined | null,
  globalStyle: string | undefined | null,
): string {
  const preset = getDirectorStylePreset(stylePresetId);
  const stored = String(globalStyle || '').trim();
  // 非「自定义」：标签预设正文为底；若用户长按编辑过该标签，globalStyle 会覆盖预设
  if (preset.id !== 'custom') {
    return stored || String(preset.prompt || '').trim();
  }
  return stored;
}

/** 当前选中的风格图名称（写入提示词，便于无图界面辨认） */
export function resolveDirectorStylePictureLabel(
  stylePresetId?: string | null,
): string {
  const preset = getDirectorStylePreset(stylePresetId);
  if (preset.id === 'custom') return '自定义风格图';
  return String(preset.labelZh || '').trim() || '自定义风格图';
}

/** 分镜 / 视频：风格图固定按参考图序号说，不写风格名称以免误导 */
export function parseDirectorStylePictureIndex(
  raw?: number | string | null,
): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  const s = String(raw || '').trim();
  if (/^\d+$/.test(s)) return Math.max(1, parseInt(s, 10));
  return 1;
}

/** 风格参考图：只锁光色；画风固定真人写实（写入分镜/视频提示词） */
export function formatDirectorStyleFromRefImageHint(
  stylePictureIndex?: number | string | null,
): string {
  const n = parseDirectorStylePictureIndex(stylePictureIndex);
  return `光色参考第${n}张风格图；画风固定真人写实摄影（photorealistic），禁止插画/卡通/二次元/三维CG`;
}

/** 解析当前应使用的风格参考图 URL（状态优先，否则回落到预设图） */
export function resolveDirectorStyleReferenceImageUrl(
  stylePresetId: string | undefined | null,
  styleReferenceImageUrl: string | undefined | null,
): string {
  const stored = String(styleReferenceImageUrl || '').trim();
  if (stored) return stored;
  const preset = getDirectorStylePreset(stylePresetId);
  if (preset.id === 'custom') return '';
  return directorStylePresetImageUrl(preset.imageFile);
}

export function isDirectorStylePresetId(id: string): id is DirectorStylePresetId {
  return DIRECTOR_STYLE_PRESETS.some((p) => p.id === id) || id in LEGACY_STYLE_PRESET_MAP;
}
