import { HIDE_SORA2_AND_SORA_CHARACTER_UI } from '../config/sora2UiPolicy';

/**
 * 节点连线兼容规则：谁可以连到谁
 * - 用于拖线创建菜单过滤（不显示不兼容的模块）
 * - 用于 isValidConnection（禁止连到不兼容节点 + 红色节点框）
 */

/** 菜单/创建用类型与节点 type 的对应 */
export const MENU_TYPE_TO_NODE_TYPE: Record<string, string> = {
  text: 'minimalistText',
  llm: 'llm',
  textSplit: 'textSplit',
  image: 'image',
  video: 'video',
  wanAnimate: 'wanAnimate',
  videoSplice: 'videoSplice',
  photoCollage: 'photoCollage',
  imageTo3d: 'imageTo3d',
  character: 'character',
  audio: 'audio',
};

export const NODE_TYPE_TO_MENU_TYPE: Record<string, string> = {
  minimalistText: 'text',
  llm: 'llm',
  textSplit: 'textSplit',
  image: 'image',
  video: 'video',
  wanAnimate: 'wanAnimate',
  videoSplice: 'videoSplice',
  photoCollage: 'photoCollage',
  imageTo3d: 'imageTo3d',
  character: 'character',
  audio: 'audio',
  audioTranscribe: 'audioTranscribe',
};

/** 角色节点：旧版「上图」磁吸把手 id（兼容已存边） */
export const CHARACTER_OUTPUT_IMAGES_HANDLE = 'output-images';
/** 角色节点：旧版「参考音」磁吸把手 id（兼容已存边） */
export const CHARACTER_OUTPUT_AUDIO_HANDLE = 'output-audio';
/** 角色节点：统一输出把手（按目标模块类型传图/传音） */
export const CHARACTER_SOURCE_OUTPUT_HANDLE = 'output';

/** 从源节点类型看：不能作为“新建目标”的菜单类型（拖线创建菜单中要隐藏） */
const FORBIDDEN_TARGET_MENU_TYPES_BY_SOURCE: Record<string, string[]> = {
  text: ['text', 'character', 'videoSplice', 'photoCollage'],
  minimalistText: ['text', 'character', 'videoSplice', 'photoCollage'],
  llm: ['text', 'character', 'videoSplice', 'photoCollage'],
  textSplit: ['text', 'character', 'videoSplice', 'photoCollage'],
  image: ['text', 'textSplit', 'character', 'audio'],
  video: ['textSplit'], // 允许 video -> text（转写）、image、audio、videoSplice、llm 等
  wanAnimate: ['textSplit'],
  videoSplice: ['text', 'llm', 'textSplit', 'character'],
  // 角色模块：仅连到 图片 / 视频 / 视频换人 / 声音（由目标类型决定传参）
  character: ['text', 'llm', 'textSplit', 'character', 'videoSplice', 'photoCollage', 'canvas-tool'],
  audio: ['llm', 'textSplit', 'image', 'character'], // 允许 audio -> text（转写）；LLM 尚未接音轨输入故禁止
};

/** 从源节点类型看：不能连到的目标节点 type（用于 isValidConnection） */
const FORBIDDEN_TARGET_NODE_TYPES_BY_SOURCE: Record<string, string[]> = {
  minimalistText: ['minimalistText', 'character', 'videoSplice', 'photoCollage'],
  text: ['minimalistText', 'character', 'videoSplice', 'photoCollage'],
  llm: ['minimalistText', 'character', 'videoSplice', 'photoCollage'],
  textSplit: ['minimalistText', 'character', 'videoSplice', 'photoCollage'],
  image: ['minimalistText', 'textSplit', 'character', 'audio'],
  video: ['textSplit'], // 允许 video -> minimalistText（转写）、image、audio、videoSplice、llm
  wanAnimate: ['textSplit'],
  videoSplice: ['minimalistText', 'llm', 'textSplit', 'character', 'photoCollage'],
  character: [
    'minimalistText',
    'text',
    'llm',
    'textSplit',
    'character',
    'videoSplice',
    'photoCollage',
    'audioTranscribe',
    'cameraControl',
  ],
  audio: ['llm', 'textSplit', 'image', 'character'], // 允许 audio -> minimalistText（转写）
  cameraControl: ['minimalistText', 'text', 'llm', 'textSplit', 'video', 'character', 'audio', 'cameraControl'], // 旧项目兼容：3D 只能连到 image
};

const ALL_MENU_TYPES = ['text', 'llm', 'textSplit', 'image', 'canvas-tool', 'video', 'wanAnimate', 'videoSplice', 'photoCollage', 'imageTo3d', 'character', 'audio'];

/** 四视图勾选：显式 boolean[4]；缺省视为旧数据「未存勾选」 */
export function parseReferenceTransmitSlots(raw: unknown): boolean[] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  if (!raw.every((x) => x === true || x === false)) return null;
  return raw as boolean[];
}

/** 角色卡默认勾选：正面全身（第二槽，索引 1） */
export const DEFAULT_REFERENCE_TRANSMIT_SLOTS: [boolean, boolean, boolean, boolean] = [
  false,
  true,
  false,
  false,
];

export function resolveReferenceTransmitSlots(raw: unknown): boolean[] {
  const parsed = parseReferenceTransmitSlots(raw);
  if (!parsed) return [...DEFAULT_REFERENCE_TRANSMIT_SLOTS];
  if (parsed.every((x) => !x)) return [...DEFAULT_REFERENCE_TRANSMIT_SLOTS];
  return [...parsed];
}

