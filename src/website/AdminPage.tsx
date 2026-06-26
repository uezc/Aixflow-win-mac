import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  useOSSConfig,
  resolveOssWebMediaUrl,
  OSS_WEB_BASE,
  type SceneItem,
} from '../hooks/useOSSConfig';

function SimulatedProgressBar() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - t0;
      const next = Math.min(92, (elapsed / 12000) * 92);
      setPct(next);
    }, 200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="w-full space-y-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-zinc-500">处理中（前端模拟进度，实际状态以 OSS 更新为准）</p>
    </div>
  );
}

function isProcessing(s: SceneItem): boolean {
  const st = String(s.status || '').toLowerCase();
  return st === 'processing' || st === 'pending' || s.status === '处理中';
}

function SceneMedia({ scene }: { scene: SceneItem }): ReactNode {
  const t = String(scene.type || '').toLowerCase();
  const raw = String(scene.mediaUrl || '').trim();
  const url = resolveOssWebMediaUrl(raw, scene.type);

  if (isProcessing(scene) && !raw) {
    return <SimulatedProgressBar />;
  }

  if (!raw) {
    return <p className="text-xs text-zinc-500">未配置 mediaUrl</p>;
  }

  if (!url) {
    return <p className="text-xs text-zinc-500">无法解析媒体地址</p>;
  }

  if (t === 'video') {
    return (
      <video
        src={url}
        className="max-h-[min(70vh,420px)] w-full rounded-lg border border-white/10 bg-black object-contain"
        controls
        playsInline
        preload="metadata"
      />
    );
  }

  if (t === 'manga') {
    return (
      <div className="mx-auto max-w-sm rounded-xl border border-violet-500/20 bg-zinc-900/80 p-2 shadow-inner">
        <img
          src={url}
          alt={scene.title}
          className="max-h-[min(75vh,560px)] w-full rounded-md object-contain"
          loading="lazy"
          decoding="async"
        />
      </div>
    );
  }

  if (t === 'music' || t === 'audio') {
    return (
      <audio src={url} controls className="w-full" preload="metadata">
        <track kind="captions" />
      </audio>
    );
  }

  if (t === 'workflow') {
    const isJson = /\.json($|\?)/i.test(url);
    return (
      <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="text-xs text-zinc-400">工作流文件（下载或新窗口预览）</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-cyan-400 underline decoration-cyan-500/40 hover:text-cyan-300"
        >
          打开 / 下载
        </a>
        {isJson ? (
          <p className="text-[11px] text-zinc-500">JSON 可在浏览器新标签页中查看；也可下载后导入客户端。</p>
        ) : null}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={scene.title}
      className="max-h-[min(70vh,480px)] w-full rounded-lg border border-white/10 object-contain"
      loading="lazy"
      decoding="async"
    />
  );
}

export function AdminPage() {
  const { data, loading, error, refetch, configUrl } = useOSSConfig();

  const subtitle = useMemo(() => {
    if (!data) return '';
    return `v${data.version} · ${data.scenes.length} 个场景`;
  }, [data]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#070b12] via-[#05070a] to-[#030508] px-4 py-10 text-zinc-100">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text text-transparent">
              {data?.projectName || 'AIXflow 内容展示'}
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              数据来自 OSS <code className="text-zinc-400">{OSS_WEB_BASE}</code> 下静态资源
              {subtitle ? ` · ${subtitle}` : ''}
            </p>
            <p className="mt-2 break-all font-mono text-[10px] text-zinc-600">{configUrl}</p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => refetch()}
            className="shrink-0 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? '加载中…' : '重新拉取'}
          </button>
        </header>

        {loading && !data ? (
          <div className="flex justify-center py-24">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-500/35 bg-red-500/10 p-6 text-sm leading-relaxed text-red-200/95">
            <p className="font-semibold text-red-100">加载配置失败</p>
            <p className="mt-2 text-xs text-red-200/85">{error}</p>
            <p className="mt-4 text-[11px] text-red-300/70">
              请检查：① 是否已上传 <code className="text-red-200/90">web/data/config.json</code>；② Bucket 匿名读或签名 URL；③
              OSS CORS；④ <code className="text-red-200/90">VITE_OSS_SCENE_CONFIG_URL</code> 是否指向正确地址。
            </p>
          </div>
        ) : null}

        {data ? (
          <ul className="space-y-8">
            {data.scenes.map((scene, idx) => (
              <li
                key={`${scene.title}-${idx}`}
                className="rounded-2xl border border-cyan-500/15 bg-zinc-950/70 p-6 shadow-[0_0_0_1px_rgba(6,182,212,0.08)] backdrop-blur-md"
              >
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">{scene.title || `场景 ${idx + 1}`}</h2>
                  <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[10px] uppercase text-cyan-400/90">
                    {scene.type || 'image'}
                  </span>
                </div>
                {scene.description ? (
                  <p className="mb-4 text-xs leading-relaxed text-zinc-400">{scene.description}</p>
                ) : null}
                {isProcessing(scene) ? (
                  <div className="space-y-3">
                    {String(scene.mediaUrl || '').trim() ? (
                      <div className="opacity-60">
                        <SceneMedia scene={{ ...scene, status: 'ready' }} />
                      </div>
                    ) : null}
                    <SimulatedProgressBar />
                  </div>
                ) : (
                  <SceneMedia scene={scene} />
                )}
              </li>
            ))}
          </ul>
        ) : null}

        <footer className="mt-12 space-y-1 text-center text-[10px] text-zinc-600">
          <p>
            路径约定：<code className="text-zinc-500">…/web/data/config.json</code> ·{' '}
            <code className="text-zinc-500">web/video/</code> · <code className="text-zinc-500">web/image/</code> ·{' '}
            <code className="text-zinc-500">web/music/</code> · <code className="text-zinc-500">web/workflow/</code>
          </p>
          <p>
            模板 <code className="text-zinc-500">public/config_template.json</code> · 环境变量{' '}
            <code className="text-zinc-500">VITE_OSS_SCENE_CONFIG_URL</code>
          </p>
        </footer>
      </div>
    </div>
  );
}
