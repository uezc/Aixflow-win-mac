/**
 * AI 短剧视频生成技术手册（分析 / 拆镜注入）。
 * 分析阶段只学标签剧本与镜头语言意图，禁止在 analyze JSON 里写 size/angle/move。
 */

export type DramaH3CraftTag = '元' | '场' | '画' | '台' | '转';

const CRAFT_TAG_RE = /^【\s*(元|场|画|台|转)\s*】\s*(.*)$/;

export function parseDramaH3CraftTag(
  trimmed: string,
): { tag: DramaH3CraftTag; rest: string } | null {
  const m = String(trimmed || '').trim().match(CRAFT_TAG_RE);
  if (!m) return null;
  return { tag: m[1] as DramaH3CraftTag, rest: String(m[2] || '').trim() };
}

export function isDramaH3CraftTagLine(trimmed: string): boolean {
  return !!parseDramaH3CraftTag(trimmed);
}

/** 分析阶段：读懂带标签剧本；see=视线，position=站位，禁止运镜字段 */
export const DRAMA_H3_CRAFT_ANALYZE_RULES = `## 带标签剧本（【元】【场】【画】【台】【转】）
若正文出现这五个标签，必须按标签拆事件，禁止把整场糊成一条 see。
- 【元】：只写入 project.visual_style / color_style / references（参考图名、风格词）。不进 visual_events。
- 【场】：内/外景 + 地点 + 时间 → 开新 scene_beats；本场第一条画面事件 kind=establish。
- 【画】：只写画面。人物+动作+表情+环境+特效+音效。禁止把台词写进 action/see。说话镜头的 action/expression 必须写可见口型（如「正在说话嘴唇微动」）。
- 【台】：只写台词。格式「角色名（情绪）：原文」。who=角色名；see 写视线落点（对白事件可空）；expression 可写括注情绪的可见微相，禁止把画面动作写进对白事件。
- 【转】：kind=transition（黑屏/切至/淡入淡出）。
- 同一场多个【画】+【台】→ 多条 visual_events，一对一，禁止合并。
- 情绪写两遍：【画】→ expression（脸/肢体）；【台】→ emotion.primary（导演意图）。二者不要互相覆盖。
- 系统界面 / 手机屏 / 证据 / 关键道具特写 → 单独 insert 或 information 事件，后面再跟 reaction。
- 动作必须有主语；多角色各写各的事件，禁止逗号把两人动作和台词粘在一行。

## 镜头语言分析（写理解，不写分镜字段）
本阶段禁止输出 size / angle / move / shot / 景别 / 运镜 / camera_action。
禁止把「怎么拍」写成推镜、OTS、特写、双人镜头。
- kind：establish / action / reaction / dialogue / reveal / emotional / transition / information / insert
- cut：只表达事件边界 / 是否适合作为信息切换点（new_action / speaker / reveal / prop / space / emotion / enter / exit / emphasis）。禁止由 cut 发明运镜。
- emotion.primary：主导情绪词；intensity 0-1。
- see：视线落点或被看对象（短词，如「远处」「江澈」）。禁止 camera / viewer / lens / 镜头 / 观众。禁止写成 25-55 字整幅画面散文。
- position：站位理解（如「江澈坐在画面左侧」）。无则 ""。
- source_segment_ids：只能从输入 OriginalSegment 清单选择；找不到则 []；禁止编造。`;

/** 拆镜 / 加厚：运镜 + 构图 + 黄金组合 + AI 避坑 */
export const DRAMA_H3_CRAFT_SHOT_PLAN_RULES = `【H3电影级运镜构图·强制】
每个 shot 的 size + angle + move + composition/blocking 必须点名，禁止裸写「固定/跟拍/推/拉」。
一个镜头最多 1～2 种运镜；环绕只写 180 度不写 360；手持只写 subtle shake；速度只写 slow / moderate。
对话镜必须写过肩 OTS + 180 度轴线；系统/道具必须 insert 特写。

【运镜选用·按情绪，禁止随机】
紧张/压迫 → slow dolly in + handheld subtle shake
孤独/失落 → slow dolly out + 大远景留白
震惊/冲击 → 快速推近或插入特写（少用眩晕变焦）
战斗/混乱 → handheld + 对角线；甩镜限 1 处
仪式/高潮 → 180° orbit 或 crane rise
沉浸/代入 → Steadicam follow
宏大/世界观 → 垂直上升揭示 / 倒飞揭示 / 上帝正俯 / 静帧航拍
快节奏转场 → whip pan 或硬切，不要一镜里叠三种运动
对峙对话 → OTS + slow push in，侧光半脸
英雄登场 → low angle + slow push in + 中心构图
追逐 → 贴地掠飞或 aerial follow，moderate 速度

【构图必须写进 blocking 或 size 修饰】
三分法 / 中心权威 / 对称 / 框中框 / 引导线 / 负空间留白 / 前景遮挡 / 对角线 / 权力高低 / 视线空间 look room
角度：仰拍力量、俯拍脆弱、荷兰角不安、过肩对话、POV 代入
景别：大远景世界观、中景对话、特写情绪、大特写眼/道具、insert 屏幕

【黄金组合（按剧情选，不抽签）】
英雄登场：low angle slow push in, centered, backlit silhouette
紧张对话：handheld OTS, slow push in, side light, 180-degree rule
战斗高潮：handheld, diagonal, dutch angle；急推只放反转拍
孤独沉思：slow pull out, negative space, doorway frame
世界观揭示：reverse pull-back aerial → static locked-off aerial, character tiny
史诗开场：vertical rise reveal → 180° aerial orbit
系统/道具：fast push in to insert ECU of screen/object, center, screen glow

【AI避坑】
禁止一镜三种以上运镜；禁止 360 环绕；禁止 heavy shake / fast 运动；禁止对话不写 OTS；禁止系统界面用中景带过。`;

/** 加厚阶段可与运镜手册叠用的短清单 */
export const DRAMA_H3_CRAFT_ENRICH_CHECK = `加厚自检：开场 5 秒有钩子（推近/特写/仰拍）？高潮有手持或环绕或升降？收束有拉远/留白？宏大场有航拍揭示？对话有 OTS？系统/道具有 insert？move 是命名手法且邻镜对仗？`;
