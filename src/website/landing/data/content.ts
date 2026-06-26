export const LOGO_URL = '/aixflow-landing-logo.png';

/** 16:9 展示短片，后续可在数组末尾追加 OSS 链接 */
export const MARQUEE_VIDEOS = [
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/A.mp4',
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/B.mp4',
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/C.mp4',
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/D.mp4',
];

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
  video: string;
};

/** 案例演示区：暂用 A–D 占位，后续可换录屏链接 */
export const PROJECTS: ProjectItem[] = [
  {
    name: '无限画布',
    description: '拖拽节点，串联 LLM、图片、视频、音频。',
    video: MARQUEE_VIDEOS[0],
  },
  {
    name: '内容批量生产',
    description: '从文案到主图、短视频，同一流程反复迭代。',
    video: 'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/CC.mp4',
  },
  {
    name: '多模态成片',
    description: '配音、口型、角色与工作流复用。',
    video: MARQUEE_VIDEOS[2],
  },
  {
    name: '自动化生产链',
    description: '一键批量运行，从单点工具到完整生产线。',
    video: MARQUEE_VIDEOS[3],
  },
];

/** 评价区固定展示视频，播完自动切下一支，可在数组末尾追加 */
export const FEATURE_VIDEOS = [
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/AA.mp4',
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/BB.mp4',
];
