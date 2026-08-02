/**
 * 官网中英文文案。组件通过 useSiteLocale().t 取词。
 */
import type { FeatureCard, ScenarioCard } from './content';
import type { RechargePackageId, RechargePackageTag } from '../../../shared/rechargePackages';

export type SiteLocale = 'zh' | 'en';

export type SiteCopy = {
  metaTitle: string;
  metaDescription: string;
  navRecharge: string;
  navDownload: string;
  navContact: string;
  langToggleAria: string;
  heroBrand: string;
  heroEyebrow: string;
  heroLine1: string;
  heroLine2: string;
  heroP1: string;
  heroP2a: string;
  heroP2b: string;
  heroP2c: string;
  heroP3: string;
  viewRecharge: string;
  startUsing: string;
  preparingDownload: string;
  installerUnavailable: string;
  downloadTitleWin: string;
  downloadTitleMac: string;
  canvasTitle: string;
  canvasSubtitle: string;
  youCan: string;
  youCanItems: string[];
  scenariosTitleBefore: string;
  scenariosTitleAfter: string;
  scenariosCount: (n: number) => string;
  contactTitle: string;
  contactSubtitle: string;
  contactUs: string;
  copyrightAllRights: (name: string) => string;
  featureCards: FeatureCard[];
  scenarioCards: ScenarioCard[];
  projects: Array<{ name: string; description: string }>;
  recharge: {
    eyebrow: string;
    title: string;
    summary: string;
    payGuideTitle: string;
    payGuideHint: string;
    videoUnsupported: string;
    openPayGuide: string;
    howTitle: string;
    howSteps: string[];
    serviceTitle: string;
    serviceText: string;
    refundTitle: string;
    refundText: string;
    salesAndSupportTitle: string;
    supportOnlyTitle: string;
    salesEntity: (name: string) => string;
    officialSite: string;
    supportLabel: (label: string, detail?: string) => string;
    contactEntry: string;
    downloadToBuy: string;
    contactSupport: string;
    cny: string;
    credited: (total: number) => string;
    includesBonus: (base: number, bonus: number) => string;
    baseOnly: (base: number) => string;
    productName: (label: string) => string;
    videoFallback: string;
  };
  packageLabel: Record<RechargePackageId, string>;
  packageTag: Record<RechargePackageTag, string>;
  social: {
    copyWechatPrompt: string;
    copiedWechat: string;
  };
};

