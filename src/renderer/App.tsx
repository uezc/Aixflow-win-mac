import React, { useState, useEffect, useCallback } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import Settings from './components/Settings';
import ActivationView from './components/ActivationView';
import Projects from './components/Projects';
import Workspace from './components/Workspace';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NxModelPricingProvider, NX_SAAS_PRICING_REFRESH } from './contexts/NxModelPricingContext';
import AdminRouteGate, { ADMIN_OPS_SESSION_KEY } from './components/Admin/AdminRouteGate';
import AdminConsoleLayout from './components/Admin/AdminConsoleLayout';
import AdminDashboardHome from './components/Admin/AdminDashboardHome';
import AdminTasksPage from './components/Admin/AdminTasksPage';
import AdminModelsPage from './components/Admin/AdminModelsPage';
import AdminUsersPage from './components/Admin/AdminUsersPage';
import AdminFinancePage from './components/Admin/AdminFinancePage';
import RechargeSettledNotifier from './components/RechargeSettledNotifier';
import { NxSaasAuthPromptBridge } from './components/NxSaasAuthPromptBridge';
import { AgreementConfirmModal } from './components/legal/AgreementConfirmModal';
import { isAgreementConfirmed } from './legal/agreementStorage';
import TechCursor from './components/TechCursor';

/** 鐗囧ご鍚庣殑璐︽埛椤电偣鍑汇€岃繘鍏ャ€嶅悗鎵嶅厑璁歌闂」鐩垪琛?/ 鐢诲竷锛堜笌鏄惁宸茬櫥褰曘€丯X_SAAS_MODE 鏃犲叧锛?*/
const NX_SAAS_GATE_KEY = 'nexflow_saas_gate_ok';
const NEXFLOW_SPLASH_SEEN_KEY = 'nexflow_splash_seen';
const NEXFLOW_POST_RELOAD_ROUTE_KEY = 'nexflow_post_reload_route';

/** 鏈湪璐︽埛椤电偣銆岃繘鍏ャ€嶆椂鎷︽埅 /projects銆?workspace锛岀粺涓€鍥炲埌璐︽埛椤?*/
const SaasRouteGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!window.electronAPI?.getNxSaasState) {
          if (!cancelled) setReady(true);
          return;
        }
        if (sessionStorage.getItem(NX_SAAS_GATE_KEY) === '1') {
          if (!cancelled) setReady(true);
          return;
        }
        navigate('/settings', { replace: true });
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-apple-blue border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }
  return <>{children}</>;
};

