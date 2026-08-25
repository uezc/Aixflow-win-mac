export type SettingsLocale = 'zh' | 'en';

/** 与设置页共用存储键的全局界面语言 */
export type AppLocale = SettingsLocale;

/** 界面语言下拉等使用；新增语言时在此追加，并同步 {@link appLocaleNativeLabel} 与类型 */
export const APP_LOCALE_OPTIONS: readonly AppLocale[] = ['zh', 'en'];

/** 各语言在选择器中的原生展示名（便于识别） */
export function appLocaleNativeLabel(code: AppLocale): string {
  switch (code) {
    case 'zh':
      return '简体中文';
    case 'en':
      return 'English';
    default: {
      const _x: never = code;
      return _x;
    }
  }
}

const STORAGE_KEY = 'nexflow-settings-locale';

export function getStoredSettingsLocale(): SettingsLocale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'zh') return v;
  } catch {
    /* ignore */
  }
  return 'zh';
}

export function persistSettingsLocale(locale: SettingsLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export type SettingsStrings = {
  languageSwitchToEn: string;
  languageSwitchToZh: string;
  back: string;
  backAria: string;
  loggedIn: string;
  ingotBalance: string;
  logout: string;
  /** 登录钮禁用时的 title：须先点输入框解锁，防自动填充误登 */
  tapEmailOrPasswordFirst: string;
  /** 首次拉取 getNxSaasState 前：避免误显示登录框后被旧会话顶掉 */
  accountStateLoading: string;
  enter: string;
  email: string;
  password: string;
  routeChannelTitle: string;
  routeChannelCn: string;
  routeChannelGlobal: string;
  regionRouteTitle: string;
  regionRouteChinaOptimized: string;
  regionRouteGlobal: string;
  /** 窄顶栏缩写 */
  regionRouteChinaOptimizedShort: string;
  regionRouteGlobalShort: string;
  updateFeedRouteTitle: string;
  updateFeedRouteBeijing: string;
  updateFeedRouteHongKong: string;
  placeholderPassword: string;
  login: string;
  loggingIn: string;
  loginDone: string;
  /** 登录成功暗黑弹窗正文（仅短句） */
  loginSuccessMessage: string;
  register: string;
  rechargeTiers: string;
  firstRechargeBadge: string;
  firstRechargeTitle: string;
  rechargeHeaderBtn: string;
  rechargePackagesTitle: string;
  rechargePackagesHint: string;
  packageTagMostPopular: string;
  packageTagBestValue: string;
  packageTagMaxDiscount: string;
  packageYuanbaoTotal: (n: number) => string;
  packageBonusExtra: (n: number) => string;
  checkoutTotal: (n: number) => string;
  yuanbaoUnit: string;
  rechargePayOpening: string;
  rechargePayNow: (price: number, total: number) => string;
  rechargePayFailed: string;
  rechargeSuccessMessage: (added: number) => string;
  tierBusy: string;
  tierYuan: (n: number) => string;
  redeemCode: string;
  redeemPlaceholder: string;
  redeem: string;
  redeeming: string;
  billListTitle: string;
  billPagePrev: string;
  billPageNext: string;
  billPageStatus: (page: number, totalPages: number, total: number) => string;
  refresh: string;
  refreshing: string;
  txTime: string;
  txType: string;
  txChange: string;
  txBalance: string;
  noRecords: string;
  txConsume: string;
  txRefund: string;
  txWelcomeBonus: string;
  txRecharge: string;
  txAdjust: string;
  txCoupon: string;
  appUpdate: string;
  currentVersion: string;
  checkUpdate: string;
  checkingUpdate: string;
  /** 更新按钮：与版本号拼成「1.7.2 最新版本」 */
  alreadyLatest: string;
  /** 更新按钮：有可用更新时与新版本号拼成「1.8.0 可下载」 */
  updateReadyBtn: string;
  newVersionAvailable: (v: string) => string;
  checkFailedPrefix: string;
  checkFailedGeneric: string;
  /** 页脚更新按钮：检查失败时的短文案 */
  checkFailedShort: string;
  downloadInstall: (v: string) => string;
  downloading: string;
  downloadStubLabel: string;
  downloadPackageLabel: string;
  downloadingMainPackage: (size: string) => string;
  downloadFailed: string;
  installingUpdate: string;
  /** 页脚更新按钮：安装中短文案 */
  installingShort: string;
  preparingDownload: string;
  loadTxFailed: string;
  requestFailed: string;
  cloudLoginNotSupported: string;
  enterEmailPassword: string;
  /** 纯验证码账号尝试密码登录时 */
  useOtpLoginHint: string;
  verifyCode: string;
  verifyCodePlaceholder: string;
  sendVerifyCode: string;
  sendVerifyCodeWait: (sec: number) => string;
  enterEmailCode: string;
  directRechargeClosed: string;
  onlineRechargeNotSupported: string;
  rechargeFailed: string;
  couponNotSupported: string;
  logoutFailed: string;
  registerNotSupported: string;
  fillEmailPassword: string;
  passwordMismatch: string;
  registerTitle: string;
  registerDesc: string;
  registerVerifyCode: string;
  registerVerifyPlaceholder: string;
  registerFillCode: string;
  registerSendCodeNeedEmail: string;
  confirmPassword: string;
  placeholderConfirmPassword: string;
  cancel: string;
  confirm: string;
  submitting: string;
  registerSuccess: string;
  welcomeMessage: string;
  confirmOk: string;
  newVersionFallback: string;
  dash: string;
  /** 已登录：修改密码（邮箱验证码） */
  changePasswordTitle: string;
  changePasswordHint: string;
  changePasswordNew: string;
  changePasswordSubmit: string;
  changePasswordSuccessMessage: string;
  changePasswordNotSupported: string;
  changePasswordTooShort: string;
  /** 未登录：忘记密码 */
  forgotPassword: string;
  forgotPasswordTitle: string;
  forgotPasswordDesc: string;
  forgotPasswordSuccess: string;
  forgotPasswordSuccessHint: string;
  forgotPasswordNotSupported: string;
  hwAccelTitle: string;
  hwAccelDesc: string;
  hwAccelRestartHint: string;
  hwAccelRestart: string;
  hwAccelRestarting: string;
  hwAccelStatusActive: string;
  hwAccelStatusInactive: string;
  hwAccelPendingRestart: string;
  hwAccelExpectHint: string;
  hwAccelNotActiveWarning: string;
  hwAccelDiagTitle: string;
  hwAccelDiagCompositing: string;
  hwAccelDiagVideoDecode: string;
  hwAccelDiagGpuDevice: string;
  hwAccelFeatureEnabled: string;
  hwAccelFeatureDisabled: string;
  hwAccelFeatureUnknown: string;
};

const zh: SettingsStrings = {
  languageSwitchToEn: 'English',
  languageSwitchToZh: '中文',
  back: '返回',
  backAria: '返回片头',
  loggedIn: '已登录',
  ingotBalance: '元宝余额：',
  logout: '退出登录',
  tapEmailOrPasswordFirst: '请先点击邮箱或密码框，再点登录（避免浏览器自动填充误操作）',
  accountStateLoading: '正在读取本机登录状态…',
  enter: '进入',
  email: '邮箱',
  password: '密码',
  routeChannelTitle: '参考图通道',
  routeChannelCn: '中国',
  routeChannelGlobal: '全球',
  regionRouteTitle: '云端与素材线路（中国优化：北京 FC + 北京 OSS；全球线路：香港 FC + 香港 OSS）',
  regionRouteChinaOptimized: '中国优化',
  regionRouteGlobal: '全球线路',
  regionRouteChinaOptimizedShort: '中国',
  regionRouteGlobalShort: '全球',
  updateFeedRouteTitle: '软件更新下载线路（北京 OSS / 香港 OSS）',
  updateFeedRouteBeijing: '北京线路',
  updateFeedRouteHongKong: '香港线路',
  placeholderPassword: '请输入密码',
  login: '登录',
  loggingIn: '处理中…',
  loginDone: '已完成',
  loginSuccessMessage: '登录成功',
  register: '注册',
  rechargeTiers: '充值档位',
  firstRechargeBadge: '『首充特惠：额外赠送 20%』',
  firstRechargeTitle: '首笔充值按云端档位叠加赠送（与 Tablestore is_first_recharge 同步）',
  rechargeHeaderBtn: '充值',
  rechargePackagesTitle: '元宝充值',
  rechargePackagesHint:
    '元宝永久有效，充值后立即到账，支付宝支付。元宝用于所有功能消费。',
  packageTagMostPopular: '最受欢迎',
  packageTagBestValue: '性价比最高',
  packageTagMaxDiscount: '最大优惠',
  packageYuanbaoTotal: (n) => `${n} 元宝`,
  packageBonusExtra: (n) => `再送 ${n}`,
  checkoutTotal: (n) => `到账 ${n}`,
  yuanbaoUnit: '元宝',
  rechargePayOpening: '正在打开支付宝…',
  rechargePayNow: (price, total) => `支付宝支付 ¥${price}（约 ${total} 元宝）`,
  rechargePayFailed: '无法发起支付，请确认本机支付服务已启动',
  rechargeSuccessMessage: (added) => `充值成功！获得 ${added} 元宝`,
  tierBusy: '处理中…',
  tierYuan: (n) => `${n} 元`,
  redeemCode: '兑换码',
  redeemPlaceholder: '输入兑换码',
  redeem: '兑换',
  redeeming: '兑换中…',
  billListTitle: '账单列表（分页，含充值/兑换）',
  billPagePrev: '上一页',
  billPageNext: '下一页',
  billPageStatus: (page, totalPages, total) => `第 ${page}/${totalPages} 页 · 共 ${total} 条`,
  refresh: '刷新',
  refreshing: '刷新中…',
  txTime: '时间',
  txType: '类型',
  txChange: '变动',
  txBalance: '余额',
  noRecords: '暂无记录',
  txConsume: '消费',
  txRefund: '退款',
  txWelcomeBonus: '新手礼包',
  txRecharge: '充值',
  txAdjust: '管理员调整',
  txCoupon: '兑换码',
  appUpdate: '应用更新',
  currentVersion: '当前版本',
  checkUpdate: '检查更新',
  checkingUpdate: '检查中...',
  alreadyLatest: '最新版本',
  updateReadyBtn: '可下载',
  newVersionAvailable: (v) => `发现新版本 v${v}`,
  checkFailedPrefix: '检查失败:',
  checkFailedGeneric: '检查失败，请稍后重试',
  checkFailedShort: '检查失败',
  downloadInstall: (v) => `下载 ${v} 并安装`,
  downloading: '下载中...',
  downloadStubLabel: '引导程序',
  downloadPackageLabel: '安装包（压缩包）',
  downloadingMainPackage: (size) => `引导包已就绪，正在下载主安装包（约 ${size}），请耐心等待，勿关闭应用`,
  downloadFailed: '下载失败，请检查网络后重试',
  installingUpdate: '下载完成，正在保存并退出以安装更新…',
  installingShort: '安装中...',
  preparingDownload: '准备下载...',
  loadTxFailed: '加载失败',
  requestFailed: '请求失败',
  cloudLoginNotSupported: '当前环境不支持云端登录',
  enterEmailPassword: '请输入邮箱和密码',
  useOtpLoginHint: '请使用验证码登录',
  verifyCode: '验证码',
  verifyCodePlaceholder: '6 位数字',
  sendVerifyCode: '获取验证码',
  sendVerifyCodeWait: (sec) => `${sec} 秒后可重发`,
  enterEmailCode: '请输入邮箱和验证码',
  directRechargeClosed: '直连充值未开放，请使用兑换码',
  onlineRechargeNotSupported: '当前版本不支持在线充值',
  rechargeFailed: '充值失败',
  couponNotSupported: '当前版本不支持兑换码',
  logoutFailed: '退出失败',
  registerNotSupported: '当前环境不支持云端注册',
  fillEmailPassword: '请填写邮箱和密码',
  passwordMismatch: '两次输入的密码不一致',
  registerTitle: '注册账号',
  registerDesc: '请填写邮箱与密码，获取邮箱验证码并填写正确后方可完成注册，成功后自动登录。',
  registerVerifyCode: '邮箱验证码',
  registerVerifyPlaceholder: '6 位数字',
  registerFillCode: '请输入 6 位邮箱验证码',
  registerSendCodeNeedEmail: '请先填写注册邮箱，再获取验证码',
  confirmPassword: '再次确认密码',
  placeholderConfirmPassword: '请再次输入密码',
  cancel: '取消',
  confirm: '确认',
  submitting: '提交中…',
  registerSuccess: '注册成功',
  welcomeMessage: '欢迎使用 Aixflow',
  confirmOk: '确认',
  newVersionFallback: '新版本',
  dash: '—',
  changePasswordTitle: '修改密码',
  changePasswordHint: '请先填写并确认新密码，再获取邮箱验证码并填入。',
  changePasswordNew: '新密码',
  changePasswordSubmit: '确认修改',
  changePasswordSuccessMessage: '密码已修改。当前会话已结束，请使用新密码重新登录。',
  changePasswordNotSupported: '当前环境不支持修改密码',
  changePasswordTooShort: '新密码长度至少为 6 位',
  forgotPassword: '忘记密码',
  forgotPasswordTitle: '重置密码',
  forgotPasswordDesc: '依次填写邮箱、获取并填入验证码，再输入两次新密码（至少 6 位）完成重置。',
  forgotPasswordSuccess: '密码已重置',
  forgotPasswordSuccessHint: '请使用新密码登录。',
  forgotPasswordNotSupported: '当前环境不支持重置密码',
  hwAccelTitle: '启用硬件加速（实验）',
  hwAccelDesc: '开启后画布平移与视频预览可走 GPU，Windows 上通常更流畅；部分电脑可能出现黑屏，可随时关闭并重启。',
  hwAccelRestartHint: '已保存设置，须完全重启应用后才会生效。',
  hwAccelRestart: '立即重启',
  hwAccelRestarting: '正在重启…',
  hwAccelStatusActive: '当前会话：GPU 加速已启用',
  hwAccelStatusInactive: '当前会话：软件渲染（默认）',
  hwAccelPendingRestart: '等待重启后生效',
  hwAccelExpectHint:
    'GPU 主要改善视频预览解码与界面合成；节点很多时平移仍受 CPU/DOM 影响，与 Mac 差距不一定完全消除。',
  hwAccelNotActiveWarning: '开关已打开，但当前会话仍是软件渲染——必须点「立即重启」后才会变成「GPU 开」。',
  hwAccelDiagTitle: 'Chromium 图形状态',
  hwAccelDiagCompositing: '界面合成',
  hwAccelDiagVideoDecode: '视频硬解',
  hwAccelDiagGpuDevice: '显卡',
  hwAccelFeatureEnabled: '已启用',
  hwAccelFeatureDisabled: '未启用',
  hwAccelFeatureUnknown: '未知',
};

const en: SettingsStrings = {
  languageSwitchToEn: 'English',
  languageSwitchToZh: '中文',
  back: 'Back',
  backAria: 'Back to splash',
  loggedIn: 'Signed in',
  ingotBalance: 'Credits:',
  logout: 'Log out',
  tapEmailOrPasswordFirst: 'Click the email or password field first, then sign in (reduces mistaken autofill login).',
  accountStateLoading: 'Loading sign-in status…',
  enter: 'Enter',
  email: 'Email',
  password: 'Password',
  routeChannelTitle: 'Reference image channel',
  routeChannelCn: 'China',
  routeChannelGlobal: 'Global',
  regionRouteTitle: 'Cloud & media route (China: Beijing FC + OSS; Global: Hong Kong FC + OSS)',
  regionRouteChinaOptimized: 'China optimized',
  regionRouteGlobal: 'Global route',
  regionRouteChinaOptimizedShort: 'CN',
  regionRouteGlobalShort: 'Global',
  updateFeedRouteTitle: 'App update download region (Beijing OSS / Hong Kong OSS)',
  updateFeedRouteBeijing: 'Beijing',
  updateFeedRouteHongKong: 'Hong Kong',
  placeholderPassword: 'Enter password',
  login: 'Sign in',
  loggingIn: 'Working…',
  loginDone: 'Done',
  loginSuccessMessage: 'Signed in',
  register: 'Create account',
  rechargeTiers: 'Top-up amounts',
  firstRechargeBadge: '「First top-up: +20% bonus」',
  firstRechargeTitle: 'First purchase bonus synced from cloud (Tablestore is_first_recharge)',
  rechargeHeaderBtn: 'Top up',
  rechargePackagesTitle: 'Yuanbao top-up',
  rechargePackagesHint:
    'Yuanbao never expires. Credited instantly after Alipay payment. Used for all features.',
  packageTagMostPopular: 'Most popular',
  packageTagBestValue: 'Best value',
  packageTagMaxDiscount: 'Best deal',
  packageYuanbaoTotal: (n) => `${n} Yuanbao`,
  packageBonusExtra: (n) => `+${n} bonus`,
  checkoutTotal: (n) => `Total ${n}`,
  yuanbaoUnit: 'Yuanbao',
  rechargePayOpening: 'Opening Alipay…',
  rechargePayNow: (price, total) => `Pay ¥${price} (~${total} Yuanbao)`,
  rechargePayFailed: 'Could not start payment. Is the local pay service running?',
  rechargeSuccessMessage: (added) => `Top-up successful! +${added} Yuanbao`,
  tierBusy: 'Working…',
  tierYuan: (n) => `¥${n}`,
  redeemCode: 'Redeem code',
  redeemPlaceholder: 'Enter redeem code',
  redeem: 'Redeem',
  redeeming: 'Redeeming…',
  billListTitle: 'Transactions (paginated, incl. top-ups)',
  billPagePrev: 'Previous',
  billPageNext: 'Next',
  billPageStatus: (page, totalPages, total) => `Page ${page}/${totalPages} · ${total} total`,
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  txTime: 'Time',
  txType: 'Type',
  txChange: 'Change',
  txBalance: 'Balance',
  noRecords: 'No records',
  txConsume: 'Spend',
  txRefund: 'Refund',
  txWelcomeBonus: 'Welcome bonus',
  txRecharge: 'Top-up',
  txAdjust: 'Admin adjustment',
  txCoupon: 'Redeem code',
  appUpdate: 'App updates',
  currentVersion: 'Current version',
  checkUpdate: 'Check for updates',
  checkingUpdate: 'Checking…',
  alreadyLatest: 'Latest',
  updateReadyBtn: 'available',
  newVersionAvailable: (v) => `New version v${v} available`,
  checkFailedPrefix: 'Check failed:',
  checkFailedGeneric: 'Update check failed. Try again later.',
  checkFailedShort: 'Check failed',
  downloadInstall: (v) => `Download ${v} and install`,
  downloading: 'Downloading…',
  downloadStubLabel: 'Bootstrap installer',
  downloadPackageLabel: 'Main package (.7z)',
  downloadingMainPackage: (size) => `Bootstrap ready. Downloading main installer (~${size}). Please keep the app open.`,
  downloadFailed: 'Download failed. Check your network and try again.',
  installingUpdate: 'Download complete. Saving and quitting to install…',
  installingShort: 'Installing…',
  preparingDownload: 'Preparing download…',
  loadTxFailed: 'Failed to load',
  requestFailed: 'Request failed',
  cloudLoginNotSupported: 'Cloud sign-in is not available in this build',
  enterEmailPassword: 'Enter email and password',
  useOtpLoginHint: 'Please sign in with the email verification code',
  verifyCode: 'Verification code',
  verifyCodePlaceholder: '6-digit code',
  sendVerifyCode: 'Send code',
  sendVerifyCodeWait: (sec) => `Resend in ${sec}s`,
  enterEmailCode: 'Enter email and verification code',
  directRechargeClosed: 'Direct top-up is disabled. Use a redeem code.',
  onlineRechargeNotSupported: 'Online top-up is not available in this version',
  rechargeFailed: 'Top-up failed',
  couponNotSupported: 'Redeem codes are not available in this version',
  logoutFailed: 'Sign out failed',
  registerNotSupported: 'Registration is not available in this build',
  fillEmailPassword: 'Enter email and password',
  passwordMismatch: 'Passwords do not match',
  registerTitle: 'Create account',
  registerDesc: 'Enter email and password, then verify your inbox with the 6-digit code before completing sign-up.',
  registerVerifyCode: 'Email verification code',
  registerVerifyPlaceholder: '6-digit code',
  registerFillCode: 'Enter the 6-digit code sent to your email',
  registerSendCodeNeedEmail: 'Enter your registration email before requesting a code',
  confirmPassword: 'Confirm password',
  placeholderConfirmPassword: 'Enter password again',
  cancel: 'Cancel',
  confirm: 'OK',
  submitting: 'Submitting…',
  registerSuccess: 'Account created',
  welcomeMessage: 'Welcome to Aixflow',
  confirmOk: 'OK',
  newVersionFallback: 'New version',
  dash: '—',
  changePasswordTitle: 'Change password',
  changePasswordHint: 'Enter and confirm your new password first, then request the email code and fill it in below.',
  changePasswordNew: 'New password',
  changePasswordSubmit: 'Update password',
  changePasswordSuccessMessage: 'Password updated. You have been signed out. Sign in again with your new password.',
  changePasswordNotSupported: 'Password change is not available in this build',
  changePasswordTooShort: 'New password must be at least 6 characters',
  forgotPassword: 'Forgot password',
  forgotPasswordTitle: 'Reset password',
  forgotPasswordDesc:
    'Enter your registered email, request a code, then enter your new password twice (at least 6 characters).',
  forgotPasswordSuccess: 'Password reset',
  forgotPasswordSuccessHint: 'Sign in with your new password.',
  forgotPasswordNotSupported: 'Password reset is not available in this build',
  hwAccelTitle: 'Hardware acceleration (experimental)',
  hwAccelDesc:
    'Uses GPU for canvas pan/zoom and video preview—often smoother on Windows. Some PCs may show a black screen; turn off and restart if that happens.',
  hwAccelRestartHint: 'Setting saved. Fully restart the app for it to take effect.',
  hwAccelRestart: 'Restart now',
  hwAccelRestarting: 'Restarting…',
  hwAccelStatusActive: 'This session: GPU acceleration on',
  hwAccelStatusInactive: 'This session: software rendering (default)',
  hwAccelPendingRestart: 'Pending restart',
  hwAccelExpectHint:
    'GPU mainly helps video preview decode and UI compositing. Panning with many nodes is still CPU/DOM-bound; it may not fully match Mac.',
  hwAccelNotActiveWarning:
    'The switch is on, but this session is still software-rendered. Tap Restart now until the pill reads GPU on.',
  hwAccelDiagTitle: 'Chromium graphics',
  hwAccelDiagCompositing: 'Compositing',
  hwAccelDiagVideoDecode: 'Video decode',
  hwAccelDiagGpuDevice: 'GPU',
  hwAccelFeatureEnabled: 'enabled',
  hwAccelFeatureDisabled: 'disabled',
  hwAccelFeatureUnknown: 'unknown',
};

export function settingsT(locale: SettingsLocale): SettingsStrings {
  return locale === 'en' ? en : zh;
}

export function dateLocaleForSettings(locale: SettingsLocale): string {
  return locale === 'en' ? 'en-US' : 'zh-CN';
}
