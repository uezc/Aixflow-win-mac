/**
 * 生成节点提示词 @ 引用候选：仅当前节点上游接入素材
 *（入边源节点 + 面板已挂载参考图），不扫全画布、不塞全局角色/场景库。
 */

export type PromptMentionKind = 'text' | 'image' | 'video' | 'audio';

export type PromptMentionCandidate = {
  id: string;
  origin: 'node' | 'asset' | 'ref';
  type: PromptMentionKind;
  /** 菜单主文案（节点标题 / 资产名） */
  label: string;
  /** AI Canvas 风格序号标签，如 图片1、文本2 */
  refLabel?: string;
  thumbUrl?: string;
  /** 选中后写入提示词的文本 */
  insertText: string;
  subtitle?: string;
  nodeId?: string;
  content?: string;
};

export type MentionCanvasNode = {
  id: string;
  type?: string;
  data?: Record<string, unknown> | null;
};

export type MentionCanvasEdge = {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};

const AT_TYPE_MAP: Record<PromptMentionKind, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
};

const AT_TYPE_MAP_EN: Record<PromptMentionKind, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
};

function normalizeText(v: unknown): string {
  return String(v ?? '').trim();
}

function typeLabel(kind: PromptMentionKind, locale?: string): string {
  return locale === 'en' ? AT_TYPE_MAP_EN[kind] : AT_TYPE_MAP[kind];
}

/** 将 NEXFLOW 节点 type 映射为 AI Canvas 的 mention kind */
export function resolveMentionKind(node: MentionCanvasNode): PromptMentionKind | null {
  const t = String(node.type || '').trim();
  if (!t) return null;
  if (
    t === 'minimalistText' ||
    t === 'text' ||
    t === 'llm' ||
    t === 'textSplit' ||
    t === 'audioTranscribe' ||
    t === 'storyboardScript'
  ) {
    return 'text';
  }
  if (t === 'image' || t === 'photoCollage' || t === 'imageTo3d' || t === 'gridMap') return 'image';
  if (t === 'video' || t === 'videoSplice' || t === 'wanAnimate' || t === 'heyGem' || t === 'director') {
    return 'video';
  }
  if (t === 'audio' || t === 'rvcTrain') return 'audio';
  if (t === 'character') return 'image';
  return null;
}

function pickNodeTitle(node: MentionCanvasNode, fallback: string): string {
  const d = node.data || {};
  const title =
    normalizeText(d.title) ||
    normalizeText(d.nickname) ||
    normalizeText(d.label) ||
    normalizeText(d.name) ||
    normalizeText(d.songName);
  if (title && title !== 'image' && title !== 'video' && title !== 'text' && title !== 'audio' && title !== 'character') {
    return title;
  }
  return title || fallback;
}

function pickTextContent(node: MentionCanvasNode): string {
  const d = node.data || {};
  return (
    normalizeText(d.outputText) ||
    normalizeText(d.text) ||
    normalizeText(d.prompt) ||
    normalizeText(d.name) ||
    ''
  );
}

function pickThumbUrl(node: MentionCanvasNode, kind: PromptMentionKind): string {
  const d = (node.data || {}) as Record<string, any>;
  if (kind === 'image' || node.type === 'character') {
    const fromList = Array.isArray(d.outputImages) ? normalizeText(d.outputImages[0]) : '';
    return (
      normalizeText(d.outputImage) ||
      normalizeText(d.originalImageUrl) ||
      fromList ||
      normalizeText(d.avatar) ||
      normalizeText(d.libraryAvatarUrl) ||
      ''
    );
  }
  if (kind === 'video') {
    return (
      normalizeText(d.videoAsset?.poster) ||
      normalizeText(d.poster) ||
      normalizeText(d.thumbnailUrl) ||
      ''
    );
  }
  return '';
}

function pickMediaUrl(node: MentionCanvasNode, kind: PromptMentionKind): string {
  const d = (node.data || {}) as Record<string, any>;
  if (kind === 'image') {
    return pickThumbUrl(node, kind);
  }
  if (kind === 'video') {
    return normalizeText(d.outputVideo) || normalizeText(d.originalVideoUrl) || '';
  }
  if (kind === 'audio') {
    return (
      normalizeText(d.outputAudio) ||
      normalizeText(d.originalAudioUrl) ||
      (Array.isArray(d.outputAudios) ? normalizeText(d.outputAudios[0]) : '') ||
      ''
    );
  }
  return pickTextContent(node);
}

function buildInsertText(opts: {
  kind: PromptMentionKind;
  label: string;
  refLabel?: string;
  content?: string;
  locale?: string;
  preferSeedanceTag?: boolean;
}): string {
  const { kind, label, refLabel, content, preferSeedanceTag } = opts;
  if (kind === 'text') {
    const body = normalizeText(content);
    if (body) return body;
    return `@${label}`;
  }
  if (kind === 'image' && preferSeedanceTag && refLabel) {
    const m = refLabel.match(/(\d+)\s*$/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1) {
        return opts.locale === 'en' ? `@Image${n}` : `@图片${n}`;
      }
    }
  }
  return `@${refLabel || label}`;
}

