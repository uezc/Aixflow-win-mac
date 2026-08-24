/**
 * 人设 → 分镜加厚：骨架镜表已覆盖事件后，按批补微表情/标志动作/潜台词/光线。
 * 分批是为了避开一次输出截断；禁止增删镜头、改 event_ids / 时长。
 */

import { extractJsonObject } from '../../directorPipeline/normalize.js';
import type {
  DramaCharacterDirecting,
  DramaShotPlanPaceGear,
  DramaShotSuggestion,
} from '../types.js';
import { normalizeDramaShotPlanPaceGear } from '../types.js';
import { createEmptyDramaShotSuggestion } from '../episodeBible.js';
import { normalizeDramaShotTimeOfDay } from '../types.js';
import { DRAMA_CAMERA_MOVE_HANDBOOK } from './cameraMoveHandbook.js';
import { DRAMA_SHOT_PLAN_ENRICH_PACE_SHORT_DRAMA, DRAMA_SHOT_PLAN_ENRICH_PACE_DENSE_15S } from './shotPlan.js';
export const DRAMA_SHOT_PLAN_ENRICH_BATCH = 3;

export const DRAMA_SHOT_PLAN_ENRICH_SYSTEM = `${DRAMA_CAMERA_MOVE_HANDBOOK}

你是电影级分镜导演。任务：把已有骨架镜头按人设档案加厚，不是重新拆镜。

规则：
1. 只输出合法 JSON，不要 Markdown，不要代码块。
2. type 必须是 "director-drama-domain-shot-enrich"。顶层：schemaVersion, type, shots。
3. 输入有几镜就输出几镜，shot_no 必须对齐。禁止增删镜头，禁止改 duration_sec、event_ids、scene、dramatic_purpose。
4. 人设是执行手册。对照 action_index：触发条件匹配则强制写入对应动作。
5. 字段写法：
   - action：连续 3–5 个可见身体动作（含物理交互：雨水/门板/屏幕水痕）。禁止「低头快步冲进」这种概括。例：左手护外卖袋防雨 → 右手推门手背先试门板温度 → 进入后甩头抖落雨帽 → 胸口起伏。
   - expression：演员情绪，格式 [主导情绪]（微表情/肢体1/肢体2）。转折写「麻木→隐忍（低头沉默/胸口起伏/攥拳后看掌心）」。禁止单字「焦虑」。
   - purpose：除纯建立镜外必须含「触发[角色]的 core_desire/core_fear（具体内容）」。禁止「表现紧迫感/暗示无力感」。
   - dialogue[].text：只写可说出台词原文。subtext 单独字段。禁止把【潜台词】写进 text。
   - move：必须从手册选命名手法，写满 [设备]+[运动方式]+[速度/节奏]+[情绪意图]。同场主手法不得重复，相邻镜必须对仗/反差。禁止「固定」「跟拍」。
   - lighting：按地点变化，禁止连续多镜只写「冷光」。雨夜霓虹倒影；电梯冷白荧光+镜面光斑；室内暖台灯 vs 屏幕冷光切割。不要用 lighting 写时段词。
   - time_of_day：若骨架已有则保留；空则据剧情补全，只能是：朦胧亮|日出|正午|下午|傍晚|晚上|深夜|黎明。
   - environment：若骨架已有则保留；空则补 ≤20 字环境简述（天气+室内外+可见景物）。禁止复述 lighting。
   - sfx：必填。环境底噪+物理 Foley。例：门轴缺油吱呀，室内键盘敲击声骤停。
   - blocking：构图站位与权力关系。
   - size：可细化（如特写→大特写（手机屏+手指）），但不要改成完全无关的景别。
   - duration_why：写为何选该时长（信息闪现/赶路单句/对白冲突），不要改 duration_sec。
   - cast_names：写成「C-01 周一川」。
6. 无对白镜：无对白 ≠ 无情绪。展开麻木/压抑肢体；sfx 只留环境与 Foley。
7. 同一角色标志性动作全片一致。若与「已用动作」矛盾，修正 action 并在 purpose 末尾写「已校正角色行为」。
8. 推导示例（不要输出这张表，按此密度写 shots）：
   被说「超时了」→ expression=愤怒（咬下唇内侧/攥拳后看掌心/下巴抽动）；男人台词 text=超时了，这单我不会给好评。 subtext=你在我眼里不值钱；purpose=周一川的 core_fear（被彻底否定）被激活，过肩仰拍放大压迫。
9. 加厚 QA（执行级）：
   - 威胁源/说话人切换：purpose 或 duration_why 须点明转场因果（离开/拒之门外/时间跳切），禁止无桥接硬切。
   - 雨夜车内：sfx 写「雨声 Loop；对白建议 ADR」，不要暗示同期清晰收音。
   - expression：单镜只写 1 个主微相（可加 1 个肢体），禁止微相清单堆砌。
   - 段落末镜若黑屏/熄屏：purpose 末尾加「留悬念接下一场」。

shots[] 每项：
{ shot_no, action, expression, purpose, blocking, lighting, time_of_day, environment, move, size, sfx, duration_why, cast_names[], dialogue:[{character_name,text,subtext}] }`;

