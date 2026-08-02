import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, ChevronRight, Download, Trash2, Trash, LayoutGrid, AlertCircle } from 'lucide-react';
import AssetLibrarySidebar from '../AssetLibrarySidebar';
import type { Character, SceneLibraryItem, DigitalHumanLibraryItem, RvcVoiceLibraryItem } from '../characterListShared';
import { TaskImageDisplay } from './TaskImageDisplay';
import { TaskMediaPreview } from './TaskMediaPreview';
import {
  userFacingErrorMessage,
  failedGenerationDetailWithRefund,
  refundHintForLocale,
  messageContainsRefundHint,
} from '../../utils/userErrorMessageCn';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { workspaceChromeT, type WorkspaceChromeStrings } from '../../i18n/workspaceI18n';
import type { AppLocale } from '../../i18n/settingsI18n';
import {
  assetLibBtnDanger,
  assetLibBtnPrimary,
  assetLibBtnSecondary,
  ASSET_LIBRARY_SIDEBAR_WIDTH_PX,
} from '../../utils/assetLibraryChrome';

export interface Task {
  id: string;
  nodeId: string;
  nodeTitle: string;
  imageUrl?: string;
  outputImages?: string[];
  videoUrl?: string;
  audioUrl?: string;
  prompt: string;
  createdAt: number;
  /** 完成时固化的耗时（秒） */
  durationSec?: number;
  /** 预估消耗元宝（与画布定价表一致） */
  yuanbaoConsumed?: number;
  status?: 'success' | 'error' | 'processing' | 'running' | 'failed' | 'timeout';
  errorMessage?: string;
  taskType?: 'image' | 'video' | 'text' | 'audio';
  /** 音乐模块下载时预填的文件名（含扩展名，如「告白气球.mp3」） */
  downloadFileName?: string;
  localFilePath?: string;
  runningHubTaskId?: string;
}

export interface WorkspaceSidebarProps {
  /** 左侧角色列表 */
  characterListCollapsed: boolean;
  onToggleCharacterList: () => void;
  characterListRefreshTrigger: number;
  sceneListRefreshTrigger: number;
  digitalHumanListRefreshTrigger: number;
  rvcVoiceListRefreshTrigger: number;
  onSelectCharacter: (character: Character) => void;
  /** 添加角色时从画布点选参考音（音频等），返回 { url, label } 或取消时 null */
  requestVoicePickFromCanvas?: () => Promise<{ url: string; label: string } | null>;
  /** 添加角色时从画布点选图片写入四视图第 slotIndex 格（0–3），取消时 null */
  requestViewSlotPickFromCanvas?: (slotIndex: number) => Promise<string | null>;
  requestSceneImagePickFromCanvas?: (role: 'normal' | 'display3d') => Promise<string | null>;
  requestDigitalHumanVideoPickFromCanvas?: () => Promise<string | null>;
  rightSidebarOpen: boolean;
  onToggleRightSidebar: () => void;
  tasks: Task[];
  projectId: string | undefined;
  isDarkMode: boolean;
  formatImagePath: (path: string) => string;
  mapProjectPath: (url: string, projectId?: string) => Promise<string>;
  onPreviewImage: (url: string, nodeId?: string) => void;
  onPreviewAudio: (url: string) => void;
  onDownloadLocalFile: (filePath: string, preferredFileName?: string) => void | Promise<void>;
  onDeleteTask: (taskId: string) => void;
  onDownloadImage: (taskId: string, imageUrl: string, nodeTitle: string) => void;
  onDownloadVideo: (task: Task) => void | Promise<void>;
  onDownloadAudio: (task: Task) => void | Promise<void>;
  /** 清空全部任务（任务过多时使用） */
  onClearAllTasks?: () => void;
  /** 点击放入画布按钮时，将任务素材放置到画布中心 */
  onTaskPlaceToCanvas?: (task: Task) => void;
  /** 场景资产「导入到画布」：落点在左侧资产栏右侧 */
  onPlaceSceneToCanvas?: (scene: SceneLibraryItem, anchorScreen: { x: number; y: number }) => void;
  /** 数字人资产「导入到画布」：创建 HeyGem 节点 */
  onPlaceDigitalHumanToCanvas?: (item: DigitalHumanLibraryItem, anchorScreen: { x: number; y: number }) => void;
  onPlaceRvcVoiceToCanvas?: (item: RvcVoiceLibraryItem, anchorScreen: { x: number; y: number }) => void;
  onRvcVoiceUpdated?: (item: RvcVoiceLibraryItem) => void;
}

