/**
 * RunningHub 请求经 FC 转发：提交扣费、轮询不扣费（与 ImageProvider 中 rhPost/rhQuery 模式一致）。
 */
import { randomUUID } from 'crypto';
import { fcForwardRequest } from './fcForwardTask.js';
import type { RhSealMediaFields } from './rhSealMedia.js';

export type { RhSealMediaFields } from './rhSealMedia.js';

export type RhAiAppNodeInfo = {
  nodeId: string;
  fieldName: string;
  fieldValue?: string;
  description?: string;
  fieldType?: string;
  nodeName?: string;
};

export type RhNodeInfoItem = {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  description?: string;
};

/** 经 FC 拉取 AI App 的 apiCallDemo nodeInfoList（需 FC 支持 /api/webapp/* 转发） */
export async function fetchRhAiAppCallDemoNodes(
  webappId: string,
  options?: { rhRegion?: 'cn' | 'ai' },
): Promise<RhAiAppNodeInfo[]> {
  const id = String(webappId || '').trim();
  if (!id) return [];
  const rhRegion = options?.rhRegion === 'ai' || options?.rhRegion === 'cn' ? options.rhRegion : 'cn';
  const { data } = await fcForwardRequest(randomUUID(), 'video', 'none', {
    provider: 'runninghub',
    path: `/api/webapp/apiCallDemo?webappId=${encodeURIComponent(id)}`,
    method: 'GET',
    body: {},
    rhRegion,
  });
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const unwrapped = unwrapRunningHubForwardBody(raw);
  const candidates = [
    unwrapped.nodeInfoList,
    (unwrapped.data as Record<string, unknown> | undefined)?.nodeInfoList,
    raw.nodeInfoList,
    (raw.data as Record<string, unknown> | undefined)?.nodeInfoList,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c
        .filter((n) => n && typeof n === 'object')
        .map((n) => {
          const o = n as Record<string, unknown>;
          return {
            nodeId: String(o.nodeId ?? ''),
            fieldName: String(o.fieldName ?? ''),
            fieldValue: o.fieldValue != null ? String(o.fieldValue) : undefined,
            description: o.description != null ? String(o.description) : undefined,
            fieldType: o.fieldType != null ? String(o.fieldType) : undefined,
            nodeName: o.nodeName != null ? String(o.nodeName) : undefined,
          };
        })
        .filter((n) => n.nodeId && n.fieldName);
    }
  }
  return [];
}

/** 官方文档默认映射（文生 app 2085682347676102657）；含 description 以严格对齐 API 示例 */
export function buildMinimaxH3T2vNodeInfoListFallback(
  prompt: string,
  megapixels: string,
  aspectRh: string,
  durationSec: string,
): RhNodeInfoItem[] {
  return [
    {
      nodeId: '149',
      fieldName: 'text',
      fieldValue: prompt,
      description: '提示词',
    },
    {
      nodeId: '16',
      fieldName: 'megapixels',
      fieldValue: megapixels,
      description: '分辨率（看介绍）',
    },
    {
      nodeId: '16',
      fieldName: 'aspect_ratio',
      fieldValue: aspectRh,
      description: '比例选择',
    },
    {
      nodeId: '14',
      fieldName: 'value',
      fieldValue: durationSec,
      description: '时长',
    },
  ];
}

/** 官方文档默认映射（图生 app 2085687129061019649） */
export function buildMinimaxH3I2vNodeInfoListFallback(
  imageField: string,
  prompt: string,
  megapixels: string,
  aspectRh: string,
  durationSec: string,
  seal: RhSealMediaFields,
): RhNodeInfoItem[] {
  const image = String(imageField || '').trim() || seal.blankImage;
  return [
    {
      nodeId: '13',
      fieldName: 'image',
      fieldValue: image,
      description: '参考图',
    },
    {
      nodeId: '57',
      fieldName: 'aspect_ratio',
      fieldValue: aspectRh,
      description: '比例选择',
    },
    {
      nodeId: '57',
      fieldName: 'megapixels',
      fieldValue: megapixels,
      description: '分辨率（参考介绍）',
    },
    {
      nodeId: '56',
      fieldName: 'value',
      fieldValue: durationSec,
      description: '时间',
    },
    {
      nodeId: '149',
      fieldName: 'text',
      fieldValue: prompt,
      description: '提示词',
    },
  ];
}

function pickRhDemoNode(
  nodes: RhAiAppNodeInfo[],
  pred: (n: RhAiAppNodeInfo) => boolean,
): RhAiAppNodeInfo | undefined {
  return nodes.find(pred);
}

function isRhDemoMediaNode(n: RhAiAppNodeInfo): boolean {
  const fn = String(n.fieldName || '').toLowerCase();
  const desc = String(n.description || n.nodeName || '');
  return (
    fn === 'image' ||
    fn === 'audio' ||
    /参考图|参考音|参考音频|上传图像|image/i.test(desc) ||
    /参考音|音频|audio/i.test(desc)
  );
}

