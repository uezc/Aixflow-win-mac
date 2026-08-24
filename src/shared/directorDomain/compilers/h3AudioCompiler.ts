/**
 * MiniMax H3 对口型 Prompt Compiler。
 * 共享同一份导演执行表；只编译本镜声音绑定与口型对齐约束。
 */

import {
  compileDramaShotVideoRequest,
  type DramaShotVideoCompiledRequest,
} from '../compileDramaShotVideoRequest.js';
import type { DramaDirectorSession, DramaShot } from '../types.js';

export function compileH3AudioShotRequest(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts?: { locale?: 'zh' | 'en' | string },
): DramaShotVideoCompiledRequest {
  return compileDramaShotVideoRequest(session, shot, {
    mode: 'h3-audio',
    model: 'minimax-h3-audio',
    locale: opts?.locale,
  });
}
