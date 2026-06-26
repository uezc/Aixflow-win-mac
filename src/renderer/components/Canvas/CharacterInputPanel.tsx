import React, { useState, useMemo } from 'react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { characterInputPanelT } from '../../i18n/characterInputPanelI18n';
import { Play, Link } from 'lucide-react';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import { getSora2CharacterDisplayPrice } from '../../utils/cloudModelPricing';
import { canvasBottomInputPanelShell } from '../../theme/canvasBottomInputPanel';

export type CharacterChannel = 'plugin' | 'core';

interface CharacterInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  videoUrl: string;
  nickname: string;
  timestamp: string;
  characterChannel?: CharacterChannel; // 核心算力 / 插件算力
  isConnected?: boolean; // 是否有输入连线（从video模块）
  projectId?: string;
  onVideoUrlChange: (value: string) => void;
  onNicknameChange: (value: string) => void;
  onTimestampChange: (value: string) => void;
  onCharacterChannelChange?: (value: CharacterChannel) => void;
  onCreateCharacter: () => void;
  isUploading?: boolean; // 是否正在上传
  needsUpload?: boolean; // 是否需要上传（检测到本地视频但未上传）
  localVideoPath?: string; // 本地视频路径（用于上传）
  onConfirmUpload?: () => void; // 确认上传回调
}

