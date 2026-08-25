import type { Edge, Node } from 'reactflow';
import {
  AI_VOICE_COVER_MODEL_ID,
  deriveRvcCoverModelPath,
  hasRvcCoverModelOnNodeData,
  isAudioCoverModel,
  resolveRvcCoverModelPath,
} from './audioCoverModel';
import { isRvcTrainModel, RVC_VOICE_TRAIN_MODEL_ID } from './audioRvcTrainModel';
import { isAudioSongModel, resolveAudioConnectedDisplayName } from './audioSongModels';
import { resolveRvcTrainNickname } from './rvcTrainCanvasPlacement';
import { getCharacterVoiceClipUrl } from './connectionRules';

/** Doubao / 多参考音展示：已连接的参考音（最多 3） */
export type ConnectedReferenceAudioInfo = {
  url: string;
  name: string;
  nodeId: string;
};

const DOUBAO_MAX_REF_AUDIOS = 3;

/** 按入边顺序收集参考音 URL（去重，最多 max） */
export function collectReferenceAudiosFromEdges(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
  max = DOUBAO_MAX_REF_AUDIOS,
): ConnectedReferenceAudioInfo[] {
  const out: ConnectedReferenceAudioInfo[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.target !== targetNodeId) continue;
    const source = nodes.find((n) => n.id === e.source);
    if (!source || source.type !== 'audio') continue;
    const url = pickAudioUrlFromAudioSourceNode(source);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      name: resolveAudioConnectedDisplayName(source.data as Parameters<typeof resolveAudioConnectedDisplayName>[0]),
      nodeId: source.id,
    });
    if (out.length >= max) break;
  }
  return out;
}

export function pickAudioUrlFromAudioSourceNode(sourceNode: Node | undefined): string {
  if (!sourceNode || sourceNode.type !== 'audio') return '';
  const d = sourceNode.data as Record<string, unknown>;
  const httpOrig =
    typeof d.originalAudioUrl === 'string' && d.originalAudioUrl.startsWith('http') ? d.originalAudioUrl : '';
  if (httpOrig) return httpOrig;
  const raw = (d.outputAudio ?? d.originalAudioUrl ?? d.referenceAudioUrl) as string | undefined;
  const list = Array.isArray(d.outputAudios) ? (d.outputAudios as string[]).filter(Boolean) : [];
  if (list.length > 0) return String(list[0]).trim();
  return typeof raw === 'string' ? raw.trim() : '';
}

