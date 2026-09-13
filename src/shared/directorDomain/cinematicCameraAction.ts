/**
 * 按镜头语言（目的 / 情绪 / 节拍位置 / 对白）写成电影级运镜句。
 * 确定性映射，不随机抽模板。
 */

import type { DramaLockedCamera } from './directorCameraSchema.js';
import type { DramaShot, DramaTimelineEvent } from './types.js';

export type DramaCamBeatRole =
  | 'establish'
  | 'action'
  | 'dialogue'
  | 'listen'
  | 'reveal'
  | 'climax'
  | 'hold'
  | 'exit';

export type DramaCamEmotionLane =
  | 'power'
  | 'pressure'
  | 'anxiety'
  | 'fear'
  | 'anger'
  | 'despair'
  | 'shock'
  | 'chase'
  | 'confront'
  | 'tender'
  | 'calm';

export type DramaCinematicCameraRecipe = {
  size: string;
  angle: string;
  move: string;
  lens: string;
  composition: string;
  intent: string;
  locked: DramaLockedCamera;
};

const THIN_CAM_RE =
  /^(?:中景|近景|全景|特写|中近景)?\s*[·｜|]*\s*(?:正面|平视)?\s*[·｜|]*\s*(?:固定(?:镜头)?|缓慢推入)?(?:｜\d+mm｜(?:三分法|三分构图|居中构图))?$/;

export function isThinDramaCameraAction(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return true;
  if (
    /斯坦尼康|希区柯克|过肩|虫眼|窒息推|上帝|贴地飞行|剥离拉远|手持崩坏|框架推门|双人拉锯|环绕审视|慢速横摇|急推变焦/.test(
      t,
    )
  ) {
    return false;
  }
  if (t.length < 10) return true;
  if (THIN_CAM_RE.test(t)) return true;
  if (/^(?:中景|近景|全景)\s*[·｜]\s*(?:正面|平视)\s*[·｜]\s*固定/.test(t) && t.length < 28) {
    return true;
  }
  if (/^(?:全景|中景|近景)｜平视｜(?:固定|缓慢推入)｜\d+mm/.test(t) && t.length < 40) {
    return true;
  }
  return false;
}

function blobOf(shot: Partial<DramaShot>, ev?: Partial<DramaTimelineEvent>): string {
  return [
    shot.purpose,
    shot.dramatic_purpose,
    shot.action,
    shot.expression,
    shot.visual_focus,
    ev?.visual_action,
    ev?.character_state,
    ev?.expression,
    ev?.dialogue,
    ev?.camera_action,
  ]
    .map((x) => String(x || ''))
    .join(' ');
}

export function inferDramaCamBeatRole(
  shot: Partial<DramaShot>,
  ev: Partial<DramaTimelineEvent> | undefined,
  index: number,
  total: number,
): DramaCamBeatRole {
  const visual = String(ev?.visual_action || '');
  const dlg = String(ev?.dialogue || '').trim();
  const shotBlob = `${shot.purpose || ''} ${shot.dramatic_purpose || ''} ${shot.action || ''}`;
  if (index === 0 && total > 1 && !dlg) return 'establish';
  if (index === 0 && dlg) return 'dialogue';
  if (index === total - 1 && !dlg && /维持|余韵|黑屏|过渡|呼吸起伏/.test(visual)) return 'exit';
  if (index === total - 1 && !dlg && /结果|抽离|离开/.test(shotBlob)) return 'exit';
  if (dlg && index > 0 && !ev?.lip_sync && /听|对视|反应/.test(visual)) return 'listen';
  if (dlg) return 'dialogue';
  if (/揭示|发现|看见|揭晓|宣判|灵根|资质|秘密|系统|屏幕|商城|界面|手机/.test(`${visual} ${shotBlob} ${dlg}`)) return 'reveal';
  if (/爆发|怒吼|打架|追逐|闯入|崩坏|急停|砸/.test(`${visual} ${shotBlob}`)) return 'climax';
  if (/维持|余韵|黑屏|过渡/.test(visual)) return 'hold';
  if (/进入|站定|交代|环境/.test(visual) && index === 0) return 'establish';
  return 'action';
}

