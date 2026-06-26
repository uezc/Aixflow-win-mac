import { SCRATCH_COLORS } from '../theme/scratchColors';

const CARD_COLORS: readonly string[] = [
  SCRATCH_COLORS.operators,
  SCRATCH_COLORS.control,
  SCRATCH_COLORS.motion,
  SCRATCH_COLORS.events,
  SCRATCH_COLORS.looks,
  SCRATCH_COLORS.sound,
  SCRATCH_COLORS.sensing,
  SCRATCH_COLORS.variables,
  SCRATCH_COLORS.myBlocks,
];

function normHex(color: string): string {
  return color.trim().toUpperCase();
}

/** 黄/橙系 Scratch 色块上使用深色文字（与 scratch-chrome-btn 一致） */
const DARK_TEXT_ON: ReadonlySet<string> = new Set(
  [SCRATCH_COLORS.events, SCRATCH_COLORS.control, SCRATCH_COLORS.variables].map(normHex),
);

function hashProjectId(projectId: string): number {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) {
    h = (Math.imul(31, h) + projectId.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 按项目 ID 固定分配 Scratch 封面色，排序不改变颜色 */
export function projectCardColorForId(projectId: string): string {
  return CARD_COLORS[hashProjectId(projectId) % CARD_COLORS.length];
}

export function projectCardUsesDarkText(bgColor: string): boolean {
  return DARK_TEXT_ON.has(normHex(bgColor));
}

export function projectCardTextClasses(bgColor: string): { title: string; muted: string } {
  if (projectCardUsesDarkText(bgColor)) {
    return { title: 'text-gray-900', muted: 'text-gray-800/75' };
  }
  return { title: 'text-white', muted: 'text-white/80' };
}
