/**
 * MiniMax H3 全能参考 Adapter：执行表 → compileH3MultiShotRequest。
 * 禁止在此直连 RunningHub；mode 固定为 h3-multi。
 */

import { compileH3MultiShotRequest } from '../compilers/h3MultiCompiler.js';
import { registerDramaVideoAdapter, type DramaVideoAdapterInput } from './types.js';

registerDramaVideoAdapter({
  id: 'minimax-h3-multi',
  label: 'MiniMax H3 全能参考',
  build: (input: DramaVideoAdapterInput) => {
    if (!input.session) {
      throw new Error('H3 全能参考 Adapter 需要 directorDomain session，无法猜测编译 mode');
    }
    const compiled = compileH3MultiShotRequest(input.session, input.shot);
    return {
      adapter_id: 'minimax-h3-multi',
      model: 'minimax-h3-multi',
      prompt: compiled.prompt,
      inputImages: compiled.inputImages,
      inputAudios: compiled.inputAudios,
      durationSec: input.durationSec || compiled.durationSec || input.shot.duration_sec,
      aspectRatio: input.aspectRatio || '9:16',
    };
  },
});