export function inferDramaCamEmotionLane(
  shot: Partial<DramaShot>,
  ev?: Partial<DramaTimelineEvent>,
): DramaCamEmotionLane {
  const blob = blobOf(shot, ev);
  if (/权|压迫|审判|俯视|宣判|长老|等级|跪/.test(blob)) return 'power';
  if (/对峙|质问|还来|管饭|顶嘴|反驳/.test(blob)) return 'confront';
  if (/追|赶|逃|闯|骑|跑/.test(blob)) return 'chase';
  if (/怒|爆发|砸|吼|打脸|战斗|混战/.test(blob)) return 'anger';
  if (/恐|被看|凝视|虫眼|窒息/.test(blob)) return 'fear';
  if (/绝望|放弃|抽离|垮|孤独|失落/.test(blob)) return 'despair';
  if (/震惊|揭|突然|反转|变身/.test(blob)) return 'shock';
  if (/焦虑|慌|不安|试探/.test(blob)) return 'anxiety';
  if (/压抑|沉|克制|冷/.test(blob)) return 'pressure';
  if (/温柔|亲密|笑|暖/.test(blob)) return 'tender';
  return 'calm';
}

function recipe(
  size: DramaLockedCamera['shotSize'],
  angle: DramaLockedCamera['cameraAngle'],
  movement: DramaLockedCamera['cameraMovement'],
  lensMm: DramaLockedCamera['lensMm'],
  composition: DramaLockedCamera['composition'],
  sizeZh: string,
  angleZh: string,
  moveZh: string,
  compositionZh: string,
  intent: string,
): DramaCinematicCameraRecipe {
  return {
    size: sizeZh,
    angle: angleZh,
    move: moveZh,
    lens: `${lensMm}mm`,
    composition: compositionZh,
    intent,
    locked: { shotSize: size, cameraAngle: angle, cameraMovement: movement, lensMm, composition },
  };
}

