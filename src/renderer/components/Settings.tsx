// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowRight,
  Download,
  RefreshCw,
  Mail,
  Lock,
  LogIn,
  UserPlus,
  LogOut,
  CheckCircle2,
  Receipt,
  Ticket,
  ChevronDown,
  Globe,
  Check,
  KeyRound,
  Eye,
  EyeOff,
  Coins,
  FileText,
  Shield,
  Sparkles,
} from 'lucide-react';
import EcommerceLoginShell from './auth/EcommerceLoginShell';
import WeChatGroupEntry from './auth/WeChatGroupEntry';
import SettingsFullscreenToggle from './SettingsFullscreenToggle';
import AppUpdatePanel from './AppUpdatePanel';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { loginPageT } from '../i18n/loginPageI18n';
import { formatCloudAuthError } from '../utils/cloudAuthError';
import { NX_SAAS_PRICING_REFRESH, useNxModelPricing } from '../contexts/NxModelPricingContext';
import { clearNxModelConfigPersisted } from '../utils/nxModelConfigPricingCache';
import {
  APP_LOCALE_OPTIONS,
  appLocaleNativeLabel,
  getStoredSettingsLocale,
  settingsT,
} from '../i18n/settingsI18n';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { DarkAlertModal } from './DarkAlertModal';
import RechargeModal from './RechargeModal';
import { LegalDocModal } from './legal/LegalDocModal';
import { legalUiT } from '../legal/legalI18n';
import type { LegalDocId } from '../legal/legalDocs';
import BillListModal from './BillListModal';
import { NEXFLOW_RECHARGE_SETTLED_EVENT } from './RechargeSettledNotifier';
import type { RechargePackageId } from '../shared/rechargePackages';

