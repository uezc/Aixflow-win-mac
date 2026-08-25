/** 角色列表与画布拖放共用（单独文件，避免 CharacterList.tsx 混合导出导致 Vite Fast Refresh 失效） */

export type CharacterAssetKind = 'role' | 'imageTo3d';

export interface Character {
  id: string;
  nickname: string;
  name: string;
  avatar: string;
  roleId?: string;
  username?: string;
  permalink?: string;
  createdAt: number;
  localAvatarPath?: string;
  voiceClip?: string;
  localVoicePath?: string;
  /** 角色四视图参考图 URL（与槽位一一对应，空串表示该槽未上传） */
  viewImages?: string[];
  /** 本进程写入的视图文件路径，删除角色时清理 */
  localViewPaths?: string[];
  /** 角色形象文字描述（可手写，或对四视图之一做图像反推写入） */
  imageDescription?: string;
  /** 缺省为普通角色；imageTo3d 为图片转 3D 入库条目 */
  assetKind?: CharacterAssetKind;
  /** 图片转 3D：生成时参考图 */
  inputImageUrl?: string;
  localGlbPath?: string;
  localGlbUrl?: string;
  remoteGlbUrl?: string;
  resultTextureUrl?: string;
  localTexturePath?: string;
}

export function isImageTo3dLibraryCharacter(character: Character | null | undefined): boolean {
  return character?.assetKind === 'imageTo3d';
}

function formatLocalResourceFromFsPath(fsPath: string): string {
  let normalizedPath = fsPath.replace(/\\/g, '/');
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
    normalizedPath = normalizedPath.substring(1);
  }
  return `local-resource://${normalizedPath}`;
}

/** 资产库 3D 悬停预览用的 GLB URL */
export function resolveCharacterGlbUrlForPreview(character: Character): string {
  return (
    (character.localGlbUrl || '').trim() ||
    (character.localGlbPath ? formatLocalResourceFromFsPath(character.localGlbPath) : '') ||
    (character.remoteGlbUrl || '').trim()
  );
}

/** 3D 模型库卡片/列表/画廊封面：优先参考原图（导入包 reference.png → localAvatarPath） */
export function resolveImageTo3dLibraryThumbUrl(character: Character): string {
  if (character.localAvatarPath) {
    const local = formatLocalResourceFromFsPath(character.localAvatarPath);
    if (local) return local;
  }

  const av = formatCharacterMediaUrl(character.avatar);
  if (av) return av;

  const fromInput = formatCharacterMediaUrl(character.inputImageUrl);
  if (fromInput) return fromInput;

  // 禁止回退到 3D 贴图（常 2–4MB），列表会解码卡死；无头像时由 UI 占位
  return '';
}

function formatCharacterMediaUrl(url?: string): string {
  const v = (url || '').trim();
  if (!v) return '';
  if (isLoadableMediaUrl(v)) return v;
  return '';
}

/** 资产库 3D 悬停预览用的贴图 URL */
export function resolveCharacterTextureUrlForPreview(character: Character): string | undefined {
  const tex =
    (character.resultTextureUrl || '').trim() ||
    (character.localTexturePath ? formatLocalResourceFromFsPath(character.localTexturePath) : '');
  return tex || undefined;
}

export function characterHasGlbForPreview(character: Character): boolean {
  return !!resolveCharacterGlbUrlForPreview(character);
}

/** 从角色库卡片拖到画布时 dataTransfer 使用的类型（Workspace onDrop 需同步识别） */
export const NEXFLOW_CHARACTER_DRAG_MIME = 'application/x-nexflow-character';

/** 场景资产库条目（正常图 + 3D 展示图，拖入画布为图片节点） */
export interface SceneLibraryItem {
  id: string;
  nickname: string;
  name: string;
  avatar: string;
  localAvatarPath?: string;
  /** 正常图（平面/列表缩略） */
  normalImageUrl?: string;
  localNormalImagePath?: string;
  /** 3D 展示图（全景球面贴图 / 360 摆放） */
  display3dImageUrl?: string;
  localDisplay3dImagePath?: string;
  /** 兼容旧数据：等同 display3dImageUrl */
  panoramaUrl?: string;
  localPanoramaPath?: string;
  createdAt: number;
}

