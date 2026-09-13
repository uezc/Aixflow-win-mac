/**
 * 短剧场景「地点时代」推断：避免全片古风题材锁污染现代场景（如电竞房渗入山水古建）。
 */

export type DramaSceneSettingPeriod = 'modern' | 'ancient' | 'neutral';

const MODERN_SETTING_RE =
  /电竞|直播间|网吧|机房|服务器|公寓|写字楼|办公室|地铁|咖啡|便利店|商场|医院|教室|酒吧|酒店客房|现代|当代|都市|霓虹|玻璃幕墙|显示[器屏]|曲屏|键盘|鼠标|机械键盘|游戏椅|RGB|手机|电脑桌|办公桌/;

const ANCIENT_SETTING_RE =
  /山谷|朔风|宗门|仙府|洞府|殿堂|寺庙|古道|竹林|瀑布|青石|香炉|匾额|城墙|山门|修仙|武馆|府邸|衙门|厢房|客栈|茶楼|亭台|楼阁|宝塔|飞檐|青瓦|水墨|汉服|仙侠|玄幻|江湖|古装|道观|牌坊|石狮|厢廊/;

const ANCIENT_ERA_RE =
  /古装|仙侠|玄幻|武侠|汉服|修仙|江湖|朝代|古代|唐宋|明清|秦汉|三国|国风|水墨|飞升|宗门/;

const MODERN_ERA_RE = /现代|都市|当代|赛博|霓虹|科幻|职场|甜宠|霸总/;

export function inferDramaSceneSettingPeriod(
  ...parts: Array<string | undefined | null>
): DramaSceneSettingPeriod {
  const t = parts
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join('\n');
  if (!t) return 'neutral';
  const modern = MODERN_SETTING_RE.test(t);
  const ancient = ANCIENT_SETTING_RE.test(t);
  if (modern && !ancient) return 'modern';
  if (ancient && !modern) return 'ancient';
  if (modern && ancient) {
    // 陈设硬事实优先：电竞设备压过地名里的古风词
    if (/电竞|显示[器屏]|键盘|直播|游戏椅|RGB/.test(t)) return 'modern';
    return 'ancient';
  }
  return 'neutral';
}

/** 项目级时代/题材词是否可写入该场景卡 */
export function isDramaSceneEraCompatible(
  period: DramaSceneSettingPeriod,
  eraStyle: string,
): boolean {
  const e = String(eraStyle || '').trim();
  if (!e || period === 'neutral') return true;
  if (period === 'modern' && ANCIENT_ERA_RE.test(e)) return false;
  if (period === 'ancient' && MODERN_ERA_RE.test(e) && !ANCIENT_ERA_RE.test(e)) return false;
  return true;
}

/** 背景故事摘要是否会把冲突时代灌进场景 */
export function isDramaSceneStoryContextCompatible(
  period: DramaSceneSettingPeriod,
  storyContext: string,
): boolean {
  const s = String(storyContext || '').trim();
  if (!s || period === 'neutral') return true;
  if (period === 'modern' && ANCIENT_ERA_RE.test(s) && !MODERN_SETTING_RE.test(s)) return false;
  if (period === 'ancient' && /电竞|写字楼|公寓直播|赛博霓虹都市/.test(s)) return false;
  return true;
}

/** 风格预设/自定义风格是否偏古风（用于决定是否禁用风格参考图） */
export function dramaStyleHintLooksAncient(styleHint: string): boolean {
  return ANCIENT_ERA_RE.test(String(styleHint || ''));
}

/**
 * 场景生图 styleHint：只留光色/画质词；现代场景剥掉古风题材词。
 */
export function sanitizeDirectorStyleHintForScene(
  styleHint: string | undefined | null,
  period: DramaSceneSettingPeriod,
): string {
  let t = String(styleHint || '').trim();
  if (!t) return '';
  if (period === 'modern') {
    t = t
      .replace(/中国古装玄幻[^；;，,]*/g, '')
      .replace(/古装[^；;，,]*/g, '')
      .replace(/仙侠[^；;，,]*/g, '')
      .replace(/玄幻[^；;，,]*/g, '')
      .replace(/武侠[^；;，,]*/g, '')
      .replace(/汉服[^；;，,]*/g, '')
      .replace(/国风[^；;，,]*/g, '')
      .replace(/水墨[^；;，,]*/g, '')
      .replace(/冷色仙气[^；;，,]*/g, '')
      .replace(/江湖写实[^；;，,]*/g, '')
      .replace(/[；;，,]{2,}/g, '；')
      .replace(/^[；;，,\s]+|[；;，,\s]+$/g, '')
      .trim();
  }
  return t;
}

export function dramaScenePeriodHardLockLine(period: DramaSceneSettingPeriod): string {
  if (period === 'modern') {
    return (
      '【场景时代锁·现代·硬性】本场景为当代现代空间：建筑、装修、窗外视野与装饰必须是现代都市/现代室内；' +
      '禁止山水、宝塔、飞檐、亭台楼阁、水墨远山、仙侠地貌、古装人物海报作为窗外或主墙主景；' +
      '禁止把直播间/电竞房画成古风殿堂或开窗直通仙侠山谷。'
    );
  }
  if (period === 'ancient') {
    return (
      '【场景时代锁·古风·硬性】本场景为古代/传统语境空间：禁止现代霓虹都市天际线、玻璃幕墙写字楼、' +
      '电竞RGB机箱、曲面显示器墙、当代潮牌海报作为主景。'
    );
  }
  return '';
}
