/** 合并同一时刻的 getCharacters，避免素材准备打开时连打三次把主进程堵住。 */

type CharacterRow = Record<string, unknown>;

let inflight: Promise<CharacterRow[]> | null = null;

export function getCharactersCoalesced<T = CharacterRow>(): Promise<T[]> {
  const api = window.electronAPI?.getCharacters;
  if (!api) return Promise.resolve([]);
  if (inflight) return inflight as Promise<T[]>;
  inflight = Promise.resolve(api())
    .then((list) => (Array.isArray(list) ? list : []))
    .catch((err) => {
      console.error('加载角色列表失败:', err);
      return [];
    })
    .finally(() => {
      inflight = null;
    });
  return inflight as Promise<T[]>;
}
