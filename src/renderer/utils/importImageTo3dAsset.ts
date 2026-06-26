import type { Character } from '../components/characterListShared';

export type ImageTo3dImportItem = {
  nickname: string;
  localGlbPath: string;
  localGlbUrl: string;
  localTexturePath?: string;
  resultTextureUrl?: string;
  inputImageUrl?: string;
  localAvatarPath?: string;
};

export async function importImageTo3dAssetsToCharacters(opts?: {
  filePath?: string;
}): Promise<{ canceled: true; characters: [] } | { canceled: false; characters: Character[] }> {
  if (!window.electronAPI?.importImageTo3dAsset || !window.electronAPI?.registerImageTo3dCharacter) {
    throw new Error('导入功能未就绪，请重新编译主进程后重启应用');
  }
  const res = await window.electronAPI.importImageTo3dAsset(opts);
  if (res.canceled) return { canceled: true, characters: [] };
  const items: ImageTo3dImportItem[] = res.items ?? (res.item ? [res.item] : []);
  if (!items.length) throw new Error('未能导入任何 3D 模型');
  const characters: Character[] = [];
  for (const item of items) {
    const char = await window.electronAPI.registerImageTo3dCharacter({
      nickname: item.nickname,
      inputImageUrl: item.inputImageUrl,
      localAvatarPath: item.localAvatarPath,
      localGlbPath: item.localGlbPath,
      localGlbUrl: item.localGlbUrl,
      resultTextureLocalUrl: item.resultTextureUrl,
      resultTextureRemoteUrl: item.resultTextureUrl,
    });
    characters.push({
      ...(char as Character),
      assetKind: 'imageTo3d',
      avatar: (char as Character).avatar || item.inputImageUrl || '',
      inputImageUrl: (char as Character).inputImageUrl || item.inputImageUrl || '',
      localAvatarPath: (char as Character).localAvatarPath || item.localAvatarPath,
      localTexturePath: (char as Character).localTexturePath || item.localTexturePath,
    } as Character);
  }
  return { canceled: false, characters };
}