interface SettingsProps {
  onSaveSuccess?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onSaveSuccess }) => {
  const { locale, setLocale } = useAppLocale();
  const { syncCloudPricing } = useNxModelPricing();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);
  /** 登录区：邮箱 + 密码 */
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /** 注册弹窗：邮箱验证码 */
  const [registerAuthCode, setRegisterAuthCode] = useState('');
  const [regSendCodeSec, setRegSendCodeSec] = useState(0);
  const [regSendCodeBusy, setRegSendCodeBusy] = useState(false);
  /** 未与表单交互前锁定输入，减轻浏览器自动填充在「未输完」时触发登录的问题 */
  const [loginFieldsUnlocked, setLoginFieldsUnlocked] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  /** 正在提交登录 */
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState('');
  const [loginSuccessModalOpen, setLoginSuccessModalOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  /** 注册专用弹窗 */
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [regEmail, setRegEmail] = useState('');
  /** 注册弹窗：密码、确认密码（与登录区 password 分离，避免状态串用） */
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [regError, setRegError] = useState('');
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerSuccessVisible, setRegisterSuccessVisible] = useState(false);
  /** 未登录：忘记密码弹窗 */
  const [forgotPwdModalOpen, setForgotPwdModalOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState('');
  const [fpCode, setFpCode] = useState('');
  const [fpNewPwd, setFpNewPwd] = useState('');
  const [fpConfirmPwd, setFpConfirmPwd] = useState('');
  const [fpError, setFpError] = useState('');
  const [fpSubmitting, setFpSubmitting] = useState(false);
  const [fpSendCodeSec, setFpSendCodeSec] = useState(0);
  const [fpSendCodeBusy, setFpSendCodeBusy] = useState(false);
  const [forgotPwdSuccessVisible, setForgotPwdSuccessVisible] = useState(false);
  /** 已登录：修改密码（邮箱验证码） */
  const [changePasswordExpanded, setChangePasswordExpanded] = useState(false);
  const [cpCode, setCpCode] = useState('');
  const [cpNewPwd, setCpNewPwd] = useState('');
  const [cpConfirmPwd, setCpConfirmPwd] = useState('');
  const [cpSendSec, setCpSendSec] = useState(0);
  const [cpSendBusy, setCpSendBusy] = useState(false);
  const [cpSubmitting, setCpSubmitting] = useState(false);
  const [cpError, setCpError] = useState('');
  const [changePwdSuccessOpen, setChangePwdSuccessOpen] = useState(false);
  const [cloud, setCloud] = useState<{
    loggedIn: boolean;
    email: string | null;
    /** 与主进程 nxLastLoginEmail 一致，用于未同步到 nxEmail 时展示、登出后预填邮箱 */
    lastLoginEmail: string | null;
    balance: number;
    isFirstRecharge: boolean;
    /** 是否允许设置页「充值档位」直连 FC /recharge（需 .env NX_ENABLE_DIRECT_RECHARGE=1） */
    directRechargeEnabled: boolean;
  } | null>(null);
  const [rechargeBusyPackageId, setRechargeBusyPackageId] = useState<RechargePackageId | null>(null);
  const [rechargeError, setRechargeError] = useState('');
  const [rechargeModalOpen, setRechargeModalOpen] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState('');
  const appUpdate = useAppUpdate();
  const [txList, setTxList] = useState<
    Array<{
      tx_id: string;
      task_id?: string;
      amount?: string | number;
      type?: string;
      provider?: string;
      description?: string;
      created_at?: string;
      balance_after?: string | number;
    }>
  >([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState('');
  /** 账单大窗 */
  const [billModalOpen, setBillModalOpen] = useState(false);
  /** 协议阅读弹窗（本地 md，不落库） */
  const [legalDocId, setLegalDocId] = useState<LegalDocId | null>(null);
  const t = settingsT(locale);
  const loginT = loginPageT(locale);
  const legalT = legalUiT(locale);

  const loadTransactions = useCallback(async () => {
    if (!window.electronAPI?.nxCloudGetTransactions) return;
    const tt = settingsT(locale);
    setTxLoading(true);
    setTxError('');
    try {
      const { items } = await window.electronAPI.nxCloudGetTransactions(30);
      const rows = Array.isArray(items) ? items : [];
      setTxList(
        rows
          .filter((row) => {
            const txId = String(row.tx_id ?? '');
            const type = String(row.type ?? '').toLowerCase();
            return type !== 'alipay_trade_ref' && !txId.startsWith('alipay_trade_');
          })
          .slice(0, 30),
      );
    } catch (e: unknown) {
      setTxError(e instanceof Error ? e.message : tt.loadTxFailed);
      setTxList([]);
    } finally {
      setTxLoading(false);
    }
  }, [locale]);

  const loggedOutCloudDefaults = useCallback(
    () => ({
      loggedIn: false as const,
      email: null as string | null,
      lastLoginEmail: null as string | null,
      balance: 0,
      isFirstRecharge: false,
      directRechargeEnabled: false,
    }),
    [],
  );

  /** 只读主进程 store（getNxSaasState），不额外打 /me：登录/注册已写入 token 与余额，避免登录后再等一轮慢请求 */
  const refreshCloudState = useCallback(async () => {
    if (!window.electronAPI?.getNxSaasState) {
      setCloud(loggedOutCloudDefaults());
      return;
    }
    try {
      const s = await window.electronAPI.getNxSaasState();
      const lastEm =
        typeof s.lastLoginEmail === 'string' && s.lastLoginEmail.trim()
          ? s.lastLoginEmail.trim().toLowerCase()
          : null;
      setCloud({
        loggedIn: s.loggedIn,
        email: s.email,
        lastLoginEmail: lastEm,
        balance: typeof s.balance === 'number' ? s.balance : 0,
        isFirstRecharge: s.isFirstRecharge === true,
        directRechargeEnabled: s.directRechargeEnabled === true,
      });
    } catch {
      setCloud(loggedOutCloudDefaults());
    }
  }, [loggedOutCloudDefaults]);

  /** 入账成功：刷新余额与账单，关闭充值弹窗（成功提示由全局 RechargeSettledNotifier 负责） */
  useEffect(() => {
    const onSettled = () => {
      void refreshCloudState();
      void loadTransactions();
      setRechargeModalOpen(false);
      setRechargeError('');
    };
    window.addEventListener(NEXFLOW_RECHARGE_SETTLED_EVENT, onSettled);
    return () => window.removeEventListener(NEXFLOW_RECHARGE_SETTLED_EVENT, onSettled);
  }, [refreshCloudState, loadTransactions]);

  /** 进入账户设置页且已登录时自动同步画布预估价（无需用户手动刷新） */
  useEffect(() => {
    if (!cloud?.loggedIn) return;
    void syncCloudPricing({ force: false });
  }, [cloud?.loggedIn, syncCloudPricing]);

  /** 账户/登录页：隐藏视口右侧滚动条，离开本页时恢复 */
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add('nexflow-settings-page');
    body.classList.add('nexflow-settings-page');
    return () => {
      html.classList.remove('nexflow-settings-page');
      body.classList.remove('nexflow-settings-page');
    };
  }, []);

  useEffect(() => {
    if (!langMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const el = langMenuRef.current;
      if (el && !el.contains(e.target as Node)) setLangMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLangMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [langMenuOpen]);



  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 20;

    const load = async () => {
      if (typeof window === 'undefined' || !window.electronAPI) {
        retryCount++;
        if (retryCount >= maxRetries) return;
        setTimeout(load, 500);
        return;
      }
      await refreshCloudState();
    };

    load();
  }, [refreshCloudState]);


  useEffect(() => {
    if (!window.electronAPI?.onLafBalanceUpdated) return;
    const unsub = window.electronAPI.onLafBalanceUpdated(() => {
      void refreshCloudState();
    });
    return unsub;
  }, [refreshCloudState]);

  /** 登出后重新锁定输入，避免再次自动填充 */
  useEffect(() => {
    if (!cloud?.loggedIn) setLoginFieldsUnlocked(false);
  }, [cloud?.loggedIn]);

  /** 进入登录界面或登出后：预填上次成功登录的邮箱（不覆盖用户已输入内容） */
  useEffect(() => {
    if (!cloud || cloud.loggedIn) return;
    const hint = cloud.lastLoginEmail?.trim();
    if (!hint) return;
    setEmail((prev) => (prev.trim() ? prev : hint));
  }, [cloud?.loggedIn, cloud?.lastLoginEmail]);

  useEffect(() => {
    if (cloud?.loggedIn && window.electronAPI?.nxCloudGetTransactions) {
      void loadTransactions();
    } else {
      setTxList([]);
    }
  }, [cloud?.loggedIn, loadTransactions]);

  useEffect(() => {
    if (regSendCodeSec <= 0) return;
    const id = window.setInterval(() => {
      setRegSendCodeSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [regSendCodeSec]);

  useEffect(() => {
    if (cpSendSec <= 0) return;
    const id = window.setInterval(() => {
      setCpSendSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cpSendSec]);

  useEffect(() => {
    if (fpSendCodeSec <= 0) return;
    const id = window.setInterval(() => {
      setFpSendCodeSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [fpSendCodeSec]);

  const handleRegisterSendCode = async () => {
    if (!window.electronAPI?.nxCloudSendAuthCode) {
      setRegError(t.cloudLoginNotSupported);
      return;
    }
    if (!regEmail.trim()) {
      setRegError(t.registerSendCodeNeedEmail);
      return;
    }
    setRegError('');
    setRegSendCodeBusy(true);
    try {
      await window.electronAPI.nxCloudSendAuthCode(regEmail.trim());
      setRegSendCodeSec(60);
    } catch (e: unknown) {
      setRegError(formatCloudAuthError(e, locale));
    } finally {
      setRegSendCodeBusy(false);
    }
  };

  const submitLogin = async () => {
    if (!window.electronAPI?.nxCloudLogin) {
      setAuthError(t.cloudLoginNotSupported);
      return;
    }
    const pwd = typeof password === 'string' ? password : '';
    if (!email.trim() || !pwd) {
      setAuthError(t.enterEmailPassword);
      return;
    }

    setAuthPending(true);
    setAuthError('');

    try {
      await window.electronAPI.nxCloudLogin(email.trim(), pwd);
      await refreshCloudState();
      setPassword('');
      setLoginSuccessModalOpen(true);
      clearNxModelConfigPersisted();
      window.setTimeout(() => {
        window.dispatchEvent(new Event(NX_SAAS_PRICING_REFRESH));
      }, 0);
      // 不自动进入项目列表：须在设置页点击「进入」
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      const otpOnly =
        /USE_OTP/i.test(raw) ||
        /请使用.*验证码登录/.test(raw) ||
        /Please sign in with the email verification code/i.test(raw);
      setAuthError(otpOnly ? t.useOtpLoginHint : formatCloudAuthError(e, locale));
    } finally {
      setAuthPending(false);
    }
  };

  const openRegisterModal = () => {
    setRegEmail(email.trim());
    setRegisterPassword('');
    setRegisterConfirmPassword('');
    setRegisterAuthCode('');
    setRegSendCodeSec(0);
    setRegError('');
    setRegisterModalOpen(true);
  };

  const closeRegisterModal = () => {
    if (registerSubmitting) return;
    setRegisterModalOpen(false);
    setRegError('');
  };

  const submitRegisterModal = async () => {
    if (!window.electronAPI?.nxCloudRegister) {
      setRegError(t.registerNotSupported);
      return;
    }
    const regPwd = typeof registerPassword === 'string' ? registerPassword : '';
    const confirmPwd = typeof registerConfirmPassword === 'string' ? registerConfirmPassword : '';
    const codeRaw = typeof registerAuthCode === 'string' ? registerAuthCode : '';

    if (!regEmail.trim() || !regPwd) {
      setRegError(t.fillEmailPassword);
      return;
    }
    if (regPwd !== confirmPwd) {
      setRegError(t.passwordMismatch);
      return;
    }
    if (!codeRaw.trim()) {
      setRegError(t.registerFillCode);
      return;
    }
    if (!/^\d{6}$/.test(codeRaw.trim())) {
      setRegError(t.registerFillCode);
      return;
    }

    setRegisterSubmitting(true);
    setRegError('');

    try {
      await window.electronAPI.nxCloudRegister(regEmail.trim(), regPwd, codeRaw.trim());
      await refreshCloudState();
      setEmail(regEmail.trim());
      setPassword('');
      setRegisterModalOpen(false);
      setRegisterPassword('');
      setRegisterConfirmPassword('');
      setRegisterAuthCode('');
      setRegSendCodeSec(0);
      clearNxModelConfigPersisted();
      setRegisterSuccessVisible(true);
      window.setTimeout(() => {
        window.dispatchEvent(new Event(NX_SAAS_PRICING_REFRESH));
      }, 0);
    } catch (e: unknown) {
      setRegError(formatCloudAuthError(e, locale));
    } finally {
      setRegisterSubmitting(false);
    }
  };

  const dismissRegisterSuccess = () => {
    setRegisterSuccessVisible(false);
  };

  const openForgotPasswordModal = () => {
    setFpEmail(email.trim());
    setFpCode('');
    setFpNewPwd('');
    setFpConfirmPwd('');
    setFpSendCodeSec(0);
    setFpError('');
    setForgotPwdModalOpen(true);
  };

  const closeForgotPasswordModal = () => {
    if (fpSubmitting) return;
    setForgotPwdModalOpen(false);
    setFpError('');
  };

  const handleFpSendCode = async () => {
    if (!window.electronAPI?.nxCloudSendAuthCode) {
      setFpError(t.cloudLoginNotSupported);
      return;
    }
    if (!fpEmail.trim()) {
      setFpError(t.registerSendCodeNeedEmail);
      return;
    }
    setFpError('');
    setFpSendCodeBusy(true);
    try {
      await window.electronAPI.nxCloudSendAuthCode(fpEmail.trim(), 'change_password');
      setFpSendCodeSec(60);
    } catch (e: unknown) {
      setFpError(formatCloudAuthError(e, locale));
    } finally {
      setFpSendCodeBusy(false);
    }
  };

  const submitForgotPasswordModal = async () => {
    if (!window.electronAPI?.nxCloudChangePassword) {
      setFpError(t.forgotPasswordNotSupported);
      return;
    }
    const em = fpEmail.trim();
    const codeRaw = fpCode.trim().replace(/\s/g, '');
    const np = typeof fpNewPwd === 'string' ? fpNewPwd : '';
    const cpw = typeof fpConfirmPwd === 'string' ? fpConfirmPwd : '';
    if (!em) {
      setFpError(t.registerSendCodeNeedEmail);
      return;
    }
    if (!/^\d{6}$/.test(codeRaw)) {
      setFpError(t.registerFillCode);
      return;
    }
    if (!np) {
      setFpError(t.fillEmailPassword);
      return;
    }
    if (np.length < 6) {
      setFpError(t.changePasswordTooShort);
      return;
    }
    if (np !== cpw) {
      setFpError(t.passwordMismatch);
      return;
    }
    setFpSubmitting(true);
    setFpError('');
    try {
      await window.electronAPI.nxCloudChangePassword(em, codeRaw, np);
      setForgotPwdModalOpen(false);
      setFpCode('');
      setFpNewPwd('');
      setFpConfirmPwd('');
      setFpSendCodeSec(0);
      setForgotPwdSuccessVisible(true);
    } catch (e: unknown) {
      setFpError(formatCloudAuthError(e, locale));
    } finally {
      setFpSubmitting(false);
    }
  };

  const dismissForgotPwdSuccess = () => {
    setForgotPwdSuccessVisible(false);
  };

  const handleChangePwdSendCode = async () => {
    if (!window.electronAPI?.nxCloudSendAuthCode) {
      setCpError(t.changePasswordNotSupported);
      return;
    }
    const em = (cloud?.email?.trim() || cloud?.lastLoginEmail?.trim() || '').trim();
    if (!em) {
      setCpError(t.registerSendCodeNeedEmail);
      return;
    }
    setCpError('');
    setCpSendBusy(true);
    try {
      await window.electronAPI.nxCloudSendAuthCode(em, 'change_password');
      setCpSendSec(60);
    } catch (e: unknown) {
      setCpError(formatCloudAuthError(e, locale));
    } finally {
      setCpSendBusy(false);
    }
  };

  const handleChangePwdSubmit = async () => {
    if (!window.electronAPI?.nxCloudChangePassword) {
      setCpError(t.changePasswordNotSupported);
      return;
    }
    const em = (cloud?.email?.trim() || cloud?.lastLoginEmail?.trim() || '').trim();
    const codeRaw = cpCode.trim().replace(/\s/g, '');
    const np = typeof cpNewPwd === 'string' ? cpNewPwd : '';
    const cp = typeof cpConfirmPwd === 'string' ? cpConfirmPwd : '';
    if (!em) {
      setCpError(t.registerSendCodeNeedEmail);
      return;
    }
    if (!/^\d{6}$/.test(codeRaw)) {
      setCpError(t.registerFillCode);
      return;
    }
    if (!np) {
      setCpError(t.fillEmailPassword);
      return;
    }
    if (np.length < 6) {
      setCpError(t.changePasswordTooShort);
      return;
    }
    if (np !== cp) {
      setCpError(t.passwordMismatch);
      return;
    }
    setCpSubmitting(true);
    setCpError('');
    try {
      await window.electronAPI.nxCloudChangePassword(em, codeRaw, np);
      setCpCode('');
      setCpNewPwd('');
      setCpConfirmPwd('');
      setCpSendSec(0);
      if (window.electronAPI?.nxCloudLogout) {
        await window.electronAPI.nxCloudLogout();
      }
      await refreshCloudState();
      setChangePasswordExpanded(false);
      setChangePwdSuccessOpen(true);
    } catch (e: unknown) {
      setCpError(formatCloudAuthError(e, locale));
    } finally {
      setCpSubmitting(false);
    }
  };

  const handleAlipayRecharge = async (pkg: { id: RechargePackageId; priceCny: number }) => {
    if (rechargeBusyPackageId) return;
    if (!window.electronAPI?.alipayCreateRechargeOrder) {
      setRechargeError(t.rechargePayFailed);
      return;
    }
    setRechargeError('');
    setRechargeBusyPackageId(pkg.id);
    const baselineBalance = cloud?.balance ?? 0;
    try {
      const order = await window.electronAPI.alipayCreateRechargeOrder(pkg.id);
      if (window.electronAPI?.openExternalUrl) {
        await window.electronAPI.openExternalUrl(order.pay_url);
      } else {
        window.open(order.pay_url, '_blank', 'noopener,noreferrer');
      }
      if (window.electronAPI?.alipayWatchOrderSettlement && order.out_trade_no) {
        void window.electronAPI.alipayWatchOrderSettlement(order.out_trade_no, baselineBalance);
      } else if (window.electronAPI?.nxCloudGetProfile) {
        void window.electronAPI.nxCloudGetProfile().then(() => refreshCloudState());
      }
    } catch (e: unknown) {
      setRechargeError(e instanceof Error ? e.message : t.rechargePayFailed);
    } finally {
      setRechargeBusyPackageId(null);
    }
  };

  const openBillModal = () => {
    setBillModalOpen(true);
    void loadTransactions();
  };

  const openRechargeModal = () => {
    setRechargeError('');
    setRechargeModalOpen(true);
  };

  const handleRedeemCoupon = async () => {
    if (rechargeBusyPackageId !== null) return;
    if (!window.electronAPI?.nxCloudRedeemCoupon) {
      setCouponError(t.couponNotSupported);
      return;
    }
    setCouponError('');
    setCouponBusy(true);
    try {
      await window.electronAPI.nxCloudRedeemCoupon(couponCode);
      setCouponCode('');
      await refreshCloudState();
      void loadTransactions();
    } catch (e: unknown) {
      setCouponError(formatCloudAuthError(e, locale));
    } finally {
      setCouponBusy(false);
    }
  };

  const handleCloudLogout = async () => {
    if (!window.electronAPI?.nxCloudLogout) {
      setAuthError(t.cloudLoginNotSupported);
      return;
    }
    setLogoutBusy(true);
    setAuthError('');
    try {
      await window.electronAPI.nxCloudLogout();
      await refreshCloudState();
      window.dispatchEvent(new Event(NX_SAAS_PRICING_REFRESH));
      try {
        sessionStorage.removeItem('nexflow_saas_gate_ok');
      } catch {
        /* ignore */
      }
      setPassword('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setAuthError(msg || t.logoutFailed);
    } finally {
      setLogoutBusy(false);
    }
  };

  const loginFieldClass =
    'w-full rounded-full border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-white/20 read-only:opacity-90';

  const renderLanguageSelector = (placement: 'header' | 'footer') => (
    <div className="relative" ref={langMenuRef}>
      <button
        type="button"
        onClick={() => {
          setLangMenuOpen((o) => !o);
        }}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-neutral-900/90 px-3 py-2 text-sm font-normal text-white backdrop-blur transition-colors hover:bg-neutral-800/90"
        aria-expanded={langMenuOpen}
        aria-haspopup="listbox"
        aria-label={locale === 'zh' ? '界面语言' : 'Display language'}
      >
        <Globe className="h-4 w-4 shrink-0 text-white/70" strokeWidth={1.75} aria-hidden />
        <span>{appLocaleNativeLabel(locale)}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/55 transition-transform duration-200 ${langMenuOpen ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {langMenuOpen ? (
        <ul
          className={`absolute z-[10003] min-w-[11.5rem] overflow-hidden rounded-xl border border-white/12 bg-[#1e1e22] py-1 shadow-2xl ${
            placement === 'header'
              ? 'right-0 top-full mt-2'
              : 'bottom-full left-1/2 mb-2 -translate-x-1/2'
          }`}
          role="listbox"
          aria-label="Language"
        >
          {APP_LOCALE_OPTIONS.map((code) => {
            const selected = locale === code;
            return (
              <li key={code} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setLocale(code);
                    setLangMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-white transition-colors ${
                    selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.06]'
                  }`}
                >
                  <span>{appLocaleNativeLabel(code)}</span>
                  {selected ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-400" strokeWidth={2.25} aria-hidden />
                  ) : (
                    <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );

  const openLegalDoc = (id: LegalDocId) => setLegalDocId(id);

  const wechatGroupEntry = (
    <WeChatGroupEntry
      label={loginT.wechatGroup}
      title={loginT.wechatGroupTitle}
      hint={loginT.wechatGroupHint}
      closeLabel={loginT.wechatGroupClose}
      loadingLabel={loginT.wechatGroupLoading}
      loadFailedLabel={loginT.wechatGroupLoadFailed}
    />
  );

  /** 左：协议三图标；右：更新按钮（含版本/状态）+ 微信交流群 — 登录页与账户中心共用 */
  const legalLinksSection = (
    <div
      className="flex items-center justify-between gap-2 border-t border-white/[0.08] pt-2.5"
      role="group"
      aria-label={legalT.legalSectionTitle}
    >
      <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
        {(
          [
            { id: 'user-agreement' as const, label: legalT.userAgreement, Icon: FileText },
            { id: 'privacy-policy' as const, label: legalT.privacyPolicy, Icon: Shield },
            { id: 'ai-disclaimer' as const, label: legalT.aiDisclaimer, Icon: Sparkles },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            onClick={() => openLegalDoc(id)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/75"
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        ))}
      </div>
      <AppUpdatePanel update={appUpdate} variant="compact" align="right" trailing={wechatGroupEntry} />
    </div>
  );

  const loginFormCard =
    cloud !== null ? (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-white/55">{t.email}</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              type="email"
              autoComplete="email"
              value={email}
              readOnly={!loginFieldsUnlocked}
              onFocus={() => setLoginFieldsUnlocked(true)}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={`${loginFieldClass} pl-11`}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-white/55">{t.password}</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              type={showLoginPassword ? 'text' : 'password'}
              autoComplete={loginFieldsUnlocked ? 'current-password' : 'new-password'}
              value={password}
              readOnly={!loginFieldsUnlocked}
              onFocus={() => setLoginFieldsUnlocked(true)}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.placeholderPassword}
              className={`${loginFieldClass} pl-11 pr-11`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && loginFieldsUnlocked) void submitLogin();
              }}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowLoginPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-white/40 hover:text-white/70"
              aria-label={showLoginPassword ? loginT.hidePassword : loginT.showPassword}
            >
              {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {authError ? <p className="text-sm text-red-400/90">{authError}</p> : null}
        <button
          type="button"
          onClick={() => void submitLogin()}
          disabled={authPending || !loginFieldsUnlocked}
          title={!loginFieldsUnlocked ? t.tapEmailOrPasswordFirst : undefined}
          className="nexflow-btn-primary w-full"
        >
          <LogIn className="h-4 w-4" />
          {authPending ? t.loggingIn : t.login}
        </button>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={openRegisterModal}
            disabled={authPending}
            className="nexflow-btn-secondary flex-1"
          >
            <UserPlus className="h-4 w-4 shrink-0" />
            <span className="truncate">{t.register}</span>
          </button>
          <button
            type="button"
            onClick={openForgotPasswordModal}
            disabled={authPending}
            className="nexflow-btn-secondary flex-1"
          >
            <KeyRound className="h-4 w-4 shrink-0" />
            <span className="truncate">{t.forgotPassword}</span>
          </button>
        </div>
        {legalLinksSection}
      </div>
    ) : null;

  const accountInlineFieldClass =
    'w-full rounded-full border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-55';

  const accountPanelCard = cloud?.loggedIn ? (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-white/[0.08] bg-black/35 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium text-white">
              <Mail className="h-4 w-4 shrink-0 text-amber-300/90" />
              <span className="truncate">{cloud.email?.trim() || cloud.lastLoginEmail?.trim() || t.loggedIn}</span>
            </p>
            <p className="text-xs text-white/50">
              {t.ingotBalance}
              <span className="font-semibold tabular-nums text-amber-300/95">{cloud.balance}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleCloudLogout();
            }}
            disabled={logoutBusy}
            className="nexflow-btn-secondary nexflow-btn-secondary-sm shrink-0"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t.logout}
          </button>
        </div>

        {window.electronAPI?.nxCloudChangePassword && window.electronAPI?.nxCloudSendAuthCode ? (
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/25">
            <button
              type="button"
              onClick={() => setChangePasswordExpanded((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-2 text-sm text-white/85">
                <KeyRound className="h-4 w-4 shrink-0 text-amber-300/80" aria-hidden />
                {t.changePasswordTitle}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-white/45 transition-transform ${changePasswordExpanded ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            {changePasswordExpanded ? (
              <div className="space-y-3 border-t border-white/[0.08] px-3 pb-3 pt-0">
                <p className="pt-2 text-xs text-white/50">{t.changePasswordHint}</p>
                {cpError ? <p className="text-xs text-red-400/90">{cpError}</p> : null}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-white/60">{t.changePasswordNew}</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={cpNewPwd}
                    onChange={(e) => setCpNewPwd(e.target.value)}
                    placeholder={t.placeholderPassword}
                    disabled={cpSubmitting}
                    className={accountInlineFieldClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-white/60">{t.confirmPassword}</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={cpConfirmPwd}
                    onChange={(e) => setCpConfirmPwd(e.target.value)}
                    placeholder={t.placeholderConfirmPassword}
                    disabled={cpSubmitting}
                    className={accountInlineFieldClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-white/60">{t.registerVerifyCode}</label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                      value={cpCode}
                      onChange={(e) => setCpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder={t.registerVerifyPlaceholder}
                      disabled={cpSubmitting}
                      className={`min-w-[8rem] flex-1 ${accountInlineFieldClass}`}
                    />
                    <button
                      type="button"
                      disabled={cpSendBusy || cpSubmitting || cpSendSec > 0}
                      onClick={() => void handleChangePwdSendCode()}
                      className="nexflow-btn-secondary nexflow-btn-secondary-sm"
                    >
                      {cpSendBusy
                        ? t.submitting
                        : cpSendSec > 0
                          ? t.sendVerifyCodeWait(cpSendSec)
                          : t.sendVerifyCode}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={cpSubmitting}
                  onClick={() => void handleChangePwdSubmit()}
                  className="nexflow-btn-primary w-full"
                >
                  {cpSubmitting ? t.submitting : t.changePasswordSubmit}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {onSaveSuccess ? (
          <button
            type="button"
            onClick={() => onSaveSuccess()}
            className="nexflow-btn-primary w-full"
          >
            {t.enter}
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {(window.electronAPI?.nxCloudRedeemCoupon && cloud?.loggedIn) ? (
        <div className="space-y-3">
          {window.electronAPI?.nxCloudRedeemCoupon ? (
            <div className="space-y-2 rounded-xl border border-white/[0.08] bg-black/35 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-white/95">
                <Ticket className="h-4 w-4 shrink-0 text-amber-400/90" />
                {t.redeemCode}
              </p>
              {couponError ? <p className="text-xs text-red-400/90">{couponError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRedeemCoupon();
                  }}
                  placeholder={t.redeemPlaceholder}
                  disabled={couponBusy || rechargeBusyPackageId !== null}
                  className="min-w-[10rem] flex-1 rounded-xl border border-amber-500/30 bg-black/35 px-3 py-2 text-sm text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-55"
                />
                <button
                  type="button"
                  disabled={couponBusy || rechargeBusyPackageId !== null || !couponCode.trim()}
                  onClick={() => void handleRedeemCoupon()}
                  className="nexflow-btn-primary nexflow-btn-primary-sm"
                >
                  {couponBusy ? t.redeeming : t.redeem}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {window.electronAPI?.nxCloudGetTransactions ? (
        <div className="border-t border-white/[0.08] pt-3">
          <button
            type="button"
            onClick={openBillModal}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
          >
            <span className="flex items-center gap-2 text-sm text-white/60">
              <Receipt className="h-4 w-4 shrink-0" />
              {t.billListTitle}
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
          </button>
        </div>
      ) : null}
      {legalLinksSection}
    </div>
  ) : null;

  const modals = (
    <>
      <DarkAlertModal
        open={loginSuccessModalOpen}
        message={t.loginSuccessMessage}
        onClose={() => setLoginSuccessModalOpen(false)}
        appearance="loginShell"
      />
      <DarkAlertModal
        open={changePwdSuccessOpen}
        message={t.changePasswordSuccessMessage}
        onClose={() => setChangePwdSuccessOpen(false)}
        appearance="loginShell"
      />
      <LegalDocModal open={!!legalDocId} docId={legalDocId} onClose={() => setLegalDocId(null)} />
    </>
  );

  if (!cloud?.loggedIn) {
    return (
      <>
        {modals}
        <EcommerceLoginShell
          locale={locale}
          loading={cloud === null}
          headerRight={renderLanguageSelector('header')}
          loginCard={loginFormCard}
        />
        {registerModalOpen ? (
          <div
            className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/75 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-dialog-title"
          >
            <div className="w-full max-w-md rounded-xl border border-white/10 bg-neutral-950 shadow-2xl p-6 space-y-4">
              <h3 id="register-dialog-title" className="text-lg font-semibold text-white">
                {t.registerTitle}
              </h3>
              <p className="text-xs text-white/45">{t.registerDesc}</p>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-white">
                  <span className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    {t.email}
                  </span>
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-black/50 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-apple-blue"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-white">
                  <span className="flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    {t.password}
                  </span>
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={registerPassword}
                  onChange={(e) => setRegisterPassword(e.target.value)}
                  placeholder={t.placeholderPassword}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-black/50 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-apple-blue"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-white">
                  <span className="flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    {t.confirmPassword}
                  </span>
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={registerConfirmPassword}
                  onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                  placeholder={t.placeholderConfirmPassword}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-black/50 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-apple-blue"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRegisterModal();
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-white">
                  <span className="flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    {t.registerVerifyCode}
                  </span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    value={registerAuthCode}
                    onChange={(e) => setRegisterAuthCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder={t.registerVerifyPlaceholder}
                    className="min-w-0 flex-1 px-4 py-2 rounded-lg border border-white/10 bg-black/50 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-apple-blue tracking-widest"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitRegisterModal();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void handleRegisterSendCode()}
                    disabled={regSendCodeBusy || regSendCodeSec > 0 || registerSubmitting}
                    className="nexflow-btn-secondary nexflow-btn-secondary-sm shrink-0 whitespace-nowrap"
                  >
                    {regSendCodeSec > 0
                      ? t.sendVerifyCodeWait(regSendCodeSec)
                      : regSendCodeBusy
                        ? '…'
                        : t.sendVerifyCode}
                  </button>
                </div>
              </div>

              {regError ? <p className="text-sm text-red-400/90">{regError}</p> : null}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeRegisterModal}
                  disabled={registerSubmitting}
                  className="nexflow-btn-secondary flex-1"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => void submitRegisterModal()}
                  disabled={registerSubmitting}
                  className="nexflow-btn-primary flex-1"
                >
                  {registerSubmitting ? t.submitting : t.confirm}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {forgotPwdModalOpen ? (
          <div
            className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/75 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-pwd-dialog-title"
          >
            <div className="w-full max-w-md rounded-xl border border-white/10 bg-neutral-950 shadow-2xl p-6 space-y-4">
              <h3 id="forgot-pwd-dialog-title" className="text-lg font-semibold text-white">
                {t.forgotPasswordTitle}
              </h3>
              <p className="text-xs text-white/45">{t.forgotPasswordDesc}</p>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-white">
                  <span className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    {t.email}
                  </span>
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  value={fpEmail}
                  onChange={(e) => setFpEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-black/50 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-apple-blue"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-white">
                  <span className="flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    {t.registerVerifyCode}
                  </span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    value={fpCode}
                    onChange={(e) => setFpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder={t.registerVerifyPlaceholder}
                    className="min-w-0 flex-1 px-4 py-2 rounded-lg border border-white/10 bg-black/50 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-apple-blue tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => void handleFpSendCode()}
                    disabled={fpSendCodeBusy || fpSendCodeSec > 0 || fpSubmitting}
                    className="nexflow-btn-secondary nexflow-btn-secondary-sm shrink-0 whitespace-nowrap"
                  >
                    {fpSendCodeSec > 0
                      ? t.sendVerifyCodeWait(fpSendCodeSec)
                      : fpSendCodeBusy
                        ? '…'
                        : t.sendVerifyCode}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-white">
                  <span className="flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    {t.changePasswordNew}
                  </span>
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={fpNewPwd}
                  onChange={(e) => setFpNewPwd(e.target.value)}
                  placeholder={t.placeholderPassword}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-black/50 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-apple-blue"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-white">
                  <span className="flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    {t.confirmPassword}
                  </span>
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={fpConfirmPwd}
                  onChange={(e) => setFpConfirmPwd(e.target.value)}
                  placeholder={t.placeholderConfirmPassword}
                  className="w-full px-4 py-2 rounded-lg border border-white/10 bg-black/50 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-apple-blue"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitForgotPasswordModal();
                  }}
                />
              </div>

              {fpError ? <p className="text-sm text-red-400/90">{fpError}</p> : null}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeForgotPasswordModal}
                  disabled={fpSubmitting}
                  className="nexflow-btn-secondary flex-1"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => void submitForgotPasswordModal()}
                  disabled={fpSubmitting}
                  className="nexflow-btn-primary flex-1"
                >
                  {fpSubmitting ? t.submitting : t.confirm}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {registerSuccessVisible ? (
          <div
            className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="register-success-title"
            aria-describedby="register-success-desc"
          >
            <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-neutral-950 px-8 py-8 shadow-2xl">
              <CheckCircle2 className="w-12 h-12 text-emerald-400/90" strokeWidth={1.75} aria-hidden />
              <p id="register-success-title" className="text-lg font-medium text-white">
                {t.registerSuccess}
              </p>
              <p id="register-success-desc" className="text-center text-xs text-white/45">
                {t.welcomeMessage}
              </p>
              <button
                type="button"
                onClick={dismissRegisterSuccess}
                className="nexflow-btn-primary mt-1 w-full"
              >
                {t.confirmOk}
              </button>
            </div>
          </div>
        ) : null}
        {forgotPwdSuccessVisible ? (
          <div
            className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="forgot-pwd-success-title"
            aria-describedby="forgot-pwd-success-desc"
          >
            <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-neutral-950 px-8 py-8 shadow-2xl">
              <CheckCircle2 className="w-12 h-12 text-emerald-400/90" strokeWidth={1.75} aria-hidden />
              <p id="forgot-pwd-success-title" className="text-lg font-medium text-white">
                {t.forgotPasswordSuccess}
              </p>
              <p id="forgot-pwd-success-desc" className="text-center text-xs text-white/45">
                {t.forgotPasswordSuccessHint}
              </p>
              <button
                type="button"
                onClick={dismissForgotPwdSuccess}
                className="nexflow-btn-primary mt-1 w-full"
              >
                {t.confirmOk}
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {modals}
      <RechargeModal
        open={rechargeModalOpen}
        onClose={() => setRechargeModalOpen(false)}
        locale={locale}
        busyPackageId={rechargeBusyPackageId}
        error={rechargeError}
        onPay={handleAlipayRecharge}
      />
      <BillListModal
        open={billModalOpen}
        onClose={() => setBillModalOpen(false)}
        locale={locale}
        txList={txList}
        txLoading={txLoading}
        txError={txError}
        onRefresh={loadTransactions}
      />
      <EcommerceLoginShell
        locale={locale}
        wideCard
        cardTitle={loginT.accountTitle}
        cardSubtitle={loginT.accountSubtitle}
        headerRight={
          <>
            {cloud?.loggedIn ? (
              <button
                type="button"
                onClick={openRechargeModal}
                className="nexflow-btn-primary nexflow-btn-primary-sm shrink-0"
              >
                <Coins className="h-3.5 w-3.5" />
                {t.rechargeHeaderBtn}
              </button>
            ) : null}
            <div className="flex items-center gap-2 rounded-full bg-neutral-900/90 px-3.5 py-2 text-xs backdrop-blur">
              <Coins className="h-4 w-4 text-white/80" strokeWidth={1.75} />
              <span className="text-white/55">{t.ingotBalance}</span>
              <span className="font-medium tabular-nums text-white">
                {(cloud?.balance ?? 0).toLocaleString()}
              </span>
            </div>
            {renderLanguageSelector('header')}
            <SettingsFullscreenToggle />
          </>
        }
        loginCard={accountPanelCard}
      />
    </>
  );

};

export default Settings;
