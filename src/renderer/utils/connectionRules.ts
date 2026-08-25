import { HIDE_SORA2_AND_SORA_CHARACTER_UI } from '../config/sora2UiPolicy';
import { HIDE_DIRECTOR_DRAMA_UI, HIDE_DIRECTOR_STAGE_UI } from '../config/directorUiPolicy';
import {
  isDigitalHumanAudioOutputHandle,
  isDigitalHumanVideoOutputHandle,
} from './digitalHumanNodeMedia';

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
  heyGem: 'heyGem',
  videoSplice: 'videoSplice',
  photoCollage: 'photoCollage',
  gridMap: 'gridMap',
  imageComparer: 'imageComparer',
  storyboardScript: 'storyboardScript',
  script: 'script',
  director: 'director',
  directorDrama: 'directorDrama',
  imageTo3d: 'imageTo3d',
  character: 'character',
  digitalHuman: 'digitalHuman',
  audio: 'audio',
  rvcTrain: 'rvcTrain',
};

export const NODE_TYPE_TO_MENU_TYPE: Record<string, string> = {
  minimalistText: 'text',
  llm: 'llm',
  textSplit: 'textSplit',
  image: 'image',
  video: 'video',
  wanAnimate: 'wanAnimate',
  heyGem: 'heyGem',
  videoSplice: 'videoSplice',
  photoCollage: 'photoCollage',
  gridMap: 'gridMap',
  imageComparer: 'imageComparer',
  storyboardScript: 'storyboardScript',
  script: 'script',
  director: 'director',
  directorDrama: 'directorDrama',
  imageTo3d: 'imageTo3d',
  character: 'character',
  digitalHuman: 'digitalHuman',
  audio: 'audio',
  rvcTrain: 'rvcTrain',
  audioTranscribe: 'audioTranscribe',
};

/** 数字人源模块：参考视频 / 参考音输出把手（再导出供画布组件使用） */
export { DIGITAL_HUMAN_OUTPUT_VIDEO_HANDLE, DIGITAL_HUMAN_OUTPUT_AUDIO_HANDLE } from './digitalHumanNodeMedia';
export const CHARACTER_OUTPUT_IMAGES_HANDLE = 'output-images';
/** 角色节点：旧版「参考音」磁吸把手 id（兼容已存边） */
export const CHARACTER_OUTPUT_AUDIO_HANDLE = 'output-audio';
/** 角色节点：统一输出把手（按目标模块类型传图/传音） */
export const CHARACTER_SOURCE_OUTPUT_HANDLE = 'output';

