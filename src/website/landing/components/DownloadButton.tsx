import { useInstallerDownload } from '../hooks/useInstallerDownload';
import { Button } from './Button';
import type { MouseEvent } from 'react';

type Props = {
  className?: string;
  label?: string;
  loadingLabel?: string;
  unavailableLabel?: string;
};

export function DownloadButton({
  className = '',
  label = '开始使用',
  loadingLabel = '准备下载…',
  unavailableLabel = '安装包暂不可用',
}: Props) {
  const { primaryUrl, loading, platform } = useInstallerDownload();

  if (loading) {
    return (
      <span
        className={`inline-flex cursor-wait items-center justify-center rounded-full bg-[#051A24]/70 px-7 py-3 text-sm font-medium text-white/80 ${className}`.trim()}
        aria-busy="true"
      >
        {loadingLabel}
      </span>
    );
  }

  if (!primaryUrl) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-zinc-700/80 px-7 py-3 text-sm font-medium text-zinc-300 ${className}`.trim()}
        aria-disabled="true"
        title="请确认 OSS 已上传 latest.yml 与安装包，并配置 CORS"
      >
        {unavailableLabel}
      </span>
    );
  }

  const fileHint = platform === 'mac' ? 'macOS 安装包' : 'Windows 安装包';

  const handleDownloadClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // OSS 跨域时 download 属性无效，需直接导航才能触发浏览器下载
    e.preventDefault();
    window.location.href = primaryUrl;
  };

  return (
    <Button
      href={primaryUrl}
      className={className}
      title={`下载 Aixflow ${fileHint}`}
      rel="noopener noreferrer"
      onClick={handleDownloadClick}
    >
      {label}
    </Button>
  );
}