const CharacterInputPanel: React.FC<CharacterInputPanelProps> = ({
  nodeId,
  isDarkMode,
  videoUrl,
  nickname,
  timestamp,
  characterChannel = 'core',
  isConnected = false,
  projectId,
  onVideoUrlChange,
  onNicknameChange,
  onTimestampChange,
  onCharacterChannelChange,
  onCreateCharacter,
  isUploading = false,
  needsUpload = false,
  localVideoPath,
  onConfirmUpload,
}) => {
  const [error, setError] = useState<string | null>(null);
  const { cloudMap } = useNxModelPricing();
  const { locale } = useAppLocale();
  const ct = useMemo(() => characterInputPanelT(locale), [locale]);

  const characterPriceYuanbao = useMemo(
    () => getSora2CharacterDisplayPrice(characterChannel, cloudMap, 1),
    [characterChannel, cloudMap],
  );

  // 验证时间戳格式
  const validateTimestamp = (ts: string): boolean => {
    if (!ts.trim()) return true; // 可选字段
    const pattern = /^\d+,\d+$/;
    if (!pattern.test(ts)) return false;
    const [start, end] = ts.split(',').map(Number);
    if (start >= end) return false;
    const diff = end - start;
    if (diff < 1 || diff > 3) return false;
    return true;
  };

  // 处理创建角色
  const handleCreate = () => {
    if (!videoUrl.trim()) {
      setError(ct.errNeedVideo);
      return;
    }

    if (timestamp.trim() && !validateTimestamp(timestamp)) {
      setError(ct.errTimestampFormat);
      return;
    }

    setError(null);
    onCreateCharacter();
  };

  return (
    <div className={canvasBottomInputPanelShell(isDarkMode)}>
      <div className="flex-1 overflow-y-auto space-y-3">
        {/* 视频对接状态 */}
        {isConnected && videoUrl && !needsUpload && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
            isDarkMode ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-green-100 text-green-700 border border-green-300'
          }`}>
            <Link className="w-3.5 h-3.5" />
            <span>{ct.videoLinkedBadge}</span>
          </div>
        )}

        {/* 需要上传提示 */}
        {needsUpload && !isUploading && (
          <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs ${
            isDarkMode ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-yellow-100 text-yellow-700 border border-yellow-300'
          }`}>
            <div className="flex items-center gap-2">
              <Link className="w-3.5 h-3.5" />
              <span>{ct.localVideoNeedUpload}</span>
            </div>
            {onConfirmUpload && (
              <button
                onClick={onConfirmUpload}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  isDarkMode
                    ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                    : 'bg-yellow-500 hover:bg-yellow-600 text-white'
                }`}
              >
                {ct.confirmUploadVideo}
              </button>
            )}
          </div>
        )}

        {/* 角色名 + 时间戳范围（同一行各占一半） */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <label className={`block text-xs font-medium mb-1.5 ${
              isDarkMode ? 'text-white/80' : 'text-gray-700'
            }`}>
              {ct.nicknameLabel}
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => onNicknameChange(e.target.value)}
              placeholder={ct.nicknamePlaceholder}
              className={`w-full px-3 py-2 rounded-lg text-sm border ${
                isDarkMode
                  ? 'bg-black/30 text-white border-white/20 placeholder-white/40'
                  : 'bg-white/90 text-gray-900 border-gray-300 placeholder-gray-500'
              } focus:outline-none focus:ring-2 focus:ring-apple-blue`}
            />
          </div>

          <div className="flex-1 min-w-0">
            <label className={`block text-xs font-medium mb-1.5 ${
              isDarkMode ? 'text-white/80' : 'text-gray-700'
            }`}>
              {ct.timestampLabel}
            </label>
            <input
              type="text"
              value={timestamp}
              onChange={(e) => {
                onTimestampChange(e.target.value);
                setError(null);
              }}
              placeholder={ct.timestampPlaceholder}
              className={`w-full px-3 py-2 rounded-lg text-sm border ${
                isDarkMode
                  ? 'bg-black/30 text-white border-white/20 placeholder-white/40'
                  : 'bg-white/90 text-gray-900 border-gray-300 placeholder-gray-500'
              } focus:outline-none focus:ring-2 focus:ring-apple-blue`}
            />
            <p className={`text-xs mt-1 ${
              isDarkMode ? 'text-white/50' : 'text-gray-500'
            }`}>
              {ct.timestampHint}
            </p>
          </div>
        </div>

        {/* 视频URL */}
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${
            isDarkMode ? 'text-white/80' : 'text-gray-700'
          }`}>
            {ct.videoUrlLabel}
          </label>
          <div className="relative">
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => {
                onVideoUrlChange(e.target.value);
                setError(null);
              }}
              placeholder={isUploading ? ct.videoUrlPlaceholderUploading : ct.videoUrlPlaceholder}
              disabled={isConnected || isUploading}
              className={`w-full px-3 py-2 rounded-lg text-sm border ${
                isDarkMode
                  ? 'bg-black/30 text-white border-white/20 placeholder-white/40'
                  : 'bg-white/90 text-gray-900 border-gray-300 placeholder-gray-500'
              } focus:outline-none focus:ring-2 focus:ring-apple-blue disabled:opacity-50 disabled:cursor-not-allowed`}
            />
            {isUploading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </div>
          {isUploading && (
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
              {ct.uploadingHint}
            </p>
          )}
        </div>

        {/* 错误信息 */}
        {error && (
          <div className={`p-2 rounded-lg text-xs ${
            isDarkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700'
          }`}>
            {error}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 pt-3 border-t border-white/10">
        <select
          value={characterChannel}
          onChange={(e) => onCharacterChannelChange?.(e.target.value as CharacterChannel)}
          className={`px-2 py-1.5 rounded-lg text-xs border ${
            isDarkMode
              ? 'bg-black/30 text-white border-white/20'
              : 'bg-white/90 text-gray-900 border-gray-300'
          } focus:outline-none focus:ring-2 focus:ring-apple-blue`}
          title={ct.selectChannelTitle}
        >
          <option value="plugin">{ct.channelPlugin}</option>
          <option value="core">{ct.channelCore}</option>
        </select>
        <span
          className={`flex-shrink-0 text-center text-xs font-medium px-2 py-1 rounded tabular-nums ${
            isDarkMode ? 'text-yellow-200 bg-yellow-500/25' : 'text-yellow-700 bg-yellow-100'
          }`}
          title={ct.priceTitle}
        >
          {characterPriceYuanbao}
          {locale === 'en' ? ' ' : ''}
          {ct.creditsSuffix}
        </span>
        <button
          onClick={handleCreate}
          disabled={!videoUrl.trim() || isUploading || needsUpload}
          className={`flex-1 min-w-0 px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-center gap-2 ${
            isDarkMode
              ? (isUploading || needsUpload)
                ? 'bg-gray-600 text-white/60 border border-gray-500 cursor-not-allowed'
                : 'bg-apple-blue hover:bg-apple-blue/80 text-white border border-apple-blue'
              : (isUploading || needsUpload)
                ? 'bg-gray-400 text-gray-600 border border-gray-300 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isUploading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>{ct.uploadingButton}</span>
            </>
          ) : needsUpload ? (
            <>
              <span>{ct.needUploadFirst}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>{ct.createCharacter}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default CharacterInputPanel;
