/**
 * AI 短剧 2 代场景定妆图：复用 1 代场景提示词与 16:9 比例。
 */
import type { Node } from 'reactflow';
import {
  applyDramaSessionAssetImage,
  composeDramaImageStyleHint,
  resolveDramaGenreLock,
  type DramaDirectorSession,
} from '../../shared/directorDomain';
import {
  buildDirectorSceneImagePrompt,
  directorAssetAspectRatio,
  normalizeDirectorImageResolution,
  resolveDirectorStylePrompt,
} from '../../shared/directorPipeline';
import {
  DEFAULT_IMAGE_MODEL,
  filterImageModelsForMode,
  normalizeImageModelIfRetired,
} from '../config/imageModelUiPolicy';
import { DRAMA_FLOW_NODE_TYPE } from '../components/Canvas/DramaFlowNode';
import { DRAMA_FLOW_SCENE_NODE_TYPE } from '../components/Canvas/DramaFlowSceneNode';

export function dramaFlowSceneImageNodeId(parentDramaFlowId: string, sceneId: string): string {
  return `${parentDramaFlowId}-director-scene-img-${sceneId}`;
}

export function parseDramaFlowSceneImageNodeId(
  packetNodeId: string,
): { parentId: string; sceneId: string } | null {
  const m = String(packetNodeId || '').match(/^(.+)-director-scene-img-(.+)$/);
  if (!m) return null;
  return { parentId: m[1]!, sceneId: m[2]! };
}

function pickT2iModel(preferred: string | undefined | null): string {
  const normalized = normalizeImageModelIfRetired(preferred);
  const opts = filterImageModelsForMode({ hasRefs: false, refCount: 0 });
  if (opts.some((m) => m.value === normalized)) return normalized;
  return opts[0]?.value || DEFAULT_IMAGE_MODEL;
}

export function buildDramaFlowSceneImagePrompt(opts: {
  parentNode: Node;
  name: string;
  prompt: string;
  location?: string;
  kind?: string;
  spatial_structure?: string;
  architecture?: string;
  materials?: string;
  lighting?: string;
  time_default?: string;
  fixed_elements?: string[];
}): string {
  const d = (opts.parentNode.data || {}) as Record<string, unknown>;
  const domain = (d.directorDomain as DramaDirectorSession | null) || null;
  const genreLock = resolveDramaGenreLock({
    style: domain?.bible?.project?.style || String(d.styleLabel || ''),
    type: domain?.bible?.project?.type,
    era: domain?.bible?.project?.era,
    visual_style: domain?.bible?.project?.visual_style || String(d.stylePrompt || ''),
    worldview: domain?.bible?.project?.worldview,
    plot: domain?.bible?.plot,
    script: domain?.meta?.source_script || String(d.scriptText || ''),
    keywords: domain?.bible?.script_keywords,
  });
  const baseStyle =
    resolveDirectorStylePrompt(String(d.stylePresetId || ''), String(d.stylePrompt || '')) ||
    String(d.stylePrompt || '').trim();
  const styleHint = composeDramaImageStyleHint(
    genreLock,
    baseStyle,
    domain?.bible?.project?.visual_style,
    domain?.bible?.project?.style,
  );
  return buildDirectorSceneImagePrompt({
    name: opts.name,
    prompt: opts.prompt,
    styleHint,
    location: opts.location,
    kind: opts.kind,
    spatial_structure: opts.spatial_structure,
    architecture: opts.architecture,
    materials: opts.materials,
    lighting: opts.lighting,
    time_default: opts.time_default,
    fixed_elements: opts.fixed_elements,
  });
}

export async function invokeDramaFlowSceneImage(opts: {
  parentNode: Node;
  sceneId: string;
  name: string;
  prompt: string;
  imageModel?: string;
  imageResolution?: string;
  projectId?: string;
  location?: string;
  kind?: string;
  spatial_structure?: string;
  architecture?: string;
  materials?: string;
  lighting?: string;
  time_default?: string;
  fixed_elements?: string[];
}): Promise<void> {
  const parentId = opts.parentNode.id;
  const sceneId = String(opts.sceneId || '').trim();
  if (!sceneId) throw new Error('缺少场景 id');
  const prompt = buildDramaFlowSceneImagePrompt({
    parentNode: opts.parentNode,
    name: opts.name,
    prompt: opts.prompt,
    location: opts.location,
    kind: opts.kind,
    spatial_structure: opts.spatial_structure,
    architecture: opts.architecture,
    materials: opts.materials,
    lighting: opts.lighting,
    time_default: opts.time_default,
    fixed_elements: opts.fixed_elements,
  });
  const model = pickT2iModel(opts.imageModel);
  const resTier = normalizeDirectorImageResolution(opts.imageResolution || '2K');
  const resolution = (resTier === '4K' ? '2K' : resTier).toLowerCase();
  await window.electronAPI.invokeAI({
    modelId: 'image',
    nodeId: dramaFlowSceneImageNodeId(parentId, sceneId),
    input: {
      model,
      prompt,
      response_format: 'url',
      aspect_ratio: directorAssetAspectRatio('scene'),
      resolution,
      projectId: opts.projectId || undefined,
      nodeTitle: `场景定妆-${opts.name || sceneId}`,
      directorAssetId: sceneId,
    },
  });
}

/** 将场景图写回 2 代剧本 Domain + 场景卡节点 */
export function patchNodesWithDramaFlowSceneImage(
  nodes: Node[],
  parentId: string,
  sceneId: string,
  updates: { imageUrl?: string; status?: string; error?: string },
): Node[] {
  return nodes.map((n) => {
    if (n.id === parentId && n.type === DRAMA_FLOW_NODE_TYPE) {
      const domain = (n.data as { directorDomain?: DramaDirectorSession | null })?.directorDomain;
      if (!domain) return n;
      const nextDomain = applyDramaSessionAssetImage(domain, sceneId, {
        imageUrl: updates.imageUrl,
        status: (updates.status as any) || (updates.imageUrl ? 'ready' : 'idle'),
      });
      if (!nextDomain) return n;
      return {
        ...n,
        data: {
          ...n.data,
          directorDomain: nextDomain,
        },
      };
    }
    if (
      n.type === DRAMA_FLOW_SCENE_NODE_TYPE &&
      String((n.data as any)?.parentDramaFlowId || '') === parentId &&
      String((n.data as any)?.sceneId || '') === sceneId
    ) {
      return {
        ...n,
        data: {
          ...n.data,
          ...(updates.imageUrl != null ? { imageUrl: updates.imageUrl } : {}),
          ...(updates.status != null ? { status: updates.status } : {}),
          ...(updates.error != null ? { error: updates.error } : { error: '' }),
        },
      };
    }
    return n;
  });
}
