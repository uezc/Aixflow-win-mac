/**
 * MiniMax H3 对口型 Adapter：执行表 → compileH3AudioShotRequest。
 * 禁止在此直连 RunningHub；mode 固定为 h3-audio。
 */

import { compileH3AudioShotRequest } from '../compilers/h3AudioCompiler.js';
import { registerDramaVideoAdapter, type DramaVideoAdapterInput } from './types.js';

registerDramaVideoAdapter({
  id: 'minimax-h3-audio',
  label: 'MiniMax H3 对口型',
  build: (input: DramaVideoAdapterInput) => {
    if (!input.session) {
      throw new Error('H3 对口型 Adapter 需要 directorDomain session，无法猜测编译 mode');
    }
    const compiled = compileH3AudioShotRequest(input.session, input.shot);
    return {
      adapter_id: 'minimax-h3-audio',
      model: 'minimax-h3-audio',
      prompt: compiled.prompt,
      inputImages: compiled.inputImages,
      inputAudios: compiled.inputAudios,
      durationSec: input.durationSec || compiled.durationSec || input.shot.duration_sec,
      aspectRatio: input.aspectRatio || '9:16',
    };
  },
});
