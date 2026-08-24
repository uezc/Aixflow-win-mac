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
  [/暴雨|雨水|雨声/, 'heavy rain'],
  [/轮胎摩擦/, 'tire scrape'],
  [/车流声|车流|引擎/, 'traffic'],
  [/轮胎/, 'tires'],
  [/空调/, 'hvac hum'],
  [/电流|屏幕/, 'monitor hiss'],
  [/脚步/, 'footsteps'],
  [/键盘/, 'keyboard'],
  [/场景底噪|环境底噪/, 'room tone'],
];

const CAM_EN: Array<[RegExp, string]> = [
  [/大特写/, 'ECU'],
  [/特写/, 'CU'],
  [/中近景/, 'MCU'],
  [/近景/, 'close shot'],
  [/中景/, 'MS'],
  [/全景/, 'WS'],
  [/平视/, 'eye-level'],
  [/微俯|俯拍/, 'high angle'],
  [/微仰|仰拍/, 'low angle'],
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
    const mapped = stripCjk(applyMap(stripH3SilentBoilerplate(raw), FOLEY_EN));
    const bit = mapped || 'room tone';
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
