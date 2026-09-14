/**
 * AI 短剧 2 代：图片/声音提示词独立弹窗（对齐 1 代图三：正文 + 修改思路 + AI 改写 + 取消/保存）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveDramaChatModel } from '../../utils/cloudModelPricing';

function buildReviseMessages(opts: {
  mode: 'image' | 'voice';
  original: string;
  opinion: string;
}): { systemPrompt: string; userPrompt: string } {
  if (opts.mode === 'voice') {
    return {
      systemPrompt: [
        '你是短剧配音提示词编辑。根据用户修改思路改写声音提示词。',
        '输出必须仍是纯文本，固定结构（每行一项，勿输出 Markdown/JSON/解释）：',
        '名字',
        '年龄：…',
        '性别：男/女/未注明',
        '音色描述：口语化、可念给人听的音色（勿堆英文标签）',
        '台词：',
        '（只能保留或改用小说/剧本中该角色的原句；禁止新编台词）',
        '只改用户点名的部分；未提及的字段尽量沿用原文。只输出改写后的全文。',
      ].join('\n'),
      userPrompt: [
        '【原文】',
        opts.original.trim() || '（空）',
        '',
        '【修改思路】',
        opts.opinion.trim(),
        '',
        '请输出改写后的声音提示词全文：',
      ].join('\n'),
    };
  }
  return {
    systemPrompt: [
      '你是短剧美术提示词编辑。根据用户修改思路改写图片提示词。',
      '输出必须仍是纯文本生图提示词，勿输出 Markdown/JSON/解释。',
      '只改用户点名的部分；未提及的约束尽量沿用原文。只输出改写后的全文。',
    ].join('\n'),
    userPrompt: [
      '【原文】',
      opts.original.trim() || '（空）',
      '',
      '【修改思路】',
      opts.opinion.trim(),
      '',
      '请输出改写后的图片提示词全文：',
    ].join('\n'),
  };
}

function stripAiOutput(raw: string): string {
  let t = String(raw || '').trim();
  if (!t) return '';
  const fence = t.match(/^```(?:\w+)?\s*([\s\S]*?)```$/);
  if (fence) t = fence[1].trim();
  return t.replace(/^\s*改写后的[^：:\n]*[：:]\s*/i, '').trim();
}

function runDramaFlowPromptChat(opts: {
  nodeId: string;
  systemPrompt: string;
  userPrompt: string;
  projectId?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const api = window.electronAPI;
  if (!api?.invokeAI || !api?.onAIStatusUpdate) {
    return Promise.reject(new Error('AI 通道不可用'));
  }
  const requestId = `drama-flow-prompt-${opts.nodeId}-${Date.now()}`;
  const chatNodeId = `${opts.nodeId}::flow-prompt-revise`;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let remove: (() => void) | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        remove?.();
      } catch {
        /* ignore */
      }
      fn();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error('AI 改写超时，请重试')));
    }, 120_000);
    remove = api.onAIStatusUpdate((packet: {
      nodeId?: string;
      status?: string;
      payload?: { text?: string; content?: string; error?: string; directorChatRequestId?: string };
    }) => {
      if (String(packet?.nodeId || '') !== chatNodeId) return;
      const rid = String(packet?.payload?.directorChatRequestId || '').trim();
      if (rid && rid !== requestId) return;
      const st = String(packet?.status || '').toUpperCase();
      if (st === 'SUCCESS' || st === 'COMPLETED' || st === 'DONE') {
        const text = String(
          packet?.payload?.text || packet?.payload?.content || '',
        ).trim();
        finish(() => {
          if (!text) reject(new Error('AI 未返回有效改写'));
          else resolve(text);
        });
        return;
      }
      if (st === 'ERROR' || st === 'FAILED') {
        finish(() =>
          reject(new Error(String(packet?.payload?.error || 'AI 改写失败'))),
        );
      }
    });
    void api
      .invokeAI({
        modelId: 'chat',
        nodeId: chatNodeId,
        input: {
          model: resolveDramaChatModel(opts.model),
          messages: [
            { role: 'system', content: opts.systemPrompt },
            { role: 'user', content: opts.userPrompt },
          ],
          stream: false,
          projectId: opts.projectId || undefined,
          nodeTitle: 'AI短剧2代·提示词改写',
          directorChatRequestId: requestId,
          max_tokens: opts.maxTokens ?? 1200,
          temperature: opts.temperature ?? 0.55,
        },
      })
      .catch((e: unknown) => {
        finish(() =>
          reject(e instanceof Error ? e : new Error(String(e || 'AI 改写失败'))),
        );
      });
  });
}

