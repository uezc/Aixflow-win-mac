import { mediaObjectUrl, remapMediaUrlToSite } from '../lib/siteRegion';

export const LOGO_URL = '/aixflow-landing-logo.png';

/** 官网展示视频对象键（北京/香港桶同名各存一份，用 mediaObjectUrl 按站点取） */
export const MARQUEE_VIDEO_KEYS = ['A.mp4', 'B.mp4', 'C.mp4', 'D.mp4'] as const;
export const FEATURE_VIDEO_KEYS = ['AA.mp4', 'BB.mp4'] as const;
export const PROJECT_EXTRA_VIDEO_KEY = 'CC.mp4';
export const PAY_GUIDE_VIDEO_KEY = '支付方法.mp4';

/** @deprecated 请用 getMarqueeVideos()；保留字段仅为兼容静态引用排查 */
export const MARQUEE_VIDEOS = MARQUEE_VIDEO_KEYS.map((k) => mediaObjectUrl(k, 'cn'));

export function getMarqueeVideos(): string[] {
  return MARQUEE_VIDEO_KEYS.map((k) => mediaObjectUrl(k));
}

export function getFeatureVideos(): string[] {
  return FEATURE_VIDEO_KEYS.map((k) => mediaObjectUrl(k));
}

export const BOOK_URL = 'https://halaskastudio.com/./book';

/** 页脚备案信息 */
export const LEGAL_FOOTER = {
  companyName: '宜昌地心引力科技有限公司',
  icp: '鄂ICP备2026026876号-1',
  icpUrl: 'https://beian.miit.gov.cn/',
  gongan: '鄂公网安备42050002421020号',
  gonganUrl: 'http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=42050002421020',
};

export type SocialLinkItem = {
  id: string;
  label: string;
  href?: string;
  /** 账号展示；无 href 时可点击复制（如微信号） */
  detail?: string;
};

