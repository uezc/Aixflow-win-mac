// @ts-nocheck
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useUpdateNodeInternals, useStore } from 'reactflow';
import { Loader2, Mic2 } from 'lucide-react';
import { ModuleProgressBar } from './ModuleProgressBar';

export interface AudioTranscribeNodeData {
  audioUrl?: string;
  text?: string;
  transcribeLanguage?: string;
  title?: string;
  width?: number;
  height?: number;
  isUserResized?: boolean;
  aiStatus?: 'idle' | 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
  errorMessage?: string;
}

interface AudioTranscribeNodeProps extends NodeProps<AudioTranscribeNodeData> {
  projectId?: string;
  isDarkMode?: boolean;
  performanceMode?: boolean;
  onDataChange?: (nodeId: string, updates: Partial<AudioTranscribeNodeData>) => void;
}

const MIN_W = 280;
const MIN_H = 220;

function pickUpstreamAudioUrl(srcData: Record<string, unknown> | undefined): string {
  if (!srcData) return '';
  const raw = (srcData.originalAudioUrl ?? srcData.outputAudio ?? srcData.referenceAudioUrl) as string | undefined;
  return typeof raw === 'string' ? raw.trim() : '';
}

function pickUpstreamVideoUrl(srcData: Record<string, unknown> | undefined): string {
  if (!srcData) return '';
  const raw = (srcData.outputVideo ?? srcData.originalVideoUrl) as string | undefined;
  return typeof raw === 'string' ? raw.trim() : '';
}

