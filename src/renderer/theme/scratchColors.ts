/** Scratch 3.0 官方分类色 */
export const SCRATCH_COLORS = {
  motion: '#4C97FF',
  looks: '#9966FF',
  sound: '#CF63CF',
  events: '#FFBF00',
  control: '#FFAB19',
  sensing: '#5CB1D6',
  operators: '#59C059',
  variables: '#FF8C1A',
  myBlocks: '#FF6680',
} as const;

export type ScratchColorId = keyof typeof SCRATCH_COLORS;

/** 明亮模式：仅作配色修饰，不改变按钮外形（需配合 nexflow-btn / scratch-float-btn 等基底） */
export function scratchTintClass(id: ScratchColorId, extra = ''): string {
  return `scratch-tint scratch-tint--${id} ${extra}`.trim();
}

/** @deprecated 请优先用 scratchTintClass；保留别名，仅输出配色 class */
export function scratchBtnClass(id: ScratchColorId, extra = ''): string {
  return scratchTintClass(id, extra);
}

/** @deprecated 与 scratchBtnClass 相同，不再附带圆形图标按钮外形 */
export function scratchIconBtnClass(id: ScratchColorId, extra = ''): string {
  return scratchTintClass(id, extra);
}