/** 联系方式：统一在此维护 */
export const SOCIAL_LINKS: SocialLinkItem[] = [
  { id: 'bilibili', label: 'B站', href: 'https://space.bilibili.com/85935882' },
  { id: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@%E4%B8%80%E5%B7%9D-o7v8g' },
  { id: 'douyin', label: '抖音', href: 'https://v.douyin.com/pVzE6J1peaA/' },
  { id: 'discord', label: 'Discord', href: 'https://discord.gg/TJN5RxQ3' },
  { id: 'wechat', label: '微信', detail: 'howells532' },
  {
    id: 'qq',
    label: 'QQ',
    href: 'https://wpa.qq.com/msgrd?v=3&uin=307908369&site=qq&menu=yes',
    detail: '307908369',
  },
];

export type FeatureCardGroup = { label: string; text: string };

export type FeatureCard = {
  title: string;
  summary: string;
  groups: FeatureCardGroup[];
};

/** 官网功能卡：仅罗列功能，极简分组 */
export const FEATURE_CARDS: FeatureCard[] = [
  {
    title: '无限画布',
    summary: '拖拽连线，搭建 AI 工作流。',
    groups: [
      { label: '节点', text: '文本 · LLM · 文本拆分 · 图片 · 视频 · 音频 · 角色 · 3D 视角' },
      { label: '画布', text: '实时保存 · 缩放平移 · 曲线 / 直角连线 · 批量运行 · 工程导出' },
      { label: 'LLM', text: '对话 · 续写 · 改写 · 人设保存' },
    ],
  },
  {
    title: 'AI 生产',
    summary: '多模态生成与处理，一键跑通链路。',
    groups: [
      { label: '图片', text: '文生图 · 图生图 · 放大 · 抠图 · 去水印 · 3D 视角' },
      { label: '视频', text: '文生视频 · 图生视频 · 口型同步 · 裁剪 · 下载' },
      { label: '音频', text: '语音合成 · 参考音克隆 · 写歌 · 人声分离 · 裁剪' },
      { label: '角色', text: '视频生角色 · 保存角色库 · 工作流复用' },
    ],
  },
];

export type ScenarioCard = {
  quote: string;
  tag: string;
};

/** 使用场景轮播：审核后可改 quote / tag，或增删条目 */
export const SCENARIO_CARDS: ScenarioCard[] = [
  {
    quote: '不用在多个工具间来回切换。文案、图片、视频、音频都在一张画布里完成。',
    tag: '内容创作者',
  },
  {
    quote: '主图、详情素材、短视频在同一流程里批量产出，改提示词就能整条链路重跑。',
    tag: '电商团队',
  },
  {
    quote: '长脚本拆分、配音、口型视频串联，适合营销内容快速试创意、试风格。',
    tag: '营销团队',
  },
  {
    quote: '工程可保存、可导出，小团队也能复用同一套生产模板，减少重复搭建。',
    tag: '工作室',
  },
  {
    quote: '从单个节点起步，逐步扩展成完整自动化流程，适合从试用到规模化生产。',
    tag: '企业团队',
  },
];

export type ProjectItem = {
  name: string;
  description: string;
  videoKey: string;
};

/** 官网公开「元宝充值套餐」说明（支付宝电脑网站支付合规公示，与客户端充值档位一致） */
export const RECHARGE_PAGE = {
  eyebrow: '商品与价格公示',
  title: 'Aixflow 元宝充值套餐',
  summary:
    '元宝是 Aixflow 桌面端内用于调用 AI 生成与处理能力的虚拟点数。下列为当前对外销售的固定充值商品档位与标价（人民币），与软件内一致。',
  /** 套餐卡片下方：客户端内支付宝充值操作演示 */
  payGuideTitle: '支付方法演示',
  payGuideVideoKey: PAY_GUIDE_VIDEO_KEY,
  howTitle: '如何购买',
  howSteps: [
    '在本站下载并安装 Aixflow Windows 客户端',
    '打开软件并登录账号',
    '进入「设置」→ 选择充值套餐 → 使用支付宝完成付款',
    '支付成功后元宝将自动充入当前登录账户',
  ],
  serviceTitle: '服务说明',
  serviceText:
    '充值商品为虚拟数字商品「元宝」。到账后可用于本软件内 AI 文生图/视频、对话、音频等按次计费功能；元宝永久有效，不设有效期。本页仅作商品与价格公示，不在网页端直接收款；实际支付在官方桌面客户端内通过支付宝完成。',
  refundTitle: '退换与售后',
  refundText:
    '虚拟商品一经充值到账，除因系统故障导致未到账或重复扣款等情况外，原则上不支持无理由退款。如遇支付异常、未到账或对账单有疑问，请通过本页客服渠道联系我们核查处理。',
};

export function getPayGuideVideoUrl(): string {
  return mediaObjectUrl(RECHARGE_PAGE.payGuideVideoKey);
}

/** 案例演示区 */
export const PROJECT_DEFS: ProjectItem[] = [
  {
    name: '无限画布',
    description: '拖拽节点，串联 LLM、图片、视频、音频。',
    videoKey: MARQUEE_VIDEO_KEYS[0],
  },
  {
    name: '内容批量生产',
    description: '从文案到主图、短视频，同一流程反复迭代。',
    videoKey: PROJECT_EXTRA_VIDEO_KEY,
  },
  {
    name: '多模态成片',
    description: '配音、口型、角色与工作流复用。',
    videoKey: MARQUEE_VIDEO_KEYS[2],
  },
  {
    name: '自动化生产链',
    description: '一键批量运行，从单点工具到完整生产线。',
    videoKey: MARQUEE_VIDEO_KEYS[3],
  },
];

export function getProjects(): Array<{ name: string; description: string; video: string }> {
  return PROJECT_DEFS.map((p) => ({
    name: p.name,
    description: p.description,
    video: mediaObjectUrl(p.videoKey),
  }));
}

/** @deprecated 用 getProjects() */
export const PROJECTS = PROJECT_DEFS.map((p) => ({
  name: p.name,
  description: p.description,
  video: mediaObjectUrl(p.videoKey, 'cn'),
}));

/** @deprecated 用 getFeatureVideos() */
export const FEATURE_VIDEOS = FEATURE_VIDEO_KEYS.map((k) => mediaObjectUrl(k, 'cn'));

export { remapMediaUrlToSite, mediaObjectUrl };
