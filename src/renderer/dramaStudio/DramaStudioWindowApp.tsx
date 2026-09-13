/**
 * AI 短剧独立窗口：单节点 React Flow 承载 DirectorNode（dramaStudioWindow 模式），
 * 状态与出片动作经 IPC 回主画布 Workspace。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import DirectorNode from '../components/Canvas/DirectorNode';
import { DarkAlertProvider } from '../contexts/DarkAlertContext';
import { CloudBalanceInsufficientAlertBridge } from '../components/CloudBalanceInsufficientAlertBridge';
import { AppLocaleProvider } from '../contexts/AppLocaleContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import '../index.css';

type Bootstrap = {
  projectId: string;
  nodeId: string;
  episodeId?: string;
  data: Record<string, unknown>;
};

function readQuery(): { projectId: string; nodeId: string; episodeId: string } {
  const q = new URLSearchParams(window.location.search || '');
  return {
    projectId: String(q.get('projectId') || '').trim(),
    nodeId: String(q.get('nodeId') || '').trim(),
    episodeId: String(q.get('episodeId') || '').trim(),
  };
}

function StudioDirectorNode(props: NodeProps) {
  return <DirectorNode {...(props as any)} />;
}

function DramaStudioFlow({ bootstrap }: { bootstrap: Bootstrap }) {
  const api = window.electronAPI?.dramaStudio;
  const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const h = typeof window !== 'undefined' ? window.innerHeight : 900;

  const buildData = useCallback(
    (raw: Record<string, unknown>) => {
      const nodeId = bootstrap.nodeId;
      return {
        ...raw,
        projectId: bootstrap.projectId,
        width: w,
        height: h,
        dramaStudioWindowOpen: true,
        onUpdate: (updates: Record<string, unknown>) => {
          void api?.askHost('patch', { nodeId, updates });
        },
        onSpawnVideos: (opts?: Record<string, unknown>) =>
          api?.askHost('spawnVideos', { nodeId, opts }) as Promise<unknown>,
        onPreviewToSplice: () => api?.askHost('previewToSplice', { nodeId }),
        onVideosToSplice: () => api?.askHost('videosToSplice', { nodeId }),
        onConfirmGenVideos: () => api?.askHost('confirmGenVideos', { nodeId }),
        onExportMv: () => api?.askHost('exportMv', { nodeId }),
        onResolveKaraokeMvVideo: () => api?.askHost('resolveKaraokeMvVideo', { nodeId }),
        onPickImageFromCanvas: () => api?.askHost('pickImageFromCanvas', { nodeId }),
        onPickVideoFromCanvas: () => api?.askHost('pickVideoFromCanvas', { nodeId }),
        onPickAudioFromCanvas: () => api?.askHost('pickAudioFromCanvas', { nodeId }),
        onApplyShotVideoToSplice: (shotNo: string, videoUrl: string) =>
          api?.askHost('applyShotVideoToSplice', { nodeId, shotNo, videoUrl }),
        onAddVideoClipNodes: (payload: unknown) =>
          api?.askHost('addVideoClipNodes', { nodeId, payload }),
      };
    },
    [api, bootstrap.nodeId, bootstrap.projectId, h, w],
  );

  const initialNodes = useMemo<Node[]>(
    () => [
      {
        id: bootstrap.nodeId,
        type: 'directorDrama',
        position: { x: 0, y: 0 },
        data: buildData(bootstrap.data || {}),
        dragHandle: undefined,
        selectable: false,
        draggable: false,
        style: { width: w, height: h },
      },
    ],
    [bootstrap.data, bootstrap.nodeId, buildData, h, w],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  useEffect(() => {
    if (!api?.onStatePush) return;
    return api.onStatePush((payload) => {
      const p = payload as { nodeId?: string; data?: Record<string, unknown> } | null;
      if (!p?.data || String(p.nodeId || '') !== bootstrap.nodeId) return;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === bootstrap.nodeId
            ? {
                ...n,
                data: buildData(p.data || {}),
                style: { width: window.innerWidth, height: window.innerHeight },
              }
            : n,
        ),
      );
    });
  }, [api, bootstrap.nodeId, buildData, setNodes]);

  useEffect(() => {
    const onResize = () => {
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === bootstrap.nodeId
            ? {
                ...n,
                data: { ...(n.data as object), width: nw, height: nh },
                style: { width: nw, height: nh },
              }
            : n,
        ),
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [bootstrap.nodeId, setNodes]);

  const nodeTypes = useMemo(() => ({ directorDrama: StudioDirectorNode }), []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0b0b0c]">
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling
        proOptions={{ hideAttribution: true }}
        minZoom={1}
        maxZoom={1}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      />
    </div>
  );
}

export default function DramaStudioWindowApp() {
  const q = readQuery();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const api = window.electronAPI?.dramaStudio;
        if (!api?.askHost) {
          throw new Error('短剧窗口 API 不可用，请确认 preload 已加载');
        }
        if (!q.projectId || !q.nodeId) {
          throw new Error('缺少 projectId / nodeId');
        }
        const raw = (await api.askHost('bootstrap', {
          projectId: q.projectId,
          nodeId: q.nodeId,
          episodeId: q.episodeId || undefined,
        })) as Bootstrap & { ok?: boolean; error?: string };
        if (cancelled) return;
        if ((raw as { error?: string })?.error) {
          throw new Error(String((raw as { error: string }).error));
        }
        setBootstrap({
          projectId: q.projectId,
          nodeId: q.nodeId,
          episodeId: q.episodeId || undefined,
          data: (raw?.data || {}) as Record<string, unknown>,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [q.episodeId, q.nodeId, q.projectId]);

  if (error) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[#0b0b0c] px-6 text-center text-white/80">
        <div className="text-[18px] font-medium text-red-300">无法打开短剧导演台</div>
        <div className="max-w-lg text-[14px] text-white/55">{error}</div>
        <button
          type="button"
          className="rounded-lg bg-sky-600 px-4 py-2 text-[14px] text-white"
          onClick={() => void window.electronAPI?.dramaStudio?.close?.()}
        >
          关闭窗口
        </button>
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0b0b0c] text-[15px] text-white/60">
        正在加载短剧导演台…
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <DarkAlertProvider>
        <AppLocaleProvider>
          <CloudBalanceInsufficientAlertBridge />
          <ReactFlowProvider>
            <DramaStudioFlow bootstrap={bootstrap} />
          </ReactFlowProvider>
        </AppLocaleProvider>
      </DarkAlertProvider>
    </ErrorBoundary>
  );
}
