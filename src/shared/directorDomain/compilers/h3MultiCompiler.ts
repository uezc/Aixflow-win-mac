/**
 * MiniMax H3 全能参考 Prompt Compiler。
 * 共享同一份导演执行表；只编译角色参考音绑定与「按时间轴生成声景」。
 */

import {
  compileDramaShotVideoRequest,
  type DramaShotVideoCompiledRequest,
} from '../compileDramaShotVideoRequest.js';
import type { DramaDirectorSession, DramaShot } from '../types.js';

export function compileH3MultiShotRequest(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts?: { locale?: 'zh' | 'en' | string },
): DramaShotVideoCompiledRequest {
  return compileDramaShotVideoRequest(session, shot, {
    mode: 'h3-multi',
    model: 'minimax-h3-multi',
    locale: opts?.locale,
  });
}
