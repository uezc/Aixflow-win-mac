// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, LayoutGroup } from 'framer-motion';
import { Plus, Edit2, Trash2, ArrowLeft, Download, Upload, FolderOpen, Power } from 'lucide-react';
import { setIsExiting } from '../utils/globalInteractionStore';
import { useDarkAlert } from '../contexts/DarkAlertContext';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { projectsT } from '../i18n/projectsI18n';
import SettingsFullscreenToggle from './SettingsFullscreenToggle';
import { readIsDarkMode, writeIsDarkMode, NEXFLOW_THEME_CHANGE_EVENT, NEXFLOW_DARK_MODE_KEY, applyThemeToDocument } from '../utils/appTheme';
import { assetLibBtnPrimary, assetLibBtnSecondary, assetLibBtnDanger, assetLibBtnIcon } from '../utils/assetLibraryChrome';
import { projectCardColorForId, projectCardTextClasses } from '../utils/projectCardColors';
import { SCRATCH_COLORS, scratchTintClass, type ScratchColorId } from '../theme/scratchColors';

const LONG_PRESS_MS = 300;

const CARD_BG_STORAGE_KEY = 'nexflow-project-card-bg';
function getCardBgKey(projectId: string) {
  return `${CARD_BG_STORAGE_KEY}-${projectId}`;
}

interface Project {
  id: string;
  name: string;
  date: string;
  createdAt: number;
  lastModified: number;
}

interface ProjectsProps {
  onBack?: () => void;
  /** 打开云端登录 / 设置（#/settings） */
  onOpenCloudAccount?: () => void;
}

