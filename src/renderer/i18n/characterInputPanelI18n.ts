import type { AppLocale } from './settingsI18n';

export type CharacterInputPanelStrings = {
  /** Sora 管线角色创建已下线时底部说明 */
  soraCharacterUnavailableTitle: string;
  soraCharacterUnavailableBody: string;
  videoLinkedBadge: string;
  localVideoNeedUpload: string;
  confirmUploadVideo: string;
  nicknameLabel: string;
  nicknamePlaceholder: string;
  timestampLabel: string;
  timestampPlaceholder: string;
  timestampHint: string;
  videoUrlLabel: string;
  videoUrlPlaceholder: string;
  videoUrlPlaceholderUploading: string;
  uploadingHint: string;
  selectChannelTitle: string;
  channelPlugin: string;
  channelCore: string;
  priceTitle: string;
  creditsSuffix: string;
  createCharacter: string;
  uploadingButton: string;
  needUploadFirst: string;
  errNeedVideo: string;
  errTimestampFormat: string;
};

const zh: CharacterInputPanelStrings = {
  soraCharacterUnavailableTitle: '「从视频创建角色」已暂停',
  soraCharacterUnavailableBody:
    '因官方 Sora2 相关能力调整，画布内基于该管线的角色创建入口已关闭。已有角色节点仍可查看；后续若开放新管线会在此更新。',
  videoLinkedBadge: '[视频对接]',
  localVideoNeedUpload: '检测到本地视频，需要上传到云端',
  confirmUploadVideo: '确认上传视频',
  nicknameLabel: '角色名',
  nicknamePlaceholder: '输入备注角色名(可选)',
  timestampLabel: '时间戳(秒)范围',
  timestampPlaceholder: '例如: 1,3',
  timestampHint: '格式 1,3（差值 1-3 秒）',
  videoUrlLabel: '视频URL',
  videoUrlPlaceholder: '输入视频URL或连接视频模块',
  videoUrlPlaceholderUploading: '正在上传视频至云端...',
  uploadingHint: '正在上传视频至云端...',
  selectChannelTitle: '选择算力通道',
  channelPlugin: '插件算力',
  channelCore: '核心算力',
  priceTitle:
    '单次创建角色预估消耗元宝；优先 nx_model_config 中 sora-2-character-plugin / sora-2-character-core（或 sora-2-character）',
  creditsSuffix: '元宝',
  createCharacter: '创建角色',
  uploadingButton: '正在上传视频至云端...',
  needUploadFirst: '请先确认上传视频',
  errNeedVideo: '请输入视频URL或连接视频模块',
  errTimestampFormat: '时间戳格式错误，格式应为：1,3（表示1-3秒，范围差值1-3秒）',
};

const en: CharacterInputPanelStrings = {
  soraCharacterUnavailableTitle: 'Video-to-character creation is paused',
  soraCharacterUnavailableBody:
    'Sora2-related capabilities have changed. Character creation from video on the canvas is hidden. Existing character nodes remain visible; we will update here if a new pipeline is available.',
  videoLinkedBadge: '[Video linked]',
  localVideoNeedUpload: 'Local video detected — upload to cloud to continue',
  confirmUploadVideo: 'Upload video',
  nicknameLabel: 'Character name',
  nicknamePlaceholder: 'Display name (optional)',
  timestampLabel: 'Timestamp range (sec)',
  timestampPlaceholder: 'e.g. 1,3',
  timestampHint: 'Format 1,3 (1–3 second span)',
  videoUrlLabel: 'Video URL',
  videoUrlPlaceholder: 'Paste URL or connect a video node',
  videoUrlPlaceholderUploading: 'Uploading to cloud…',
  uploadingHint: 'Uploading to cloud…',
  selectChannelTitle: 'Compute channel',
  channelPlugin: 'Plugin compute',
  channelCore: 'Core compute',
  priceTitle: 'Estimated credits per character create (nx_model_config)',
  creditsSuffix: 'credits',
  createCharacter: 'Create character',
  uploadingButton: 'Uploading…',
  needUploadFirst: 'Confirm upload first',
  errNeedVideo: 'Enter a video URL or connect a video node',
  errTimestampFormat: 'Invalid range. Use 1,3 (start,end seconds, span 1–3s)',
};

export function characterInputPanelT(locale: AppLocale): CharacterInputPanelStrings {
  return locale === 'en' ? en : zh;
}