export function DramaFlowPromptEditDialog({
  isDark,
  title,
  value,
  placeholder,
  mode,
  projectId,
  nodeId,
  showAlert,
  onSave,
  onClose,
}: {
  isDark: boolean;
  title: string;
  value: string;
  placeholder: string;
  mode: 'image' | 'voice';
  projectId?: string;
  nodeId: string;
  showAlert?: (msg: string) => void;
  onSave: (next: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [opinion, setOpinion] = useState('');
  const [revising, setRevising] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const fieldCls = isDark
    ? 'border-white/12 bg-black/40 text-white/90 placeholder:text-white/35'
    : 'border-gray-200 bg-gray-50 text-gray-800 placeholder:text-gray-400';

  const handleAiRevise = async () => {
    if (revising) return;
    const hint = String(opinion || '').trim();
    if (!hint) {
      showAlert?.(
        mode === 'voice'
          ? '请先输入修改思路，例如：音色更低沉，台词换成更急促的两句'
          : '请先输入修改思路，例如：衣服改成红色工装，表情更冷',
      );
      return;
    }
    const original = String(draftRef.current || '').trim();
    if (!original) {
      showAlert?.('原文为空，请先填写提示词');
      return;
    }
    setRevising(true);
    try {
      const { systemPrompt, userPrompt } = buildReviseMessages({
        mode,
        original,
        opinion: hint,
      });
      const raw = await runDramaFlowPromptChat({
        nodeId,
        systemPrompt,
        userPrompt,
        projectId,
        maxTokens: mode === 'voice' ? 800 : 1200,
      });
      const next = stripAiOutput(raw);
      if (!next) {
        showAlert?.('AI 未返回有效改写，请重试或换个说法');
        return;
      }
      setDraft(next);
      setOpinion('');
    } catch (e) {
      showAlert?.(e instanceof Error ? e.message : 'AI 改写失败');
    } finally {
      setRevising(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100090] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`w-[min(40rem,94vw)] overflow-hidden rounded-2xl border shadow-2xl ${
          isDark ? 'border-white/12 bg-[#16161a] text-white' : 'border-gray-200 bg-white text-gray-900'
        }`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-[15px] font-semibold">{title}</div>
          <button
            type="button"
            className={`nodrag flex h-7 w-7 items-center justify-center rounded-full text-[16px] ${
              isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'
            }`}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="px-4 pb-2">
          <textarea
            className={`nodrag nowheel min-h-[14rem] w-full resize-y rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed outline-none custom-scrollbar-dark ${fieldCls}`}
            value={draft}
            placeholder={placeholder}
            autoFocus
            disabled={revising}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <div
          className={`mx-4 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border px-2 py-1.5 ${
            isDark ? 'border-white/10 bg-black/25' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <input
            type="text"
            className={`nodrag nowheel min-w-0 flex-1 basis-[12rem] rounded-md border px-2 py-1.5 text-[12px] outline-none ${fieldCls}`}
            value={opinion}
            disabled={revising}
            placeholder={
              mode === 'voice'
                ? '修改思路，例如：音色更低沉，台词换成更急的两句'
                : '修改思路，例如：衣服改红，表情更冷'
            }
            onChange={(e) => setOpinion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAiRevise();
              }
            }}
          />
          <button
            type="button"
            className="nodrag shrink-0 rounded-lg bg-violet-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-400 disabled:opacity-50"
            disabled={revising || !String(opinion || '').trim()}
            onClick={() => void handleAiRevise()}
          >
            {revising ? 'AI 改写中…' : 'AI 按原文改'}
          </button>
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button
            type="button"
            className={`nodrag rounded-lg px-3 py-1.5 text-[13px] ${
              isDark ? 'bg-white/10 text-white/85 hover:bg-white/14' : 'bg-gray-100 text-gray-700'
            }`}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="nodrag rounded-lg bg-sky-500 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            disabled={revising}
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
