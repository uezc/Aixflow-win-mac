import React from 'react';

type Props = {
  className?: string;
  isDarkMode?: boolean;
};

/**
 * 可复用于图片 / 视频 / 音频结果区的 AI 生成标识提示。
 * 产品决定暂不展示该角标（合规说明仍见用户协议 / AI 免责声明）。
 */
export const AiGeneratedBadge: React.FC<Props> = () => null;
