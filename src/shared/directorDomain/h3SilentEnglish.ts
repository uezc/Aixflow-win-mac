/**
 * MiniMax H3 全能参考会把中文说明当台词念。
 * 无对白镜：镜头动作 / Foley 编成短英文，去掉模板套话与「不要说话」叠句。
 */

const BOILERPLATE_RE = [
  /出场人物(?:身处|在)场景内可辨区域(?:执行)?/g,
  /动作前静止[:：,]?双手与双脚就位/g,
  /双手与双脚处于动作前的静止姿态/g,
  /尚未开始[「『“"][^」』”"]{0,48}[」』”"]?/g,
  /尚未开始/g,
  /肢体从起始姿态移向落点/g,
  /双手与脚步(?:位置)?变化清晰/g,
  /双手与脚步不再大幅改位/g,
  /维持落点姿态/g,
  /胸腔随呼吸轻微起伏/g,
  /本时段无台词[^。]{0,24}/g,
  /不触发口型/g,
  /无人物语音/g,
] as const;

const ACTION_EN: Array<[RegExp, string]> = [
  [/用手背试(?:一下)?门板温度/, 'tests the door with the back of his hand'],
  [/推开虚掩的门|推门而入|推开门/, 'pushes the ajar door open'],
  [/进入昏暗的办公室|走进办公室|进入室内/, 'enters the dim office'],
  [/目光扫过桌面散落的文件/, 'eyes scan scattered papers on the desk'],
  [/停留在电脑屏幕的冷光上|看向电脑屏幕/, 'gaze holds on the cold monitor glow'],
  [/目光扫过/, 'eyes scan the room'],
  [/骑车穿过雨夜车流|逆雨骑行|骑电动车穿过/, 'rides through rainy night traffic'],
  [/动作稳定/, 'steady'],
  [/紧急刹车|急停/, 'hard brake'],
  [/车轮打滑/, 'tires slip'],
  [/低头喘气|低头呼吸/, 'head down, breathing hard'],
  [/前臂抹(?:去)?(?:脸上)?雨水/, 'wipes rain with his forearm'],
  [/甩头抖落雨帽/, 'shakes rain off the cap'],
  [/左手护住外卖袋|护住外卖袋/, 'shields the food bag from rain'],
  [/攥拳后展开看掌心/, 'opens a fist and looks at his palm'],
];

const FOLEY_EN: Array<[RegExp, string]> = [
  [/门轴[^、,，]{0,10}余韵/, 'residual hinge creak'],
  [/门轴/, 'hinge creak'],
  [/金属门[^、,，]{0,6}撞击|金属撞击/, 'metal door impact'],
  [/开门声|开门/, 'door opening'],
  [/关门声|关门/, 'door closing'],
  [/落地声|落地/, 'landing thud'],
  [/暴雨|雨水|雨声/, 'heavy rain'],
  [/雷声|雷鸣/, 'thunder'],
  [/风声|刮风/, 'wind'],
  [/滴水|漏水/, 'water drip'],
  [/轮胎摩擦/, 'tire scrape'],
  [/车流声|车流|引擎/, 'traffic'],
  [/轮胎/, 'tires'],
  [/空调/, 'hvac hum'],
  [/投影|放映|屏幕加震|加震音/, 'projector buzz'],
  [/系统提示音|系统提示|UI\s*音/, 'UI system chime'],
  [/电流|屏幕/, 'monitor hiss'],
  [/粉笔|黑板|擦黑板/, 'chalkboard scratch'],
  [/教室嘈杂|课堂嘈杂|教室底噪|教室/, 'classroom murmur'],
  [/走廊/, 'hallway ambience'],
  [/铃声|下课铃|上课铃/, 'school bell'],
  [/翻书|书页/, 'page turn'],
  [/写字|笔写|笔触/, 'pen scratch'],
  [/椅子|拖椅|挪椅/, 'chair scrape'],
  [/脚步/, 'footsteps'],
  [/键盘|敲击|打字/, 'keyboard clicks'],
  [/气泡声|汽水|气泡/, 'soda fizz'],
  [/远处惊呼|惊呼|呼喊/, 'distant gasp'],
  [/笑声/, 'laughter'],
  [/抽泣|哭泣|哭声/, 'sobbing'],
  [/心跳/, 'heartbeat'],
  [/呼吸/, 'breathing'],
  [/动作带起细碎声响/, 'subtle movement noises'],
  [/环境声收回|余韵/, 'ambience decay'],
  [/场景底噪压低|底噪压低/, 'lowered room tone'],
  [/场景底噪|环境底噪|环境声/, 'room tone'],
  [/拟音/, 'foley'],
];

const CAM_EN: Array<[RegExp, string]> = [
  [/希区柯克推拉/, 'Hitchcock dolly zoom'],
  [/斯坦尼康贴身呼吸跟拍/, 'Steadicam breathing follow'],
  [/斯坦尼康/, 'Steadicam'],
  [/贴地飞行跟拍/, 'low skimming track'],
  [/过肩呼吸跟拍/, 'OTS breathing follow'],
  [/过肩压迫|过肩对切感/, 'over-the-shoulder pressure'],
  [/双人拉锯推拉/, 'two-shot push-pull'],
  [/窒息推轨|窒息推近/, 'choke dolly-in'],
  [/急推变焦后接手持崩坏感|急推后手持崩坏/, 'crash zoom then handheld collapse'],
  [/急推变焦/, 'crash zoom'],
  [/手持崩坏跟拍|手持崩坏/, 'handheld collapse'],
  [/手持呼吸感/, 'handheld breathing'],
  [/框架推门跟入/, 'door-frame push-in'],
  [/倒飞揭示/, 'reverse pull-back aerial'],
  [/垂直上升揭示/, 'vertical rise reveal'],
  [/插入镜头/, 'insert shot'],
  [/慢速横摇后悬停俯冲到站位/, 'slow pan then hover-dive'],
  [/顶部俯拍缓慢环绕审视/, 'top-down orbit of scrutiny'],
  [/高机位上帝俯|高角度上帝降/, "God's-eye high angle"],
  [/环绕审视/, 'orbit of scrutiny'],
  [/低角度虫眼推|虫眼仰拍/, 'worm-eye push'],
  [/极低机位超广角缓推入|极低机位超广角/, 'ultra-wide ground-level'],
  [/剥离拉远/, 'estranging pull-out'],
  [/逆向飞离/, 'reverse fly-away'],
  [/失重漂浮感缓拉/, 'weightless pull-out'],
  [/POV 第一人称/, 'POV'],
  [/三分构图/, 'rule of thirds'],
  [/居中构图/, 'centered'],
  [/框中框/, 'frame-in-frame'],
  [/前景遮挡/, 'foreground obstruction'],
  [/负空间/, 'negative space'],
  [/大特写/, 'ECU'],
  [/特写/, 'CU'],
  [/中近景/, 'MCU'],
  [/近景/, 'close shot'],
  [/中景/, 'MS'],
  [/全景|远景/, 'WS'],
  [/贴地低机|低机位仰拍|低机仰拍/, 'low angle'],
  [/平视略偏侧|平视微侧|平视贴脸/, 'eye-level'],
  [/俯拍审判/, 'high-angle judgment'],
  [/微俯|俯拍/, 'high angle'],
  [/微仰|仰拍/, 'low angle'],
  [/平视/, 'eye-level'],
  [/缓慢推入|缓推/, 'slow push-in'],
  [/固定镜头|固定/, 'locked-off'],
  [/跟拍/, 'tracking'],
];

function applyMap(text: string, rows: Array<[RegExp, string]>): string {
  let s = String(text || '');
  for (const [re, en] of rows) s = s.replace(re, ` ${en} `);
  return s;
}

function stripCjk(text: string): string {
  return String(text || '')
    .replace(/[\u4e00-\u9fff]+/g, ' ')
    .replace(/[｜|]/g, ', ')
    .replace(/[「」『』“”‘’]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，。、；;]+/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/^[,\s.]+|[,\s.]+$/g, '')
    .trim();
}

