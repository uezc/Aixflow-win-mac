import type { DramaDirectorSession, DramaGenerationPackage, DramaShot, DramaVideoAdapterPayload } from '../types.js';

export interface DramaVideoAdapterInput {
  shot: DramaShot;
  package: DramaGenerationPackage;
  session?: DramaDirectorSession;
  aspectRatio?: string;
  durationSec?: number;
  preferLipsync?: boolean;
}

export interface DramaVideoModelAdapter {
  id: string;
  label: string;
  /** 构建可交给 AICore video 的 payload */
  build(input: DramaVideoAdapterInput): DramaVideoAdapterPayload;
}

const registry = new Map<string, DramaVideoModelAdapter>();

export function registerDramaVideoAdapter(adapter: DramaVideoModelAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getDramaVideoAdapter(id: string): DramaVideoModelAdapter | undefined {
  return registry.get(String(id || '').trim());
}

export function listDramaVideoAdapters(): DramaVideoModelAdapter[] {
  return [...registry.values()];
}
