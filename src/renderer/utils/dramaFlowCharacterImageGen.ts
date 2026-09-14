/**
 * AI 短剧 2 代角色定妆图：复用 1 代四宫格提示词与 invoke 参数。
 */
import type { Node } from 'reactflow';
import {
  applyDramaSessionAssetImage,
  composeDramaImageStyleHint,
  ensureDramaCharacterPromptGenreLock,
  resolveDramaGenreLock,
  type DramaDirectorSession,
} from '../../shared/directorDomain';
import {
  buildDirectorCharacterImagePrompt,
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
import { DRAMA_FLOW_CHARACTER_NODE_TYPE } from '../components/Canvas/DramaFlowCharacterNode';

export function dramaFlowCharacterImageNodeId(parentDramaFlowId: string, characterId: string): string {
  return `${parentDramaFlowId}-director-img-${characterId}`;
}

export function parseDramaFlowCharacterImageNodeId(
  packetNodeId: string,
): { parentId: string; characterId: string } | null {
  const m = String(packetNodeId || '').match(/^(.+)-director-img-(.+)$/);
  if (!m) return null;
  return { parentId: m[1]!, characterId: m[2]! };
}

function pickT2iModel(preferred: string | undefined | null): string {
  const normalized = normalizeImageModelIfRetired(preferred);
  const opts = filterImageModelsForMode({ hasRefs: false, refCount: 0 });
  if (opts.some((m) => m.value === normalized)) return normalized;
  return opts[0]?.value || DEFAULT_IMAGE_MODEL;
}

export function buildDramaFlowCharacterImagePrompt(opts: {
  parentNode: Node;
  name: string;
  prompt: string;
  gender?: string;
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
  const lockedPrompt = ensureDramaCharacterPromptGenreLock(opts.prompt, genreLock);
  return buildDirectorCharacterImagePrompt({
    name: opts.name,
    prompt: lockedPrompt,
    styleHint,
    subject: 'character',
    gender: opts.gender || '',
  });
}

export async function invokeDramaFlowCharacterImage(opts: {
  parentNode: Node;
  characterId: string;
  name: string;
  prompt: string;
  imageModel?: string;
  imageResolution?: string;
  projectId?: string;
  gender?: string;
}): Promise<void> {
  const parentId = opts.parentNode.id;
  const characterId = String(opts.characterId || '').trim();
  if (!characterId) throw new Error('缺少角色 id');
  const prompt = buildDramaFlowCharacterImagePrompt({
    parentNode: opts.parentNode,
    name: opts.name,
    prompt: opts.prompt,
    gender: opts.gender,
  });
  const model = pickT2iModel(opts.imageModel);
  const resTier = normalizeDirectorImageResolution(opts.imageResolution || '2K');
  const resolution = (resTier === '4K' ? '2K' : resTier).toLowerCase();
  await window.electronAPI.invokeAI({
    modelId: 'image',
    nodeId: dramaFlowCharacterImageNodeId(parentId, characterId),
    input: {
      model,
      prompt,
      response_format: 'url',
      aspect_ratio: directorAssetAspectRatio('character'),
      resolution,
      projectId: opts.projectId || undefined,
      nodeTitle: `角色定妆-${opts.name || characterId}`,
      directorAssetId: characterId,
    },
  });
}

/** 将定妆图写回 2 代剧本 Domain + 角色卡节点 */
export function patchNodesWithDramaFlowCharacterImage(
  nodes: Node[],
  parentId: string,
  characterId: string,
  updates: { imageUrl?: string; status?: string; error?: string },
): Node[] {
  return nodes.map((n) => {
    if (n.id === parentId && n.type === DRAMA_FLOW_NODE_TYPE) {
      const domain = (n.data as { directorDomain?: DramaDirectorSession | null })?.directorDomain;
      if (!domain) return n;
      const nextDomain = applyDramaSessionAssetImage(domain, characterId, {
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
      n.type === DRAMA_FLOW_CHARACTER_NODE_TYPE &&
      String((n.data as any)?.parentDramaFlowId || '') === parentId &&
      String((n.data as any)?.characterId || '') === characterId
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