/** role:lane → 主方案 + 对仗方案（邻段撞车时用第二条，不随机） */
const RECIPE_BANK: Record<string, DramaCinematicCameraRecipe[]> = {
  'establish:calm': [
    recipe('wide', 'high', 'slow_pull_out', 24, 'negative_space', '远景', '高机位上帝俯', '倒飞揭示，镜头后退上升，人物缩成点', '负空间', '先认人再看见世界有多大'),
    recipe('wide', 'high', 'slow_push_in', 24, 'thirds', '远景', '高角度上帝降', '垂直上升揭示后悬停俯冲到站位', '三分构图', '先给空间地图再落到人物'),
  ],
  'establish:power': [
    recipe('wide', 'high', 'orbit', 24, 'center', '远景', '高角度上帝降', '顶部俯拍缓慢环绕审视', '居中构图', '空间权力压住进场者'),
    recipe('full', 'low', 'slow_push_in', 24, 'thirds', '全景', '低机位仰拍', '极低机位超广角缓推入', '三分构图', '门槛与屋顶压住人物'),
  ],
  'establish:pressure': [
    recipe('medium', 'high', 'slow_push_in', 35, 'foreground_obstruction', '中景', '微俯', '窒息推轨 0.2m/s，前景遮挡', '前景遮挡', '进场即被空间挤住'),
    recipe('full', 'eye', 'follow', 35, 'frame_in_frame', '全景', '平视', '框架推门跟入，呼吸微晃', '框中框', '跟入时门框切割画面'),
  ],
  'action:calm': [
    recipe('medium', 'eye', 'follow', 35, 'thirds', '中景', '平视略偏侧', '斯坦尼康贴身呼吸跟拍，膝高距主体1.2m', '三分构图', '动作落点始终在焦点平面'),
    recipe('full', 'low', 'follow', 24, 'thirds', '全景', '低机位', '贴地飞行跟拍，步伐1:1', '三分构图', '脚位与地面材质可读'),
  ],
  'action:chase': [
    recipe('full', 'low', 'follow', 24, 'thirds', '全景', '贴地低机', '贴地飞行跟拍，水花或尘土入镜时微晃', '三分构图', '赶路紧迫不丢空间'),
    recipe('medium', 'eye', 'handheld', 35, 'center', '中景', '平视', '手持崩坏跟拍，±2°呼吸', '居中构图', '速度压过稳定'),
  ],
  'action:anger': [
    recipe('medium_close', 'low', 'slow_push_in', 35, 'center', '中近景', '低机位仰拍', '急推变焦后接手持崩坏感', '居中构图', '爆发前先压近再碎'),
    recipe('full', 'eye', 'handheld', 24, 'thirds', '全景', '平视', '手持贴身跟打点，撕裂感甩摇≤30°', '三分构图', '动作轴不断'),
  ],
  'dialogue:calm': [
    recipe('medium_close', 'eye', 'static', 50, 'thirds', '中近景', '平视微侧', '过肩呼吸跟拍，听者肩线占前景三分', '三分构图', '说话人眼睛落在上三分'),
    recipe('medium', 'eye', 'slow_push_in', 50, 'thirds', '中景', '平视', '双人拉锯推拉，说话时轻推听话时微退', '三分构图', '对白节奏带动机位'),
  ],
  'dialogue:confront': [
    recipe('medium_close', 'eye', 'static', 85, 'thirds', '中近景', '过肩对切感', '过肩压迫，前景肩背虚化，85mm浅景深隔离', '三分构图', '质问落在听者耳后'),
    recipe('close', 'low', 'slow_push_in', 50, 'center', '近景', '微仰', '窒息推轨对准下颌开合', '居中构图', '不给听者逃出画面'),
  ],
  'dialogue:power': [
    recipe('medium', 'high', 'slow_push_in', 35, 'negative_space', '中景', '俯拍审判', '高角度缓慢降，负空间压住被审者', '负空间', '宣判者占画面上方权力线'),
    recipe('close', 'low', 'static', 85, 'center', '近景', '低机仰拍', '固定仰拍长老面部，被审者只留肩', '居中构图', '权力单向压下来'),
  ],
  'dialogue:pressure': [
    recipe('close', 'eye', 'slow_push_in', 85, 'center', '近景', '平视贴脸', '窒息推近，景深收死背景', '居中构图', '台词压进面中'),
    recipe('medium_close', 'high', 'static', 50, 'foreground_obstruction', '中近景', '微俯', '前景道具遮挡，固定机位只让嘴眼可读', '前景遮挡', '被物压住的对白'),
  ],
  'dialogue:tender': [
    recipe('medium_close', 'eye', 'slow_push_in', 50, 'thirds', '中近景', '平视', '柔和云台慢推，50mm人文感', '三分构图', '亲密但不贴脸畸变'),
    recipe('medium', 'eye', 'static', 50, 'negative_space', '中景', '平视', '负空间留白，固定呼吸', '负空间', '话说完仍留气口'),
  ],
  'listen:calm': [
    recipe('close', 'eye', 'static', 85, 'thirds', '近景', '平视', '听者反应特写，固定，浅景深', '三分构图', '口型关，眼神先动'),
    recipe('medium_close', 'high', 'static', 50, 'foreground_obstruction', '中近景', '微俯', '过肩看听者，前景说话人肩虚', '前景遮挡', '反应比台词更大'),
  ],
  'reveal:shock': [
    recipe('medium_close', 'eye', 'slow_push_in', 50, 'center', '中近景', '平视', '急推变焦 ≤0.5s 对准揭示物', '居中构图', '信息落点压画面中心'),
    recipe('close', 'high', 'static', 85, 'thirds', '近景', '微俯', '变焦切割到证物/玉石/屏幕', '三分构图', '只给结果不给逃路'),
  ],
  'reveal:power': [
    recipe('medium', 'high', 'orbit', 35, 'center', '中景', '俯拍', '环绕审视后停在宣判角度', '居中构图', '揭示即宣判'),
    recipe('close', 'low', 'slow_push_in', 85, 'negative_space', '近景', '仰拍', '希区柯克推拉，背景坠向被审者', '负空间', '空间塌缩到结论'),
  ],
  'climax:anger': [
    recipe('medium_close', 'low', 'handheld', 35, 'center', '中近景', '低机仰拍', '急推后手持崩坏，±3°', '居中构图', '爆发点机位先近后碎'),
    recipe('full', 'eye', 'follow', 24, 'thirds', '全景', '平视', '甩摇切入动作轴，≥90°/s 后刹停', '三分构图', '速度服务击打落点'),
  ],
  'climax:fear': [
    recipe('close', 'low', 'slow_push_in', 24, 'center', '近景', '虫眼仰拍', '低角度虫眼推，超广角畸变', '居中构图', '威胁源压满天空'),
    recipe('medium', 'eye', 'handheld', 35, 'foreground_obstruction', '中景', '平视', 'POV 第一人称闯入，门框挤入', '前景遮挡', '观众被迫变成闯入者'),
  ],
  'hold:calm': [
    recipe('medium', 'eye', 'static', 50, 'thirds', '中景', '平视', '固定机位，胸腔呼吸起伏可读，禁止再推', '三分构图', '余韵只靠表演'),
    recipe('medium_close', 'eye', 'slow_pull_out', 50, 'negative_space', '中近景', '平视', '剥离拉远半档，负空间增大', '负空间', '气口留给下一镜'),
  ],
  'exit:calm': [
    recipe('full', 'eye', 'slow_pull_out', 35, 'thirds', '全景', '平视', '剥离拉远，人物缩进环境', '三分构图', '结束态可交给下一镜'),
    recipe('wide', 'high', 'slow_pull_out', 24, 'negative_space', '远景', '高机', '逆向飞离，空间重新变大', '负空间', '抽离而不是再给特写'),
  ],
  'exit:despair': [
    recipe('full', 'high', 'slow_pull_out', 35, 'negative_space', '全景', '俯拍', '失重漂浮感缓拉，人物变小', '负空间', '放弃后的抽离'),
    recipe('wide', 'eye', 'slow_pull_out', 24, 'thirds', '远景', '平视', '缓拉远+轻微变焦，环境吞掉人', '三分构图', '人不再是构图中心'),
  ],
  'establish:confront': [
    recipe('full', 'eye', 'slow_push_in', 35, 'thirds', '全景', '平视微侧', '慢速横摇扫过对峙轴线后停在两人之间', '三分构图', '先画清对峙距离再压近'),
    recipe('medium', 'low', 'orbit', 35, 'center', '中景', '微仰', '半环绕审视，停在压迫一方肩后', '居中构图', '进场即站边'),
  ],
  'action:power': [
    recipe('medium', 'low', 'slow_push_in', 35, 'center', '中景', '低机仰拍', '极低机位超广角缓推，屋顶压人', '居中构图', '动作被空间权力压住'),
    recipe('full', 'high', 'orbit', 24, 'thirds', '全景', '高角度上帝降', '顶部俯拍缓慢环绕后落动作轴', '三分构图', '从上往下审动作'),
  ],
  'action:pressure': [
    recipe('medium', 'eye', 'follow', 35, 'foreground_obstruction', '中景', '平视', '窒息推轨贴身跟，前景不断切边', '前景遮挡', '动作被通道挤窄'),
    recipe('medium_close', 'high', 'slow_push_in', 50, 'center', '中近景', '微俯', '框架推门跟入后贴住肩背', '居中构图', '空间先于动作'),
  ],
  'dialogue:anger': [
    recipe('close', 'low', 'slow_push_in', 35, 'center', '近景', '低机仰拍', '急推变焦后接手持崩坏感，对准下颌', '居中构图', '怒句压进面中'),
    recipe('medium_close', 'eye', 'handheld', 50, 'thirds', '中近景', '过肩对切感', '过肩压迫，听者肩线抖一下再稳住', '三分构图', '怒气传到听者耳后'),
  ],
  'dialogue:anxiety': [
    recipe('medium_close', 'eye', 'handheld', 50, 'thirds', '中近景', '平视微侧', '手持呼吸感 ±2°，景深轻轻喘气', '三分构图', '试探句带着机位不稳'),
    recipe('close', 'eye', 'slow_push_in', 85, 'center', '近景', '平视贴脸', '呼吸变焦，瞳孔与嘴开合同步微抖', '居中构图', '慌从眼周先露'),
  ],
  'dialogue:fear': [
    recipe('close', 'low', 'slow_push_in', 24, 'center', '近景', '虫眼仰拍', '低角度虫眼推，超广角把说话人压在威胁下', '居中构图', '台词被空间吓住'),
    recipe('medium', 'eye', 'handheld', 35, 'foreground_obstruction', '中景', '平视', 'POV 第一人称听句，门框挤入', '前景遮挡', '观众被迫变成受话者'),
  ],
  'listen:confront': [
    recipe('close', 'eye', 'static', 85, 'thirds', '近景', '平视', '听者反应特写，固定，浅景深，下颌先紧', '三分构图', '质问落在听者眼里'),
    recipe('medium_close', 'low', 'slow_push_in', 50, 'foreground_obstruction', '中近景', '微仰', '过肩看听者，前景说话人肩虚，轻推半档', '前景遮挡', '反应比台词更大'),
  ],
  'reveal:calm': [
    recipe('close', 'eye', 'slow_push_in', 85, 'center', '大特写', '平视', '插入镜头急推到屏幕或证物，居中', '居中构图', '系统/道具必须看清信息面'),
    recipe('close', 'eye', 'static', 85, 'thirds', '近景', '平视', '变焦切割到证物，锁定结果', '三分构图', '只给结果不给逃路'),
  ],
  'climax:chase': [
    recipe('full', 'low', 'follow', 24, 'thirds', '全景', '贴地低机', '贴地飞行跟拍，尘土入镜时微晃后急停', '三分构图', '速度服务撞击落点'),
    recipe('medium', 'eye', 'handheld', 35, 'center', '中景', '平视', '手持崩坏跟拍，甩摇切入后刹停', '居中构图', '追逐在爆发点碎掉'),
  ],
  'climax:power': [
    recipe('medium', 'high', 'orbit', 35, 'center', '中景', '俯拍审判', '环绕审视后急停在宣判角度', '居中构图', '爆发即宣判'),
    recipe('close', 'low', 'slow_push_in', 50, 'center', '近景', '低机仰拍', '希区柯克推拉，背景坠向被压者', '居中构图', '空间塌缩到权力'),
  ],
  'hold:pressure': [
    recipe('medium_close', 'eye', 'static', 50, 'foreground_obstruction', '中近景', '平视', '固定机位，前景遮挡不撤，禁止再推', '前景遮挡', '余韵仍被空间挤着'),
    recipe('medium', 'high', 'slow_pull_out', 35, 'negative_space', '中景', '微俯', '剥离拉远半档，负空间增大但不给解脱', '负空间', '压住气口'),
  ],
  'hold:despair': [
    recipe('full', 'high', 'slow_pull_out', 35, 'negative_space', '全景', '俯拍', '失重漂浮感缓拉，人物变小', '负空间', '放弃后的余韵'),
    recipe('medium', 'eye', 'static', 50, 'negative_space', '中景', '平视', '固定呼吸，负空间留白，禁止再推', '负空间', '话说完人还在空里'),
  ],
};