/** 渲染进程可加载的媒体 URL（排除 bundled-imports/ 等裸相对路径） */
export function isLoadableMediaUrl(url?: string): boolean {
  const u = (url || '').trim();
  if (!u) return false;
  if (
    u.startsWith('local-resource://') ||
    u.startsWith('http://') ||
    u.startsWith('https://') ||
    u.startsWith('data:') ||
    u.startsWith('file://')
  ) {
    return true;
  }
  /** 裸相对路径（bundled-imports/…）在渲染进程无法加载 */
  return false;
}

function sceneImageUrlFromPaths(
  url?: string,
  localPath?: string,
  fallbacks: (string | undefined)[] = [],
): string {
  const lp = (localPath || '').trim();
  if (lp) {
    if (pathLooksAbsolute(lp)) {
      const normalized = lp.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1));
      return `local-resource://${normalized}`;
    }
  }
  const u = (url || '').trim();
  if (isLoadableMediaUrl(u)) return u;
  for (const f of fallbacks) {
    const t = (f || '').trim();
    if (isLoadableMediaUrl(t)) return t;
  }
  return '';
}

function pathLooksAbsolute(p: string): boolean {
  if (p.startsWith('local-resource://') || p.startsWith('file://')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) return true;
  if (p.startsWith('/') && !p.startsWith('bundled-imports/')) return true;
  return false;
}

/** 场景正常图 URL */
export function sceneNormalImageUrl(scene: SceneLibraryItem): string {
  return sceneImageUrlFromPaths(scene.normalImageUrl, scene.localNormalImagePath, [
    scene.avatar,
    scene.panoramaUrl,
  ]);
}

/** 场景 3D 展示图 URL（全景） */
export function sceneDisplay3dImageUrl(scene: SceneLibraryItem): string {
  return sceneImageUrlFromPaths(scene.display3dImageUrl, scene.localDisplay3dImagePath, [
    scene.panoramaUrl,
    scene.avatar,
  ]);
}

/** 从场景库拖到画布 */
export const NEXFLOW_SCENE_DRAG_MIME = 'application/x-nexflow-scene';

/** 数字人资产库条目：HeyGem 参考视频 + 驱动音频 */
export interface DigitalHumanLibraryItem {
  id: string;
  nickname: string;
  name: string;
  createdAt: number;
  /** 列表缩略图（视频 poster，可选） */
  poster?: string;
  localPosterPath?: string;
  /** 数字人参考视频 */
  videoUrl?: string;
  localVideoPath?: string;
  originalVideoUrl?: string;
  /** 驱动音频 */
  audioUrl?: string;
  localAudioPath?: string;
  originalAudioUrl?: string;
}

function digitalHumanMediaUrlFromPaths(
  url?: string,
  localPath?: string,
  remoteFallback?: string,
): string {
  const lp = (localPath || '').trim();
  if (lp && pathLooksAbsolute(lp)) {
    const normalized = lp.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1));
    return `local-resource://${normalized}`;
  }
  const u = (url || '').trim();
  if (isLoadableMediaUrl(u)) return u;
  const remote = (remoteFallback || '').trim();
  if (isLoadableMediaUrl(remote)) return remote;
  return '';
}

/** 数字人库参考视频 URL */
export function digitalHumanVideoUrl(item: DigitalHumanLibraryItem): string {
  return digitalHumanMediaUrlFromPaths(item.videoUrl, item.localVideoPath, item.originalVideoUrl);
}

/** 数字人库驱动音频 URL */
export function digitalHumanAudioUrl(item: DigitalHumanLibraryItem): string {
  return digitalHumanMediaUrlFromPaths(item.audioUrl, item.localAudioPath, item.originalAudioUrl);
}

/** 数字人库列表缩略图（仅静态图；勿回退到视频，否则列表会并发加载 N 路 video metadata 卡死） */
export function digitalHumanPosterUrl(item: DigitalHumanLibraryItem): string {
  return digitalHumanMediaUrlFromPaths(item.poster, item.localPosterPath);
}

/** 从数字人库拖到画布 */
export const NEXFLOW_DIGITAL_HUMAN_DRAG_MIME = 'application/x-nexflow-digital-human';

/** 从 RVC 音色库拖到画布 */
export const NEXFLOW_RVC_VOICE_DRAG_MIME = 'application/x-nexflow-rvc-voice';

