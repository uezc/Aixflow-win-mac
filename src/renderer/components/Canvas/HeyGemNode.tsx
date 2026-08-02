/**
 * 独立「HeyGem 数字人」画布模块：
 * 双栏配置（参考视频 / 台词与声音）渲染在节点主框内；成片在右侧新建视频节点并连线展示。
 * 与 VideoNode 共用节点壳与进度交互。
 */
import { VideoNode, HEYGEM_SHELL_W, HEYGEM_SHELL_H, HEYGEM_SHELL_H_BUSY } from './VideoNode';

export { HEYGEM_SHELL_W, HEYGEM_SHELL_H, HEYGEM_SHELL_H_BUSY };
export default VideoNode;
