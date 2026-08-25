/**
 * 读取本地镜像的 MiniMax-H3 h3-prompt-writing skill（resources/skills）。
 * 打包后从 extraResources/skills 读取。
 *
 * 开发（electron . / vite）与打包路径差异大：不能只查 process.resourcesPath。
 * 候选顺序：打包 resources → 项目根 resources → 相对本文件(__dirname) → cwd。
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type MinimaxH3GuideKind = 'base' | 'ref';

const SKILL_SEGMENTS = ['skills', 'minimax-h3', 'h3-prompt-writing'] as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedSkillRoot: string | null | undefined;

function skillRel(...base: string[]): string {
  return path.join(...base, ...SKILL_SEGMENTS);
}

function skillRootCandidates(): string[] {
  const out: string[] = [];
  const push = (p: string | null | undefined) => {
    if (!p) return;
    const n = path.normalize(p);
    if (!out.includes(n)) out.push(n);
  };

  // 1) 安装包：extraResources 将 resources/skills → process.resourcesPath/skills
  if (process.resourcesPath) {
    push(path.join(process.resourcesPath, ...SKILL_SEGMENTS));
  }

  // 2) 开发/未打包：项目根下 resources/skills/...
  try {
    push(skillRel(app.getAppPath(), 'resources'));
  } catch {
    /* app 未就绪时忽略 */
  }

  // 3) 相对编译产物：dist-electron/main/utils → ../../../resources/...
  //    （避免 cwd 被 IDE/脚本改成别的目录时找不到）
  push(skillRel(__dirname, '../../..', 'resources'));
  push(skillRel(__dirname, '../../../..', 'resources'));

  // 4) 当前工作目录（npm run electron:dev 通常为仓库根）
  push(skillRel(process.cwd(), 'resources'));

  // 5) 少数情况下 appPath 指向 dist-electron，再上一级找 resources
  try {
    const appPath = app.getAppPath();
    push(skillRel(appPath, '..', 'resources'));
    push(skillRel(path.dirname(appPath), 'resources'));
  } catch {
    /* ignore */
  }

  return out;
}

function isCompleteSkillRoot(root: string): boolean {
  return (
    fs.existsSync(path.join(root, 'SKILL.md')) &&
    fs.existsSync(path.join(root, 'references', 'base-en.txt')) &&
    fs.existsSync(path.join(root, 'references', 'ref-en.txt'))
  );
}

function resolveSkillRoot(): string | null {
  if (cachedSkillRoot !== undefined) return cachedSkillRoot;

  const candidates = skillRootCandidates();
  for (const root of candidates) {
    if (isCompleteSkillRoot(root)) {
      console.log('[minimaxH3SkillGuide] using skill root:', root);
      cachedSkillRoot = root;
      return root;
    }
  }
  console.warn(
    '[minimaxH3SkillGuide] skill root not found. candidates=',
    candidates.map((c) => ({
      path: c,
      skillMd: fs.existsSync(path.join(c, 'SKILL.md')),
      base: fs.existsSync(path.join(c, 'references', 'base-en.txt')),
      ref: fs.existsSync(path.join(c, 'references', 'ref-en.txt')),
    })),
  );
  cachedSkillRoot = null;
  return null;
}

function readUtf8(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function guideFileName(kind: MinimaxH3GuideKind): string {
  return kind === 'ref' ? 'ref-en.txt' : 'base-en.txt';
}

export function readMinimaxH3SkillMd(): string {
  const root = resolveSkillRoot();
  if (!root) throw new Error('未找到 MiniMax-H3 skill（resources/skills/minimax-h3/h3-prompt-writing）');
  return readUtf8(path.join(root, 'SKILL.md'));
}

export function readMinimaxH3PromptGuide(kind: MinimaxH3GuideKind): string {
  const root = resolveSkillRoot();
  if (!root) throw new Error('未找到 MiniMax-H3 skill（resources/skills/minimax-h3/h3-prompt-writing）');
  const file = guideFileName(kind);
  const full = path.join(root, 'references', file);
  if (!fs.existsSync(full)) {
    throw new Error(`缺少指南文件: ${file}`);
  }
  return readUtf8(full);
}

export function loadMinimaxH3PromptWritingBundle(kind: MinimaxH3GuideKind): {
  skillMd: string;
  guide: string;
  kind: MinimaxH3GuideKind;
  root: string;
} {
  const root = resolveSkillRoot();
  if (!root) throw new Error('未找到 MiniMax-H3 skill（resources/skills/minimax-h3/h3-prompt-writing）');
  const file = guideFileName(kind);
  const full = path.join(root, 'references', file);
  if (!fs.existsSync(full)) {
    throw new Error(`缺少指南文件: ${file}`);
  }
  return {
    skillMd: readUtf8(path.join(root, 'SKILL.md')),
    guide: readUtf8(full),
    kind,
    root,
  };
}