const ZH: SiteCopy = {
  metaTitle: 'AIXFLOW — AI工作流与内容生产平台',
  metaDescription: 'AIXFLOW — AI工作流与内容生产平台，一体化AI生产系统，让创意直接变成结果。',
  navRecharge: '充值套餐',
  navDownload: '下载',
  navContact: '联系',
  langToggleAria: '切换语言',
  heroBrand: '地心引力聚合平台Aixflow',
  heroEyebrow: 'AI工作流与内容生产平台',
  heroLine1: '一体化AI生产系统',
  heroLine2: '让创意直接变成结果',
  heroP1: '连接AI模型、工作流与自动化流程，\n在一个无限画布中完成内容生产与业务执行。',
  heroP2a: '从电商内容到营销素材，',
  heroP2b: '从文案生成到视频与图像，',
  heroP2c: '从单点工具到完整生产线。',
  heroP3: '为创作者、团队与企业打造。',
  viewRecharge: '查看充值套餐',
  startUsing: '开始使用',
  preparingDownload: '准备下载…',
  installerUnavailable: '安装包暂不可用',
  downloadTitleWin: 'Windows 安装包',
  downloadTitleMac: 'macOS 安装包',
  canvasTitle: '无限AI工作画布',
  canvasSubtitle: '不只是工具，而是生产系统',
  youCan: '你可以：',
  youCanItems: ['拖拽节点', '组合AI能力', '构建自动流程', '一键执行整个任务链'],
  scenariosTitleBefore: '他们这样用 ',
  scenariosTitleAfter: '',
  scenariosCount: (n) => `${n} 种典型场景`,
  contactTitle: '联系我们',
  contactSubtitle: '教程、更新与交流，欢迎通过以下方式找到我们。',
  contactUs: '联系我们',
  copyrightAllRights: (name) => `© ${name} 版权所有`,
  featureCards: [
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
  ],
  scenarioCards: [
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
  ],
  projects: [
    { name: '无限画布', description: '拖拽节点，串联 LLM、图片、视频、音频。' },
    { name: '内容批量生产', description: '从文案到主图、短视频，同一流程反复迭代。' },
    { name: '多模态成片', description: '配音、口型、角色与工作流复用。' },
    { name: '自动化生产链', description: '一键批量运行，从单点工具到完整生产线。' },
  ],
  recharge: {
    eyebrow: '商品与价格公示',
    title: 'Aixflow 元宝充值套餐',
    summary:
      '元宝是 Aixflow 桌面端内用于调用 AI 生成与处理能力的虚拟点数。下列为当前对外销售的固定充值商品档位与标价（人民币），与软件内一致。',
    payGuideTitle: '支付方法演示',
    payGuideHint: '客户端内选择套餐后使用支付宝付款的操作演示',
    videoUnsupported: '您的浏览器不支持视频播放，请',
    openPayGuide: '打开支付方法演示',
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
    salesAndSupportTitle: '销售主体与客服',
    supportOnlyTitle: '客服',
    salesEntity: (name) => `销售主体：${name}`,
    officialSite: '官方网站：https://aixflow.com.cn/',
    supportLabel: (label, detail) => (detail ? `客服：${label} ${detail}` : `客服：${label}`),
    contactEntry: '联系入口',
    downloadToBuy: '下载客户端购买',
    contactSupport: '联系客服',
    cny: '人民币',
    credited: (total) => `到账 ${total} 元宝`,
    includesBonus: (base, bonus) => `含基础 ${base} + 套餐赠送 ${bonus}`,
    baseOnly: (base) => `基础 ${base} 元宝`,
    productName: (label) => `商品名称：Aixflow ${label}（元宝充值）`,
    videoFallback: '。',
  },
  packageLabel: {
    starter: '入门包',
    popular: '标准包',
    value: '进阶包',
    premium: '尊享包',
  },
  packageTag: {
    most_popular: '热门',
    best_value: '超值',
    max_discount: '最大加赠',
  },
  social: {
    copyWechatPrompt: '复制微信号',
    copiedWechat: '已复制微信号',
  },
};

