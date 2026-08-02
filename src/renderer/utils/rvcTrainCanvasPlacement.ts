import type { Node } from 'reactflow';
import type { RvcVoiceLibraryItem } from '../components/characterListShared';
import { rvcVoiceAvatarUrl, rvcVoiceDisplayName, rvcVoiceModelPackageUrl, rvcVoiceTrainAudioUrl } from '../components/characterListShared';
import { RVC_VOICE_TRAIN_MODEL_ID } from './audioRvcTrainModel';
import { RVC_TRAIN_HEIGHT, RVC_TRAIN_WIDTH, RVC_TRAIN_NAME_FONT_DEFAULT_PX } from '../constants/rvcTrainLayout';

const RVC_TRAIN_TECHNICAL_TITLES = new Set(['rvctrain', 'rvc 训练', 'rvc 音色训练', '音色训练']);

/** 画布节点 / 面板用的昵称（排除内部 title 标识） */
export function resolveRvcTrainNickname(data?: { rvcTrainModelName?: string; title?: string } | null): string {
  const model = (data?.rvcTrainModelName || '').trim();
  if (model) return model;
  const title = (data?.title || '').trim();
  if (title && !RVC_TRAIN_TECHNICAL_TITLES.has(title.toLowerCase())) return title;
  return '';
}

function centeredPosition(flowPosition: { x: number; y: number }) {
  return {
    x: flowPosition.x - RVC_TRAIN_WIDTH / 2,
    y: flowPosition.y - RVC_TRAIN_HEIGHT / 2,
  };
}

/** 空白 RVC 训练节点（右键菜单 / 拖线创建） */
export function buildEmptyRvcTrainNode(flowPosition: { x: number; y: number }, nodeId?: string): Node {
  const id = nodeId || `rvcTrain-${Date.now()}`;
  return {
    id,
    type: 'rvcTrain',
    position: centeredPosition(flowPosition),
    data: {
      label: '音色训练',
      title: '',
      model: RVC_VOICE_TRAIN_MODEL_ID,
      width: RVC_TRAIN_WIDTH,
      height: RVC_TRAIN_HEIGHT,
      isUserResized: false,
      rvcTrainModelName: '',
      referenceAudioUrl: '',
      rvcTrainNameFontPx: RVC_TRAIN_NAME_FONT_DEFAULT_PX,
      aiStatus: 'idle',
      progress: 0,
    },
    selected: true,
    selectable: true,
  };
}

/** 从音色库条目放置到画布（已训练模型回顾 / 复用） */
export function buildRvcTrainNodeFromLibraryItem(
  item: RvcVoiceLibraryItem,
  flowPosition: { x: number; y: number },
  nodeId?: string,
): Node {
  const id = nodeId || `rvcTrain-${Date.now()}`;
  const displayName = rvcVoiceDisplayName(item, 'RVC');
  const pkgUrl = rvcVoiceModelPackageUrl(item);
  const avatar = rvcVoiceAvatarUrl(item);
  return {
    id,
    type: 'rvcTrain',
    position: centeredPosition(flowPosition),
    data: {
      label: displayName,
      title: displayName,
      model: RVC_VOICE_TRAIN_MODEL_ID,
      width: RVC_TRAIN_WIDTH,
      height: RVC_TRAIN_HEIGHT,
      isUserResized: false,
      rvcTrainModelName: displayName,
      referenceAudioUrl: rvcVoiceTrainAudioUrl(item) || '',
      rvcTrainNameFontPx: RVC_TRAIN_NAME_FONT_DEFAULT_PX,
      outputModelUrl: pkgUrl || undefined,
      outputModelRemoteUrl: item.originalModelUrl,
      libraryRvcVoiceId: item.id,
      libraryAvatarUrl: avatar || undefined,
      aiStatus: pkgUrl ? 'SUCCESS' : 'idle',
      progress: 0,
    },
    selected: true,
    selectable: true,
  };
}
