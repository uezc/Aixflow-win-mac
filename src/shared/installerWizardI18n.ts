export type InstallerLocale = 'zh' | 'en';

export type InstallerWizardStrings = {
  dialogAria: string;
  close: string;
  stepDownload: string;
  stepInstall: string;
  stepDone: string;
  tagline: string;
  taglineSub: string;
  learnMore: string;
  helpSupport: string;
  productTitle: string;
  installerName: string;
  heroDescLine1: string;
  heroDescLine2: string;
  /** 应用内更新向导副文案 */
  updateHeroLine1: string;
  updateHeroLine2: string;
  updateInstallingHint: string;
  statusReady: string;
  statusResolving: string;
  statusDownloading: string;
  /** 引导程序（stub）阶段 */
  statusDownloadingStub: string;
  /** 主安装包阶段 */
  statusDownloadingPackage: string;
  /** 速度为 0 时的防假死文案 */
  statusDownloadingWaiting: string;
  statusPaused: string;
  statusInstalling: string;
  statusDone: string;
  statusError: string;
  statusCancelled: string;
  downloaded: string;
  remaining: string;
  paused: string;
  installingHint: string;
  installingWait: string;
  fileName: string;
  fileSize: string;
  cacheDir: string;
  systemTemp: string;
  installDir: string;
  browse: string;
  browseTitle: string;
  installDirAria: string;
  installDirHint: string;
  updateCacheDir: string;
  updateInstallHint: string;
  startInstall: string;
  preparing: string;
  continue: string;
  pause: string;
  cancel: string;
  launch: string;
  installedTo: string;
  langZh: string;
  langEn: string;
  langToggleAria: string;
  downloadRouteAria: string;
  downloadRouteBeijing: string;
  downloadRouteHongKong: string;
  downloadRouteHint: string;
  idleChooseRoute: string;
  idleCurrentVersion: string;
  actionCheckUpdate: string;
  actionDownloadInstall: string;
  idleChecking: string;
  idleLatest: string;
  idleHasUpdate: string;
  connectFailed: string;
  launchFailed: string;
};

const zh: InstallerWizardStrings = {
  dialogAria: 'Aixflow 安装程序',
  close: '关闭',
  stepDownload: '下载与安装',
  stepInstall: '安装进度',
  stepDone: '完成',
  tagline: '让 AI 流程更简单',
  taglineSub: '创意 · 连接 · 无限可能',
  learnMore: '了解更多 >',
  helpSupport: '帮助与支持',
  productTitle: 'Aixflow',
  installerName: 'Aixflow 安装程序',
  heroDescLine1: '玻璃拟态本机安装器 · 下载完整包并安装到你选择的目录',
  heroDescLine2: '全程无需标准 NSIS 向导界面',
  updateHeroLine1: '一款强大的 AI 工作流构建与管理平台',
  updateHeroLine2: '拖拽式设计 · 模块化扩展 · 高效执行',
  updateInstallingHint: '即将退出并启动安装程序，请稍候…',
  statusReady: '准备下载并安装 Aixflow',
  statusResolving: '正在解析安装包…',
  statusDownloading: '正在下载 Aixflow 安装包',
  statusDownloadingStub: '正在下载引导程序…',
  statusDownloadingPackage: '正在下载主安装包（体积较大，请耐心等待）…',
  statusDownloadingWaiting: '仍在下载中（网络较慢或连接中，进度可能暂时不动）…',
  statusPaused: '下载已暂停',
  statusInstalling: '正在安装 Aixflow',
  statusDone: '安装完成',
  statusError: '出错了',
  statusCancelled: '已取消',
  downloaded: '已下载',
  remaining: '剩余',
  paused: '已暂停',
  installingHint: '正在静默安装到',
  installingWait: '请稍候，正在写入文件…',
  fileName: '文件名称',
  fileSize: '文件大小',
  cacheDir: '缓存目录',
  systemTemp: '系统临时目录',
  installDir: '安装目录',
  browse: '浏览',
  browseTitle: '选择安装文件夹',
  installDirAria: '软件安装目录',
  installDirHint:
    '软件将安装到此目录。下载完成后以静默方式安装，不会弹出标准 NSIS「选定安装位置」向导。',
  updateCacheDir: '更新缓存目录',
  updateInstallHint:
    '应用内更新将沿用已安装路径。官网首次安装请使用玻璃安装器 Aixflow-Installer（可选目录）',
  startInstall: '开始安装',
  preparing: '准备中…',
  continue: '继续',
  pause: '暂停',
  cancel: '取消',
  launch: '启动 Aixflow',
  installedTo: '已安装到',
  langZh: '中文',
  langEn: 'EN',
  langToggleAria: '切换界面语言',
  downloadRouteAria: '选择安装包下载线路',
  downloadRouteBeijing: '北京线路',
  downloadRouteHongKong: '香港线路',
  downloadRouteHint: '同一版本，请选更快的线路：国内通常北京更快，海外通常香港更快。',
  idleChooseRoute: '选择更新线路',
  idleCurrentVersion: '当前版本',
  actionCheckUpdate: '检查更新',
  actionDownloadInstall: '下载并安装',
  idleChecking: '正在检查更新…',
  idleLatest: '已是最新版本',
  idleHasUpdate: '发现新版本',
  connectFailed: '未能连接安装器主进程',
  launchFailed: '启动失败',
};