const App: React.FC = () => {
  const [cloudBalance, setCloudBalance] = useState<number | null>(null);
  const [cloudStatus, setCloudStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle');
  /** 鐢ㄤ簬璐︽埛椤碉細鏈櫥褰曟椂涓嶆樉绀洪《鏍忋€屼簯绔厓瀹濄€嶄笌杩斿洖鎸夐挳 */
  const [cloudLoggedIn, setCloudLoggedIn] = useState(false);
  const [isElectronReady, setIsElectronReady] = useState(false);
  const [isActivated, setIsActivated] = useState(false);
  const [activationStatus, setActivationStatus] = useState<string>('NOT_ACTIVATED');
  const [checkingActivation, setCheckingActivation] = useState(true);
  /** 婵€娲诲悗鍏堟樉绀虹墖澶达紝鐗囧ご缁撴潫鍚庡啀寤惰繜 300ms 杩涗富鐣岄潰 */
  const [showSplash, setShowSplash] = useState(false);
  const [showMainUI, setShowMainUI] = useState(false);

  /** 产品要求：每次启动都需手动登录，进入应用后主动清空上次云端会话 */
  useEffect(() => {
    if (!isElectronReady || !window.electronAPI?.nxCloudLogout) return;
    void window.electronAPI.nxCloudLogout().catch(() => {});
  }, [isElectronReady]);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      root.dataset.nexflowWindowHidden = document.visibilityState === 'hidden' ? 'true' : 'false';
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      delete root.dataset.nexflowWindowHidden;
    };
  }, []);

  // 检查 electronAPI 是否可用和激活状态（延迟首帧发 IPC，避免与 Chromium WidgetHost 时序冲突）
  useEffect(() => {
    let mounted = true;
    const checkElectronAPI = async () => {
      if (typeof window === 'undefined' || !window.electronAPI) return false;
      if (!mounted) return true;
      setIsElectronReady(true);
      try {
        const status = await window.electronAPI.checkActivation();
        if (mounted) {
          const s = status?.status ?? 'NOT_ACTIVATED';
          setActivationStatus(s);
          // 已关闭激活流程 / 已激活 / 过期（仍可进项目列表）均可进入；勿因 IPC 抖动误弹激活页
          const ok =
            status?.skipped === true ||
            status?.activated === true ||
            s === 'VALID' ||
            s === 'EXPIRED';
          setIsActivated(ok);
        }
      } catch (error) {
        console.error('[App] checkActivation failed:', error);
        // 开发态或重建主进程中 IPC 失败时，勿误显示已取消的激活页
        if (mounted) {
          const skipByEnv =
            import.meta.env.DEV ||
            String((import.meta as { env?: { VITE_SKIP_ACTIVATION?: string } }).env?.VITE_SKIP_ACTIVATION || '') ===
              '1';
          setIsActivated(skipByEnv);
          if (skipByEnv) setActivationStatus('VALID');
        }
      } finally {
        if (mounted) setCheckingActivation(false);
      }
      return true;
    };

    const retryTimerRef = { current: 0 as any };
    const tryOnce = () => {
      if (!mounted) return;
      if (typeof window !== 'undefined' && window.electronAPI) {
        checkElectronAPI();
        return;
      }
      retryTimerRef.current = window.setTimeout(tryOnce, 100);
    };
    // 延后首帧再发起 IPC，减少 "Message rejected by blink.mojom.WidgetHost" 以及渲染进程崩溃
    const startTimer = window.setTimeout(() => {
      if (!mounted) return;
      tryOnce();
    }, 200);

    // 若 5 秒后仍未就绪则停止 loading，避免一直卡在“正在检查激活状态”
    const fallbackTimer = window.setTimeout(() => {
      if (!mounted) return;
      if (window.electronAPI) return;
      clearTimeout(retryTimerRef.current);
      setCheckingActivation(false);
      setIsElectronReady(false);
      // 开发环境无 preload 时也不要弹激活页（激活步骤已默认关闭）
      setIsActivated(!!import.meta.env.DEV);
      if (import.meta.env.DEV) setActivationStatus('VALID');
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(startTimer);
      clearTimeout(retryTimerRef.current);
      clearTimeout(fallbackTimer);
    };
  }, []);

  /** 应用内更新：主进程退出安装前触发画布落盘 */
  useEffect(() => {
    if (!window.electronAPI?.onPrepareForUpdate) return;
    return window.electronAPI.onPrepareForUpdate(async () => {
      const w = window as Window & { __nexflowFlushBeforeUpdate?: () => Promise<void> };
      if (typeof w.__nexflowFlushBeforeUpdate === 'function') {
        await w.__nexflowFlushBeforeUpdate();
      }
    });
  }, []);

  /** Hash 鍚?#/admin 鏃剁洿鎺ヨ繘鍏ヤ富璺敱鍖哄煙锛岄伩鍏嶆湭璧板畬鐗囧ご/鍔犺浇闂ㄩ椄鏃舵棤娉曟墦寮€杩愯惀鎺у埗鍙?*/
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const apply = () => {
      try {
        if (/\/admin/i.test(window.location.hash || '')) {
          setShowMainUI(true);
          setShowSplash(false);
        }
      } catch {
        /* ignore */
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  useEffect(() => {
    if (!isElectronReady || !window.electronAPI) return;

    const load = async () => {
      try {
        let saasLoggedIn = false;
        if (window.electronAPI.getNxSaasState) {
          const pre = await window.electronAPI.getNxSaasState();
          if (pre.enabled && !pre.loggedIn) {
            setCloudStatus('idle');
            setCloudBalance(null);
            setCloudLoggedIn(false);
            return;
          }
          saasLoggedIn = pre.loggedIn === true;
        }
        setCloudStatus('connecting');
        const state = window.electronAPI.nxCloudGetProfile
          ? await window.electronAPI.nxCloudGetProfile()
          : await window.electronAPI.initLafUser();
        setCloudStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
        // 已登录时 /me 失败仍保留 store 余额，避免顶栏与设置页出现“已登录+余额空”矛盾
        if (saasLoggedIn && typeof state.balance === 'number') {
          setCloudBalance(state.balance);
        } else {
          setCloudBalance(state.status === 'success' ? state.balance : null);
        }
        if (window.electronAPI.getNxSaasState) {
          const p = await window.electronAPI.getNxSaasState();
          setCloudLoggedIn(p.loggedIn === true);
        } else {
          setCloudLoggedIn(state.status === 'success');
        }
      } catch {
        setCloudStatus('error');
        setCloudBalance(null);
        setCloudLoggedIn(false);
      }
    };
    void load();

    if (!window.electronAPI.onLafBalanceUpdated) return;

    const unsub = window.electronAPI.onLafBalanceUpdated((state) => {
      void (async () => {
        try {
          if (window.electronAPI.getNxSaasState) {
            const pre = await window.electronAPI.getNxSaasState();
            if (!pre.loggedIn) {
              setCloudStatus('idle');
              setCloudBalance(null);
              setCloudLoggedIn(false);
              return;
            }
            setCloudLoggedIn(true);
            setCloudStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
            setCloudBalance(typeof state.balance === 'number' ? state.balance : null);
            return;
          }
          setCloudStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
          setCloudBalance(state.status === 'success' ? state.balance : null);
          setCloudLoggedIn(state.status === 'success');
        } catch {
          setCloudStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
          setCloudBalance(state.status === 'success' ? state.balance : null);
          setCloudLoggedIn(state.status === 'success');
        }
      })();
    });
    return unsub;
  }, [isElectronReady]);

  // 涓荤晫闈細Hash 璺敱鍒囨崲鏃舵媺鍙?/me锛岄伩鍏嶃€岄」鐩垪琛ㄣ€嶉《鏍忓厓瀹濅笌鐢诲竷/璁剧疆涓嶅悓姝ワ紱瀹氭椂杞涓庣敾甯冮€昏緫瀵归綈
  useEffect(() => {
    if (!isElectronReady || !showMainUI || !window.electronAPI?.nxCloudGetProfile || !window.electronAPI?.getNxSaasState) {
      return;
    }

    const pull = async () => {
      try {
        const pre = await window.electronAPI.getNxSaasState();
        if (!pre.loggedIn) {
          setCloudBalance(null);
          setCloudStatus('idle');
          setCloudLoggedIn(false);
          return;
        }
        setCloudLoggedIn(true);
        const state = await window.electronAPI.nxCloudGetProfile();
        setCloudStatus(state.status as 'idle' | 'connecting' | 'success' | 'error');
        setCloudBalance(typeof state.balance === 'number' ? state.balance : null);
      } catch {
        /* ignore */
      }
    };

    const onHash = () => {
      void pull();
    };
    window.addEventListener('hashchange', onHash);
    void pull();

    const interval = window.setInterval(() => {
      void pull();
    }, 60_000);

    return () => {
      window.removeEventListener('hashchange', onHash);
      window.clearInterval(interval);
    };
  }, [isElectronReady, showMainUI]);

  // F11 切换全屏/窗口模式（覆盖浏览器默认行为）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'F11') return;
      e.preventDefault();
      e.stopPropagation();
      if (window.electronAPI?.toggleFullscreen) {
        window.electronAPI.toggleFullscreen().catch((err) => {
          console.error('鍒囨崲鍏ㄥ睆澶辫触:', err);
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 激活后直接进主界面（账户页），跳过片头动画以节省启动与安装体积占用
  useEffect(() => {
    if (!isActivated) {
      setShowSplash(false);
      setShowMainUI(false);
      return;
    }
    setShowSplash(false);
    setShowMainUI(true);
    try {
      sessionStorage.setItem(NEXFLOW_SPLASH_SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
  }, [isActivated]);

  // 濡傛灉姝ｅ湪妫€鏌ユ縺娲荤姸鎬侊紝鏄剧ず鍔犺浇
  if (checkingActivation) {
    return (
      <ErrorBoundary>
        <TechCursor />
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-apple-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/60">姝ｅ湪妫€鏌ユ縺娲荤姸鎬?..</p>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  // 涓荤晫闈細甯﹁矾鐢憋紙/admin 鏃犻渶婵€娲诲嵆鍙闂級
  return (
    <ErrorBoundary>
      <TechCursor />
      <HashRouter>
        <AppRouter
          isActivated={isActivated}
          activationStatus={activationStatus}
          setActivationStatus={setActivationStatus}
          setIsActivated={setIsActivated}
          isElectronReady={isElectronReady}
          showSplash={showSplash}
          setShowSplash={setShowSplash}
          showMainUI={showMainUI}
          setShowMainUI={setShowMainUI}
          cloudBalance={cloudBalance}
          cloudStatus={cloudStatus}
          cloudLoggedIn={cloudLoggedIn}
        />
      </HashRouter>
    </ErrorBoundary>
  );
};

/** 鏍规嵁璺敱涓庢縺娲荤姸鎬佹覆鏌擄細鏈縺娲绘樉绀烘縺娲婚〉锛屽凡婵€娲诲厛鐗囧ご鍐嶄富搴旂敤 */
const AppRouter: React.FC<{
  isActivated: boolean;
  activationStatus: string;
  setActivationStatus: (v: string) => void;
  setIsActivated: (v: boolean) => void;
  isElectronReady: boolean;
  showSplash: boolean;
  setShowSplash: (v: boolean) => void;
  showMainUI: boolean;
  setShowMainUI: (v: boolean) => void;
  cloudBalance: number | null;
  cloudStatus: 'idle' | 'connecting' | 'success' | 'error';
  cloudLoggedIn: boolean;
}> = ({
  isActivated,
  activationStatus,
  setActivationStatus,
  setIsActivated,
  isElectronReady,
  showSplash,
  setShowSplash,
  showMainUI,
  setShowMainUI,
  cloudBalance,
  cloudStatus,
  cloudLoggedIn,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const adminBypass =
    location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const [adminUnlockBump, setAdminUnlockBump] = useState(0);
  /** 首次进入：协议确认（localStorage，不落库） */
  const [agreementOk, setAgreementOk] = useState(() => isAgreementConfirmed());

  /** reload 后恢复跳转目标（如画布返回项目列表） */
  useEffect(() => {
    if (!showMainUI) return;
    try {
      const pending = sessionStorage.getItem(NEXFLOW_POST_RELOAD_ROUTE_KEY);
      if (!pending) return;
      sessionStorage.removeItem(NEXFLOW_POST_RELOAD_ROUTE_KEY);
      navigate(pending, { replace: true });
    } catch {
      /* ignore */
    }
  }, [showMainUI, navigate]);

  useEffect(() => {
    if (!showMainUI || !window.electronAPI?.setFullscreen) return;
    const path = location.pathname || '';
    const windowed = path === '/settings' || path.startsWith('/settings/');

    if (windowed) {
      void window.electronAPI.setFullscreen(false);
      return;
    }

    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!cancelled) void window.electronAPI?.setFullscreen?.(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [showMainUI, location.pathname]);

  useEffect(() => {
    if (!showMainUI || typeof window === 'undefined' || !window.electronAPI?.getNxSaasState) return;
    let cancelled = false;
    void (async () => {
      try {
        if (window.electronAPI.nxCloudGetProfile) {
          const pre = await window.electronAPI.getNxSaasState();
          if (pre.enabled && pre.loggedIn) {
            await window.electronAPI.nxCloudGetProfile();
          }
        }
        // 片头后固定进入账户页登录，不再自动弹覆盖层登录框（避免与设置页表单重复）
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showMainUI]);

  /** 杩涘叆涓荤晫闈㈠悗鍐嶈Е鍙戜竴娆″畾浠峰悓姝ワ紙姝ゆ椂 NxModelPricingProvider 宸叉寕杞斤紝涓?JWT 鎭㈠鏃跺簭瀵归綈锛?*/
  useEffect(() => {
    if (!showMainUI) return;
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event(NX_SAAS_PRICING_REFRESH));
    }, 1200);
    return () => window.clearTimeout(t);
  }, [showMainUI]);

  /** 单实例：双击 .aixflow 或二次启动时由主进程导入并跳转画布 */
  useEffect(() => {
    if (!isElectronReady || !window.electronAPI?.onProjectImportedFromFile) return;
    return window.electronAPI.onProjectImportedFromFile(({ project, cardBackground }) => {
      if (!project?.id) return;
      if (cardBackground) {
        try {
          localStorage.setItem(`nexflow-project-card-bg-${project.id}`, cardBackground);
        } catch {
          /* ignore */
        }
      }
      const target = `/workspace/${project.id}`;
      try {
        sessionStorage.setItem(NX_SAAS_GATE_KEY, '1');
        if (!showMainUI) {
          sessionStorage.setItem(NEXFLOW_POST_RELOAD_ROUTE_KEY, target);
          return;
        }
      } catch {
        /* ignore */
      }
      navigate(target, { replace: true });
    });
  }, [isElectronReady, showMainUI, navigate]);

  /** 杩愯惀鎺у埗鍙拌В閿侊細Ctrl/Cmd + Shift + A */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        try {
          sessionStorage.setItem(ADMIN_OPS_SESSION_KEY, '1');
        } catch {
          /* ignore */
        }
        setAdminUnlockBump((n) => n + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!isActivated && !adminBypass) {
    return (
      <ActivationView
        activationStatus={activationStatus}
        onActivated={() => {
          setIsActivated(true);
          setActivationStatus('VALID');
        }}
      />
    );
  }

  // 片头已关闭：激活后直接主界面（账户页需登录并点「进入」）
  if (!showMainUI && !adminBypass) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-apple-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60 tracking-wide">loading......</p>
        </div>
      </div>
    );
  }

  return (
    <NxModelPricingProvider>
    <>
    <Routes>
        <Route path="/admin" element={<AdminRouteGate unlockBump={adminUnlockBump} />}>
          <Route element={<AdminConsoleLayout />}>
            <Route index element={<AdminDashboardHome />} />
            <Route path="tasks" element={<AdminTasksPage />} />
            <Route path="models" element={<AdminModelsPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="finance" element={<AdminFinancePage />} />
          </Route>
        </Route>
        <Route
          path="/workspace/:projectId"
          element={
            <SaasRouteGate>
              {activationStatus === 'EXPIRED' ? (
                <ActivationView
                  activationStatus="EXPIRED"
                  onActivated={() => {
                    setActivationStatus('VALID');
                    setIsActivated(true);
                  }}
                  onBack={() => navigate('/projects')}
                />
              ) : (
                <ErrorBoundary>
                  <Workspace />
                </ErrorBoundary>
              )}
            </SaasRouteGate>
          }
        />
      <Route path="/" element={<DefaultHomeRedirect />} />
      <Route
        path="/settings"
        element={
          <div className="min-h-screen bg-black">
            <SettingsWithNavigate />
          </div>
        }
      />
      <Route
        path="/projects"
        element={
          <SaasRouteGate>
            <ProjectsWithNavigate />
          </SaasRouteGate>
        }
      />
    </Routes>
    {showMainUI ? (
      <>
        <AgreementConfirmModal
          open={!agreementOk}
          onConfirmed={() => setAgreementOk(true)}
        />
        <NxSaasAuthPromptBridge />
        <RechargeSettledNotifier />
      </>
    ) : null}
    </>
    </NxModelPricingProvider>
  );
};

// Settings 组件包装器（用于导航）
const SettingsWithNavigate: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Settings
      onSaveSuccess={() => {
        try {
          sessionStorage.setItem(NX_SAAS_GATE_KEY, '1');
        } catch {
          /* ignore */
        }
        // 先离开 settings（卸载背景视频），再由路由 effect 延迟切全屏，避免点击进入瞬间视频比例跳动
        navigate('/projects', { replace: true });
      }}
    />
  );
};

/** 棣栭〉锛氬凡鍦ㄨ处鎴烽〉鐐硅繃銆岃繘鍏ャ€嶁啋 椤圭洰鍒楄〃锛屽惁鍒?鈫?璐︽埛椤碉紙涓?SaaS 寮€鍏虫棤鍏筹級 */
const DefaultHomeRedirect: React.FC = () => {
  const [to, setTo] = useState<'settings' | 'projects' | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!window.electronAPI?.getNxSaasState) {
          if (!cancelled) setTo('projects');
          return;
        }
        if (cancelled) return;
        if (sessionStorage.getItem(NX_SAAS_GATE_KEY) === '1') {
          setTo('projects');
        } else {
          setTo('settings');
        }
      } catch {
        if (!cancelled) setTo('projects');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  if (!to) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-apple-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return <Navigate to={to === 'settings' ? '/settings' : '/projects'} replace />;
};

// Projects 组件包装器（用于导航）
const ProjectsWithNavigate: React.FC = () => {
  const navigate = useNavigate();
  return <Projects onOpenCloudAccount={() => navigate('/settings')} />;
};

export default App;