/** 单任务卡片高度估计值（用于虚拟列表，含视频/音频时更高，measureElement 会动态修正） */
const TASK_CARD_ESTIMATE_HEIGHT = 280;
const TASK_GAP = 12;

/** 按状态估算行高，避免「运行中」矮卡片仍按 280px 占位导致累计偏移与测量缓存错乱 */
function estimateTaskRowHeight(task: Task | undefined): number {
  if (!task) return TASK_CARD_ESTIMATE_HEIGHT + TASK_GAP;
  const st = String(task.status || '').toLowerCase();
  const isRunning = st === 'running' || st === 'processing';
  if (isRunning) return 158 + TASK_GAP;
  const isSuccess = st === 'success';
  const hasMedia = !!(task.imageUrl || task.videoUrl || task.audioUrl);
  if (isSuccess && hasMedia) return TASK_CARD_ESTIMATE_HEIGHT + TASK_GAP;
  if (isSuccess) return 210 + TASK_GAP;
  const isFailed = st === 'failed' || st === 'error' || st === 'timeout';
  if (isFailed) return 248 + TASK_GAP;
  return 200 + TASK_GAP;
}

/** 任务卡片内提示词超过约三行或字数较多时显示「展开」 */
function taskPromptNeedsExpandControl(prompt: string): boolean {
  const t = (prompt || '').trim();
  if (!t) return false;
  const newlines = t.match(/\n/g)?.length ?? 0;
  if (t.length >= 120) return true;
  if (newlines >= 2) return true;
  return false;
}

/** 任务列表控件：明亮模式采用 Scratch 分类色 */
function taskListBtnSecondary(isDarkMode: boolean) {
  return assetLibBtnSecondary(isDarkMode, 'flex-1 !py-1.5 !px-0 !min-w-0', isDarkMode ? undefined : 'motion');
}
function taskListBtnPrimary(isDarkMode: boolean) {
  return assetLibBtnPrimary(isDarkMode, 'flex-1 !py-1.5 !px-0 !min-w-0', 'operators');
}
function taskListBtnDanger(isDarkMode: boolean) {
  return assetLibBtnDanger(isDarkMode, 'flex-1 !py-1.5 !px-0 !min-w-0');
}
function taskListStatusSuccess(isDarkMode: boolean) {
  return isDarkMode ? 'text-sky-300/90' : 'text-sky-600';
}
function taskListStatusRunning(isDarkMode: boolean) {
  return isDarkMode ? 'text-sky-300/80' : 'text-sky-600';
}