/** 从 apiCallDemo 提取演示用媒体 fieldValue（提交前校验，防止误用 RH「API 调用」页测试素材） */
export function collectRhDemoMediaValues(liveNodes?: RhAiAppNodeInfo[] | null): Set<string> {
  const out = new Set<string>();
  for (const n of liveNodes || []) {
    if (!isRhDemoMediaNode(n)) continue;
    const v = String(n.fieldValue || '').trim();
    if (v) out.add(v);
  }
  return out;
}

/** 提交前断言：nodeInfoList 不得含 apiCallDemo 里的演示媒体 path */
export function assertRhNodeInfoListNoDemoLeak(
  list: RhNodeInfoItem[],
  liveNodes?: RhAiAppNodeInfo[] | null,
): void {
  const demo = collectRhDemoMediaValues(liveNodes);
  if (!demo.size) return;
  for (const n of list) {
    const v = String(n.fieldValue || '').trim();
    if (!v || !demo.has(v)) continue;
    const label = n.description || `${n.nodeId}/${n.fieldName}`;
    throw new Error(
      `提交拦截：${label} 仍使用 RunningHub API 演示素材，请重试；若反复出现请清理 RH 工作流节点默认文件`,
    );
  }
}

/** apiCallDemo 中全部参考音节点（口型同步可能有多路 audio 输入） */
export function pickRhAudioDemoNodes(liveNodes?: RhAiAppNodeInfo[] | null): RhAiAppNodeInfo[] {
  const nodes = Array.isArray(liveNodes) ? liveNodes : [];
  const audioNodes = nodes.filter(
    (n) =>
      String(n.fieldName || '').toLowerCase() === 'audio' ||
      /参考音|参考音频|音频/i.test(String(n.description || '')) ||
      /audio/i.test(String(n.nodeName || '')),
  );
  const seen = new Set<string>();
  const out: RhAiAppNodeInfo[] = [];
  for (const n of audioNodes) {
    const k = `${n.nodeId}:${n.fieldName}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}


function finishRhNodeInfoList(
  list: RhNodeInfoItem[],
  liveNodes?: RhAiAppNodeInfo[] | null,
): RhNodeInfoItem[] {
  const out = list.filter((n) => n.nodeId && n.fieldName && String(n.fieldValue || '').trim());
  if (liveNodes?.length) assertRhNodeInfoListNoDemoLeak(out, liveNodes);
  return out;
}

/**
 * 强制覆盖 apiCallDemo 暴露的全部 image/audio 槽：
 * 有用户素材用用户的，否则用客户端上传的占位静音/灰图，杜绝 RH 工作流默认测试素材。
 */
export function applyRhWorkflowMediaSeal(
  list: RhNodeInfoItem[],
  liveNodes: RhAiAppNodeInfo[] | null | undefined,
  seal: RhSealMediaFields,
  userImages: string[],
  userAudios: string[],
): void {
  const nodes = Array.isArray(liveNodes) ? liveNodes : [];
  if (!nodes.length) return;

  const imageDemoNodes = nodes.filter((n) => n.fieldName === 'image');
  const audioDemoNodes = pickRhAudioDemoNodes(nodes);
  if (!imageDemoNodes.length && !audioDemoNodes.length) return;

  const base = list.filter((n) => n.fieldName !== 'image' && n.fieldName !== 'audio');
  list.length = 0;
  list.push(...base);

  const imgs = userImages.map((u) => String(u || '').trim()).filter(Boolean);
  const auds = userAudios.map((u) => String(u || '').trim()).filter(Boolean);
  const anchorImg = imgs[0] || seal.blankImage;
  const anchorAud = auds[0] || seal.silentAudio;

  imageDemoNodes.forEach((demo, idx) => {
    list.push({
      nodeId: String(demo.nodeId),
      fieldName: 'image',
      fieldValue: imgs[idx] || anchorImg,
      description: demo.description || `image${idx + 1}`,
    });
  });

  audioDemoNodes.forEach((demo, idx) => {
    list.push({
      nodeId: String(demo.nodeId),
      fieldName: String(demo.fieldName || 'audio'),
      fieldValue: auds[idx] || anchorAud,
      description: demo.description || `参考音${idx + 1}`,
    });
  });
}

function sealFallbackImageSlots(
  list: RhNodeInfoItem[],
  imageFields: string[],
  slots: ReadonlyArray<{ nodeId: string; description: string }>,
  seal: RhSealMediaFields,
): void {
  const imgs = imageFields.map((u) => String(u || '').trim()).filter(Boolean);
  const anchor = imgs[0] || seal.blankImage;
  slots.forEach((slot, idx) => {
    list.push({
      nodeId: slot.nodeId,
      fieldName: 'image',
      fieldValue: imgs[idx] || anchor,
      description: slot.description,
    });
  });
}

function sealFallbackAudioSlots(
  list: RhNodeInfoItem[],
  audioFields: string[],
  slots: ReadonlyArray<{ nodeId: string; description: string }>,
  seal: RhSealMediaFields,
): void {
  const auds = audioFields.map((u) => String(u || '').trim()).filter(Boolean);
  const anchor = auds[0] || seal.silentAudio;
  slots.forEach((slot, idx) => {
    list.push({
      nodeId: slot.nodeId,
      fieldName: 'audio',
      fieldValue: auds[idx] || anchor,
      description: slot.description,
    });
  });
}

/**
 * 优先用 apiCallDemo 实时节点（仅 nodeId 映射）；缺字段时回退官方文档映射。
 * 提交前校验不得含 RH API 演示媒体 path。
 */
export function buildMinimaxH3T2vNodeInfoList(
  prompt: string,
  megapixels: string,
  aspectRh: string,
  durationSec: string,
  seal: RhSealMediaFields,
  liveNodes?: RhAiAppNodeInfo[] | null,
): RhNodeInfoItem[] {
  const fallback = buildMinimaxH3T2vNodeInfoListFallback(prompt, megapixels, aspectRh, durationSec);
  const nodes = Array.isArray(liveNodes) ? liveNodes : [];
  if (!nodes.length) {
    applyRhWorkflowMediaSeal(fallback, nodes, seal, [], []);
    return fallback;
  }

  const promptNode =
    pickRhDemoNode(nodes, (n) => /提示词/.test(n.description || '')) ||
    pickRhDemoNode(nodes, (n) => n.fieldName === 'text' || n.fieldName === 'prompt');
  const megaNode = pickRhDemoNode(nodes, (n) => n.fieldName === 'megapixels');
  const aspectNode = pickRhDemoNode(nodes, (n) => n.fieldName === 'aspect_ratio');
  const durNode =
    pickRhDemoNode(nodes, (n) => /时长|时间/.test(n.description || '')) ||
    pickRhDemoNode(
      nodes,
      (n) => n.fieldName === 'value' && n.nodeId !== megaNode?.nodeId && n.nodeId !== aspectNode?.nodeId,
    );

  if (!promptNode || !megaNode || !aspectNode || !durNode) {
    console.warn(
      '[MiniMax-H3 t2v] apiCallDemo 节点不完整，回退文档映射',
      summarizeRhNodeInfoForLog(
        nodes.map((n) => ({
          nodeId: n.nodeId,
          fieldName: n.fieldName,
          fieldValue: n.fieldValue || '',
          description: n.description,
        })),
      ),
    );
    applyRhWorkflowMediaSeal(fallback, nodes, seal, [], []);
    return finishRhNodeInfoList(fallback, nodes);
  }

  const list: RhNodeInfoItem[] = [
    {
      nodeId: String(promptNode.nodeId),
      fieldName: String(promptNode.fieldName),
      fieldValue: prompt,
      description: promptNode.description || '提示词',
    },
    {
      nodeId: String(megaNode.nodeId),
      fieldName: 'megapixels',
      fieldValue: megapixels,
      description: megaNode.description || '分辨率（看介绍）',
    },
    {
      nodeId: String(aspectNode.nodeId),
      fieldName: 'aspect_ratio',
      fieldValue: aspectRh,
      description: aspectNode.description || '比例选择',
    },
    {
      nodeId: String(durNode.nodeId),
      fieldName: String(durNode.fieldName || 'value'),
      fieldValue: durationSec,
      description: durNode.description || '时长',
    },
  ];
  applyRhWorkflowMediaSeal(list, nodes, seal, [], []);
  return finishRhNodeInfoList(list, nodes);
}

export function buildMinimaxH3I2vNodeInfoList(
  imageField: string,
  prompt: string,
  megapixels: string,
  aspectRh: string,
  durationSec: string,
  seal: RhSealMediaFields,
  liveNodes?: RhAiAppNodeInfo[] | null,
): RhNodeInfoItem[] {
  const fallback = buildMinimaxH3I2vNodeInfoListFallback(
    imageField,
    prompt,
    megapixels,
    aspectRh,
    durationSec,
    seal,
  );
  const nodes = Array.isArray(liveNodes) ? liveNodes : [];
  if (!nodes.length) {
    applyRhWorkflowMediaSeal(fallback, nodes, seal, [imageField], []);
    return fallback;
  }

  const imageNode =
    pickRhDemoNode(nodes, (n) => /参考图|上传图像|image/i.test(n.description || '')) ||
    pickRhDemoNode(nodes, (n) => n.fieldName === 'image');
  const promptNode =
    pickRhDemoNode(nodes, (n) => /提示词/.test(n.description || '')) ||
    pickRhDemoNode(nodes, (n) => n.fieldName === 'text' || n.fieldName === 'prompt');
  const megaNode = pickRhDemoNode(nodes, (n) => n.fieldName === 'megapixels');
  const aspectNode = pickRhDemoNode(nodes, (n) => n.fieldName === 'aspect_ratio');
  const durNode =
    pickRhDemoNode(nodes, (n) => /时长|时间/.test(n.description || '')) ||
    pickRhDemoNode(
      nodes,
      (n) => n.fieldName === 'value' && n.nodeId !== megaNode?.nodeId && n.nodeId !== aspectNode?.nodeId,
    );

  if (!imageNode || !promptNode || !megaNode || !aspectNode || !durNode) {
    console.warn('[MiniMax-H3 i2v] apiCallDemo 节点不完整，回退文档映射');
    applyRhWorkflowMediaSeal(fallback, nodes, seal, [imageField], []);
    return finishRhNodeInfoList(fallback, nodes);
  }

  const list: RhNodeInfoItem[] = [
    {
      nodeId: String(aspectNode.nodeId),
      fieldName: 'aspect_ratio',
      fieldValue: aspectRh,
      description: aspectNode.description || '比例选择',
    },
    {
      nodeId: String(megaNode.nodeId),
      fieldName: 'megapixels',
      fieldValue: megapixels,
      description: megaNode.description || '分辨率（参考介绍）',
    },
    {
      nodeId: String(durNode.nodeId),
      fieldName: String(durNode.fieldName || 'value'),
      fieldValue: durationSec,
      description: durNode.description || '时间',
    },
    {
      nodeId: String(promptNode.nodeId),
      fieldName: String(promptNode.fieldName),
      fieldValue: prompt,
      description: promptNode.description || '提示词',
    },
  ];
  applyRhWorkflowMediaSeal(list, nodes, seal, [imageField], []);
  return finishRhNodeInfoList(list, nodes);
}

/** 从 apiCallDemo 提取有序参考音节点（fieldName=audio 或描述含参考音） */
export function pickMinimaxH3MultiAudioDemoNodes(
  liveNodes?: RhAiAppNodeInfo[] | null,
): RhAiAppNodeInfo[] {
  const nodes = Array.isArray(liveNodes) ? liveNodes : [];
  const audioNodes = nodes.filter(
    (n) =>
      String(n.fieldName || '').toLowerCase() === 'audio' ||
      /参考音|参考音频|音频/i.test(String(n.description || '')) ||
      /audio/i.test(String(n.nodeName || '')),
  );
  const rank = (n: RhAiAppNodeInfo): number => {
    const d = `${n.description || ''} ${n.nodeName || ''}`;
    const m = d.match(/参考音(?:频)?\s*([123])|audio\s*([123])|音\s*([123])/i);
    if (m) {
      const n1 = Number(m[1] || m[2] || m[3]);
      if (n1 >= 1 && n1 <= 3) return n1;
    }
    if (String(n.nodeId) === '38') return 1;
    if (String(n.nodeId) === '67') return 2;
    if (String(n.nodeId) === '68') return 3;
    return 100 + Number(n.nodeId || 0);
  };
  return [...audioNodes].sort((a, b) => rank(a) - rank(b) || String(a.nodeId).localeCompare(String(b.nodeId)));
}

/**
 * 官方文档回退映射（全能参考 ai-app 2086289185186603010）。
 * 含时长 28/value；空图/音槽勿写入（已无参考视频槽）。
 */
export function buildMinimaxH3MultiNodeInfoListFallback(
  prompt: string,
  megapixels: string,
  aspectRh: string,
  durationSec: string,
  imageFields: string[],
  seal: RhSealMediaFields,
  audioFields?: string[] | string | null,
): RhNodeInfoItem[] {
  const list: RhNodeInfoItem[] = [
    {
      nodeId: '25',
      fieldName: 'value',
      fieldValue: prompt,
      description: '提示词',
    },
    {
      nodeId: '26',
      fieldName: 'aspect_ratio',
      fieldValue: aspectRh,
      description: '比例',
    },
    {
      nodeId: '26',
      fieldName: 'megapixels',
      fieldValue: megapixels,
      description: '分辨率（看介绍）',
    },
    {
      nodeId: '28',
      fieldName: 'value',
      fieldValue: durationSec,
      description: '时长',
    },
  ];
  const IMAGE_SLOTS = [
    { nodeId: '18', description: 'image1' },
    { nodeId: '23', description: 'image2' },
    { nodeId: '22', description: 'image3' },
    { nodeId: '24', description: 'image4' },
    { nodeId: '32', description: 'image5' },
    { nodeId: '33', description: 'image6' },
    { nodeId: '34', description: 'image7' },
    { nodeId: '35', description: 'image8' },
    { nodeId: '76', description: 'image9' },
  ] as const;
  sealFallbackImageSlots(list, imageFields, IMAGE_SLOTS, seal);

  const audios = (Array.isArray(audioFields)
    ? audioFields
    : audioFields
      ? [audioFields]
      : []
  )
    .map((u) => String(u || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  const AUDIO_FALLBACK = [
    { nodeId: '38', description: '参考音1' },
    { nodeId: '67', description: '参考音2' },
    { nodeId: '68', description: '参考音3' },
  ] as const;
  sealFallbackAudioSlots(list, audios, AUDIO_FALLBACK, seal);
  return list;
}

/**
 * MiniMax H3 全能参考：apiCallDemo 仅取 nodeId；媒体值用用户上传。
 * 空图槽用 image1 封口；有参考音时覆盖全部 audio 槽。
 */
export function buildMinimaxH3MultiNodeInfoList(
  prompt: string,
  megapixels: string,
  aspectRh: string,
  durationSec: string,
  imageFields: string[],
  seal: RhSealMediaFields,
  audioFields?: string[] | string | null,
  liveNodes?: RhAiAppNodeInfo[] | null,
): RhNodeInfoItem[] {
  const audios = (Array.isArray(audioFields)
    ? audioFields
    : audioFields
      ? [audioFields]
      : []
  )
    .map((u) => String(u || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  const fallback = buildMinimaxH3MultiNodeInfoListFallback(
    prompt,
    megapixels,
    aspectRh,
    durationSec,
    imageFields,
    seal,
    audios,
  );
  const nodes = Array.isArray(liveNodes) ? liveNodes : [];
  if (!nodes.length) {
    applyRhWorkflowMediaSeal(fallback, nodes, seal, imageFields, audios);
    return fallback;
  }

  const promptNode =
    pickRhDemoNode(nodes, (n) => /提示词/.test(n.description || '')) ||
    pickRhDemoNode(nodes, (n) => n.fieldName === 'text' || n.fieldName === 'prompt') ||
    pickRhDemoNode(
      nodes,
      (n) =>
        n.fieldName === 'value' &&
        n.nodeId !== '28' &&
        !/时长|时间/.test(n.description || ''),
    );
  const megaNode = pickRhDemoNode(nodes, (n) => n.fieldName === 'megapixels');
  const aspectNode = pickRhDemoNode(nodes, (n) => n.fieldName === 'aspect_ratio');
  const durNode =
    pickRhDemoNode(nodes, (n) => /时长|时间/.test(n.description || '')) ||
    pickRhDemoNode(nodes, (n) => n.nodeId === '28' && n.fieldName === 'value');

  if (!promptNode || !megaNode || !aspectNode || !durNode) {
    console.warn(
      '[MiniMax-H3 multi] apiCallDemo 节点不完整，回退文档映射',
      summarizeRhNodeInfoForLog(
        nodes.map((n) => ({
          nodeId: n.nodeId,
          fieldName: n.fieldName,
          fieldValue: n.fieldValue || '',
          description: n.description,
        })),
      ),
    );
    applyRhWorkflowMediaSeal(fallback, nodes, seal, imageFields, audios);
    return finishRhNodeInfoList(fallback, nodes);
  }

  const list: RhNodeInfoItem[] = [
    {
      nodeId: String(promptNode.nodeId),
      fieldName: String(promptNode.fieldName || 'value'),
      fieldValue: prompt,
      description: promptNode.description || '提示词',
    },
    {
      nodeId: String(aspectNode.nodeId),
      fieldName: 'aspect_ratio',
      fieldValue: aspectRh,
      description: aspectNode.description || '比例',
    },
    {
      nodeId: String(megaNode.nodeId),
      fieldName: 'megapixels',
      fieldValue: megapixels,
      description: megaNode.description || '分辨率（看介绍）',
    },
    {
      nodeId: String(durNode.nodeId),
      fieldName: String(durNode.fieldName || 'value'),
      fieldValue: durationSec,
      description: durNode.description || '时长',
    },
  ];
  applyRhWorkflowMediaSeal(list, nodes, seal, imageFields, audios);
  return finishRhNodeInfoList(list, nodes);
}

/** 官方文档默认映射（口型同步 app 2086260808442531842） */
export function buildMinimaxH3AudioNodeInfoListFallback(
  prompt: string,
  megapixels: string,
  aspectRh: string,
  imageFields: string[],
  audioField: string,
  seal: RhSealMediaFields,
): RhNodeInfoItem[] {
  const audio = String(audioField || '').trim() || seal.silentAudio;
  const list: RhNodeInfoItem[] = [
    {
      nodeId: '138',
      fieldName: 'value',
      fieldValue: prompt,
      description: '提示词',
    },
    {
      nodeId: '115',
      fieldName: 'aspect_ratio',
      fieldValue: aspectRh,
      description: '比例选择',
    },
    {
      nodeId: '115',
      fieldName: 'megapixels',
      fieldValue: megapixels,
      description: '分辨率（看介绍）',
    },
  ];
  const IMAGE_SLOTS = [
    { nodeId: '137', description: 'image1' },
    { nodeId: '182', description: 'image2' },
    { nodeId: '199', description: 'image3' },
    { nodeId: '200', description: 'image4' },
    { nodeId: '202', description: 'image5' },
  ] as const;
  sealFallbackImageSlots(list, imageFields, IMAGE_SLOTS, seal);
  const AUDIO_SLOTS = [{ nodeId: '171', description: '参考音' }] as const;
  sealFallbackAudioSlots(list, [audio], AUDIO_SLOTS, seal);
  return list;
}

/**
 * MiniMax-H3 口型同步：优先 apiCallDemo 仅取 nodeId 映射；媒体值一律用用户上传。
 * 未使用的图槽用 image1 封口，避免 RH 工作流默认测试图渗入；全部 audio 槽写入同一参考音。
 */
export function buildMinimaxH3AudioNodeInfoList(
  prompt: string,
  megapixels: string,
  aspectRh: string,
  imageFields: string[],
  audioField: string,
  seal: RhSealMediaFields,
  liveNodes?: RhAiAppNodeInfo[] | null,
): RhNodeInfoItem[] {
  const audio = String(audioField || '').trim();
  const fallback = buildMinimaxH3AudioNodeInfoListFallback(
    prompt,
    megapixels,
    aspectRh,
    imageFields,
    audio,
    seal,
  );
  const nodes = Array.isArray(liveNodes) ? liveNodes : [];
  if (!nodes.length) {
    applyRhWorkflowMediaSeal(fallback, nodes, seal, imageFields, [audio]);
    return fallback;
  }

  const promptNode =
    pickRhDemoNode(nodes, (n) => /提示词/.test(n.description || '')) ||
    pickRhDemoNode(nodes, (n) => n.fieldName === 'text' || n.fieldName === 'prompt') ||
    pickRhDemoNode(
      nodes,
      (n) =>
        n.fieldName === 'value' &&
        !/时长|时间/.test(n.description || ''),
    );
  const megaNode = pickRhDemoNode(nodes, (n) => n.fieldName === 'megapixels');
  const aspectNode = pickRhDemoNode(nodes, (n) => n.fieldName === 'aspect_ratio');
  const audioDemoNodes = pickRhAudioDemoNodes(nodes);
  const audioNode = audioDemoNodes[0];

  if (!promptNode || !megaNode || !aspectNode || !audioNode || !audio) {
    console.warn(
      '[MiniMax-H3 audio] apiCallDemo 节点不完整或缺少参考音，回退文档映射',
      summarizeRhNodeInfoForLog(
        nodes.map((n) => ({
          nodeId: n.nodeId,
          fieldName: n.fieldName,
          fieldValue: n.fieldValue || '',
          description: n.description,
        })),
      ),
    );
    applyRhWorkflowMediaSeal(fallback, nodes, seal, imageFields, [audio]);
    return finishRhNodeInfoList(fallback, nodes);
  }

  const list: RhNodeInfoItem[] = [
    {
      nodeId: String(promptNode.nodeId),
      fieldName: String(promptNode.fieldName || 'value'),
      fieldValue: prompt,
      description: promptNode.description || '提示词',
    },
    {
      nodeId: String(aspectNode.nodeId),
      fieldName: 'aspect_ratio',
      fieldValue: aspectRh,
      description: aspectNode.description || '比例选择',
    },
    {
      nodeId: String(megaNode.nodeId),
      fieldName: 'megapixels',
      fieldValue: megapixels,
      description: megaNode.description || '分辨率（看介绍）',
    },
  ];
  applyRhWorkflowMediaSeal(list, nodes, seal, imageFields, [audio]);
  return finishRhNodeInfoList(list, nodes);
}

export function isRhNodeInfoMismatch803(data: Record<string, unknown> | null | undefined): boolean {
  const msg = formatRunningHubTaskError(data, '');
  return /\[?803\]?|NODE_INFO_MISMATCH|node_not_found_in_workflow/i.test(msg);
}

export function enhanceMinimaxH3NodeMismatchError(baseMsg: string): string {
  return (
    `${baseMsg}。` +
    '请到 RunningHub 应用页「API调用」核对当前 nodeId/fieldName（尤其提示词节点），' +
    '或重新导出 API 示例后反馈给我们。若刚部署过 FC，请确认已包含 /api/webapp/apiCallDemo 转发。'
  );
}

/**
 * FC 返回的 RunningHub 体常被包一层 `{ code, data: { status, results, ... } }`，
 * 若直接读顶层 `status` 会得到 undefined，导致轮询永远不认 SUCCESS。
 */
export function unwrapRunningHubForwardBody(raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = { ...raw };
  const inner = raw.data;
  if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
    const d = inner as Record<string, unknown>;
    const innerLooksRh =
      d.status != null ||
      d.taskStatus != null ||
      d.task_status != null ||
      d.results != null ||
      d.taskId != null ||
      d.task_id != null ||
      d.errorMessage != null ||
      d.error != null;
    const code = raw.code;
    const codeOk = code === 0 || code === '0' || code === 200 || code === '200';
    if (innerLooksRh || codeOk) {
      if (d.status != null) out.status = d.status;
      if (d.taskStatus != null) {
        out.taskStatus = d.taskStatus;
        if (out.status == null) out.status = d.taskStatus;
      }
      if (d.task_status != null) {
        out.task_status = d.task_status;
        if (out.status == null) out.status = d.task_status;
      }
      if (d.results != null) out.results = d.results;
      if (d.taskId != null) out.taskId = d.taskId;
      if (d.task_id != null) out.task_id = d.task_id;
      if (d.errorMessage != null) out.errorMessage = d.errorMessage;
      if (d.errorCode != null) out.errorCode = d.errorCode;
      if (d.error != null) out.error = d.error;
      if (d.message != null) out.message = d.message;
      if (d.fail_reason != null) out.fail_reason = d.fail_reason;
      if (d.failedReason != null) out.failedReason = d.failedReason;
      for (const k of [
        'video_url',
        'videoUrl',
        'url',
        'output',
        'fileUrl',
        'imageUrl',
        'image_url',
        'file_url',
      ]) {
        const v = d[k];
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
          out[k] = v;
        }
      }
      const inner2 = d.data;
      if (inner2 != null && typeof inner2 === 'object' && !Array.isArray(inner2)) {
        const d2 = inner2 as Record<string, unknown>;
        if (out.status == null && d2.status != null) out.status = d2.status;
        if (out.status == null && d2.taskStatus != null) out.status = d2.taskStatus;
        if (out.status == null && d2.task_status != null) out.status = d2.task_status;
        if (out.results == null && d2.results != null) out.results = d2.results;
      }
    }
  }
  return out;
}

/** 从 FC 转发提交响应提取 RunningHub taskId（含 `{ code, data: { taskId } }` 包装） */
export function extractRhTaskIdFromForward(raw: Record<string, unknown>): string | undefined {
  const data = unwrapRunningHubForwardBody(raw);
  const top =
    (typeof data.taskId === 'string' && data.taskId.trim()) ||
    (typeof data.task_id === 'string' && data.task_id.trim()) ||
    '';
  if (top) return top;
  const inner = data.data;
  if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
    const o = inner as { taskId?: string; task_id?: string };
    const nested =
      (typeof o.taskId === 'string' && o.taskId.trim()) ||
      (typeof o.task_id === 'string' && o.task_id.trim()) ||
      '';
    if (nested) return nested;
  }
  return undefined;
}

/** 从 RunningHub 提交/轮询响应提取可读错误（含 errorCode） */
function extractRhFailedReasonMessage(failedReason: unknown): string {
  if (!failedReason || typeof failedReason !== 'object') return '';
  const fr = failedReason as Record<string, unknown>;
  const direct =
    fr.exception_message ??
    fr.exceptionMessage ??
    fr.message ??
    fr.error ??
    fr.reason;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return '';
}

export function formatRunningHubTaskError(
  data: Record<string, unknown> | null | undefined,
  fallback = '任务失败',
): string {
  if (!data || typeof data !== 'object') return fallback;
  const codeRaw = data.errorCode ?? data.error_code ?? data.code;
  const msgRaw =
    data.errorMessage ??
    data.error ??
    data.message ??
    data.msg ??
    data.fail_reason ??
    data.failReason ??
    extractRhFailedReasonMessage(data.failedReason);
  const frMsg = extractRhFailedReasonMessage(data.failedReason);
  const msg = typeof msgRaw === 'string' ? msgRaw.trim() : msgRaw != null ? String(msgRaw).trim() : '';
  const isGenericMsg = !msg || /^工作流运行失败$/i.test(msg) || /^task failed$/i.test(msg);
  let detail = isGenericMsg && frMsg ? frMsg.split('\n')[0].trim() : msg;
  if (/Value not in list|not in \(list of length 47\)/i.test(`${detail} ${frMsg}`)) {
    detail =
      'RVC model_name 不在 RunningHub 官方 47 项预置列表内（自训练 openapi/ 路径不可用，非客户端故障）';
  }
  const code =
    codeRaw != null && String(codeRaw).trim() !== '' && !['0', '200', 'SUCCESS'].includes(String(codeRaw))
      ? String(codeRaw).trim()
      : '';
  if (code && detail) return `[${code}] ${detail}`;
  return detail || frMsg.split('\n')[0].trim() || fallback;
}

export function logRunningHubTaskFailure(
  context: string,
  data: Record<string, unknown>,
  taskId?: string,
): void {
  const summary = formatRunningHubTaskError(data);
  console.error(`[RunningHub] ${context} 失败 taskId=${taskId ?? '—'} → ${summary}`);
  try {
    const debug = {
      status: data.status,
      errorCode: data.errorCode ?? data.error_code ?? data.code,
      errorMessage: data.errorMessage,
      error: data.error,
      message: data.message,
      fail_reason: data.fail_reason,
      failedReason: data.failedReason,
    };
    console.error(`[RunningHub] ${context} 响应摘要:`, JSON.stringify(debug));
  } catch {
    /* ignore */
  }
}

export function rhPollFailureError(
  context: string,
  data: Record<string, unknown>,
  taskId?: string,
  fallback = '生成失败',
): Error {
  logRunningHubTaskFailure(context, data, taskId);
  return new Error(formatRunningHubTaskError(data, fallback));
}

export function summarizeRhNodeInfoForLog(
  list: Array<{ nodeId: string; fieldName: string; fieldValue: string; description?: string }>,
): unknown[] {
  return list.map((n) => ({
    nodeId: n.nodeId,
    fieldName: n.fieldName,
    description: n.description,
    fieldValue:
      n.fieldName === 'image' && n.fieldValue
        ? n.fieldValue.length > 72
          ? `${n.fieldValue.slice(0, 72)}…`
          : n.fieldValue
        : n.fieldValue,
  }));
}

export function pathFromRunningHubUrl(fullUrl: string): string {
  const marker = '/openapi/v2';
  const i = fullUrl.indexOf(marker);
  if (i === -1) {
    try {
      const u = new URL(fullUrl);
      return u.pathname + u.search;
    } catch {
      return fullUrl;
    }
  }
  return fullUrl.slice(i + marker.length) || '/';
}

export async function rhPostChargeVideo(
  fullUrl: string,
  payload: Record<string, unknown>,
  fallbackFcId: string,
  options?: { billingModelId?: string; rhRegion?: 'cn' | 'ai' },
  prepaidLedgerTaskId?: string | null,
): Promise<Record<string, unknown>> {
  const usePrepaid = prepaidLedgerTaskId != null && String(prepaidLedgerTaskId).trim() !== '';
  const taskId = usePrepaid ? String(prepaidLedgerTaskId).trim() : fallbackFcId;
  const billing = usePrepaid ? ('none' as const) : ('charge' as const);
  const rhRegion = options?.rhRegion === 'ai' || options?.rhRegion === 'cn' ? options.rhRegion : undefined;
  const { data } = await fcForwardRequest(
    taskId,
    'video',
    billing,
    {
      provider: 'runninghub',
      path: pathFromRunningHubUrl(fullUrl),
      method: 'POST',
      body: payload,
      ...(rhRegion ? { rhRegion } : {}),
    },
    options?.billingModelId ? { billingModelId: options.billingModelId } : undefined,
  );
  return data;
}

export async function rhQueryPollVideo(
  rhTaskId: string,
  fcPollId: string,
  ledgerTaskId?: string | null,
  options?: { rhRegion?: 'cn' | 'ai' },
): Promise<Record<string, unknown>> {
  const taskId =
    ledgerTaskId != null && String(ledgerTaskId).trim() !== '' ? String(ledgerTaskId).trim() : fcPollId;
  const rhRegion = options?.rhRegion === 'ai' || options?.rhRegion === 'cn' ? options.rhRegion : undefined;
  const { data } = await fcForwardRequest(taskId, 'video', 'none', {
    provider: 'runninghub',
    path: '/query',
    method: 'POST',
    body: { taskId: rhTaskId },
    ...(rhRegion ? { rhRegion } : {}),
  });
  return unwrapRunningHubForwardBody(data as Record<string, unknown>);
}

export type RhQueryPollOptions = {
  /** 为 true 时用 ledger taskId 走 FC（写 nx_tasks）；默认 false，轮询只用 fcPollId 快路径 */
  useLedgerFcTaskId?: boolean;
  /** 与提交同站：cn=国内 / ai=海外。省略则靠 FC 粘性，多实例时可能问错站 */
  rhRegion?: 'cn' | 'ai';
};

/** RunningHub 图片轮询：首次不等待，前 60s 每 1s，之后每 3s */
export function imageRhPollSleepMs(pollingAttempts: number, pollStartTimeMs: number): number {
  if (pollingAttempts === 0) return 0;
  const elapsed = Date.now() - pollStartTimeMs;
  return elapsed < 60_000 ? 1000 : 3000;
}

export async function rhQueryPollImage(
  rhTaskId: string,
  fcPollId: string,
  ledgerTaskId?: string | null,
  options?: RhQueryPollOptions,
): Promise<Record<string, unknown>> {
  const useLedger =
    options?.useLedgerFcTaskId === true &&
    ledgerTaskId != null &&
    String(ledgerTaskId).trim() !== '';
  const taskId = useLedger ? String(ledgerTaskId).trim() : fcPollId;
  const rhRegion = options?.rhRegion === 'ai' || options?.rhRegion === 'cn' ? options.rhRegion : undefined;
  const { data } = await fcForwardRequest(taskId, 'image', 'none', {
    provider: 'runninghub',
    path: '/query',
    method: 'POST',
    body: { taskId: rhTaskId },
    ...(rhRegion ? { rhRegion } : {}),
  });
  return unwrapRunningHubForwardBody(data as Record<string, unknown>);
}

/** SUCCESS 后一次性用 ledger id 回写 nx_tasks（供 /tasks/status） */
export async function syncLedgerAfterRhImageSuccess(
  rhTaskId: string,
  ledgerTaskId: string,
): Promise<void> {
  try {
    await rhQueryPollImage(rhTaskId, `${ledgerTaskId}:ledger-sync`, ledgerTaskId, {
      useLedgerFcTaskId: true,
    });
  } catch (e) {
    console.warn('[图片生成] 云端任务状态回写失败（不影响结果）', e);
  }
}

export async function rhPostChargeAudio(
  fullUrl: string,
  payload: Record<string, unknown>,
  fallbackFcId: string,
  options?: { billingModelId?: string },
  prepaidLedgerTaskId?: string | null,
): Promise<Record<string, unknown>> {
  const usePrepaid = prepaidLedgerTaskId != null && String(prepaidLedgerTaskId).trim() !== '';
  const taskId = usePrepaid ? String(prepaidLedgerTaskId).trim() : fallbackFcId;
  const billing = usePrepaid ? ('none' as const) : ('charge' as const);
  const { data: raw } = await fcForwardRequest(
    taskId,
    'audio',
    billing,
    {
      provider: 'runninghub',
      path: pathFromRunningHubUrl(fullUrl),
      method: 'POST',
      body: payload,
    },
    options?.billingModelId ? { billingModelId: options.billingModelId } : undefined,
  );
  return unwrapRunningHubForwardBody(raw as Record<string, unknown>);
}

export async function rhQueryPollAudio(
  rhTaskId: string,
  fcPollId: string,
  ledgerTaskId?: string | null,
): Promise<Record<string, unknown>> {
  const taskId =
    ledgerTaskId != null && String(ledgerTaskId).trim() !== '' ? String(ledgerTaskId).trim() : fcPollId;
  const { data } = await fcForwardRequest(taskId, 'audio', 'none', {
    provider: 'runninghub',
    path: '/query',
    method: 'POST',
    body: { taskId: rhTaskId },
  });
  return unwrapRunningHubForwardBody(data as Record<string, unknown>);
}