export const AudioTranscribeNode: React.FC<AudioTranscribeNodeProps> = (props) => {
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    projectId,
    onDataChange,
  } = props as any;
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useStore((s) => s.edges) ?? [];
  const nodes = useStore((s) => s.nodes) ?? [];
  const [audioUrl, setAudioUrl] = useState(data?.audioUrl || '');
  const [text, setText] = useState(data?.text || '');
  const [lang, setLang] = useState(data?.transcribeLanguage || 'auto');
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sync = useCallback(
    (updates: Partial<AudioTranscribeNodeData>) => {
      onDataChange?.(id, updates);
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...updates } } : n))
      );
    },
    [id, onDataChange, setNodes]
  );

  /** 入边或上游音视频输出变化时更新，避免仅依赖 onConnect 时序导致未写入 audioUrl */
  const upstreamKey = useMemo(() => {
    return edges
      .filter((e) => e.target === id)
      .map((e) => {
        const s = nodes.find((n) => n.id === e.source);
        if (!s) return `${e.source}:unknown`;
        if (s.type === 'audio') return `${e.source}:audio:${pickUpstreamAudioUrl(s.data as Record<string, unknown>)}`;
        if (s.type === 'video') return `${e.source}:video:${pickUpstreamVideoUrl(s.data as Record<string, unknown>)}`;
        return `${e.source}:${s.type}`;
      })
      .sort()
      .join('|');
  }, [edges, nodes, id]);

  useEffect(() => {
    let cancelled = false;
    const incoming = edges.filter((e) => e.target === id);
    const self = nodes.find((n) => n.id === id);
    const curUrl = String(self?.data?.audioUrl || '').trim();

    const audioUrls: string[] = [];
    let videoUrl = '';
    for (const e of incoming) {
      const src = nodes.find((n) => n.id === e.source);
      if (!src) continue;
      if (src.type === 'audio') {
        const u = pickUpstreamAudioUrl(src.data as Record<string, unknown>);
        if (u) audioUrls.push(u);
      } else if (src.type === 'video') {
        const v = pickUpstreamVideoUrl(src.data as Record<string, unknown>);
        if (v) videoUrl = v;
      }
    }

    const nextAudio = audioUrls[0] || '';
    if (nextAudio) {
      setLinking(false);
      if (nextAudio !== curUrl) {
        setAudioUrl(nextAudio);
        sync({ audioUrl: nextAudio, errorMessage: undefined, aiStatus: 'idle' });
      }
      return () => {
        cancelled = true;
        setLinking(false);
      };
    }

    if (!videoUrl || !window.electronAPI?.extractAudioFromVideo) {
      return () => {
        cancelled = true;
        setLinking(false);
      };
    }

    setLinking(true);
    void window.electronAPI
      .extractAudioFromVideo(projectId || undefined, videoUrl)
      .then((res) => {
        if (cancelled) return;
        setLinking(false);
        if (!res?.audioUrl) return;
        setAudioUrl(res.audioUrl);
        sync({ audioUrl: res.audioUrl, errorMessage: undefined, aiStatus: 'idle' });
      })
      .catch((err) => {
        if (cancelled) return;
        setLinking(false);
        sync({ errorMessage: err?.message || String(err) || '从视频提取音频失败', aiStatus: 'ERROR' });
      });

    return () => {
      cancelled = true;
      setLinking(false);
    };
  }, [upstreamKey, id, projectId, sync]);

  useEffect(() => {
    if (data?.audioUrl !== undefined) setAudioUrl(data.audioUrl || '');
  }, [data?.audioUrl]);
  useEffect(() => {
    if (data?.text !== undefined) setText(data.text || '');
  }, [data?.text]);
  useEffect(() => {
    if (data?.transcribeLanguage !== undefined) setLang(data.transcribeLanguage || 'auto');
  }, [data?.transcribeLanguage]);

  const onAudioUrlChange = useCallback(
    (v: string) => {
      setAudioUrl(v);
      sync({ audioUrl: v });
    },
    [sync]
  );

  const onLangChange = useCallback(
    (v: string) => {
      setLang(v);
      sync({ transcribeLanguage: v });
    },
    [sync]
  );

  const runTranscribe = useCallback(async () => {
    const url = (audioUrl || '').trim();
    if (!url) {
      sync({
        errorMessage: '请从左侧连接「声音」或「视频」模块（会自动填入），或在此粘贴 http / local-resource 音频地址',
        aiStatus: 'ERROR',
      });
      return;
    }
    if (!window.electronAPI?.transcribeSpeechFromAudioUrl) {
      sync({ errorMessage: '当前环境不支持语音转写', aiStatus: 'ERROR' });
      return;
    }
    setBusy(true);
    sync({ aiStatus: 'PROCESSING', errorMessage: undefined });
    try {
      const { text: out } = await window.electronAPI.transcribeSpeechFromAudioUrl(
        projectId || undefined,
        url,
        lang === 'auto' ? undefined : lang
      );
      const t = (out || '').trim();
      setText(t);
      sync({ text: t, aiStatus: 'SUCCESS', errorMessage: undefined });
    } catch (e: any) {
      const msg = e?.message || String(e);
      sync({ aiStatus: 'ERROR', errorMessage: msg });
    } finally {
      setBusy(false);
      updateNodeInternals(id);
    }
  }, [audioUrl, lang, projectId, id, sync, updateNodeInternals]);

  const w = Math.max(MIN_W, data?.width ?? MIN_W);
  const h = Math.max(MIN_H, data?.height ?? MIN_H);
  const border = isDarkMode ? 'border-white/15' : 'border-gray-200';
  const bg = isDarkMode ? 'nexflow-glass-panel' : 'bg-white';
  const textMuted = isDarkMode ? 'text-white/55' : 'text-gray-500';
  const textMain = isDarkMode ? 'text-white' : 'text-gray-900';

  return (
    <div
      ref={containerRef}
      className={`rounded-2xl border shadow-lg ${border} ${bg} ${selected ? 'ring-2 ring-emerald-500/70' : ''}`}
      style={{ width: w, minHeight: h }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="audio-transcribe-input"
        className="nexflow-plus-handle nexflow-plus-handle-left"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />

      <div className="px-3 pt-3 pb-2 flex items-center gap-2 border-b border-white/10">
        <Mic2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className={`text-sm font-semibold truncate ${textMain}`}>语音转文字</span>
        <span className={`text-[10px] ml-auto ${textMuted}`}>whisper.cpp</span>
      </div>

      <div className="p-3 space-y-2">
        <label className={`block text-[11px] ${textMuted}`}>
          音频来源（左侧连线自动填入；可粘贴 http / local-resource 覆盖）
        </label>
        <textarea
          value={audioUrl}
          onChange={(e) => onAudioUrlChange(e.target.value)}
          rows={2}
          className={`w-full text-xs rounded-lg px-2 py-1.5 border resize-y min-h-[44px] nodrag ${
            isDarkMode ? 'bg-black/30 border-white/10 text-white placeholder:text-white/30' : 'bg-gray-50 border-gray-200 text-gray-900'
          }`}
          placeholder="连接声音/视频模块后自动出现地址；也可手动粘贴"
        />
        {linking && <p className={`text-[11px] ${textMuted}`}>正在从上游视频提取音轨…</p>}

        <div className="flex items-center gap-2">
          <label className={`text-[11px] shrink-0 ${textMuted}`}>语言</label>
          <select
            value={lang}
            onChange={(e) => onLangChange(e.target.value)}
            aria-label="转写语言"
            className={`text-xs rounded-lg px-2 py-1 border flex-1 nodrag ${
              isDarkMode ? 'bg-black/30 border-white/10 text-white' : 'bg-gray-50 border-gray-200'
            }`}
          >
            <option value="auto">自动</option>
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runTranscribe()}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white"
          >
            {busy ? (
              <span className="flex items-center gap-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                转写中
              </span>
            ) : (
              '开始转写'
            )}
          </button>
        </div>

        {data?.aiStatus === 'PROCESSING' && (
          <ModuleProgressBar progress={45} visible progressMessage="正在转写" />
        )}

        {data?.errorMessage && (
          <p className="text-[11px] text-red-400 break-words">{data.errorMessage}</p>
        )}

        <label className={`block text-[11px] ${textMuted}`}>识别结果</label>
        <textarea
          value={text}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            sync({ text: t });
          }}
          rows={5}
          className={`w-full text-xs rounded-lg px-2 py-1.5 border resize-y nodrag ${
            isDarkMode ? 'bg-black/20 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'
          }`}
          placeholder="转写结果将显示在此，也可手动编辑"
        />
      </div>
    </div>
  );
};
