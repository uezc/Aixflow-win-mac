/**
 * 分析阶段是否跳过云端 LLM。
 * 生产建议 true。P1-A1 真实 LLM 灰度验收临时默认 false。
 * 覆盖：VITE_SKIP_LLM_ANALYZE / NEXFLOW_SKIP_LLM_ANALYZE = true|false
 */
export const SKIP_LLM_ANALYZE_DEFAULT = false;

export function resolveSkipLlmAnalyze(raw?: string | null): boolean {
  const v = String(raw ?? '').trim();
  if (!v) return SKIP_LLM_ANALYZE_DEFAULT;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|off|no)$/i.test(v)) return false;
  return SKIP_LLM_ANALYZE_DEFAULT;
}
