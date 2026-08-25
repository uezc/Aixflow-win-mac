/** 从提示词解析 Seedance / 导演用的 @图片N / @ImageN（1-based，去重保序） */
export function extractSeedanceImageMentionIndices(prompt: string): number[] {
  const text = String(prompt || '');
  if (!text) return [];
  const re = /@(?:图片|Image)\s*(\d+)/gi;
  const seen = new Set<number>();
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number.parseInt(m[1], 10);
    if (!Number.isFinite(n) || n < 1 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function parseDirectorBindingRows(
  prompt: string,
): Array<{ n: number; kind: string; name: string }> {
  const out: Array<{ n: number; kind: string; name: string }> = [];
  const re = /@图片\s*(\d+)\s*作为第\d+张参考图｜([^｜\n]+)｜([^｜\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(prompt || '')))) {
    const n = Number.parseInt(m[1], 10);
    if (!Number.isFinite(n) || n < 1) continue;
    out.push({ n, kind: String(m[2] || '').trim(), name: String(m[3] || '').trim() });
  }
  return out;
}

function findVideoAssetByName(
  name: string,
  refs: DirectorVideoAssetRef[],
): DirectorVideoAssetRef | undefined {
  const n = String(name || '').trim();
  if (n.length < 2) return undefined;
  const exact = refs.find((a) => String(a.name || '').trim() === n);
  if (exact) return exact;
  return refs.find((a) => {
    const an = String(a.name || '').trim();
    if (an.length < 2) return false;
    return an.includes(n) || n.includes(an);
  });
}

export type DirectorVideoAssetRef = {
  id?: string;
  imageUrl: string;
  name?: string;
  kind?: string;
};

/**
 * 按镜筛选参考图：只保留提示词中 @图片N（或画面描述里点名的资产），
 * 并重编号为 @图片1..K，避免把全量角色/场景塞进每个视频节点。
 */
export function sliceDirectorShotAssetsForVideo(
  prompt: string,
  orderedAssetsWithImages: DirectorVideoAssetRef[],
  options?: { fallbackText?: string; maxImages?: number },
): { prompt: string; inputImages: string[] } {
  const maxImages = Math.max(1, Math.min(9, options?.maxImages ?? 9));
  const refs = (orderedAssetsWithImages || []).filter((a) => String(a?.imageUrl || '').trim());
  const rawPrompt = String(prompt || '');
  const bindings = parseDirectorBindingRows(rawPrompt);
  if (bindings.length > 0) {
    const inputImages: string[] = [];
    for (const b of bindings) {
      if (/风格|场景|道具|生物|分镜/.test(b.kind)) continue;
      if (b.kind && !/角色|人物/.test(b.kind)) continue;
      const hit = findVideoAssetByName(b.name, refs);
      const url = String(hit?.imageUrl || '').trim();
      if (!url || inputImages.includes(url)) continue;
      inputImages.push(url);
      if (inputImages.length >= maxImages) break;
    }
    return { prompt: rawPrompt, inputImages };
  }

  let indices = extractSeedanceImageMentionIndices(rawPrompt);

  if (indices.length === 0) {
    const blob = `${rawPrompt}\n${String(options?.fallbackText || '')}`;
    refs.forEach((a, i) => {
      const name = String(a.name || '').trim();
      if (name && blob.includes(name)) indices.push(i + 1);
    });
  }

  const seen = new Set<number>();
  const picked: number[] = [];
  for (const n of indices) {
    if (n < 1 || n > refs.length || seen.has(n)) continue;
    seen.add(n);
    picked.push(n);
    if (picked.length >= maxImages) break;
  }

  if (picked.length === 0) {
    return { prompt: rawPrompt, inputImages: [] };
  }

  const alreadySequential = picked.every((n, i) => n === i + 1);
  const hadMentions = /@(?:图片|Image)\s*\d+/i.test(rawPrompt);
  let newPrompt = rawPrompt;
  if (hadMentions && !alreadySequential) {
    const oldToNew = new Map<number, number>();
    picked.forEach((oldN, i) => oldToNew.set(oldN, i + 1));
    newPrompt = rawPrompt
      .replace(/@(?:图片|Image)\s*(\d+)/gi, (_full, numStr: string) => {
        const oldN = Number.parseInt(numStr, 10);
        const neu = oldToNew.get(oldN);
        return neu != null ? `@图片${neu}` : '';
      })
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const inputImages = picked.map((n) => String(refs[n - 1].imageUrl).trim()).filter(Boolean);
  return { prompt: newPrompt, inputImages };
}
