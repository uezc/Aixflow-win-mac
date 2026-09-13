/**
 * 小说/剧情正文 → 标准影视剧本格式。
 * 规则对齐 novel-to-screenplay Skill（场景标题、对白、括注、系统音/弹幕/蒙太奇）。
 */

export type DramaNovelToScreenplayChunk = {
  index: number;
  total: number;
  text: string;
};

const SCREENPLAY_SYSTEM = `你是影视剧本改编。把小说/剧情正文转成可拍摄的标准剧本，只输出剧本正文。

【格式】
- 场景标题：\`数字. 内景/外景 地点 - 时间\`（时间用 夜/晨/日/黄昏/午后）。地点或时间一变就新开一场。
- 动作：现在时，一句一个明确动作，短句。环境只留对剧情有用的 1–2 句。
- 角色名：单独一行，不要 Markdown 加粗、不要居中 HTML。
- 对白：角色名下一行，不加引号。
- 括注：角色名与对白之间，用（括号）写语气/表情/动作。
- 内心活动：用（内心OS），不要大段心理旁白。
- 系统音：【系统提示音】或【系统提示音（机械女声，脑海中响起）】
- 旁白：【旁白】
- 弹幕：【弹幕浮字：…】多条用「／」分隔
- 蒙太奇：【快速蒙太奇：…】
- 特效：【特效：技能名】
- 转场：独立一行写 切至： / 淡入： / 淡出：

【节奏】
- 叙述尽量转成对白；每个场景只承载一个事件。
- 战斗/连续动作用短句堆叠，必要时用【快速蒙太奇】。
- 禁止空镜头、禁止拖沓静止描写。
- 不要改人物名；不要编造原文没有的情节。
- 不要片尾字幕、下集预告、制作说明、文件名、开场寒暄。

【示例】
淡入：

1. 内景 电竞直播间 - 夜

RGB灯条在昏暗房间里闪烁。江澈靠在电竞椅上。

江澈
（慵懒）
家人们，这把打完就下播了啊。

【弹幕浮字：澈神今天又杀疯了！／全能王名不虚传！】

切至：
`;

export function splitSourceForNovelToScreenplay(source: string, maxChars = 4800): string[] {
  const text = String(source || '').trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const lines = text.split('\n');
  const parts: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  const flush = () => {
    const s = buf.join('\n').trim();
    if (s) parts.push(s);
    buf = [];
    bufLen = 0;
  };
  for (const line of lines) {
    const add = (buf.length ? 1 : 0) + line.length;
    if (bufLen + add > maxChars && bufLen > 600) flush();
    buf.push(line);
    bufLen += add;
  }
  flush();
  return parts;
}

export function lastScreenplaySceneNumber(text: string): number {
  const re = /^(\d{1,3})\.\s*(?:内景|外景|内|外)\s+/gm;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || '')))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > last) last = n;
  }
  return last;
}

export function normalizeDramaScreenplayOutput(raw: string): string {
  let t = String(raw || '').trim();
  t = t.replace(/^```(?:markdown|md|text)?\s*\n?/i, '');
  t = t.replace(/\n?```\s*$/i, '');
  t = t.replace(/^#+\s+[^\n]*(标准剧本|第\s*\d+\s*集)[^\n]*\n+/i, '');
  const body = t.match(/(?:^|\n)(淡入：|\d{1,3}\.\s*(?:内景|外景|内|外)\s[\s\S]*)$/);
  if (body) t = body[1].replace(/^\n/, '');
  t = t.replace(/^\*\*(.+?)\*\*\s*$/gm, '$1');
  return t.trim();
}

export function buildDramaNovelToScreenplayMessages(opts: {
  title: string;
  sourceText: string;
  workName?: string;
  characterNames?: string[];
  chunk?: DramaNovelToScreenplayChunk;
  continueFromScene?: number;
}): { systemPrompt: string; userPrompt: string } {
  const title = String(opts.title || '本集').trim() || '本集';
  const work = String(opts.workName || '').trim();
  const names = (opts.characterNames || []).map((n) => String(n || '').trim()).filter(Boolean);
  const chunk = opts.chunk;
  const cont = Number(opts.continueFromScene) > 0 ? Number(opts.continueFromScene) : 0;
  const parts = [
    work ? `作品：${work}` : '',
    `集标题：${title}`,
    names.length ? `已知人物名（不得改名）：${names.join('、')}` : '',
    chunk && chunk.total > 1 ? `这是原文第 ${chunk.index + 1}/${chunk.total} 段，只转换本段。` : '',
    cont > 0 ? `上一场最后场景编号是 ${cont}。本段场景编号从 ${cont + 1} 起，不要重复已写内容。` : '',
    '把下面原文转成标准剧本。只输出剧本正文。',
    '',
    opts.sourceText,
  ].filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== ''));
  return {
    systemPrompt: SCREENPLAY_SYSTEM,
    userPrompt: parts.join('\n'),
  };
}
