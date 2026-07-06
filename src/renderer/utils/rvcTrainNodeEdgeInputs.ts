import type { Edge, Node } from 'reactflow';
import { pickBestAudioUrlForRhTrainFromNodeData } from './rvcTrainAudioUrl';

/** 从 audio 入边解析 RVC 训练素材 URL（优先 OSS/https） */
export function resolveRvcTrainAudioFromEdges(targetNodeId: string, nodes: Node[], edges: Edge[]): string {
  for (const e of edges) {
    if (e.target !== targetNodeId) continue;
    const source = nodes.find((n) => n.id === e.source);
    if (!source || source.type !== 'audio') continue;
    const url = pickBestAudioUrlForRhTrainFromNodeData(source.data as Record<string, unknown>);
    if (url) return url;
  }
  return '';
}
