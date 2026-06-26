import type { Node } from 'reactflow';
import type { Character } from '../components/characterListShared';
import { IMAGE_TO_3D_HEIGHT, IMAGE_TO_3D_WIDTH } from '../constants/imageTo3dLayout';

export function formatLocalResourceFromFsPath(fsPath: string): string {
  let normalizedPath = fsPath.replace(/\\/g, '/');
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
    normalizedPath = normalizedPath.substring(1);
  }
  return `local-resource://${normalizedPath}`;
}

/** 从角色库条目或导入结果在画布上创建「图片转 3D」节点 */
export function buildImageTo3dNodeFromCharacter(
  character: Character,
  flowPosition: { x: number; y: number },
  nodeId?: string,
): Node {
  const w = IMAGE_TO_3D_WIDTH;
  const h = IMAGE_TO_3D_HEIGHT;
  const nodePosition = { x: flowPosition.x - w / 2, y: flowPosition.y - h / 2 };
  const id = nodeId || `imageTo3d-${Date.now()}`;
  const inputUrl = (character.inputImageUrl || character.avatar || '').trim();
  const glbUrl =
    (character.localGlbUrl || '').trim() ||
    (character.localGlbPath ? formatLocalResourceFromFsPath(character.localGlbPath) : '') ||
    (character.remoteGlbUrl || '').trim();
  const tex =
    (character.resultTextureUrl || '').trim() ||
    (character.localTexturePath ? formatLocalResourceFromFsPath(character.localTexturePath) : '');
  return {
    id,
    type: 'imageTo3d',
    position: nodePosition,
    data: {
      label: '图片转 3D',
      title: 'imageTo3d',
      width: w,
      height: h,
      isUserResized: false,
      inputImageUrl: inputUrl,
      outputGlbUrl: glbUrl,
      localGlbUrl: character.localGlbUrl,
      localGlbPath: character.localGlbPath,
      remoteGlbUrl: character.remoteGlbUrl,
      resultTextureUrl: tex || undefined,
      localTexturePath: character.localTexturePath,
      progress: 0,
      progressMessage: '',
      libraryCharacterId: character.id,
    },
    selected: true,
    selectable: true,
  };
}
