/**
 * AI 短剧 2 代道具 / 生物生图。
 */
import type { Node } from 'reactflow';
import {
  applyDramaSessionAssetImage,
  composeDramaImageStyleHint,
  resolveDramaGenreLock,
  type DramaDirectorSession,
} from '../../shared/directorDomain';
import {
  buildDirectorCharacterImagePrompt,
  buildDirectorPropImagePrompt,
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
import {
  DRAMA_FLOW_CREATURE_NODE_TYPE,
  DRAMA_FLOW_PROP_NODE_TYPE,
} from '../components/Canvas/DramaFlowAssetCardNode';

export function dramaFlowPropImageNodeId(parentDramaFlowId: string, propId: string): string {
  return `${parentDramaFlowId}-director-prop-img-${propId}`;
}

export function parseDramaFlowPropImageNodeId(
  packetNodeId: string,
): { parentId: string; propId: string } | null {
  const m = String(packetNodeId || '').match(/^(.+)-director-prop-img-(.+)$/);
  if (!m) return null;
  return { parentId: m[1]!, propId: m[2]! };
}

export function dramaFlowCreatureImageNodeId(parentDramaFlowId: string, creatureId: string): string {
  return `${parentDramaFlowId}-director-creature-img-${creatureId}`;
}

export function parseDramaFlowCreatureImageNodeId(
  packetNodeId: string,
): { parentId: string; creatureId: string } | null {
  const m = String(packetNodeId || '').match(/^(.+)-director-creature-img-(.+)$/);
  if (!m) return null;
  return { parentId: m[1]!, creatureId: m[2]! };
}

function pickT2iModel(preferred: string | undefined | null): string {
  const normalized = normalizeImageModelIfRetired(preferred);
  const opts = filterImageModelsForMode({ hasRefs: false, refCount: 0 });
  if (opts.some((m) => m.value === normalized)) return normalized;
  return opts[0]?.value || DEFAULT_IMAGE_MODEL;
}

function styleHintForParent(parentNode: Node): string {
  const d = (parentNode.data || {}) as Record<string, unknown>;
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
  return composeDramaImageStyleHint(
    genreLock,
    baseStyle,
    domain?.bible?.project?.visual_style,
    domain?.bible?.project?.style,
  );
}

export async function invokeDramaFlowPropImage(opts: {
  parentNode: Node;
  propId: string;
  name: string;
  prompt: string;
  imageModel?: string;
  imageResolution?: string;
  projectId?: string;
}): Promise<void> {
  const propId = String(opts.propId || '').trim();
  if (!propId) throw new Error('缺少道具 id');
  const prompt = buildDirectorPropImagePrompt({
    name: opts.name,
    prompt: opts.prompt,
    styleHint: styleHintForParent(opts.parentNode),
  });
  const model = pickT2iModel(opts.imageModel);
  const resTier = normalizeDirectorImageResolution(opts.imageResolution || '2K');
  const resolution = (resTier === '4K' ? '2K' : resTier).toLowerCase();
  await window.electronAPI.invokeAI({
    modelId: 'image',
    nodeId: dramaFlowPropImageNodeId(opts.parentNode.id, propId),
    input: {
      model,
      prompt,
      response_format: 'url',
      aspect_ratio: directorAssetAspectRatio('prop'),
      resolution,
      projectId: opts.projectId || undefined,
      nodeTitle: `道具图-${opts.name || propId}`,
      directorAssetId: propId,
    },
  });
}

export async function invokeDramaFlowCreatureImage(opts: {
  parentNode: Node;
  creatureId: string;
  name: string;
  prompt: string;
  imageModel?: string;
  imageResolution?: string;
  projectId?: string;
}): Promise<void> {
  const creatureId = String(opts.creatureId || '').trim();
  if (!creatureId) throw new Error('缺少生物 id');
  const prompt = buildDirectorCharacterImagePrompt({
    name: opts.name,
    prompt: opts.prompt,
    styleHint: styleHintForParent(opts.parentNode),
    subject: 'creature',
  });
  const model = pickT2iModel(opts.imageModel);
  const resTier = normalizeDirectorImageResolution(opts.imageResolution || '2K');
  const resolution = (resTier === '4K' ? '2K' : resTier).toLowerCase();
  await window.electronAPI.invokeAI({
    modelId: 'image',
    nodeId: dramaFlowCreatureImageNodeId(opts.parentNode.id, creatureId),
    input: {
      model,
      prompt,
      response_format: 'url',
      aspect_ratio: directorAssetAspectRatio('creature'),
      resolution,
      projectId: opts.projectId || undefined,
      nodeTitle: `生物图-${opts.name || creatureId}`,
      directorAssetId: creatureId,
    },
  });
}

export function patchNodesWithDramaFlowPropImage(
  nodes: Node[],
  parentId: string,
  propId: string,
  updates: { imageUrl?: string; status?: string; error?: string },
): Node[] {
  return nodes.map((n) => {
    if (n.id === parentId && n.type === DRAMA_FLOW_NODE_TYPE) {
      const domain = (n.data as { directorDomain?: DramaDirectorSession | null })?.directorDomain;
      if (!domain) return n;
      const nextDomain = applyDramaSessionAssetImage(domain, propId, {
        imageUrl: updates.imageUrl,
        status: (updates.status as any) || (updates.imageUrl ? 'ready' : 'idle'),
      });
      if (!nextDomain) return n;
      return { ...n, data: { ...n.data, directorDomain: nextDomain } };
    }
    if (
      n.type === DRAMA_FLOW_PROP_NODE_TYPE &&
      String((n.data as any)?.parentDramaFlowId || '') === parentId &&
      String((n.data as any)?.assetId || '') === propId
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

export function patchNodesWithDramaFlowCreatureImage(
  nodes: Node[],
  parentId: string,
  creatureId: string,
  updates: { imageUrl?: string; status?: string; error?: string },
): Node[] {
  return nodes.map((n) => {
    if (n.id === parentId && n.type === DRAMA_FLOW_NODE_TYPE) {
      const domain = (n.data as { directorDomain?: DramaDirectorSession | null })?.directorDomain;
      if (!domain) return n;
      const nextDomain = applyDramaSessionAssetImage(domain, creatureId, {
        imageUrl: updates.imageUrl,
        status: (updates.status as any) || (updates.imageUrl ? 'ready' : 'idle'),
      });
      if (!nextDomain) return n;
      return { ...n, data: { ...n.data, directorDomain: nextDomain } };
    }
    if (
      n.type === DRAMA_FLOW_CREATURE_NODE_TYPE &&
      String((n.data as any)?.parentDramaFlowId || '') === parentId &&
      String((n.data as any)?.assetId || '') === creatureId
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