export function pickAudioDurationFromAudioSourceNode(sourceNode: Node | undefined): number {
  if (!sourceNode || sourceNode.type !== 'audio') return 0;
  const raw = Number((sourceNode.data as Record<string, unknown>)?.mediaDurationSec);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

type AudioEdgeEntry = {
  edge: Edge;
  source: Node;
  url: string;
  durationSec: number;
};

function compareAudioEdgeByDurationDesc(a: AudioEdgeEntry, b: AudioEdgeEntry): number {
  if (b.durationSec !== a.durationSec) return b.durationSec - a.durationSec;
  return String(a.edge.id).localeCompare(String(b.edge.id));
}

function collectAudioEdgeEntries(targetNodeId: string, nodes: Node[], edges: Edge[]): AudioEdgeEntry[] {
  return edges
    .filter((e) => e.target === targetNodeId)
    .map((e) => {
      const source = nodes.find((n) => n.id === e.source);
      if (!source || source.type !== 'audio') return null;
      const url = pickAudioUrlFromAudioSourceNode(source);
      if (!url) return null;
      return {
        edge: e,
        source,
        url,
        durationSec: pickAudioDurationFromAudioSourceNode(source),
      };
    })
    .filter((x): x is AudioEdgeEntry => x != null);
}

function findRvcTrainSourceNode(targetNodeId: string, nodes: Node[], edges: Edge[]): Node | undefined {
  for (const e of edges) {
    if (e.target !== targetNodeId) continue;
    const source = nodes.find((n) => n.id === e.source);
    if (source?.type === 'rvcTrain') return source;
  }
  return undefined;
}

/** 角色卡入边：有声音片段即取参考音（取第一条有效 URL；不依赖勾选） */
function pickCharacterTransmitAudioFromEdges(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
): string {
  for (const e of edges) {
    if (e.target !== targetNodeId) continue;
    const source = nodes.find((n) => n.id === e.source);
    if (source?.type !== 'character') continue;
    const url = getCharacterVoiceClipUrl(source.data as Record<string, unknown>);
    if (url) return url;
  }
  return '';
}

/** 翻唱原曲：取最长 audio 入边 */
export function pickCoverSourceSongUrl(entries: AudioEdgeEntry[]): string {
  if (entries.length === 0) return '';
  const sorted = [...entries].sort(compareAudioEdgeByDurationDesc);
  return sorted[0].url;
}

/** @deprecated 旧双路翻唱（参考音） */
export function pickCoverSourceAndReferenceUrls(entries: AudioEdgeEntry[]): {
  sourceSongAudioUrl: string;
  coverReferenceAudioUrl: string;
} {
  if (entries.length === 0) return { sourceSongAudioUrl: '', coverReferenceAudioUrl: '' };
  if (entries.length === 1) {
    return { sourceSongAudioUrl: entries[0].url, coverReferenceAudioUrl: '' };
  }
  const byLongest = [...entries].sort(compareAudioEdgeByDurationDesc);
  return {
    sourceSongAudioUrl: byLongest[0].url,
    coverReferenceAudioUrl: byLongest[1]?.url || '',
  };
}

export function resolveDualAudioInputsFromEdges(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
): { sourceSongAudioUrl: string; coverReferenceAudioUrl: string; audioSourceCount: number } {
  const entries = collectAudioEdgeEntries(targetNodeId, nodes, edges);
  const picked = pickCoverSourceAndReferenceUrls(entries);
  return {
    audioSourceCount: entries.length,
    sourceSongAudioUrl: picked.sourceSongAudioUrl,
    coverReferenceAudioUrl: picked.coverReferenceAudioUrl,
  };
}

export function normalizeAudioUrlForApi(url: string): string {
  let u = (url || '').trim();
  if (!u) return '';
  if (u.startsWith('local-resource://') || u.startsWith('file://')) {
    u = u.replace(/%5C/gi, '/').replace(/^local-resource:\/\/+/, 'local-resource://').replace(/^file:\/\/+/, 'file://');
  }
  return u;
}

export type AudioIncomingPatch = {
  sourceSongAudioUrl?: string;
  referenceAudioUrl?: string;
  /** Doubao 等多段参考音（最多 3）；有值时 referenceAudioUrl 为第 1 路 */
  referenceAudioUrls?: string[];
  connectedReferenceAudios?: ConnectedReferenceAudioInfo[];
  model?: string;
  coverPitch?: number;
  coverRhVolume?: number;
  rvcTrainModelName?: string;
  rvcCoverModelName?: string;
  libraryRvcVoiceId?: string;
  outputModelUrl?: string;
  outputModelRemoteUrl?: string;
  coverReferenceAudioUrl?: string;
};

function hasRvcCoverModelInput(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
  existingData?: Record<string, unknown>,
): boolean {
  if (findRvcTrainSourceNode(targetNodeId, nodes, edges)) return true;
  return hasRvcCoverModelOnNodeData(existingData);
}

function buildRvcCoverPatchFromRvcTrainSource(
  rvcSource: Node,
  audioEntries: AudioEdgeEntry[],
  existingData?: Record<string, unknown>,
): AudioIncomingPatch {
  const src = rvcSource.data as Record<string, unknown>;
  const voiceName = resolveRvcTrainNickname(src as { rvcTrainModelName?: string; title?: string });
  const existingCoverPath = resolveRvcCoverModelPath(
    existingData as { rvcCoverModelName?: string; rvcTrainModelName?: string; title?: string },
  );
  const rvcCoverModelName = existingCoverPath || deriveRvcCoverModelPath(voiceName);
  const sourceSongAudioUrl = pickCoverSourceSongUrl(audioEntries);
  return {
    model: AI_VOICE_COVER_MODEL_ID,
    rvcTrainModelName: voiceName || undefined,
    rvcCoverModelName: rvcCoverModelName || undefined,
    libraryRvcVoiceId: src.libraryRvcVoiceId as string | undefined,
    outputModelUrl: src.outputModelUrl as string | undefined,
    outputModelRemoteUrl: src.outputModelRemoteUrl as string | undefined,
    sourceSongAudioUrl: sourceSongAudioUrl || undefined,
    referenceAudioUrl: '',
  };
}

/** 源节点时长更新后，重算以该节点为 audio 源的翻唱目标 */
export function buildCoverTargetPatchesAfterSourceDurationChange(
  sourceNodeId: string,
  nodes: Node[],
  edges: Edge[],
): Array<{ targetId: string; patch: AudioIncomingPatch }> {
  const out: Array<{ targetId: string; patch: AudioIncomingPatch }> = [];
  const targetIds = new Set(edges.filter((e) => e.source === sourceNodeId).map((e) => e.target));
  targetIds.forEach((targetId) => {
    const target = nodes.find((n) => n.id === targetId);
    if (target?.type !== 'audio') return;
    const patch = buildAudioIncomingPatchFromEdges(
      targetId,
      nodes,
      edges,
      target.data as Record<string, unknown>,
    );
    if (
      patch &&
      isAudioCoverModel(patch.model) &&
      patch.sourceSongAudioUrl &&
      (patch.rvcCoverModelName || patch.outputModelUrl || patch.outputModelRemoteUrl)
    ) {
      out.push({ targetId, patch });
    }
  });
  return out;
}

/** 根据入边：rvcTrain + audio → RVC 翻唱；1 路 audio → Index-TTS 参考音等 */
export function buildAudioIncomingPatchFromEdges(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
  existingData?: Record<string, unknown>,
): AudioIncomingPatch | null {
  const rvcSource = findRvcTrainSourceNode(targetNodeId, nodes, edges);
  const audioEntries = collectAudioEdgeEntries(targetNodeId, nodes, edges);
  const existingModel = String(existingData?.model ?? '').trim();

  if (rvcSource) {
    return buildRvcCoverPatchFromRvcTrainSource(rvcSource, audioEntries, existingData);
  }

  if (
    audioEntries.length >= 1 &&
    hasRvcCoverModelInput(targetNodeId, nodes, edges, existingData)
  ) {
    const voiceName = resolveRvcTrainNickname(
      existingData as { rvcTrainModelName?: string; title?: string },
    );
    const rvcCoverModelName =
      resolveRvcCoverModelPath(
        existingData as { rvcCoverModelName?: string; rvcTrainModelName?: string; title?: string },
      ) || deriveRvcCoverModelPath(voiceName);
    return {
      model: AI_VOICE_COVER_MODEL_ID,
      rvcTrainModelName: voiceName || undefined,
      rvcCoverModelName: rvcCoverModelName || undefined,
      libraryRvcVoiceId: existingData?.libraryRvcVoiceId as string | undefined,
      outputModelUrl: existingData?.outputModelUrl as string | undefined,
      outputModelRemoteUrl: existingData?.outputModelRemoteUrl as string | undefined,
      sourceSongAudioUrl: pickCoverSourceSongUrl(audioEntries) || undefined,
      referenceAudioUrl: '',
    };
  }

  if (audioEntries.length >= 1) {
    const sourceSongAudioUrl = pickCoverSourceSongUrl(audioEntries);
    if (isAudioCoverModel(existingModel)) {
      const rvcCoverModelName = resolveRvcCoverModelPath(
        existingData as { rvcCoverModelName?: string; rvcTrainModelName?: string; title?: string },
      );
      return {
        sourceSongAudioUrl,
        model: AI_VOICE_COVER_MODEL_ID,
        rvcCoverModelName: rvcCoverModelName || undefined,
        referenceAudioUrl: '',
      };
    }
    if (isAudioSongModel(existingModel)) {
      return { referenceAudioUrl: sourceSongAudioUrl, sourceSongAudioUrl: '' };
    }
    if (isRvcTrainModel(existingModel)) {
      const rvcName = String(existingData?.rvcTrainModelName ?? existingData?.title ?? '').trim();
      return {
        referenceAudioUrl: sourceSongAudioUrl,
        sourceSongAudioUrl: '',
        model: RVC_VOICE_TRAIN_MODEL_ID,
        rvcTrainModelName: rvcName,
      };
    }
    // Index-TTS / Doubao：按入边顺序最多 3 路参考音（Doubao 可用多段；Index 仍取第 1 路）
    // 多路时不强制改模型，仅写入列表供面板标签 / Doubao 提交使用
    const connectedRefs = collectReferenceAudiosFromEdges(targetNodeId, nodes, edges, DOUBAO_MAX_REF_AUDIOS);
    const refUrls = connectedRefs.map((r) => r.url);
    const firstRef = refUrls[0] || sourceSongAudioUrl;
    return {
      referenceAudioUrl: firstRef,
      referenceAudioUrls: refUrls.length > 0 ? refUrls : undefined,
      connectedReferenceAudios: connectedRefs.length > 0 ? connectedRefs : undefined,
      sourceSongAudioUrl: '',
      model: existingModel || 'index-tts2',
    };
  }

  // 角色卡 → 音频：有 voiceClip/referenceAudioUrl 即写入参考音；无声音不写空、不覆盖
  const characterAudioUrl = pickCharacterTransmitAudioFromEdges(targetNodeId, nodes, edges);
  if (characterAudioUrl) {
    if (isAudioSongModel(existingModel)) {
      return { referenceAudioUrl: characterAudioUrl, sourceSongAudioUrl: '' };
    }
    if (isRvcTrainModel(existingModel)) {
      const rvcName = String(existingData?.rvcTrainModelName ?? existingData?.title ?? '').trim();
      return {
        referenceAudioUrl: characterAudioUrl,
        sourceSongAudioUrl: '',
        model: RVC_VOICE_TRAIN_MODEL_ID,
        rvcTrainModelName: rvcName,
      };
    }
    return {
      referenceAudioUrl: characterAudioUrl,
      sourceSongAudioUrl: '',
      model: existingModel || 'index-tts2',
    };
  }
  // 已连角色但无声音片段：不写空参考音（避免清掉用户手填/历史参考音）
  return null;
}