/** 从源节点类型看：不能作为“新建目标”的菜单类型（拖线创建菜单中要隐藏） */
const FORBIDDEN_TARGET_MENU_TYPES_BY_SOURCE: Record<string, string[]> = {
  text: ['text', 'character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'heyGem', 'rvcTrain'],
  minimalistText: ['text', 'character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'heyGem', 'rvcTrain'],
  llm: ['text', 'character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'heyGem', 'rvcTrain'],
  textSplit: ['character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'heyGem', 'rvcTrain'],
  image: ['text', 'textSplit', 'character', 'audio', 'heyGem', 'rvcTrain', 'script'],
  video: ['textSplit', 'rvcTrain', 'script'], // 允许 video -> text（转写）、image、audio、videoSplice、llm、storyboardScript 等
  wanAnimate: ['textSplit', 'rvcTrain', 'script'],
  heyGem: ['textSplit', 'rvcTrain', 'script'],
  videoSplice: ['text', 'llm', 'textSplit', 'character', 'rvcTrain', 'storyboardScript', 'script', 'director', 'directorDrama'],
  // 角色模块：仅连到 图片 / 视频 / 视频换人 / 声音（由目标类型决定传参）
  character: ['text', 'llm', 'textSplit', 'character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'canvas-tool', 'rvcTrain', 'storyboardScript', 'script', 'director', 'directorDrama'],
  // audio → director / directorDrama 允许（MV 吸收音乐；短剧亦可接文本旁白等）；其余保持禁止
  audio: ['llm', 'textSplit', 'image', 'character', 'photoCollage', 'gridMap', 'imageComparer', 'storyboardScript', 'script'],
  rvcTrain: ['text', 'llm', 'textSplit', 'image', 'character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'canvas-tool', 'heyGem', 'storyboardScript', 'script', 'director', 'directorDrama'],
  digitalHuman: ['text', 'llm', 'textSplit', 'character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'canvas-tool', 'imageTo3d', 'rvcTrain', 'storyboardScript', 'script', 'director', 'directorDrama'],
  // 分镜脚本：可拖线创建/连到 图片、视频、文本、LLM 等下游模型
  storyboardScript: ['character', 'audio', 'heyGem', 'rvcTrain', 'photoCollage', 'gridMap', 'imageComparer', 'canvas-tool', 'imageTo3d', 'videoSplice', 'storyboardScript', 'script', 'director', 'directorDrama'],
  // 剧本：主要连到导演 / 文本 / LLM
  script: ['character', 'audio', 'heyGem', 'rvcTrain', 'photoCollage', 'gridMap', 'imageComparer', 'canvas-tool', 'imageTo3d', 'videoSplice', 'image', 'video', 'wanAnimate', 'storyboardScript'],
  // 导演：可连到图片、视频、剪辑、文本、LLM
  director: ['character', 'audio', 'heyGem', 'rvcTrain', 'photoCollage', 'gridMap', 'imageComparer', 'canvas-tool', 'imageTo3d', 'storyboardScript', 'script', 'director', 'directorDrama'],
};

/** 从源节点类型看：不能连到的目标节点 type（用于 isValidConnection） */
const FORBIDDEN_TARGET_NODE_TYPES_BY_SOURCE: Record<string, string[]> = {
  minimalistText: ['minimalistText', 'character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'heyGem', 'rvcTrain'],
  text: ['minimalistText', 'character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'heyGem', 'rvcTrain'],
  llm: ['minimalistText', 'character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'heyGem', 'rvcTrain'],
  textSplit: ['character', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'heyGem', 'rvcTrain'],
  image: ['minimalistText', 'textSplit', 'character', 'audio', 'heyGem', 'rvcTrain'],
  video: ['textSplit', 'rvcTrain'], // 允许 video -> minimalistText（转写）、image、audio、videoSplice、llm、storyboardScript
  wanAnimate: ['textSplit', 'rvcTrain'],
  heyGem: ['textSplit', 'rvcTrain'],
  videoSplice: ['minimalistText', 'llm', 'textSplit', 'character', 'photoCollage', 'gridMap', 'imageComparer', 'rvcTrain', 'storyboardScript'],
  character: [
    'minimalistText',
    'text',
    'llm',
    'textSplit',
    'character',
    'videoSplice',
    'photoCollage',
    'gridMap',
    'imageComparer',
    'audioTranscribe',
    'cameraControl',
    'rvcTrain',
    'storyboardScript',
  ],
  audio: ['llm', 'textSplit', 'image', 'character', 'photoCollage', 'gridMap', 'imageComparer', 'storyboardScript'],
  rvcTrain: [
    'minimalistText',
    'text',
    'llm',
    'textSplit',
    'image',
    'character',
    'video',
    'wanAnimate',
    'heyGem',
    'videoSplice',
    'photoCollage',
    'gridMap',
    'imageComparer',
    'audioTranscribe',
    'cameraControl',
    'imageTo3d',
    'rvcTrain',
    'storyboardScript',
  ],
  digitalHuman: [
    'minimalistText',
    'text',
    'llm',
    'textSplit',
    'character',
    'videoSplice',
    'photoCollage',
    'gridMap',
    'imageComparer',
    'audioTranscribe',
    'cameraControl',
    'imageTo3d',
    'rvcTrain',
    'storyboardScript',
  ],
  storyboardScript: [
    'character',
    'audio',
    'heyGem',
    'rvcTrain',
    'photoCollage',
    'gridMap',
    'imageComparer',
    'imageTo3d',
    'videoSplice',
    'audioTranscribe',
    'cameraControl',
    'storyboardScript',
    'script',
    'director',
    'directorDrama',
  ],
  script: [
    'character',
    'audio',
    'heyGem',
    'rvcTrain',
    'photoCollage',
    'gridMap',
    'imageComparer',
    'imageTo3d',
    'videoSplice',
    'image',
    'video',
    'wanAnimate',
    'audioTranscribe',
    'cameraControl',
    'storyboardScript',
  ],
  director: [
    'character',
    'audio',
    'heyGem',
    'rvcTrain',
    'photoCollage',
    'gridMap',
    'imageComparer',
    'imageTo3d',
    'audioTranscribe',
    'cameraControl',
    'storyboardScript',
    'script',
    'director',
    'directorDrama',
  ],
  directorDrama: [
    'character',
    'audio',
    'heyGem',
    'rvcTrain',
    'photoCollage',
    'gridMap',
    'imageComparer',
    'imageTo3d',
    'audioTranscribe',
    'cameraControl',
    'storyboardScript',
    'script',
    'director',
    'directorDrama',
  ],
  cameraControl: ['minimalistText', 'text', 'llm', 'textSplit', 'video', 'character', 'audio', 'cameraControl'], // 旧项目兼容：3D 只能连到 image
};

const ALL_MENU_TYPES = ['text', 'llm', 'textSplit', 'image', 'canvas-tool', 'video', 'wanAnimate', 'heyGem', 'videoSplice', 'photoCollage', 'gridMap', 'imageComparer', 'director', 'directorDrama', 'imageTo3d', 'character', 'audio', 'rvcTrain'];

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

/** 角色卡参考音传出到视频：默认不勾选（与四视图显式勾选对称） */
export const DEFAULT_REFERENCE_TRANSMIT_AUDIO = false;

/** 角色形象描述传出到图片/视频 prompt：默认不勾选 */
export const DEFAULT_REFERENCE_TRANSMIT_PROMPT = false;

/** 角色卡是否勾选「传给视频当参考音」 */
export function isCharacterReferenceAudioTransmitEnabled(
  characterData: Record<string, unknown> | undefined,
): boolean {
  return characterData?.referenceTransmitAudio === true;
}

/** 角色卡是否勾选「传形象描述到图片/视频 prompt」 */
export function isCharacterReferencePromptTransmitEnabled(
  characterData: Record<string, unknown> | undefined,
): boolean {
  return characterData?.referenceTransmitPrompt === true;
}

/** 勾选且存在形象描述时返回可传出的 prompt 文本 */
export function getCharacterTransmitPrompt(
  characterData: Record<string, unknown> | undefined,
): string {
  if (!characterData || !isCharacterReferencePromptTransmitEnabled(characterData)) return '';
  return typeof characterData.imageDescription === 'string'
    ? characterData.imageDescription.trim()
    : '';
}

/** 角色卡上的声音片段 URL（voiceClip / referenceAudioUrl），不看勾选 */
export function getCharacterVoiceClipUrl(
  characterData: Record<string, unknown> | undefined,
): string {
  if (!characterData) return '';
  const voice = typeof characterData.voiceClip === 'string' ? characterData.voiceClip.trim() : '';
  if (voice) return voice;
  const ref =
    typeof characterData.referenceAudioUrl === 'string' ? characterData.referenceAudioUrl.trim() : '';
  return ref || '';
}

/**
 * 勾选且存在参考音时返回可传出的 URL（用于「角色 → 视频」参考音）。
 * 「角色 → 音频」请用 getCharacterVoiceClipUrl：有声音即传，不依赖勾选。
 */
export function getCharacterTransmitAudioUrl(
  characterData: Record<string, unknown> | undefined,
): string {
  if (!characterData || !isCharacterReferenceAudioTransmitEnabled(characterData)) return '';
  return getCharacterVoiceClipUrl(characterData);
}

/** 拖线到目标前：校验角色当前数据是否满足该目标（勾选张数等） */
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
    // 视频仍要求至少 1 张勾选图；参考音为可选附加（由 referenceTransmitAudio 门控）
    return getCharacterTransmitImageUrls(characterData).length >= 1;
  }
  if (tgt === 'audio') {
    // 有/无声音均可连线；有声音时由边同步写入参考音，无声音不报错、不写空
    return true;
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

/** 拖线创建 HeyGem：仅允许从声音节点 / 视频节点（含视频换人）拉出 */
export const HEYGEM_DRAG_CREATE_SOURCE_NODE_TYPES = ['audio', 'video', 'wanAnimate'] as const;

export function canCreateHeyGemFromSource(
  sourceNodeType: string | null | undefined,
  _sourceHandleId?: string | null,
): boolean {
  if (!sourceNodeType) return false;
  return (HEYGEM_DRAG_CREATE_SOURCE_NODE_TYPES as readonly string[]).includes(sourceNodeType);
}

function filterHeyGemFromMenuTypes(sourceNodeType: string, types: string[]): string[] {
  if (canCreateHeyGemFromSource(sourceNodeType)) return types;
  return types.filter((t) => t !== 'heyGem');
}

/**
 * 拖线创建菜单：根据源节点 type 返回允许创建的菜单类型；null 表示全部展示
 */
export function getAllowedMenuTypes(
  sourceNodeType: string | null,
  sourceHandleId?: string | null
): string[] | undefined {
  if (sourceNodeType == null) return undefined;

  if (sourceNodeType === 'digitalHuman') {
    if (isDigitalHumanAudioOutputHandle(sourceHandleId)) {
      return filterHeyGemFromMenuTypes(
        sourceNodeType,
        ['audio', 'videoSplice'].filter((t) => t !== 'character' || !HIDE_SORA2_AND_SORA_CHARACTER_UI),
      );
    }
    if (isDigitalHumanVideoOutputHandle(sourceHandleId)) {
      let types = ALL_MENU_TYPES.filter((t) => !getForbiddenMenuTypesBySourceNodeType('video').includes(t));
      // 视频→图片帧（首/当前/末）已下线，改用智能剪辑抽关键帧
      types = types.filter((t) => t !== 'image');
      if (types.includes('audio')) {
        types = types.filter((t) => t !== 'audio').concat(['audio-extract-from-video']);
      }
      if (HIDE_SORA2_AND_SORA_CHARACTER_UI) {
        types = types.filter((t) => t !== 'character');
      }
      if (HIDE_DIRECTOR_STAGE_UI) {
        types = types.filter((t) => t !== 'director' && t !== 'directorDrama');
      } else if (HIDE_DIRECTOR_DRAMA_UI) {
        types = types.filter((t) => t !== 'directorDrama');
      }
      types = types.filter((t) => t !== 'imageTo3d' && t !== 'imageComparer');
      return filterHeyGemFromMenuTypes(sourceNodeType, types);
    }
    return [];
  }

  if (sourceNodeType === 'rvcTrain') {
    return ['audio'];
  }

  if (sourceNodeType === 'videoSplice') {
    return ['video'];
  }

  const forbidden = getForbiddenMenuTypesBySourceNodeType(sourceNodeType);
  let types = ALL_MENU_TYPES.filter((t) => !forbidden.includes(t));
  if (sourceNodeType === 'video' || sourceNodeType === 'wanAnimate' || sourceNodeType === 'heyGem') {
    // 视频→图片帧（首/当前/末）已下线，改用智能剪辑抽关键帧
    types = types.filter((t) => t !== 'image');
    // 添加「从视频提取音频」选项
    if (types.includes('audio')) {
      types = types.filter((t) => t !== 'audio').concat(['audio-extract-from-video']);
    }
  }
  // 从音频节点拖线：保留「声音」选项，并添加翻唱/提取人声/提取背景音/音色训练子菜单
  if (sourceNodeType === 'audio') {
    types = types.filter((t) => t !== 'audio' && t !== 'rvcTrain');
    types = types.concat([
      'audio',
      'audio-voice-cover',
      'audio-extract-vocals',
      'audio-extract-background',
      'rvcTrain',
    ]);
  }
  // 音色训练：仅声音模块拖线子菜单（非 audio 源一律不展示）
  if (sourceNodeType !== 'audio') {
    types = types.filter((t) => t !== 'rvcTrain');
  }
  // canvas-tool 在允许 image 时也显示
  if (types.includes('image')) {
    if (!types.includes('canvas-tool')) types = types.concat(['canvas-tool']);
  }
  if (HIDE_SORA2_AND_SORA_CHARACTER_UI) {
    types = types.filter((t) => t !== 'character');
  }
  if (HIDE_DIRECTOR_STAGE_UI) {
    types = types.filter((t) => t !== 'director' && t !== 'directorDrama');
  } else if (HIDE_DIRECTOR_DRAMA_UI) {
    types = types.filter((t) => t !== 'directorDrama');
  }
  // 图片转 3D / 图片对比：仅允许从图片节点拖线创建
  if (sourceNodeType !== 'image') {
    types = types.filter((t) => t !== 'imageTo3d' && t !== 'imageComparer');
  }
  return filterHeyGemFromMenuTypes(sourceNodeType, types);
}

/** 角色节点：只能由视频类模块作为输入 */
const CHARACTER_INPUT_ALLOWED_SOURCES = ['video', 'wanAnimate', 'heyGem'];

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

  // HeyGem 数字人：仅接受声音 / 视频类模块作为输入源
  if (tgt === 'heyGem') {
    return canCreateHeyGemFromSource(src);
  }

  // 角色节点：只能输入来自 video；可从右侧磁吸连出到图/视频等
  if (tgt === 'character') {
    return CHARACTER_INPUT_ALLOWED_SOURCES.includes(src);
  }
  if (src === 'character') {
    return tgt === 'image' || tgt === 'audio' || tgt === 'video' || tgt === 'wanAnimate';
  }
  if (src === 'digitalHuman') {
    if (isDigitalHumanAudioOutputHandle(sourceHandleId)) {
      return tgt === 'audio' || tgt === 'videoSplice' || tgt === 'audioTranscribe';
    }
    if (isDigitalHumanVideoOutputHandle(sourceHandleId)) {
      return (
        tgt === 'video' ||
        tgt === 'wanAnimate' ||
        tgt === 'videoSplice' ||
        tgt === 'minimalistText' ||
        tgt === 'text' ||
        tgt === 'image' ||
        tgt === 'audio'
      );
    }
    return false;
  }
  if (tgt === 'imageTo3d' || tgt === 'imageComparer') {
    return src === 'image';
  }
  // 拼图：仅接受图片模块（超级连线 / 单连均导入图层）
  if (tgt === 'photoCollage') {
    return src === 'image';
  }
  if (tgt === 'rvcTrain') {
    return src === 'audio';
  }
  if (src === 'rvcTrain') {
    return tgt === 'audio';
  }
  if (src === 'videoSplice') {
    return tgt === 'video';
  }
  if (src === 'storyboardScript') {
    return (
      tgt === 'image' ||
      tgt === 'video' ||
      tgt === 'wanAnimate' ||
      tgt === 'llm' ||
      tgt === 'minimalistText' ||
      tgt === 'text' ||
      tgt === 'textSplit'
    );
  }
  if (src === 'script') {
    return (
      tgt === 'director' ||
      tgt === 'directorDrama' ||
      tgt === 'llm' ||
      tgt === 'minimalistText' ||
      tgt === 'text' ||
      tgt === 'textSplit' ||
      tgt === 'storyboardScript'
    );
  }
  if (src === 'director' || src === 'directorDrama') {
    return (
      tgt === 'image' ||
      tgt === 'video' ||
      tgt === 'wanAnimate' ||
      tgt === 'llm' ||
      tgt === 'minimalistText' ||
      tgt === 'text' ||
      tgt === 'textSplit' ||
      tgt === 'videoSplice'
    );
  }
  if (tgt === 'script') {
    return src === 'minimalistText' || src === 'text' || src === 'llm' || src === 'textSplit';
  }
  if (tgt === 'director') {
    return (
      src === 'script' ||
      src === 'minimalistText' ||
      src === 'text' ||
      src === 'llm' ||
      src === 'textSplit' ||
      src === 'audio'
    );
  }
  if (tgt === 'directorDrama') {
    return (
      src === 'script' ||
      src === 'minimalistText' ||
      src === 'text' ||
      src === 'llm' ||
      src === 'textSplit'
    );
  }
  const forbidden = FORBIDDEN_TARGET_NODE_TYPES_BY_SOURCE[src];
  if (!forbidden) return true;
  return !forbidden.includes(tgt);
}