const en: InstallerWizardStrings = {
  dialogAria: 'Aixflow Installer',
  close: 'Close',
  stepDownload: 'Download & Install',
  stepInstall: 'Installing',
  stepDone: 'Done',
  tagline: 'Make AI workflows simpler',
  taglineSub: 'Create · Connect · Infinite',
  learnMore: 'Learn more >',
  helpSupport: 'Help & Support',
  productTitle: 'Aixflow',
  installerName: 'Aixflow Installer',
  heroDescLine1: 'Glass-style local installer · Download the full package to your chosen folder',
  heroDescLine2: 'No standard NSIS wizard UI',
  updateHeroLine1: 'A powerful AI workflow builder and manager',
  updateHeroLine2: 'Drag-and-drop · Modular · High performance',
  updateInstallingHint: 'Exiting to launch the installer shortly…',
  statusReady: 'Ready to download and install Aixflow',
  statusResolving: 'Resolving package…',
  statusDownloading: 'Downloading Aixflow package',
  statusDownloadingStub: 'Downloading bootstrapper…',
  statusDownloadingPackage: 'Downloading main package (large file — please wait)…',
  statusDownloadingWaiting: 'Still downloading (slow network or connecting — progress may pause briefly)…',
  statusPaused: 'Download paused',
  statusInstalling: 'Installing Aixflow',
  statusDone: 'Installation complete',
  statusError: 'Something went wrong',
  statusCancelled: 'Cancelled',
  downloaded: 'Downloaded',
  remaining: 'Left',
  paused: 'Paused',
  installingHint: 'Quietly installing to',
  installingWait: 'Please wait, writing files…',
  fileName: 'File name',
  fileSize: 'File size',
  cacheDir: 'Cache folder',
  systemTemp: 'System temp folder',
  installDir: 'Install folder',
  browse: 'Browse',
  browseTitle: 'Choose install folder',
  installDirAria: 'Application install folder',
  installDirHint:
    'The app will install here. After download it installs silently — no NSIS “Choose Install Location” wizard.',
  updateCacheDir: 'Update cache folder',
  updateInstallHint:
    'In-app updates keep the existing install path. For first-time installs from the website, use Aixflow-Installer (folder selectable).',
  startInstall: 'Start Install',
  preparing: 'Preparing…',
  continue: 'Resume',
  pause: 'Pause',
  cancel: 'Cancel',
  launch: 'Launch Aixflow',
  installedTo: 'Installed to',
  langZh: '中文',
  langEn: 'EN',
  langToggleAria: 'Switch language',
  downloadRouteAria: 'Choose installer download region',
  downloadRouteBeijing: 'Beijing',
  downloadRouteHongKong: 'Hong Kong',
  downloadRouteHint: 'Same version. Pick the faster route: Beijing is usually faster in mainland China; Hong Kong is usually faster overseas.',
  idleChooseRoute: 'Choose update region',
  idleCurrentVersion: 'Current version',
  actionCheckUpdate: 'Check for updates',
  actionDownloadInstall: 'Download and install',
  idleChecking: 'Checking for updates…',
  idleLatest: 'You are on the latest version',
  idleHasUpdate: 'New version available',
  connectFailed: 'Could not connect to installer process',
  launchFailed: 'Failed to launch',
};

const STORAGE_KEY = 'aixflow.installer.locale';
const REGION_STORAGE_KEY = 'aixflow.installer.downloadRegion';

export function installerWizardT(locale: InstallerLocale): InstallerWizardStrings {
  return locale === 'en' ? en : zh;
}

type LocaleStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function browserLocalStorage(): LocaleStorage | null {
  try {
    const g = globalThis as { localStorage?: LocaleStorage };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readInstallerLocale(): InstallerLocale {
  try {
    const v = browserLocalStorage()?.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'zh') return v;
  } catch {
    /* ignore */
  }
  return 'zh';
}

export function writeInstallerLocale(locale: InstallerLocale) {
  try {
    browserLocalStorage()?.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export function readInstallerDownloadRegion(locale: InstallerLocale): 'cn' | 'hk' {
  try {
    const v = browserLocalStorage()?.getItem(REGION_STORAGE_KEY);
    if (v === 'cn' || v === 'hk') return v;
  } catch {
    /* ignore */
  }
  return locale === 'en' ? 'hk' : 'cn';
}

export function writeInstallerDownloadRegion(region: 'cn' | 'hk') {
  try {
    browserLocalStorage()?.setItem(REGION_STORAGE_KEY, region);
  } catch {
    /* ignore */
  }
}
