export type TextSplitNodeLikeData = {
  inputText?: string;
  /** @deprecated 已固定按换行拆分，保留字段仅兼容旧工程 */
  separator?: string;
  trimAndFilterEmpty?: boolean;
  convertType?: 'string' | 'number' | 'boolean';
  segments?: (string | number | boolean)[];
};

/** 文本拆分模块固定分隔符：换行 */
export const TEXT_SPLIT_DEFAULT_SEPARATOR = '\n';

function tryConvert(value: string, mode: 'string' | 'number' | 'boolean'): string | number | boolean {
  if (mode === 'string') return value;
  if (mode === 'number') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
    return value;
  }
  if (mode === 'boolean') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0' || lower === '') return false;
    return value;
  }
  return value;
}

/** 与 TextSplitNode 内 computeSegments 保持一致：固定按换行拆分 */
export function computeTextSplitSegments(
  inputText: string,
  _separator: string = TEXT_SPLIT_DEFAULT_SEPARATOR,
  trimAndFilterEmpty = true,
  convertType: 'string' | 'number' | 'boolean' = 'string',
): (string | number | boolean)[] {
  if (inputText == null || String(inputText).trim() === '') return [];
  const raw = String(inputText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let parts = raw.split('\n');
  if (trimAndFilterEmpty) {
    parts = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  } else {
    parts = parts.map((p) => p.trim());
  }
  return parts.map((p) => tryConvert(p, convertType));
}

/** 按 inputText 换行拆分；无正文时才回退已持久化的 segments */
export function resolveTextSplitSegments(
  data?: TextSplitNodeLikeData | null,
): (string | number | boolean)[] {
  const input = String(data?.inputText ?? '');
  if (input.trim()) {
    return computeTextSplitSegments(
      input,
      TEXT_SPLIT_DEFAULT_SEPARATOR,
      data?.trimAndFilterEmpty ?? true,
      data?.convertType ?? 'string',
    );
  }
  if (Array.isArray(data?.segments) && data.segments.length > 0) return data.segments;
  return [];
}

/** 从 textSplit 边的 sourceHandle 解析分段下标；缺省 / legacy `output` 视为第 0 段 */
export function resolveTextSplitSegmentIndex(
  sourceHandle: string | null | undefined,
): number | null {
  const sh = String(sourceHandle ?? '').trim();
  if (!sh || sh === 'output') return 0;
  if (sh === 'output-null') return null;
  if (sh.startsWith('output-')) {
    const idx = parseInt(sh.replace('output-', ''), 10);
    return Number.isInteger(idx) && idx >= 0 ? idx : 0;
  }
  return 0;
}

export function normalizeTextSplitSourceHandle(
  sourceHandle: string | null | undefined,
): string {
  const idx = resolveTextSplitSegmentIndex(sourceHandle);
  return idx == null ? 'output-null' : `output-${idx}`;
}

export function pickTextSplitSegmentText(
  segmentsOrData: (string | number | boolean)[] | TextSplitNodeLikeData | undefined | null,
  sourceHandle: string | null | undefined,
): string {
  const segments = Array.isArray(segmentsOrData)
    ? segmentsOrData
    : resolveTextSplitSegments(segmentsOrData);
  if (!segments.length) return '';
  const idx = resolveTextSplitSegmentIndex(sourceHandle);
  if (idx == null || segments[idx] === undefined) return '';
  return String(segments[idx]).trim();
}

type CanvasNodeLike = { id: string; type?: string; data?: TextSplitNodeLikeData & Record<string, unknown> };
type CanvasEdgeLike = { source: string; target: string; sourceHandle?: string | null };

/** 按入边顺序收集上游文本（Text / LLM 输出 / 文本拆分 / 转写） */
export function collectUpstreamTextPartsForTarget(
  targetId: string,
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  opts?: { includeAudioTranscribe?: boolean },
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  for (const e of edges) {
    if (e.target !== targetId) continue;
    const src = byId.get(e.source);
    if (!src) continue;
    if (src.type === 'minimalistText' || src.type === 'text') {
      const t = String(src.data?.text ?? '').trim();
      if (t) parts.push(t);
    } else if (src.type === 'llm') {
      const t = String(src.data?.outputText ?? '').trim();
      if (t) parts.push(t);
    } else if (src.type === 'audioTranscribe' && opts?.includeAudioTranscribe) {
      const t = String(src.data?.text ?? '').trim();
      if (t) parts.push(t);
    } else if (src.type === 'textSplit') {
      const segText = pickTextSplitSegmentText(src.data, e.sourceHandle);
      if (segText) parts.push(segText);
    }
  }
  return parts;
}

export function resolveLlmInputTextFromEdges(
  llmId: string,
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
): string {
  return collectUpstreamTextPartsForTarget(llmId, nodes, edges, { includeAudioTranscribe: true }).join(',');
}

/** 上游已连入 LLM 的文本源标题（用于底栏标签，多源用 · 拼接） */
export function collectLinkedTextTitlesForTarget(
  llmId: string,
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
): string {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const titles: string[] = [];
  for (const e of edges) {
    if (e.target !== llmId) continue;
    const src = nodeById.get(e.source);
    if (!src) continue;
    const isText = src.type === 'minimalistText' || src.type === 'text';
    const isLlm = src.type === 'llm' && !!String(src.data?.outputText ?? '').trim();
    const isSplit = src.type === 'textSplit';
    const isTranscribe = src.type === 'audioTranscribe' && !!String(src.data?.text ?? '').trim();
    if (!isText && !isLlm && !isSplit && !isTranscribe) continue;
    const title = String(src.data?.title ?? '').trim();
    if (title) {
      titles.push(title);
    } else if (isText) {
      titles.push('文本');
    } else if (src.type === 'llm') {
      titles.push('llm');
    } else if (isSplit) {
      titles.push('文本拆分');
    } else {
      titles.push('转写');
    }
  }
  return titles.join(' · ');
}
