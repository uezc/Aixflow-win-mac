/**
 * 短剧本镜 → MiniMax H3 中文官方结构。
 * 实现已迁至 h3PromptCompiler.ts（A–H Compiler）。
 */

export { composeDramaH3OfficialSixSection } from './h3PromptCompiler.js';

export function isDramaH3ZhSixSectionPrompt(text: string): boolean {
  const t = String(text || '');
  return (
    (/主体定义\s*[：:]/.test(t) && /详细描述\s*[：:]/.test(t) && /整体声景\s*[：:]/.test(t)) ||
    (/【H3编译·模式】/.test(t) && /【主体定义】/.test(t))
  );
}