const EN: SiteCopy = {
  metaTitle: 'AIXFLOW — AI Workflow & Content Production',
  metaDescription:
    'AIXFLOW — AI workflow and content production platform. An all-in-one AI production system that turns ideas into results.',
  navRecharge: 'Credits',
  navDownload: 'Download',
  navContact: 'Contact',
  langToggleAria: 'Switch language',
  heroBrand: 'Aixflow by Gravity',
  heroEyebrow: 'AI workflow & content production',
  heroLine1: 'All-in-one AI production',
  heroLine2: 'From idea to finished output',
  heroP1: 'Connect models, workflows, and automation\non one infinite canvas for content and ops.',
  heroP2a: 'From e-commerce assets to campaigns,',
  heroP2b: 'from copy to video and imagery,',
  heroP2c: 'from single tools to a full production line.',
  heroP3: 'Built for creators, teams, and businesses.',
  viewRecharge: 'View credit packs',
  startUsing: 'Get started',
  preparingDownload: 'Preparing download…',
  installerUnavailable: 'Installer unavailable',
  downloadTitleWin: 'Windows installer',
  downloadTitleMac: 'macOS installer',
  canvasTitle: 'Infinite AI canvas',
  canvasSubtitle: 'Not just tools — a production system',
  youCan: 'You can:',
  youCanItems: ['Drag nodes', 'Compose AI capabilities', 'Build automated flows', 'Run the whole chain in one click'],
  scenariosTitleBefore: 'How teams use ',
  scenariosTitleAfter: '',
  scenariosCount: (n) => `${n} typical scenarios`,
  contactTitle: 'Contact us',
  contactSubtitle: 'Tutorials, updates, and community — reach us through the channels below.',
  contactUs: 'Contact us',
  copyrightAllRights: (name) => `© ${name}. All rights reserved.`,
  featureCards: [
    {
      title: 'Infinite canvas',
      summary: 'Drag, connect, and build AI workflows.',
      groups: [
        { label: 'Nodes', text: 'Text · LLM · Text split · Image · Video · Audio · Character · 3D view' },
        { label: 'Canvas', text: 'Autosave · Pan/zoom · Curve/orthogonal edges · Batch run · Project export' },
        { label: 'LLM', text: 'Chat · Continue · Rewrite · Persona presets' },
      ],
    },
    {
      title: 'AI production',
      summary: 'Multimodal generate & process — run the pipeline in one go.',
      groups: [
        { label: 'Image', text: 'Text-to-image · Image-to-image · Upscale · Matting · Watermark remove · 3D view' },
        { label: 'Video', text: 'Text-to-video · Image-to-video · Lip sync · Crop · Download' },
        { label: 'Audio', text: 'TTS · Voice clone · Song · Vocal split · Crop' },
        { label: 'Character', text: 'Video-to-character · Library · Reuse in workflows' },
      ],
    },
  ],
  scenarioCards: [
    {
      quote: 'No more hopping between apps. Copy, images, video, and audio on one canvas.',
      tag: 'Creators',
    },
    {
      quote: 'Hero shots, detail assets, and short videos from one flow — change the prompt and re-run.',
      tag: 'E-commerce',
    },
    {
      quote: 'Split long scripts, add voiceover, and lip-sync video for fast creative tests.',
      tag: 'Marketing',
    },
    {
      quote: 'Save and export projects so small teams reuse the same production templates.',
      tag: 'Studios',
    },
    {
      quote: 'Start with one node and grow into full automation — from trial to scale.',
      tag: 'Enterprises',
    },
  ],
  projects: [
    { name: 'Infinite canvas', description: 'Drag nodes to chain LLM, image, video, and audio.' },
    { name: 'Batch content', description: 'From copy to hero shots and short videos in one iterable flow.' },
    { name: 'Multimodal output', description: 'Voice, lip sync, characters, and reusable workflows.' },
    { name: 'Automated line', description: 'One-click batch runs — from single tools to a production line.' },
  ],
  recharge: {
    eyebrow: 'Products & pricing',
    title: 'Aixflow credit packs',
    summary:
      'Yuanbao credits power AI generate & process features in the Aixflow desktop app. Below are the current fixed packs and list prices (CNY), matching in-app pricing.',
    payGuideTitle: 'Payment walkthrough',
    payGuideHint: 'Demo of choosing a pack and paying with Alipay inside the desktop client',
    videoUnsupported: 'Your browser cannot play this video. ',
    openPayGuide: 'Open payment demo',
    howTitle: 'How to buy',
    howSteps: [
      'Download and install the Aixflow Windows client from this site',
      'Open the app and sign in',
      'Go to Settings → choose a pack → pay with Alipay',
      'Credits are added to the signed-in account after payment succeeds',
    ],
    serviceTitle: 'Service notes',
    serviceText:
      'Packs sell virtual “Yuanbao” credits for in-app AI features (image/video, chat, audio, etc.). Credits do not expire. This page is a public price list only — checkout happens in the official desktop client via Alipay, not in the browser.',
    refundTitle: 'Refunds & support',
    refundText:
      'Once credits are delivered, refunds are generally not available except for failures such as undelivered credits or duplicate charges. For payment issues, contact support via the channels on this page.',
    salesAndSupportTitle: 'Seller & support',
    supportOnlyTitle: 'Support',
    salesEntity: (name) => `Seller: ${name}`,
    officialSite: 'Website: https://aixflow.com.cn/',
    supportLabel: (label, detail) => (detail ? `Support: ${label} ${detail}` : `Support: ${label}`),
    contactEntry: 'Open chat',
    downloadToBuy: 'Download client to buy',
    contactSupport: 'Contact support',
    cny: 'CNY',
    credited: (total) => `${total} credits`,
    includesBonus: (base, bonus) => `Base ${base} + bonus ${bonus}`,
    baseOnly: (base) => `Base ${base} credits`,
    productName: (label) => `Product: Aixflow ${label} (credits)`,
    videoFallback: '.',
  },
  packageLabel: {
    starter: 'Starter',
    popular: 'Standard',
    value: 'Pro',
    premium: 'Premium',
  },
  packageTag: {
    most_popular: 'Popular',
    best_value: 'Best value',
    max_discount: 'Max bonus',
  },
  social: {
    copyWechatPrompt: 'Copy WeChat ID',
    copiedWechat: 'WeChat ID copied',
  },
};

export const SITE_COPY: Record<SiteLocale, SiteCopy> = { zh: ZH, en: EN };