export function stripH3SilentBoilerplate(text: string): string {
  let s = String(text || '');
  for (const re of BOILERPLATE_RE) s = s.replace(re, ' ');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** 无对白镜头动作 → 短英文身体指令，避免 H3 念中文。 */
export function toH3SilentActionEnglish(text: string): string {
  const cleaned = stripH3SilentBoilerplate(text);
  const mapped = applyMap(cleaned, ACTION_EN);
  const en = stripCjk(mapped);
  return en || 'physical action, closed mouth, breathing only';
}

export function toH3SilentFoleyEnglish(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items || []) {
    const cleaned = stripH3SilentBoilerplate(
      String(raw || '').replace(/^环境音效\s*[：:]\s*/, '').trim(),
    );
    if (!cleaned) continue;
    const mapped = stripCjk(applyMap(cleaned, FOLEY_EN));
    // 未命中词表时仍保留 diegetic foley 占位，避免整段环境音从英文稿消失
    const bit = mapped || (/[\u4e00-\u9fff]/.test(cleaned) ? 'diegetic foley' : cleaned) || 'room tone';
    if (seen.has(bit)) continue;
    seen.add(bit);
    out.push(bit);
  }
  return out;
}

export function toH3SilentCameraEnglish(camera: string): string {
  const mapped = applyMap(String(camera || ''), CAM_EN);
  return stripCjk(mapped) || 'locked-off';
}