const Projects: React.FC<ProjectsProps> = ({ onBack, onOpenCloudAccount }) => {
  const navigate = useNavigate();
  const { locale } = useAppLocale();
  const { showConfirm } = useDarkAlert();
  const pt = projectsT(locale);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectBasePath, setProjectBasePathState] = useState<string>('');
  /** 项目卡背景图（projectId -> dataUrl），从 localStorage 读写 */
  const [cardBackgrounds, setCardBackgrounds] = useState<Record<string, string>>({});
  /** 非阻塞提示（替代 alert，避免 stole 焦点导致输入框光标异常） */
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  /** 长按拖动：正在拖动的项目 ID */
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  /** 拖动时悬停的目标索引（用于视觉反馈） */
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  /** 拖动预览跟随光标的坐标 */
  const [dragPreviewPos, setDragPreviewPos] = useState<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreNextClickRef = useRef(false);
  const dropTargetIndexRef = useRef<number | null>(null);
  const dragStartOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragCardSizeRef = useRef<{ w: number; h: number }>({ w: 280, h: 158 });
  const longPressCleanupRef = useRef<(() => void) | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => readIsDarkMode());

  useEffect(() => {
    const stored = localStorage.getItem(NEXFLOW_DARK_MODE_KEY);
    if (stored == null || stored === '') {
      writeIsDarkMode(true);
      setIsDarkMode(true);
      return;
    }
    const dark = readIsDarkMode();
    setIsDarkMode(dark);
    applyThemeToDocument(dark);
  }, []);

  useEffect(() => {
    const onTheme = (e: Event) => {
      const detail = (e as CustomEvent<{ isDarkMode?: boolean }>).detail;
      if (typeof detail?.isDarkMode === 'boolean') setIsDarkMode(detail.isDarkMode);
    };
    window.addEventListener(NEXFLOW_THEME_CHANGE_EVENT, onTheme);
    return () => window.removeEventListener(NEXFLOW_THEME_CHANGE_EVENT, onTheme);
  }, []);

  const cardPanelCls = isDarkMode ? 'apple-panel' : 'apple-panel-light shadow-md';
  const cardHoverCls = isDarkMode
    ? 'hover:bg-white/15'
    : 'hover:brightness-[0.97] hover:shadow-lg';
  const titleTextCls = isDarkMode ? 'text-white' : 'text-gray-900';
  const mutedTextCls = isDarkMode ? 'text-white/60' : 'text-gray-500';

  const scratchPrimary = (scratch: ScratchColorId, extra = '') =>
    assetLibBtnPrimary(isDarkMode, `inline-flex items-center gap-1.5 ${extra}`.trim(), scratch);
  const scratchSecondary = (scratch: ScratchColorId, extra = '') =>
    assetLibBtnSecondary(isDarkMode, `inline-flex items-center gap-1.5 ${extra}`.trim(), scratch);
  const scratchIconBtn = (scratch: ScratchColorId, extra = '') =>
    `${assetLibBtnIcon(isDarkMode, isDarkMode ? undefined : scratch)} ${extra}`.trim();
  const scratchDangerBtn = (extra = '') => assetLibBtnDanger(isDarkMode, `inline-flex items-center justify-center ${extra}`.trim());
  const scratchDangerIcon = (extra = '') =>
    isDarkMode
      ? `p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded-lg text-red-400 transition-colors inline-flex items-center justify-center ${extra}`.trim()
      : `${assetLibBtnIcon(isDarkMode, 'myBlocks')} ${extra}`.trim();

  // 新建项目对话框打开时聚焦输入框（requestAnimationFrame 确保 DOM 渲染完成）
  useEffect(() => {
    if (showCreateDialog) {
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          createInputRef.current?.focus();
        });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [showCreateDialog]);

  // 进入重命名模式时聚焦输入框
  useEffect(() => {
    if (editingProject) {
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          renameInputRef.current?.focus();
        });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [editingProject?.id]);

  // 自动关闭 toast
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // 挂载时重置 isExiting，避免从 Workspace 返回后全局状态残留
  useEffect(() => {
    setIsExiting(false);
    return () => {};
  }, []);

  // 加载项目列表与当前项目保存路径（支持重试，应对 electronAPI 未就绪或打包环境时序问题）
  // 渲染保险丝：延迟 200ms 再加载，给 Workspace 卸载 GPU 纹理和 GC 留出空窗期，避免两层渲染叠加导致崩溃
  useEffect(() => {
    let retryCount = 0;
    const MAX_RETRIES = 10;
    const RETRY_DELAY_MS = 300;
    const RENDER_FUSE_MS = 200;

    const loadProjects = async (): Promise<boolean> => {
      if (!window.electronAPI) return false;
      try {
        setIsLoadingProjects(true);
        const projectList = await window.electronAPI.getProjects();
        setProjects(Array.isArray(projectList) ? projectList : []);
        return true;
      } catch (error) {
        console.error('加载项目列表失败:', error);
        setToastMessage('加载项目列表失败，请重试');
        return false;
      } finally {
        setIsLoadingProjects(false);
      }
    };
    const loadBasePath = async () => {
      if (!window.electronAPI?.getProjectBasePath) return;
      try {
        const base = await window.electronAPI.getProjectBasePath();
        setProjectBasePathState(base || '');
      } catch (_) {}
    };

    const tryLoad = () => {
      loadProjects().then((ok) => {
        if (!ok && retryCount < MAX_RETRIES) {
          retryCount++;
          setTimeout(tryLoad, RETRY_DELAY_MS);
        }
      });
    };

    let intervalCleanup: (() => void) | null = null;
    const runAfterFuse = () => {
      if (window.electronAPI) {
        tryLoad();
        loadBasePath();
      } else {
        const t = setInterval(() => {
          if (window.electronAPI) {
            clearInterval(t);
            intervalCleanup = null;
            tryLoad();
            loadBasePath();
          } else if (++retryCount >= MAX_RETRIES) {
            clearInterval(t);
            intervalCleanup = null;
            setIsLoadingProjects(false);
          }
        }, RETRY_DELAY_MS);
        intervalCleanup = () => clearInterval(t);
      }
    };

    const fuseTimer = setTimeout(runAfterFuse, RENDER_FUSE_MS);
    return () => {
      clearTimeout(fuseTimer);
      intervalCleanup?.();
    };
  }, []);

  // 从 localStorage 加载各项目卡背景图
  useEffect(() => {
    const next: Record<string, string> = {};
    projects.forEach((p) => {
      try {
        const url = localStorage.getItem(getCardBgKey(p.id));
        if (url) next[p.id] = url;
      } catch (_) {}
    });
    setCardBackgrounds((prev) => ({ ...prev, ...next }));
  }, [projects]);

  // 格式化日期
  const formatDate = (dateStr: string) => {
    return dateStr;
  };

  // 格式化时间戳为日期
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
  };

  // 获取当前日期
  const getCurrentDate = () => {
    const now = new Date();
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  };

  // 创建新项目
  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !window.electronAPI) {
      return;
    }

    try {
      await window.electronAPI.createProject(newProjectName.trim());
      const list = await window.electronAPI.getProjects();
      setProjects(Array.isArray(list) ? list : []);
      setNewProjectName('');
      setShowCreateDialog(false);
    } catch (error) {
      console.error('创建项目失败:', error);
    }
  };

  // 开始编辑项目
  const handleStartEdit = (project: Project) => {
    setEditingProject(project);
    setEditName(project.name);
  };

  // 确认编辑
  const handleConfirmEdit = async () => {
    if (!editingProject || !editName.trim() || !window.electronAPI) {
      return;
    }

    try {
      const updated = await window.electronAPI.updateProject(editingProject.id, editName.trim());
      setProjects((prev) =>
        prev.map((p) => (p.id === editingProject.id ? updated : p))
      );
      setEditingProject(null);
      setEditName('');
    } catch (error: any) {
      console.error('更新项目失败:', error);
      setToastMessage(`重命名失败: ${error?.message || '未知错误'}`);
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingProject(null);
    setEditName('');
  };

  // 点击删除按钮：弹出确认窗口
  const handleDeleteClick = async (project: Project) => {
    const ok = await showConfirm(
      `删除项目「${project.name}」后，将同时删除其对应的项目文件夹及其中所有文件，且无法恢复。\n\n确定要删除吗？`,
      { variant: 'danger', okLabel: '确定删除' },
    );
    if (!ok || !window.electronAPI) return;
    try {
      await window.electronAPI.deleteProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (error) {
      console.error('删除项目失败:', error);
    }
  };

  // 导出项目（含项目卡背景图）
  const handleExportProject = async (projectId: string, projectName: string) => {
    if (!window.electronAPI) {
      return;
    }

    try {
      const cardBgDataUrl = typeof localStorage !== 'undefined' ? localStorage.getItem(getCardBgKey(projectId)) : null;
      const result = await window.electronAPI.exportProject(projectId, cardBgDataUrl || undefined);
      if (result.success) {
        setToastMessage(`项目 "${projectName}" 已成功导出！`);
      }
    } catch (error: any) {
      console.error('导出项目失败:', error);
      setToastMessage(`导出项目失败: ${error.message || '未知错误'}`);
    }
  };

  // 选择项目保存位置
  const handleSetProjectBasePath = async () => {
    if (!window.electronAPI?.setProjectBasePath) return;
    try {
      const result = await window.electronAPI.setProjectBasePath();
      if (result.success && result.path) {
        setProjectBasePathState(result.path);
        setToastMessage(`项目将保存到：${result.path}\n新建项目会使用新路径，已有项目仍在原路径。`);
      }
    } catch (e) {
      console.error('设置项目保存位置失败:', e);
    }
  };

  // 导入项目
  const handleImportProject = async () => {
    if (!window.electronAPI) {
      return;
    }

    try {
      const result = await window.electronAPI.importProject();
      if (result.success && result.project) {
        const list = await window.electronAPI.getProjects();
        setProjects(Array.isArray(list) ? list : []);
        if (result.cardBackground && result.project.id) {
          try {
            localStorage.setItem(getCardBgKey(result.project.id), result.cardBackground);
            setCardBackgrounds((prev) => ({ ...prev, [result.project!.id]: result.cardBackground! }));
          } catch (_) {}
        }
        setToastMessage(`项目 "${result.project.name}" 已成功导入！`);
      }
    } catch (error: any) {
      console.error('导入项目失败:', error);
      setToastMessage(`导入项目失败: ${error.message || '未知错误'}`);
    }
  };

  // 拖动时禁止选中文字
  useEffect(() => {
    if (!draggingProjectId) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => { document.body.style.userSelect = prev; };
  }, [draggingProjectId]);

  // 长按拖动：开始拖动
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const handleCardMouseDown = useCallback(
    (project: Project, index: number, e: React.MouseEvent) => {
      if (editingProject) return;
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      dragStartOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      dragCardSizeRef.current = { w: rect.width, h: rect.height };
      mousePosRef.current = { x: e.clientX, y: e.clientY };
      const onMove = (ev: MouseEvent) => { mousePosRef.current = { x: ev.clientX, y: ev.clientY }; };
      document.addEventListener('mousemove', onMove);
      longPressCleanupRef.current = () => document.removeEventListener('mousemove', onMove);
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        longPressCleanupRef.current?.();
        longPressCleanupRef.current = null;
        dropTargetIndexRef.current = index;
        setDraggingProjectId(project.id);
        setDropTargetIndex(index);
        setDragPreviewPos({ x: mousePosRef.current.x - dragStartOffsetRef.current.x, y: mousePosRef.current.y - dragStartOffsetRef.current.y });
      }, LONG_PRESS_MS);
    },
    [editingProject]
  );

  // 长按拖动：离开卡片时取消长按计时
  const handleCardMouseLeave = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      longPressCleanupRef.current?.();
      longPressCleanupRef.current = null;
    }
  }, []);

  // 长按拖动：结束（mouseup 时清除 timer 或结束拖动；实际 drop 由 document 的 capture 阶段处理）
  const handleCardMouseUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      longPressCleanupRef.current?.();
      longPressCleanupRef.current = null;
      return;
    }
    if (draggingProjectId) {
      ignoreNextClickRef.current = true;
      setDraggingProjectId(null);
      setDropTargetIndex(null);
      setDragPreviewPos(null);
    }
  }, [draggingProjectId]);

  // 长按拖动：全局 mousemove 与 mouseup 监听
  useEffect(() => {
    if (!draggingProjectId) return;
    const onDocMouseMove = (e: MouseEvent) => {
      setDragPreviewPos({ x: e.clientX - dragStartOffsetRef.current.x, y: e.clientY - dragStartOffsetRef.current.y });
      const grid = document.querySelector('[data-projects-grid]');
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      const cols = 5;
      const totalItems = 1 + projects.length; // add button + projects
      const rows = Math.ceil(totalItems / cols);
      const cardW = rect.width / cols;
      const cardH = rect.height / rows;
      const col = Math.floor((e.clientX - rect.left) / cardW);
      const row = Math.floor((e.clientY - rect.top) / cardH);
      let gridIdx = row * cols + col;
      if (gridIdx > totalItems - 1) gridIdx = totalItems - 1;
      const projectIdx = gridIdx === 0 ? -1 : gridIdx - 1; // slot 0 = add button
      const fromIdx = projects.findIndex((p) => p.id === draggingProjectId);
      if (projectIdx >= 0 && projectIdx <= projects.length && projectIdx !== fromIdx) {
        dropTargetIndexRef.current = projectIdx;
        setDropTargetIndex(projectIdx);
      }
    };
    const onDocMouseUp = (e: MouseEvent) => {
      const id = draggingProjectId;
      if (!id || !window.electronAPI?.reorderProjects) {
        setDraggingProjectId(null);
        setDropTargetIndex(null);
        setDragPreviewPos(null);
        dropTargetIndexRef.current = null;
        return;
      }
      ignoreNextClickRef.current = true;
      const fromIdx = projects.findIndex((p) => p.id === id);
      let toIdx = fromIdx;
      const grid = document.querySelector('[data-projects-grid]');
      const cards = grid ? grid.querySelectorAll('[data-project-slot]') : [];
      if (cards.length > 0) {
        let minDist = Infinity;
        let closestIdx = fromIdx;
        cards.forEach((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const d = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
          const slotIdx = parseInt((el as HTMLElement).getAttribute('data-project-slot') ?? '-1', 10);
          if (d < minDist && slotIdx >= 0) {
            minDist = d;
            closestIdx = slotIdx;
          }
        });
        toIdx = closestIdx;
      } else {
        toIdx = dropTargetIndexRef.current ?? fromIdx;
      }
      if (fromIdx !== -1 && fromIdx !== toIdx) {
        const next = [...projects];
        const [item] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, item);
        setProjects(next);
        window.electronAPI
          .reorderProjects(next.map((p) => p.id))
          .then((reordered) => setProjects(Array.isArray(reordered) ? reordered : next))
          .catch((err) => {
            console.error('重排序失败:', err);
            setProjects(projects);
          });
      }
      setDraggingProjectId(null);
      setDropTargetIndex(null);
      setDragPreviewPos(null);
      dropTargetIndexRef.current = null;
    };
    window.addEventListener('mousemove', onDocMouseMove);
    window.addEventListener('mouseup', onDocMouseUp, true);
    return () => {
      window.removeEventListener('mousemove', onDocMouseMove);
      window.removeEventListener('mouseup', onDocMouseUp, true);
    };
  }, [draggingProjectId, projects]);

  // 退出软件
  const handleQuitApp = useCallback(async () => {
    if (!window.electronAPI?.quitApp) return;
    try {
      await window.electronAPI.quitApp();
    } catch (error) {
      console.error('退出软件失败:', error);
    }
  }, []);

  const draggingProject = draggingProjectId ? projects.find((p) => p.id === draggingProjectId) : null;

  // 拖动时预览顺序：其他卡片挤开，留出放置位
  const displayProjects = useMemo(() => {
    if (!draggingProjectId || dropTargetIndex === null) return projects;
    const fromIdx = projects.findIndex((p) => p.id === draggingProjectId);
    if (fromIdx === -1) return projects;
    const next = [...projects];
    const [item] = next.splice(fromIdx, 1);
    next.splice(dropTargetIndex, 0, item);
    return next;
  }, [projects, draggingProjectId, dropTargetIndex]);

  return (
    <>
    {/* 加载项目列表时显示加载动画 */}
    {isLoadingProjects && (
      <div
        className={`fixed inset-0 z-[9997] flex items-center justify-center backdrop-blur-sm ${
          isDarkMode ? 'bg-black/80' : 'bg-white/70'
        }`}
        style={{ pointerEvents: 'none' }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className={`w-12 h-12 border-4 rounded-full animate-spin ${
              isDarkMode ? 'border-white/30 border-t-white' : 'border-gray-300 border-t-gray-700'
            }`}
          />
          <span className={`text-sm ${isDarkMode ? 'text-white/90' : 'text-gray-700'}`}>{pt.loadingList}</span>
        </div>
      </div>
    )}
    {/* 拖动时跟随光标的卡片预览 */}
    {draggingProject && dragPreviewPos &&
      createPortal(
        (() => {
          const dragScratchColor = !isDarkMode ? projectCardColorForId(draggingProject.id) : null;
          const dragText = dragScratchColor
            ? projectCardTextClasses(dragScratchColor)
            : { title: titleTextCls, muted: mutedTextCls };
          return (
        <div
          className="fixed z-[99998] pointer-events-none"
          style={{
            left: dragPreviewPos.x,
            top: dragPreviewPos.y,
            width: dragCardSizeRef.current.w,
            height: dragCardSizeRef.current.h,
          }}
        >
          <div
            className={`relative w-full h-full rounded-xl p-6 flex flex-col overflow-hidden shadow-2xl scale-105 ${
              isDarkMode ? cardPanelCls : ''
            }`}
            style={dragScratchColor ? { backgroundColor: dragScratchColor } : undefined}
          >
            {cardBackgrounds[draggingProject.id] && (
              <div
                className="absolute inset-0 rounded-xl bg-cover bg-center bg-no-repeat opacity-50"
                style={{ backgroundImage: `url(${cardBackgrounds[draggingProject.id]})` }}
              />
            )}
            {cardBackgrounds[draggingProject.id] && (
              <div className={`absolute inset-0 rounded-xl ${isDarkMode ? 'bg-black/30' : 'bg-black/20'}`} />
            )}
            <div className="flex-1 flex flex-col items-center justify-center relative z-10">
              <h3 className={`text-4xl font-semibold text-center mb-6 ${dragText.title}`}>{draggingProject.name}</h3>
              <div className="space-y-1">
                <p className={`${dragText.muted} text-base text-center`}>{formatDate(draggingProject.date)}</p>
                <p className={`${dragText.muted} text-sm text-center`}>
                  {pt.modified} {formatTimestamp(draggingProject.lastModified)}
                </p>
              </div>
            </div>
          </div>
        </div>
          );
        })(),
        document.body
      )}
    <div
      className={`projects-page-scrollbar w-full h-screen overflow-y-auto overflow-x-hidden p-10 flex flex-col items-start justify-start box-border ${
        isDarkMode ? 'custom-scrollbar-dark bg-black dark-mode' : 'custom-scrollbar light-mode bg-[#E5E7EB]'
      }`}
    >
      {/* 头部：左侧「返回登陆」+ 标题；右侧保存路径与操作 */}
      <div className="mb-8 w-full shrink-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={`mb-4 ${scratchSecondary('motion')}`}
          >
            <ArrowLeft className="w-5 h-5 shrink-0" />
            <span>{pt.backHome}</span>
          </button>
        )}
        <div className="flex items-center justify-between flex-wrap gap-4 gap-y-3">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            {onOpenCloudAccount ? (
              <button
                type="button"
                onClick={onOpenCloudAccount}
                className={scratchSecondary('looks', 'shrink-0')}
                title={pt.cloudAccountTitle}
              >
                <ArrowLeft className="w-5 h-5 shrink-0" />
                <span>{pt.cloudAccount}</span>
              </button>
            ) : null}
            <h1 className={`text-4xl font-bold min-w-0 ${titleTextCls}`}>{pt.myProjects}</h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <button
              onClick={handleSetProjectBasePath}
              className={scratchPrimary('sensing')}
              title={pt.chooseSaveLocationTitle}
            >
              <FolderOpen className="w-4 h-4" />
              <span>{pt.chooseSaveLocation}</span>
            </button>
            <button
              onClick={handleImportProject}
              className={scratchPrimary('events')}
              title={pt.importProjectTitle}
            >
              <Download className="w-4 h-4" />
              <span>{pt.importProject}</span>
            </button>
            <SettingsFullscreenToggle />
          </div>
        </div>
      </div>

      {/* 项目网格 - 每行5个卡片 */}
      <LayoutGroup>
      <div className="w-full grid grid-cols-5 gap-x-8 gap-y-6" data-projects-grid>
          {/* 新建项目卡片 - 与项目卡片同尺寸 */}
          <motion.div layout transition={{ type: 'spring', stiffness: 400, damping: 30 }} className="w-full">
            <button
              onClick={() => setShowCreateDialog(true)}
              className={`w-full aspect-video group relative rounded-xl p-6 flex flex-col items-center justify-center gap-4 ${cardHoverCls} transition-all duration-300 hover:scale-105 ${
                isDarkMode ? cardPanelCls : 'shadow-md'
              }`}
              style={!isDarkMode ? { backgroundColor: SCRATCH_COLORS.operators } : undefined}
              title={pt.newProjectTitle}
              aria-label={pt.newProjectTitle}
            >
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
                  isDarkMode
                    ? 'bg-white/10 group-hover:bg-white/20'
                    : 'bg-white/25 group-hover:bg-white/35'
                }`}
              >
                <Plus className={`w-8 h-8 ${isDarkMode ? 'text-white' : 'text-white'}`} />
              </div>
            </button>
          </motion.div>

          {/* 项目卡片 - 使用 displayProjects 实现拖动时挤开动画 */}
          {displayProjects.map((project, index) => {
            const isDragging = draggingProjectId === project.id;
            const originalIndex = projects.findIndex((p) => p.id === project.id);
            const cardScratchColor = !isDarkMode ? projectCardColorForId(project.id) : null;
            const cardText = cardScratchColor
              ? projectCardTextClasses(cardScratchColor)
              : { title: titleTextCls, muted: mutedTextCls };
            return (
            <motion.div
              key={project.id}
              layout
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              data-project-slot={index}
              className="w-full"
            >
              {isDragging ? (
                <div
                  className={`w-full aspect-video rounded-xl ${
                    isDarkMode ? 'bg-white/5 border border-dashed border-white/20' : 'bg-gray-200/60 border border-dashed border-gray-300'
                  }`}
                />
              ) : (
            <div
              onMouseDown={(e) => handleCardMouseDown(project, originalIndex, e)}
              onMouseUp={handleCardMouseUp}
              onMouseLeave={handleCardMouseLeave}
              onClick={() => {
                if (ignoreNextClickRef.current) {
                  ignoreNextClickRef.current = false;
                  return;
                }
                if (editingProject) return;
                navigate(`/workspace/${project.id}`);
              }}
              className={`w-full aspect-video group relative rounded-xl p-6 flex flex-col overflow-hidden transition-all duration-300 select-none ${cardHoverCls} hover:scale-105 cursor-pointer ${
                isDarkMode ? cardPanelCls : cardScratchColor ? 'shadow-md' : cardPanelCls
              }`}
              style={cardScratchColor ? { backgroundColor: cardScratchColor } : undefined}
            >
              {/* 半透明背景图：自适应卡片大小 */}
              {cardBackgrounds[project.id] && (
                <div
                  className="absolute inset-0 rounded-xl bg-cover bg-center bg-no-repeat opacity-50"
                  style={{ backgroundImage: `url(${cardBackgrounds[project.id]})` }}
                  aria-hidden
                />
              )}
              {/* 遮罩层保证文字可读 */}
              {cardBackgrounds[project.id] && (
                <div className={`absolute inset-0 rounded-xl pointer-events-none ${isDarkMode ? 'bg-black/30' : 'bg-black/20'}`} aria-hidden />
              )}

              {editingProject?.id === project.id ? (
                // 编辑模式（重命名）- 独立层、高 z-index，阻止冒泡
                <div
                  className={`absolute inset-0 z-20 flex flex-col p-6 space-y-4 rounded-xl ${
                    isDarkMode ? 'bg-black/80' : 'bg-white/95 shadow-lg'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmEdit();
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    className={`w-full px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-apple-blue cursor-text ${
                      isDarkMode
                        ? 'apple-panel text-white placeholder-white/40'
                        : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                    }`}
                    style={{ caretColor: isDarkMode ? 'white' : '#111827' }}
                    placeholder={pt.projectNamePlaceholder}
                    aria-label={pt.projectNamePlaceholder}
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end mt-auto">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleConfirmEdit();
                      }}
                      className={scratchPrimary('operators')}
                    >
                      {pt.confirm}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleCancelEdit();
                      }}
                      className={scratchSecondary('control')}
                    >
                      {pt.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                // 显示模式
                <div className="flex-1 flex flex-col items-center justify-center h-full relative z-10">
                  {/* 标题居中 */}
                  <h3 className={`text-4xl font-semibold text-center mb-6 ${cardText.title}`}>
                    {project.name}
                  </h3>
                  
                  {/* 日期信息 */}
                  <div className="space-y-1">
                    <p className={`${cardText.muted} text-base text-center`}>
                      {formatDate(project.date)}
                    </p>
                    <p className={`${cardText.muted} text-sm text-center`}>
                      {pt.modified} {formatTimestamp(project.lastModified)}
                    </p>
                  </div>
                  
                  {/* Hover 时显示：编辑、导出、删除 */}
                  <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 z-20">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(project);
                      }}
                      className={scratchIconBtn('motion')}
                      title={pt.editProjectTitle}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportProject(project.id, project.name);
                      }}
                      className={scratchIconBtn('looks')}
                      title={pt.exportTitle}
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClick(project);
                      }}
                      className={scratchDangerIcon()}
                      title={pt.deleteTitle}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
              )}
            </motion.div>
          );
          })}
        </div>
      </LayoutGroup>

      {/* 创建项目对话框 - 使用 Portal 避免焦点被阻断 */}
      {showCreateDialog &&
        createPortal(
          <div
            className={`fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[9999] ${
              isDarkMode ? 'bg-black/50' : 'bg-black/30'
            }`}
            onClick={(e) => e.target === e.currentTarget && setShowCreateDialog(false)}
          >
            <div
              className={`${cardPanelCls} rounded-xl p-6 w-96 relative z-10`}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className={`text-xl font-bold mb-4 ${titleTextCls}`}>{pt.newProjectHeading}</h3>
              <input
                ref={createInputRef}
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateProject();
                  if (e.key === 'Escape') setShowCreateDialog(false);
                }}
                placeholder={pt.placeholderNewProjectName}
                className={`w-full px-4 py-3 rounded-lg mb-4 cursor-text focus:outline-none focus:ring-2 focus:ring-apple-blue ${
                  isDarkMode
                    ? 'apple-panel text-white placeholder-white/40'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
                style={{ caretColor: isDarkMode ? 'white' : '#111827' }}
                autoComplete="off"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowCreateDialog(false)} className={scratchSecondary('control')}>
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim()}
                  className={scratchPrimary('operators')}
                >
                  创建
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 非阻塞提示 Toast */}
      {toastMessage &&
        createPortal(
          <div
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] px-4 py-3 rounded-lg text-sm max-w-md shadow-lg ${
              isDarkMode ? 'bg-white/10 backdrop-blur text-white' : 'bg-gray-900/90 text-white'
            }`}
          >
            {toastMessage}
          </div>,
          document.body
        )}

      {/* 右下角退出软件按钮 */}
      <button
        onClick={handleQuitApp}
        className={
          isDarkMode
            ? 'fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 hover:text-red-200 transition-colors flex items-center justify-center'
            : `fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full flex items-center justify-center scratch-float-btn ${scratchTintClass('myBlocks')}`
        }
        title={pt.quitAppTitle}
        aria-label={pt.quitAppAria}
      >
        <Power className="w-5 h-5" />
      </button>
    </div>
    </>
  );
};

export default Projects;
