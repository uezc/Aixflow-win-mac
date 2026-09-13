/**
 * MiniMax H3 时间 / 音效 / 切镜约定 → 拆镜与导演拆戏补充（Domain 字段，不写英文 Shot 语法）。
 * 官方 Skill 只规定成片 prompt 写法；本手册把「何时切、音效怎么分层、对白如何跨切」
 * 落在 shot plan / directing breakdown / timeline 事实源。
 */

/** 拆镜 / 加厚：切镜判据 + 音效分层 + 跨切对白 + 时间窗约定 */
export const DRAMA_H3_TIMING_SOUND_SHOT_PLAN_RULES = `【H3时间·音效·切镜补充·强制 · 只写 Domain 字段，禁止输出 [Shot N]/<d>/英文六段稿】

1) 切镜判据（对齐 H3「有新信息才切」）
- 只有出现以下新信息之一才允许开新 shot / 新 beat 硬切：主体变化、空间变化、状态突变、视点切换、时间跳切。
- 仅景别微调或小角度变化 → 写在同一镜的 move（机位运动），禁止为此碎切开新镜。
- 对话细切：说话人切换 / 对白情绪拐点 / 信息揭示 vs 反应 → 可切 beat 或镜。
- 赶路/过渡粗切：同一赶路动作最多 1～2 镜；电梯/走廊/门口能合并则合并。

2) 音效分层（禁止把台词写进 sfx / sound）
- 镜级 sfx 必填，推荐写法：「底噪Loop｜FoleyA、FoleyB」
  · 底噪 / Loop：教室嘈杂、雨声、空调、走廊回音、场景底噪（可持续整镜）
  · Foley：落桌、砸屏、脚步、开门、指尖敲击（与可见动作同步）
- beats[].sound / 子窗音效：只写本拍同步 Foley + 必要时点名 Loop 起伏；禁止抄整段对白。
- 台词、旁白、画外音只进 dialogue[]，禁止写入 sfx / sound / environment。
- 极端天气：sfx 写「雨声 Loop + 可选 ADR」；不要假设同期可收人声。

3) 跨切对白
- 一句原文对白禁止无标记地被切到两个 shot 各写半句。
- 若叙事必须跨 beat：只在其中一个 beat 保留完整原文；相邻 beat 的 continuity / duration_why 注明「声轨延续上一拍对白」，后拍 dialogue 可空或只写反应。
- 禁止把多句原文合并成一句 dialogue.line。

4) 时间窗（给下游 Compiler，不写 H3 时钟语法）
- 节拍 / 子窗只用秒窗：如 0-4s、4-9s；duration_sec 与窗口总和自洽。
- 禁止在 shot plan JSON 里写 [Shot N]、At 00:03.500、<scenetrans>、<cutoff>（那是出片 Compiler 的活）。
- 出片时长档仍服从模型挡位（6/10/15/20）；规划秒窗可细，最终向上取整到档。`;

/** 导演拆戏：拍级环境音与切点 */
export const DRAMA_H3_TIMING_SOUND_BREAKDOWN_RULES = `【H3时间·音效·拍级补充·强制】
- 切拍：主体/空间/状态/视点/时间有新信息，或说话人/对白情绪变化，才另起一拍；纯景别微变合并到机位描述，不硬切。
- environmentSound 分层写：可持续 Loop（雨声/教室底噪）与同步 Foley（落地声/砸屏）用顿号或「｜」分开；禁止写入台词原文。
- 对白跨拍：完整台词只落在开口那一拍；邻拍 continuityIn/Out 写「声轨延续」，禁止各拍各写半句。
- 时间：audioStart/audioEnd 覆盖本镜，对白拍优先贴台词节奏，禁止平均切等长空拍。
- 禁止输出英文 [Shot N] / <d> / overall_soundscape 终稿。`;

/** 加厚自检短清单 */
export const DRAMA_H3_TIMING_SOUND_ENRICH_CHECK = `时间音效自检：每镜 sfx 是否含底噪或 Loop？动作拍是否有同步 Foley？台词是否只在 dialogue？有无仅为景别微变而碎切？跨拍对白是否只保留一句完整原文并标注声轨延续？`;

const LOOP_HINT =
  /底噪|环境|嘈杂|雨声|风声|雷|车流|空调|风扇|走廊|教室|课堂|办公室|人群|Loop|loop|持续/;
const FOLEY_HINT =
  /脚步|开门|关门|落地|砸|敲|击|键盘|椅|翻书|粉笔|落桌|水滴|甩|撞击|蜂鸣|提示音|震动|拳|吸气/;

/** 从镜级 sfx 拆出 Loop/底噪 vs 同步 Foley（供 timeline 回填） */
export function splitDramaSfxLayers(sfx: unknown): { ambient: string[]; foley: string[] } {
  const raw = String(sfx || '').trim();
  if (!raw) return { ambient: [], foley: [] };

  const chunks = raw
    .split(/[｜|]/)
    .map((x) => x.trim())
    .filter(Boolean);

  const ambient: string[] = [];
  const foley: string[] = [];
  const pushParts = (blob: string, prefer?: 'ambient' | 'foley') => {
    for (const part of blob.split(/[、,，;/]+/).map((x) => x.trim()).filter(Boolean)) {
      const cleaned = part.replace(/^环境音效\s*[：:]\s*/, '').trim();
      if (!cleaned) continue;
      if (prefer === 'ambient' || (!prefer && LOOP_HINT.test(cleaned))) {
        if (!ambient.includes(cleaned)) ambient.push(cleaned);
      } else if (prefer === 'foley' || FOLEY_HINT.test(cleaned)) {
        if (!foley.includes(cleaned)) foley.push(cleaned);
      } else if (prefer === 'ambient') {
        if (!ambient.includes(cleaned)) ambient.push(cleaned);
      } else {
        // 无偏好：偏短的拟音进 Foley，其余进底噪
        if (cleaned.length <= 8 || FOLEY_HINT.test(cleaned)) {
          if (!foley.includes(cleaned)) foley.push(cleaned);
        } else if (!ambient.includes(cleaned)) {
          ambient.push(cleaned);
        }
      }
    }
  };

  if (chunks.length >= 2) {
    // 「底噪｜Foley」惯例：第一段偏 Loop，其后偏 Foley
    pushParts(chunks[0], 'ambient');
    for (let i = 1; i < chunks.length; i++) pushParts(chunks[i], 'foley');
  } else {
    pushParts(raw);
  }

  return { ambient, foley };
}