/** RVC 音色模型资产库条目（训练产出的 zip 包，仅素材库管理，不可在声音节点播放） */
export interface RvcVoiceLibraryItem {
  id: string;
  nickname: string;
  name: string;
  createdAt: number;
  /** 列表头像（可选） */
  avatar?: string;
  localAvatarPath?: string;
  /** 训练时填写的模型名称（可选，与显示名可不同） */
  rvcTrainModelName?: string;
  /** 模型包文件名（不含扩展名，默认显示名来源） */
  packageFileName?: string;
  /** 本地模型包 URL（local-resource） */
  modelPackageUrl?: string;
  localModelPath?: string;
  /** 原始远程 URL（RunningHub 24h 有效，仅作备份） */
  originalModelUrl?: string;
  /** 训练用声音片段 */
  trainAudioUrl?: string;
  localTrainAudioPath?: string;
  originalTrainAudioUrl?: string;
}

function rvcVoiceMediaUrlFromPaths(url?: string, localPath?: string, remoteFallback?: string): string {
  const lp = (localPath || '').trim();
  if (lp && pathLooksAbsolute(lp)) {
    const normalized = lp.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1));
    return `local-resource://${normalized}`;
  }
  const u = (url || '').trim();
  if (isLoadableMediaUrl(u)) return u;
  const remote = (remoteFallback || '').trim();
  if (isLoadableMediaUrl(remote)) return remote;
  return '';
}

/** RVC 模型包 URL（zip 等） */
export function rvcVoiceModelPackageUrl(item: RvcVoiceLibraryItem): string {
  return rvcVoiceMediaUrlFromPaths(item.modelPackageUrl, item.localModelPath, item.originalModelUrl);
}

/** RVC 训练音频片段 URL */
export function rvcVoiceTrainAudioUrl(item: RvcVoiceLibraryItem): string {
  return rvcVoiceMediaUrlFromPaths(item.trainAudioUrl, item.localTrainAudioPath, item.originalTrainAudioUrl);
}

/** 从模型包路径/URL 提取默认显示名（文件名去扩展名） */
export function deriveRvcPackageDisplayName(urlOrPath: string, localPath?: string): string {
  const raw = (localPath || urlOrPath || '').trim();
  if (!raw) return 'RVC';
  const withoutQuery = raw.split('?')[0];
  const base = withoutQuery.split(/[/\\]/).pop() || 'RVC';
  const stripped = base.replace(/\.(zip|pth|index|tar\.gz|tgz)$/i, '').trim();
  return stripped || 'RVC';
}

/** 音色库卡片 / 画布展示名：优先训练时填写的模型名称 */
export function rvcVoiceDisplayName(item: RvcVoiceLibraryItem, fallback = '未命名音色'): string {
  const model = (item.rvcTrainModelName || '').trim();
  if (model) return model;
  const nick = (item.nickname || item.name || '').trim();
  if (nick) return nick;
  const pkg = (item.packageFileName || '').trim();
  if (pkg) return pkg;
  const derived = deriveRvcPackageDisplayName(item.modelPackageUrl || '', item.localModelPath);
  return derived !== 'RVC' ? derived : fallback;
}

/** RVC 音色库卡片头像 */
export function rvcVoiceAvatarUrl(item: RvcVoiceLibraryItem): string {
  const lp = (item.localAvatarPath || '').trim();
  if (lp && pathLooksAbsolute(lp)) {
    return formatLocalResourceFromFsPath(lp);
  }
  const av = (item.avatar || '').trim();
  if (isLoadableMediaUrl(av)) return av;
  return '';
}

/** 解析角色参考音 URL（角色列表试听 / 拖入画布与主进程 local-resource 规则一致） */
export function resolveCharacterVoiceUrlForDrag(character: Character): string | null {
  if (character.localVoicePath) {
    const normalized = character.localVoicePath
      .replace(/\\/g, '/')
      .replace(/^\/[a-zA-Z]:/, (m) => m.substring(1));
    return `local-resource://${normalized}`;
  }
  const v = (character.voiceClip || '').trim();
  if (!v) return null;
  if (v.startsWith('local-resource://') || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) {
    return v;
  }
  if (v.startsWith('file://')) return v;
  return `local-resource://${v}`;
}