const FALLBACK_KEYS = [
  'action:calm',
  'dialogue:calm',
  'establish:calm',
  'hold:calm',
];

function recipesFor(role: DramaCamBeatRole, lane: DramaCamEmotionLane): DramaCinematicCameraRecipe[] {
  const exact = RECIPE_BANK[`${role}:${lane}`];
  if (exact?.length) return exact;
  const roleCalm = RECIPE_BANK[`${role}:calm`];
  if (roleCalm?.length) return roleCalm;
  for (const k of FALLBACK_KEYS) {
    if (RECIPE_BANK[k]?.length) return RECIPE_BANK[k];
  }
  return RECIPE_BANK['action:calm'];
}

function recipeKey(r: DramaCinematicCameraRecipe): string {
  return `${r.size}|${r.angle}|${r.move}`;
}

export function formatCinematicCameraLine(r: DramaCinematicCameraRecipe): string {
  return `${r.size} · ${r.angle} · ${r.move}，${r.lens}，${r.composition}，${r.intent}`;
}

export function composeDramaCinematicCameraDesign(input: {
  shot: Partial<DramaShot>;
  event?: Partial<DramaTimelineEvent>;
  index: number;
  total: number;
  prevLine?: string;
}): {
  role: DramaCamBeatRole;
  lane: DramaCamEmotionLane;
  recipe: DramaCinematicCameraRecipe;
  line: string;
} {
  const role = inferDramaCamBeatRole(input.shot, input.event, input.index, input.total);
  const lane = inferDramaCamEmotionLane(input.shot, input.event);
  const bank = recipesFor(role, lane);
  const prev = String(input.prevLine || '').trim();
  const picked =
    bank.find((r) => prev && !prev.includes(r.move.slice(0, 6))) ||
    bank.find((r) => recipeKey(r) !== prev) ||
    bank[0];
  return {
    role,
    lane,
    recipe: picked,
    line: formatCinematicCameraLine(picked),
  };
}

export function resolveDramaEventCameraAction(input: {
  shot: Partial<DramaShot>;
  event: Partial<DramaTimelineEvent>;
  index: number;
  total: number;
  prevLine?: string;
}): string {
  void input.shot;
  void input.index;
  void input.total;
  void input.prevLine;
  return String(input.event.camera_action || '').trim();
}

export function applyCinematicCamerasToTimelineEvents(
  shot: Partial<DramaShot>,
  events: DramaTimelineEvent[],
): DramaTimelineEvent[] {
  const list = Array.isArray(events) ? events : [];
  let prev = '';
  return list.map((ev, i) => {
    const camera_action = resolveDramaEventCameraAction({
      shot,
      event: ev,
      index: i,
      total: list.length,
      prevLine: prev,
    });
    prev = camera_action;
    return camera_action === ev.camera_action ? ev : { ...ev, camera_action };
  });
}