export function findLastMentionTriggerIndex(text: string, endOffset?: number): number {
  const s = String(text || '');
  const to = Number.isFinite(endOffset) ? Math.max(0, Number(endOffset) - 1) : undefined;
  return Math.max(s.lastIndexOf('@', to), s.lastIndexOf('＠', to));
}

/** 从 textarea 光标前文本解析 `@query` */
export function parseAtMentionQuery(value: string, cursor: number): { atIndex: number; query: string } | null {
  const before = String(value || '').slice(0, Math.max(0, cursor));
  const atIndex = findLastMentionTriggerIndex(before);
  if (atIndex < 0) return null;
  const query = before.slice(atIndex + 1);
  if (query.length > 20) return null;
  // 不允许跨空白再匹配更早的 @
  if (/[\s\n]/.test(query)) return null;
  return { atIndex, query };
}

export function applyMentionInsert(
  value: string,
  cursor: number,
  insertText: string,
): { next: string; cursor: number } {
  const parsed = parseAtMentionQuery(value, cursor);
  const text = String(insertText || '');
  const spacer = text.endsWith(' ') || text.endsWith('\n') ? '' : ' ';
  if (!parsed) {
    const next = value.slice(0, cursor) + text + spacer + value.slice(cursor);
    return { next, cursor: cursor + text.length + spacer.length };
  }
  const next = value.slice(0, parsed.atIndex) + text + spacer + value.slice(cursor);
  return { next, cursor: parsed.atIndex + text.length + spacer.length };
}

export type BuildMentionCandidatesOptions = {
  targetNodeId: string;
  nodes: MentionCanvasNode[];
  edges: MentionCanvasEdge[];
  /** 当前面板已挂载的参考图（上游连线带入，对齐 Seedance @图片N） */
  orderedInputImages?: string[];
  locale?: string;
  query?: string;
  preferSeedanceTag?: boolean;
  maxItems?: number;
};

function matchesQuery(c: PromptMentionCandidate, query: string): boolean {
  const q = normalizeText(query).replace(/^@+/, '').toLowerCase();
  if (!q) return true;
  const blob = [c.label, c.refLabel, c.subtitle, typeLabel(c.type), c.content]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return blob.includes(q);
}

/**
 * 构建 @ 菜单候选项：仅上游接入素材（参考图 + 入边源节点）。
 */
export function buildPromptMentionCandidates(opts: BuildMentionCandidatesOptions): PromptMentionCandidate[] {
  const {
    targetNodeId,
    nodes,
    edges,
    orderedInputImages = [],
    locale,
    query = '',
    preferSeedanceTag = false,
    maxItems = 40,
  } = opts;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const counters: Record<PromptMentionKind, number> = { text: 0, image: 0, video: 0, audio: 0 };
  const out: PromptMentionCandidate[] = [];
  const seen = new Set<string>();

  const push = (c: PromptMentionCandidate) => {
    if (seen.has(c.id)) return;
    if (!matchesQuery(c, query)) return;
    seen.add(c.id);
    out.push(c);
  };

  // 1) 当前节点已接入参考图（连线带入 / 面板 inputImages）
  orderedInputImages.forEach((url, i) => {
    const u = normalizeText(url);
    if (!u) return;
    counters.image += 1;
    const n = counters.image;
    const refLabel = `${typeLabel('image', locale)}${n}`;
    push({
      id: `ref-image-${i}`,
      origin: 'ref',
      type: 'image',
      label: refLabel,
      refLabel,
      thumbUrl: u,
      insertText: buildInsertText({
        kind: 'image',
        label: refLabel,
        refLabel,
        locale,
        preferSeedanceTag: true,
      }),
      subtitle: locale === 'en' ? 'Reference' : '参考图',
    });
  });

  // 2) 入边源节点（文本/图片/视频/音频等）
  for (const e of edges) {
    if (e.target !== targetNodeId) continue;
    const src = byId.get(e.source);
    if (!src || src.id === targetNodeId) continue;
    const kind = resolveMentionKind(src);
    if (!kind) continue;
    const mediaOrText = kind === 'text' ? pickTextContent(src) : pickMediaUrl(src, kind);
    if (!mediaOrText) continue;
    counters[kind] += 1;
    const refLabel = `${typeLabel(kind, locale)}${counters[kind]}`;
    const label = pickNodeTitle(src, refLabel);
    push({
      id: `node-${src.id}`,
      origin: 'node',
      type: kind,
      label,
      refLabel,
      thumbUrl: pickThumbUrl(src, kind) || undefined,
      content: kind === 'text' ? mediaOrText : undefined,
      nodeId: src.id,
      insertText: buildInsertText({
        kind,
        label,
        refLabel,
        content: kind === 'text' ? mediaOrText : undefined,
        locale,
        preferSeedanceTag,
      }),
      subtitle: typeLabel(kind, locale),
    });
  }

  return out.slice(0, maxItems);
}
