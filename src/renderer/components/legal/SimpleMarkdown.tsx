import React from 'react';

type Block =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] };

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`b-${key++}`} className="font-semibold text-white/95">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(
        <code key={`c-${key++}`} className="rounded bg-white/10 px-1 py-0.5 text-[0.9em]">
          {token.slice(1, -1)}
        </code>
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function parseMarkdownBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', text: trimmed.slice(2).trim() });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', text: trimmed.slice(3).trim() });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', text: trimmed.slice(4).trim() });
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    const para: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || t.startsWith('#') || /^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) break;
      para.push(t);
      i += 1;
    }
    blocks.push({ type: 'p', text: para.join(' ') });
  }
  return blocks;
}

/** 轻量 Markdown 展示（标题 / 段落 / 列表 / 粗体），协议正文用。 */
export const SimpleMarkdown: React.FC<{ markdown: string; className?: string }> = ({
  markdown,
  className = '',
}) => {
  const blocks = React.useMemo(() => parseMarkdownBlocks(markdown || ''), [markdown]);
  return (
    <div className={`space-y-3 text-left text-sm leading-relaxed text-white/75 ${className}`}>
      {blocks.map((b, idx) => {
        if (b.type === 'h1') {
          return (
            <h1 key={idx} className="pt-1 text-lg font-semibold tracking-tight text-white">
              {parseInline(b.text)}
            </h1>
          );
        }
        if (b.type === 'h2') {
          return (
            <h2 key={idx} className="pt-2 text-base font-semibold text-white/95">
              {parseInline(b.text)}
            </h2>
          );
        }
        if (b.type === 'h3') {
          return (
            <h3 key={idx} className="pt-1 text-sm font-semibold text-white/90">
              {parseInline(b.text)}
            </h3>
          );
        }
        if (b.type === 'ul') {
          return (
            <ul key={idx} className="list-disc space-y-1.5 pl-5">
              {b.items.map((item, j) => (
                <li key={j}>{parseInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={idx} className="text-white/70">
            {parseInline(b.text)}
          </p>
        );
      })}
    </div>
  );
};