function taskLooksLikeAudioMedia(task: { taskType?: string; videoUrl?: string; audioUrl?: string; localFilePath?: string }): boolean {
  const looksAudio = (u?: string) => !!u && /\.(flac|mp3|wav|aac|m4a|ogg|opus)(?:$|[?#])/i.test(String(u));
  return looksAudio(task.audioUrl) || looksAudio(task.videoUrl) || looksAudio(task.localFilePath);
}

function resolveTaskPreviewKind(task: {
  taskType?: string;
  videoUrl?: string;
  audioUrl?: string;
  localFilePath?: string;
}): 'video' | 'audio' | 'other' {
  if (task.taskType === 'audio' && task.audioUrl) return 'audio';
  if (task.taskType === 'video' && task.videoUrl) {
    // 误标：音频 SUCCESS 被写成 video + mp3 URL
    if (taskLooksLikeAudioMedia(task)) return 'audio';
    return 'video';
  }
  if (task.audioUrl && taskLooksLikeAudioMedia(task)) return 'audio';
  return 'other';
}

function serializeTaskForCanvasDrag(task: Task): string {
  let taskType =
    task.taskType ||
    (task.imageUrl ? 'image' : task.videoUrl ? 'video' : task.audioUrl ? 'audio' : task.prompt?.trim() ? 'text' : 'image');
  let videoUrl = task.videoUrl;
  let audioUrl = task.audioUrl;
  const looksAudio = (u?: string) => !!u && /\.(flac|mp3|wav|aac|m4a|ogg|opus)(?:$|[?#])/i.test(u);
  if ((taskType === 'video' || !!videoUrl) && (looksAudio(videoUrl) || looksAudio(audioUrl) || looksAudio(task.localFilePath))) {
    taskType = 'audio';
    if (!audioUrl) audioUrl = videoUrl || (task.localFilePath ? `local-resource://${task.localFilePath.replace(/\\/g, '/')}` : undefined);
    videoUrl = undefined;
  }
  return JSON.stringify({
    taskType,
    imageUrl: task.imageUrl,
    outputImages: task.outputImages,
    videoUrl,
    audioUrl,
    localFilePath: task.localFilePath,
    nodeTitle: task.nodeTitle,
    prompt: task.prompt,
  });
}

function handleTaskDragStart(e: React.DragEvent, task: Task) {
  e.dataTransfer.setData('application/nexflow-task', serializeTaskForCanvasDrag(task));
  e.dataTransfer.effectAllowed = 'copy';
}

function TaskTextResultModal({
  open,
  title,
  body,
  isDarkMode,
  wc,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  isDarkMode: boolean;
  wc: WorkspaceChromeStrings;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-text-modal-title"
        className={`flex max-h-[min(90vh,860px)] min-h-[min(70vh,560px)] w-full max-w-3xl flex-col overflow-hidden shadow-2xl ${
          isDarkMode
            ? 'rounded-2xl border border-white/10 bg-[#141418] text-white'
            : 'rounded-2xl border border-gray-200 bg-white text-gray-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`shrink-0 border-b px-4 py-3 ${
            isDarkMode ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          <h3 id="task-text-modal-title" className="text-sm font-semibold">
            {title || wc.taskTextModalTitle}
          </h3>
        </div>
        <div
          className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 text-base leading-relaxed whitespace-pre-wrap break-words select-text ${
            isDarkMode ? 'text-white/85' : 'text-gray-800'
          }`}
        >
          {body}
        </div>
        <div
          className={`shrink-0 border-t px-4 py-3 ${
            isDarkMode ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          <button
            type="button"
            className={`w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isDarkMode
                ? 'bg-white/10 text-white hover:bg-white/15'
                : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
            }`}
            onClick={onClose}
          >
            {wc.taskTextModalClose}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const TaskCard = React.memo(function TaskCard({
  task,
  projectId,
  isDarkMode,
  formatImagePath,
  mapProjectPath,
  onPreviewImage,
  onPreviewAudio,
  onDownloadLocalFile,
  onDeleteTask,
  onDownloadImage,
  onDownloadVideo,
  onDownloadAudio,
  onTaskPlaceToCanvas,
  nowTs,
  showTaskError,
  locale,
  wc,
}: {
  task: Task;
  projectId: string | undefined;
  isDarkMode: boolean;
  formatImagePath: (path: string) => string;
  mapProjectPath: (url: string, projectId?: string) => Promise<string>;
  onPreviewImage: (url: string, nodeId?: string) => void;
  onPreviewAudio: (url: string) => void;
  onDownloadLocalFile: (filePath: string, preferredFileName?: string) => void | Promise<void>;
  onDeleteTask: (taskId: string) => void;
  onDownloadImage: (taskId: string, imageUrl: string, nodeTitle: string) => void;
  onDownloadVideo: (task: Task) => void | Promise<void>;
  onDownloadAudio: (task: Task) => void | Promise<void>;
  onTaskPlaceToCanvas?: (task: Task) => void;
  nowTs: number;
  showTaskError: (message: string) => void;
  locale: AppLocale;
  wc: WorkspaceChromeStrings;
}) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [textModalOpen, setTextModalOpen] = useState(false);
  const fullPrompt = useMemo(() => (task.prompt?.trim() ? task.prompt : wc.noPrompt), [task.prompt, wc.noPrompt]);
  const promptNeedsExpand = useMemo(() => taskPromptNeedsExpandControl(fullPrompt), [fullPrompt]);
  const textBody = useMemo(() => (task.prompt || '').trim(), [task.prompt]);
  const textNeedsFullView = useMemo(() => taskPromptNeedsExpandControl(textBody), [textBody]);

  useEffect(() => {
    setPromptExpanded(false);
    setTextModalOpen(false);
  }, [task.id, fullPrompt]);

  const status = String(task.status || '').toLowerCase();
  const isSuccess = status === 'success';
  const isFailed = status === 'failed' || status === 'error';
  const isTimeout = status === 'timeout';
  const isRunning = status === 'running' || status === 'processing';
  const canPlace =
    task.status === 'success' &&
    (task.imageUrl ||
      (task.outputImages && task.outputImages.length > 0) ||
      task.videoUrl ||
      task.audioUrl ||
      (task.taskType === 'text' && !!(task.prompt?.trim())));
  const runtimeSec = Math.max(0, Math.floor((nowTs - task.createdAt) / 1000));
  const hasTextPreview = isSuccess && task.taskType === 'text' && !!(task.prompt?.trim());
  const hasRunningTextPreview = isRunning && task.taskType === 'text' && !!(task.prompt?.trim());
  const hasPreview =
    isSuccess &&
    !!(task.imageUrl || (task.outputImages && task.outputImages.length > 0) || task.videoUrl || task.audioUrl || hasTextPreview);
  const showFailOrTimeoutPlaceholder = isFailed || isTimeout;
  const errLine = userFacingErrorMessage(task.errorMessage, locale);

  return (
    <div
      data-task-card
      onClick={
        isFailed
          ? () => showTaskError(failedGenerationDetailWithRefund(errLine || wc.taskFailedDefault, locale))
          : undefined
      }
      className={`rounded-xl border p-3 transition-colors select-none ${
        isDarkMode
          ? 'nexflow-glass-panel border-white/10 hover:border-white/15'
          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
      } ${isFailed ? 'cursor-pointer' : ''}`}
    >
      {hasPreview || hasRunningTextPreview || showFailOrTimeoutPlaceholder ? (
        <div
          className={`relative mb-2 rounded overflow-hidden ${
            canPlace ? 'cursor-grab active:cursor-grabbing' : ''
          } ${
            isDarkMode ? 'bg-white/[0.06] ring-1 ring-inset ring-white/10' : 'bg-gray-200'
          }`}
          draggable={canPlace}
          onDragStart={(e) => {
            if (!canPlace) return;
            handleTaskDragStart(e, task);
          }}
        >
          {hasPreview ? (
            task.taskType === 'text' && hasTextPreview ? (
              <button
                type="button"
                className={`group relative w-full p-2.5 text-left text-xs leading-relaxed transition-colors pointer-events-auto ${
                  textNeedsFullView ? 'cursor-pointer' : 'cursor-default'
                } ${isDarkMode ? 'hover:bg-white/[0.04]' : 'hover:bg-black/[0.03]'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (textNeedsFullView) setTextModalOpen(true);
                }}
                title={textNeedsFullView ? wc.taskTextTapToView : undefined}
              >
                <div
                  className={`whitespace-pre-wrap break-words ${
                    textNeedsFullView ? 'line-clamp-5' : ''
                  } ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`}
                >
                  {textBody}
                </div>
                {textNeedsFullView ? (
                  <>
                    <div
                      className={`pointer-events-none absolute inset-x-0 bottom-6 h-10 bg-gradient-to-t ${
                        isDarkMode ? 'from-black/50 to-transparent' : 'from-gray-200 to-transparent'
                      }`}
                      aria-hidden
                    />
                    <span
                      className={`relative mt-1 block text-[10px] font-medium ${
                        isDarkMode ? 'text-sky-300/80 group-hover:text-sky-200' : 'text-sky-600 group-hover:text-sky-700'
                      }`}
                    >
                      {wc.taskTextTapToView}
                    </span>
                  </>
                ) : null}
              </button>
            ) : (
              <div className={canPlace ? 'pointer-events-none' : undefined}>
                {(() => {
                  const kind = resolveTaskPreviewKind(task);
                  if (kind === 'video' && task.videoUrl) {
                    return (
                      <TaskMediaPreview
                        task={task}
                        isDarkMode={isDarkMode}
                        onPreviewVideo={onPreviewImage}
                        onPreviewAudio={onPreviewAudio}
                      />
                    );
                  }
                  if (kind === 'audio') {
                    const audioTask = {
                      ...task,
                      taskType: 'audio' as const,
                      audioUrl: task.audioUrl || task.videoUrl,
                    };
                    return (
                      <TaskMediaPreview
                        task={audioTask}
                        isDarkMode={isDarkMode}
                        onPreviewVideo={onPreviewImage}
                        onPreviewAudio={onPreviewAudio}
                      />
                    );
                  }
                  if (task.imageUrl || (task.outputImages && task.outputImages.length > 0)) {
                    return (
                      <TaskImageDisplay
                        task={task}
                        projectId={projectId}
                        formatImagePath={formatImagePath}
                        mapProjectPath={mapProjectPath}
                        onPreview={onPreviewImage}
                        isDarkMode={isDarkMode}
                      />
                    );
                  }
                  return null;
                })()}
              </div>
            )
          ) : hasRunningTextPreview ? (
            <div
              className={`max-h-24 overflow-y-auto p-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                isDarkMode ? 'text-white/55' : 'text-gray-500'
              }`}
            >
              {task.prompt}
            </div>
          ) : (
            <div
              className={`w-full h-32 flex items-center justify-center text-xs ${
                isDarkMode ? 'bg-zinc-900/90 text-white/45' : 'text-gray-500 bg-gray-100'
              }`}
            >
              {isTimeout ? wc.taskTimeoutWait : wc.taskFailed}
            </div>
          )}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <div className={`text-xs font-semibold ${isDarkMode ? 'text-white/90' : 'text-gray-900'}`}>{task.nodeTitle}</div>
        {!hasTextPreview && !hasRunningTextPreview ? (
        <div className={`text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
          {isFailed ? (
            <div className="space-y-0.5">
              <div className="line-clamp-2">{errLine || wc.genFailedTapDetail}</div>
              {!messageContainsRefundHint(errLine) ? (
                <div className={`text-[11px] ${isDarkMode ? 'text-amber-400/90' : 'text-amber-700'}`}>
                  {refundHintForLocale(locale)}
                </div>
              ) : null}
            </div>
          ) : promptNeedsExpand ? (
            promptExpanded ? (
              <div className="min-w-0 space-y-1">
                <div
                  className={`whitespace-pre-wrap break-words rounded px-1 py-0.5 ${
                    isDarkMode ? 'bg-black/25 text-white/75' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {fullPrompt}
                </div>
                <button
                  type="button"
                  className={`text-xs font-medium underline-offset-2 hover:underline ${
                    isDarkMode ? 'text-sky-300/90 hover:text-sky-200' : 'text-sky-600 hover:text-sky-700'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPromptExpanded(false);
                  }}
                >
                  {wc.taskPromptCollapse}
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-wrap items-end gap-x-1 gap-y-0.5">
                <span className={`line-clamp-3 min-w-0 flex-1 break-words`}>{fullPrompt}</span>
                <button
                  type="button"
                  className={`shrink-0 text-xs font-medium underline-offset-2 hover:underline ${
                    isDarkMode ? 'text-sky-300/90 hover:text-sky-200' : 'text-sky-600 hover:text-sky-700'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPromptExpanded(true);
                  }}
                >
                  {wc.taskPromptExpand}
                </button>
              </div>
            )
          ) : (
            <span className="line-clamp-3 block break-words">{fullPrompt}</span>
          )}
        </div>
        ) : null}
        <div className="flex items-center justify-between text-xs">
          <span className={isDarkMode ? 'text-white/50' : 'text-gray-500'}>
            {new Date(task.createdAt).toLocaleString(wc.dateLocale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 ${
              isSuccess
                ? taskListStatusSuccess(isDarkMode)
                : isRunning
                  ? taskListStatusRunning(isDarkMode)
                  : isDarkMode
                    ? 'text-red-300/80'
                    : 'text-red-600'
            }`}
          >
            {isRunning ? (
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
              </span>
            ) : null}
            {isSuccess
              ? typeof task.durationSec === 'number' || typeof task.yuanbaoConsumed === 'number'
                ? wc.completedStatus({
                    durationSec: task.durationSec,
                    yuanbaoConsumed: task.yuanbaoConsumed,
                  })
                : wc.completed
              : isRunning
                ? wc.running(runtimeSec)
                : isTimeout
                  ? wc.timeout
                  : wc.failed}
          </span>
        </div>
      </div>
      {isFailed && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            showTaskError(failedGenerationDetailWithRefund(errLine || wc.taskFailedDefault, locale));
          }}
          className={`mt-2 w-full gap-1 ${taskListBtnDanger(isDarkMode)} !flex-none !w-full`}
          title={wc.viewFailureDetailsTitle}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          {wc.viewFailureDetails}
        </button>
      )}
      {isSuccess && task.taskType !== 'audio' && (
        <div className="flex gap-2 mt-2">
          {task.taskType !== 'text' &&
            (task.taskType === 'video' && (task.videoUrl || task.localFilePath) ? (
            <button
              onClick={() =>
                onDownloadVideo({
                  ...task,
                  videoUrl:
                    task.videoUrl ||
                    (task.localFilePath!.startsWith('local-resource://') || task.localFilePath!.startsWith('file://')
                      ? task.localFilePath!
                      : `local-resource://${task.localFilePath!.replace(/\\/g, '/')}`),
                })
              }
              className={taskListBtnSecondary(isDarkMode)}
              title={wc.downloadTitle}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          ) : task.localFilePath ? (
            <button
              onClick={() => onDownloadLocalFile(task.localFilePath!, task.nodeTitle)}
              className={taskListBtnSecondary(isDarkMode)}
              title={wc.downloadTitle}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={async () => {
                if (task.imageUrl || (task.outputImages && task.outputImages.length > 0)) {
                  onDownloadImage(task.id, task.imageUrl || task.outputImages![0], task.nodeTitle);
                }
              }}
              className={taskListBtnSecondary(isDarkMode)}
              title={wc.downloadTitle}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          ))}
          {canPlace && onTaskPlaceToCanvas && (
            <button
              type="button"
              onClick={() => onTaskPlaceToCanvas(task)}
              className={taskListBtnPrimary(isDarkMode)}
              title={wc.placeOnCanvasTitle}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onDeleteTask(task.id)}
            className={taskListBtnDanger(isDarkMode)}
            title={wc.deleteTitle}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <TaskTextResultModal
        open={textModalOpen}
        title={task.nodeTitle || wc.taskTextModalTitle}
        body={textBody}
        isDarkMode={isDarkMode}
        wc={wc}
        onClose={() => setTextModalOpen(false)}
      />
      {isSuccess && task.taskType === 'audio' && (
        <div className="flex gap-2 mt-2">
          {(task.audioUrl || task.localFilePath) && (
            <button
              onClick={() =>
                onDownloadAudio({
                  ...task,
                  audioUrl:
                    task.audioUrl ||
                    (task.localFilePath!.startsWith('local-resource://') || task.localFilePath!.startsWith('file://')
                      ? task.localFilePath!
                      : `local-resource://${task.localFilePath!.replace(/\\/g, '/')}`),
                })
              }
              className={taskListBtnSecondary(isDarkMode)}
              title={wc.downloadTitle}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          {canPlace && onTaskPlaceToCanvas && (
            <button
              type="button"
              onClick={() => onTaskPlaceToCanvas(task)}
              className={taskListBtnPrimary(isDarkMode)}
              title={wc.placeOnCanvasTitle}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onDeleteTask(task.id)}
            className={taskListBtnDanger(isDarkMode)}
            title={wc.deleteTitle}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
});

const WorkspaceSidebar = React.memo(function WorkspaceSidebar({
  characterListCollapsed,
  onToggleCharacterList,
  characterListRefreshTrigger,
  sceneListRefreshTrigger,
  digitalHumanListRefreshTrigger,
  rvcVoiceListRefreshTrigger,
  onSelectCharacter,
  requestVoicePickFromCanvas,
  requestViewSlotPickFromCanvas,
  requestSceneImagePickFromCanvas,
  requestDigitalHumanVideoPickFromCanvas,
  rightSidebarOpen,
  onToggleRightSidebar,
  tasks,
  projectId,
  isDarkMode,
  formatImagePath,
  mapProjectPath,
  onPreviewImage,
  onPreviewAudio,
  onDownloadLocalFile,
  onDeleteTask,
  onDownloadImage,
  onDownloadVideo,
  onDownloadAudio,
  onClearAllTasks,
  onTaskPlaceToCanvas,
  onPlaceSceneToCanvas,
  onPlaceDigitalHumanToCanvas,
  onPlaceRvcVoiceToCanvas,
  onRvcVoiceUpdated,
}: WorkspaceSidebarProps) {
  const { locale } = useAppLocale();
  const wc = workspaceChromeT(locale);
  const { showAlert: showTaskError } = useDarkAlert();
  const scrollRef = useRef<HTMLDivElement>(null);
  const leftAssetPanelRef = useRef<HTMLDivElement>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [assetLibraryGalleryWide, setAssetLibraryGalleryWide] = useState(false);

  const handlePlaceSceneOnCanvas = React.useCallback(
    (scene: SceneLibraryItem) => {
      if (!onPlaceSceneToCanvas) return;
      const panel = leftAssetPanelRef.current;
      const anchor = panel
        ? (() => {
            const pr = panel.getBoundingClientRect();
            return { x: pr.right + 36, y: pr.top + pr.height * 0.38 };
          })()
        : { x: 320, y: 400 };
      onPlaceSceneToCanvas(scene, anchor);
    },
    [onPlaceSceneToCanvas],
  );

  const handlePlaceDigitalHumanOnCanvas = React.useCallback(
    (item: DigitalHumanLibraryItem) => {
      if (!onPlaceDigitalHumanToCanvas) return;
      const panel = leftAssetPanelRef.current;
      const anchor = panel
        ? (() => {
            const pr = panel.getBoundingClientRect();
            return { x: pr.right + 36, y: pr.top + pr.height * 0.38 };
          })()
        : { x: 320, y: 400 };
      onPlaceDigitalHumanToCanvas(item, anchor);
    },
    [onPlaceDigitalHumanToCanvas],
  );

  const handlePlaceRvcVoiceOnCanvas = React.useCallback(
    (item: RvcVoiceLibraryItem) => {
      if (!onPlaceRvcVoiceToCanvas) return;
      const panel = leftAssetPanelRef.current;
      const anchor = panel
        ? (() => {
            const pr = panel.getBoundingClientRect();
            return { x: pr.right + 36, y: pr.top + pr.height * 0.38 };
          })()
        : { x: 320, y: 400 };
      onPlaceRvcVoiceToCanvas(item, anchor);
    },
    [onPlaceRvcVoiceToCanvas],
  );

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateTaskRowHeight(tasks[index]),
    /** 按任务 id 关联测量结果，排序/状态变化时避免索引错位造成列表中间大块空白 */
    getItemKey: (index) => tasks[index]?.id ?? index,
    overscan: 3,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* 左侧角色列表 */}
      <div
        ref={leftAssetPanelRef}
        className="absolute left-0 top-0 bottom-0 z-20 transition-all duration-300 ease-in-out pointer-events-auto"
        style={{
          width: characterListCollapsed
            ? '48px'
            : assetLibraryGalleryWide
              ? `clamp(720px, min(58vw, 1100px), calc(100vw - ${ASSET_LIBRARY_SIDEBAR_WIDTH_PX}px))`
              : `${ASSET_LIBRARY_SIDEBAR_WIDTH_PX}px`,
        }}
      >
        <AssetLibrarySidebar
          isDarkMode={isDarkMode}
          isCollapsed={characterListCollapsed}
          onToggleCollapse={onToggleCharacterList}
          onGalleryModeChange={setAssetLibraryGalleryWide}
          characterListRefreshTrigger={characterListRefreshTrigger}
          sceneListRefreshTrigger={sceneListRefreshTrigger}
          digitalHumanListRefreshTrigger={digitalHumanListRefreshTrigger}
          rvcVoiceListRefreshTrigger={rvcVoiceListRefreshTrigger}
          onSelectCharacter={onSelectCharacter}
          requestVoicePickFromCanvas={requestVoicePickFromCanvas}
          requestViewSlotPickFromCanvas={requestViewSlotPickFromCanvas}
          requestSceneImagePickFromCanvas={requestSceneImagePickFromCanvas}
          requestDigitalHumanVideoPickFromCanvas={requestDigitalHumanVideoPickFromCanvas}
          onPlaceSceneToCanvas={handlePlaceSceneOnCanvas}
          onPlaceDigitalHumanToCanvas={handlePlaceDigitalHumanOnCanvas}
          onPlaceRvcVoiceToCanvas={handlePlaceRvcVoiceOnCanvas}
          onRvcVoiceUpdated={onRvcVoiceUpdated}
        />
      </div>

      {/* 右侧任务列表 */}
      <div
        className={`absolute right-0 top-0 bottom-0 border-l flex min-h-0 flex-col transition-all duration-300 ease-in-out z-10 pointer-events-auto ${
          isDarkMode ? 'apple-panel' : 'apple-panel-light'
        } ${rightSidebarOpen ? 'w-[260px] translate-x-0' : 'w-0 translate-x-full'}`}
      >
        <div className={`p-4 border-b flex-shrink-0 flex items-center justify-between gap-2 ${isDarkMode ? 'border-white/10' : 'border-gray-300/30'}`}>
          <h3 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{wc.taskList}</h3>
          {rightSidebarOpen && tasks.length > 0 && onClearAllTasks && (
            <button
              onClick={onClearAllTasks}
              className={`nexflow-btn-secondary nexflow-btn-secondary-sm inline-flex items-center gap-1 !py-1 !px-2.5 ${
                isDarkMode ? '' : '!border-gray-300/80 !bg-white !text-gray-700 hover:!bg-gray-50'
              }`}
              title={wc.clearAllTasksTitle}
            >
              <Trash className="w-3 h-3" />
              {wc.clearAllTasks}
            </button>
          )}
        </div>
        <div
          ref={scrollRef}
          className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 ${isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar'}`}
        >
          {!rightSidebarOpen ? (
            <div className={`text-sm ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>
              {tasks.length > 0 ? wc.taskCount(tasks.length) : wc.noTasks}
            </div>
          ) : tasks.length === 0 ? (
            <div className={`text-sm ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>{wc.noTasks}</div>
          ) : (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualRow) => {
                const task = tasks[virtualRow.index];
                return (
                  <div
                    key={task.id}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="pb-3"
                  >
                    <TaskCard
                      task={task}
                      projectId={projectId}
                      isDarkMode={isDarkMode}
                      formatImagePath={formatImagePath}
                      mapProjectPath={mapProjectPath}
                      onPreviewImage={onPreviewImage}
                      onPreviewAudio={onPreviewAudio}
                      onDownloadLocalFile={onDownloadLocalFile}
                      onDeleteTask={onDeleteTask}
                      onDownloadImage={onDownloadImage}
                      onDownloadVideo={onDownloadVideo}
                      onDownloadAudio={onDownloadAudio}
                      onTaskPlaceToCanvas={onTaskPlaceToCanvas}
                      nowTs={nowTs}
                      showTaskError={showTaskError}
                      locale={locale}
                      wc={wc}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 右侧收起/展开按钮 */}
      <button
        onClick={onToggleRightSidebar}
        className={`absolute right-0 top-1/2 -translate-y-1/2 w-6 h-12 border-l rounded-l-lg flex items-center justify-center transition-all duration-300 z-20 pointer-events-auto ${
          isDarkMode ? 'apple-panel hover:bg-white/15' : 'apple-panel-light hover:bg-gray-200/30'
        } ${rightSidebarOpen ? '-translate-x-[260px]' : 'translate-x-0'}`}
      >
        {rightSidebarOpen ? (
          <ChevronRight className={`w-4 h-4 ${isDarkMode ? 'text-white/60' : 'text-gray-700'}`} />
        ) : (
          <ChevronLeft className={`w-4 h-4 ${isDarkMode ? 'text-white/60' : 'text-gray-700'}`} />
        )}
      </button>
    </div>
  );
});

export default WorkspaceSidebar;