/** 按勾选与四视图 URL 收集可传出的参考图 URL（无勾选时回退头像） */
export function getCharacterTransmitImageUrls(characterData: Record<string, unknown> | undefined): string[] {
  if (!characterData) return [];
  const vi = Array.isArray(characterData.viewImages) ? (characterData.viewImages as string[]) : [];
  const mask = resolveReferenceTransmitSlots(characterData.referenceTransmitSlots);
  const urls: string[] = [];
  for (let i = 0; i < 4; i++) {
    const url = typeof vi[i] === 'string' ? vi[i].trim() : '';
    if (!url) continue;
    if (mask[i]) urls.push(url);
  }
  if (urls.length > 0) return urls;
  const avatar = typeof characterData.avatar === 'string' ? characterData.avatar.trim() : '';
  return avatar ? [avatar] : [];
}

/** 拖线到目标前：校验角色当前数据是否满足该目标（勾选张数 / 是否有参考音） */
export function isCharacterConnectionDataValid(
  targetNodeType: string,
  characterData: Record<string, unknown> | undefined
): boolean {
  if (!characterData) return false;
  const tgt = targetNodeType;
  if (tgt === 'image') {
    return getCharacterTransmitImageUrls(characterData).length >= 1;
  }
  if (tgt === 'video' || tgt === 'wanAnimate') {
    return getCharacterTransmitImageUrls(characterData).length >= 1;
  }
  if (tgt === 'audio') {
    const refUrl =
      String(characterData.voiceClip ?? '').trim() || String(characterData.referenceAudioUrl ?? '').trim();
    return !!refUrl;
  }
  return false;
}

/**
 * 拖线创建菜单：根据源节点 type 返回禁止出现的菜单类型（菜单项中要隐藏）
 */
export function getForbiddenMenuTypesBySourceNodeType(sourceNodeType: string): string[] {
  const normalized = sourceNodeType === 'minimalistText' ? 'text' : sourceNodeType;
  return FORBIDDEN_TARGET_MENU_TYPES_BY_SOURCE[normalized] ?? [];
}

/**
 * 拖线创建菜单：根据源节点 type 返回允许创建的菜单类型；null 表示全部展示
 * 当源为 video 时，将 'image' 替换为首帧/当前帧/末帧选项，供用户选择
 */
export function getAllowedMenuTypes(
  sourceNodeType: string | null,
  _sourceHandleId?: string | null
): string[] | undefined {
  if (sourceNodeType == null) return undefined;

  const forbidden = getForbiddenMenuTypesBySourceNodeType(sourceNodeType);
  let types = ALL_MENU_TYPES.filter((t) => !forbidden.includes(t));
  if (sourceNodeType === 'video' || sourceNodeType === 'wanAnimate') {
    if (types.includes('image')) {
      types = types.filter((t) => t !== 'image').concat(['image-first-frame', 'image-current-frame', 'image-last-frame']);
    }
    // 添加「从视频提取音频」选项
    if (types.includes('audio')) {
      types = types.filter((t) => t !== 'audio').concat(['audio-extract-from-video']);
    }
  }
  // 从音频节点拖线：保留「声音」选项（创建新音频节点），并添加「提取人声」「提取背景音」
  if (sourceNodeType === 'audio') {
    if (types.includes('audio')) {
      types = types.filter((t) => t !== 'audio').concat(['audio', 'audio-extract-vocals', 'audio-extract-background']);
    }
  }
  // canvas-tool 在允许 image 时也显示（video 时为帧导出选项）
  if (types.includes('image') || types.includes('image-first-frame') || types.includes('image-current-frame') || types.includes('image-last-frame')) {
    if (!types.includes('canvas-tool')) types = types.concat(['canvas-tool']);
  }
  if (HIDE_SORA2_AND_SORA_CHARACTER_UI) {
    types = types.filter((t) => t !== 'character');
  }
  // 图片转 3D：仅允许从图片节点拖线创建
  if (sourceNodeType !== 'image') {
    types = types.filter((t) => t !== 'imageTo3d');
  }
  return types;
}

/** 角色节点：只能由视频类模块作为输入 */
const CHARACTER_INPUT_ALLOWED_SOURCES = ['video', 'wanAnimate'];

/**
 * 判断从 source 连到 target 是否允许（用于 isValidConnection）
 */
export function isConnectionAllowed(
  sourceNodeType: string,
  targetNodeType: string,
  sourceHandleId?: string | null,
  _targetHandleId?: string | null
): boolean {
  const src = sourceNodeType === 'minimalistText' ? 'minimalistText' : sourceNodeType;
  const tgt = targetNodeType;

  // 角色节点：只能输入来自 video；可从右侧磁吸连出到图/视频等
  if (tgt === 'character') {
    return CHARACTER_INPUT_ALLOWED_SOURCES.includes(src);
  }
  if (src === 'character') {
    return tgt === 'image' || tgt === 'audio' || tgt === 'video' || tgt === 'wanAnimate';
  }
  if (tgt === 'imageTo3d') {
    return src === 'image';
  }
  const forbidden = FORBIDDEN_TARGET_NODE_TYPES_BY_SOURCE[src];
  if (!forbidden) return true;
  return !forbidden.includes(tgt);
}
