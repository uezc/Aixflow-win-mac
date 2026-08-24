/** 画布上的导演类节点：MV 与 AI 短剧为两个独立 React Flow type */

export const DIRECTOR_MV_NODE_TYPE = 'director';
export const DIRECTOR_DRAMA_NODE_TYPE = 'directorDrama';

export type DirectorCanvasNodeType =
  | typeof DIRECTOR_MV_NODE_TYPE
  | typeof DIRECTOR_DRAMA_NODE_TYPE;

export function isDirectorNodeType(
  type: string | null | undefined,
): type is DirectorCanvasNodeType {
  return type === DIRECTOR_MV_NODE_TYPE || type === DIRECTOR_DRAMA_NODE_TYPE;
}

export function isDirectorDramaNodeType(type: string | null | undefined): boolean {
  return type === DIRECTOR_DRAMA_NODE_TYPE;
}

export function isDirectorMvNodeType(type: string | null | undefined): boolean {
  return type === DIRECTOR_MV_NODE_TYPE;
}

/** 由节点 type 锁定流水线 mode（两模块互不切换） */
export function directorModeForNodeType(
  type: string | null | undefined,
): 'drama' | 'mv' {
  return type === DIRECTOR_DRAMA_NODE_TYPE ? 'drama' : 'mv';
}