export function sessionHasDramaCharacterDossier(
  notes: DramaCharacterDirecting[] | undefined,
): boolean {
  return (notes || []).some((n) => {
    const d = n.dossier;
    if (!d) return false;
    return !!(
      d.desire ||
      d.fear ||
      d.emotion_signals ||
      d.signature_actions ||
      d.action_index ||
      d.subtext_rule ||
      d.scene_anchor
    );
  });
}

export function buildDramaShotPlanEnrichMessages(opts: {
  title?: string;
  dossierJson: string;
  shots: DramaShotSuggestion[];
  usedSignatureActions?: string;
  paceGear?: DramaShotPlanPaceGear | string;
}): { systemPrompt: string; userPrompt: string } {
  const compact = (opts.shots || []).map((s) => ({
    shot_no: s.shot,
    scene: s.scene,
    duration_sec: s.duration_sec,
    duration_why: s.duration_why,
    size: s.size,
    move: s.move,
    action: s.action,
    purpose: s.purpose,
    dialogue: s.dialogue,
    cast_names: s.cast_names,
    sfx: s.sound,
    expression: s.emotion_play,
    lighting: s.lighting,
    time_of_day: s.time_of_day,
    environment: s.environment,
    blocking: s.blocking,
  }));
  const pace = normalizeDramaShotPlanPaceGear(opts.paceGear);
  const systemPrompt =
    pace === 'short_drama'
      ? `${DRAMA_SHOT_PLAN_ENRICH_SYSTEM}\n\n${DRAMA_SHOT_PLAN_ENRICH_PACE_SHORT_DRAMA}`
      : pace === 'dense_15s'
        ? `${DRAMA_SHOT_PLAN_ENRICH_SYSTEM}\n\n${DRAMA_SHOT_PLAN_ENRICH_PACE_DENSE_15S}`
        : DRAMA_SHOT_PLAN_ENRICH_SYSTEM;
  return {
    systemPrompt,
    userPrompt: [
      `标题：${String(opts.title || '').trim() || '未命名'}`,
      pace === 'short_drama'
        ? '当前挡位：短剧快切（加厚时禁止扩回过程动作）'
        : pace === 'dense_15s'
          ? '当前挡位：15秒高密度（加厚时保持镜内时间子窗，禁止拆镜）'
          : '当前挡位：正剧细致感',
      '人设档案（含 action_index）：',
      String(opts.dossierJson || '').trim() || '无',
      opts.usedSignatureActions
        ? `本集已调用的标志性动作（须保持一致）：\n${opts.usedSignatureActions}`
        : '',
      '请加厚下列骨架镜头，只输出 enrich JSON：',
      JSON.stringify({ shots: compact }),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function formatDlg(
  lines: Array<{ character_name?: string; text?: string; subtext?: string }>,
): { spoken: string; subtext: string } {
  const spoken: string[] = [];
  const sub: string[] = [];
  for (const d of lines) {
    const name = asStr(d.character_name);
    const text = stripSpokenSubtext(asStr(d.text));
    const st = asStr(d.subtext);
    if (text) spoken.push(name ? `${name}：${text}` : text);
    if (st) sub.push(name ? `${name}：${st}` : st);
  }
  return { spoken: spoken.join(' / '), subtext: sub.join('；') };
}

export function stripSpokenSubtext(text: string): string {
  return String(text || '')
    .replace(/【潜台词[:：]?[^】]*】/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function splitDramaShotDialogueSubtext(raw: string): { spoken: string; subtext: string } {
  const bits: string[] = [];
  const spoken = String(raw || '')
    .replace(/【潜台词[:：]?([^】]*)】/g, (_m, inner: string) => {
      const t = String(inner || '').trim();
      if (t) bits.push(t);
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { spoken, subtext: bits.join('；') };
}

export function parseDramaShotPlanEnrichResult(text: string): DramaShotSuggestion[] {
  const parsed = extractJsonObject(text);
  const obj = asObj(parsed);
  const list = Array.isArray(obj?.shots) ? (obj!.shots as unknown[]) : [];
  const out: DramaShotSuggestion[] = [];
  for (const item of list) {
    const rec = asObj(item);
    if (!rec) continue;
    const dlgRaw = Array.isArray(rec.dialogue) ? rec.dialogue : [];
    const dlg = formatDlg(
      dlgRaw.map((x) => {
        const r = asObj(x) || {};
        return {
          character_name: asStr(r.character_name),
          text: asStr(r.text),
          subtext: asStr(r.subtext),
        };
      }),
    );
    const fromText = splitDramaShotDialogueSubtext(asStr(rec.dialogue));
    const castRaw = Array.isArray(rec.cast_names) ? rec.cast_names : [];
    out.push(
      createEmptyDramaShotSuggestion({
        shot: asStr(rec.shot_no || rec.shot),
        action: asStr(rec.action),
        purpose: asStr(rec.purpose),
        emotion_play: asStr(rec.expression || rec.emotion_play),
        lighting: asStr(rec.lighting),
        time_of_day: normalizeDramaShotTimeOfDay(asStr(rec.time_of_day)),
        environment: asStr(rec.environment) || asStr(rec.atmosphere),
        blocking: asStr(rec.blocking),
        move: asStr(rec.move),
        size: asStr(rec.size),
        sound: asStr(rec.sfx || rec.sound),
        duration_why: asStr(rec.duration_why),
        cast_names: castRaw.map((x) => asStr(x)).filter(Boolean),
        dialogue: dlg.spoken || fromText.spoken,
        subtext: dlg.subtext || fromText.subtext,
      }),
    );
  }
  return out;
}

export function mergeDramaShotPlanEnrich(
  base: DramaShotSuggestion[],
  patch: DramaShotSuggestion[],
): DramaShotSuggestion[] {
  const byNo = new Map<string, DramaShotSuggestion>();
  for (const p of patch) {
    const no = String(p.shot || '').trim();
    if (no) byNo.set(no, p);
  }
  return base.map((s) => {
    const p = byNo.get(String(s.shot || '').trim());
    if (!p) return s;
    return createEmptyDramaShotSuggestion({
      ...s,
      action: p.action || s.action,
      purpose: p.purpose || s.purpose,
      emotion_play: p.emotion_play || s.emotion_play,
      lighting: p.lighting || s.lighting,
      time_of_day: p.time_of_day || s.time_of_day,
      environment: p.environment || s.environment,
      blocking: p.blocking || s.blocking,
      move: p.move || s.move,
      size: p.size || s.size,
      sound: p.sound || s.sound,
      duration_why: p.duration_why || s.duration_why,
      cast_names: p.cast_names.length ? p.cast_names : s.cast_names,
      dialogue: p.dialogue || s.dialogue,
      subtext: p.subtext || s.subtext,
    });
  });
}

export function collectUsedSignatureActions(shots: DramaShotSuggestion[]): string {
  return (shots || [])
    .map((s) => [s.action, s.emotion_play].filter(Boolean).join(' / '))
    .filter(Boolean)
    .slice(0, 24)
    .join('\n');
}
