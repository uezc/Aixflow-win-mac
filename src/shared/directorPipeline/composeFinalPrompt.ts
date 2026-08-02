import {
  isDirectorInstrumentalLyricText,
  DIRECTOR_INSTRUMENTAL_NO_SING_GUARD,
  stripDirectorSingingPerformanceFromText,
} from './lyricTimeline.js';
import type { DirectorShot } from './schema.js';
import {
  composeDirectorCinematicLensPromptBlock,
  DIRECTOR_CINEMATIC_TECHNIQUE_INVENTORY,
  DIRECTOR_MV_PERFORMANCE_DYNAMICS_GUIDE,
  DIRECTOR_MV_SCENE_PROMPT_FORMULA_GUIDE,
  resolveDirectorMvCloseUpFramingGuide,
} from './cinematicCameraLanguage.js';

const PENDING_FINAL_PROMPT_RE = /^(待生成提示词|待生成|to\s*be\s*generated|pending(\s*prompt)?)$/i;

const STORYBOARD_NO_TEXT_GUARD =
  '画面内禁止出现任何文字、字幕、歌词、台词气泡、水印、logo、标题、字母或数字标注；纯视觉画面，不要渲染可读文本。';

/** 全片风格必须同时作用在人物与场景，不能只改背景 */
export const DIRECTOR_STYLE_ON_CAST_AND_SCENE_GUARD =
  '全片风格锁：色调、光照、胶片/摄影质感必须同时作用在人物与场景——人物的肤色受光、发丝质感、服装材质与造型气质，以及场景环境，均须与画风一致；禁止只把风格涂在背景而人物像另一套片。';

/** 有风格参考图时：对齐风格图画面本身（勿按风格名称），场景图不得用自身彩色覆盖画风 */
export const DIRECTOR_STYLE_REF_IMAGE_LOCK_GUARD =
  '【风格参考图·硬性】必须对齐风格参考图的画面本身（色调、对比度、色彩模式（彩色/黑白/单色）、胶片/摄影质感、画风），禁止按风格名称/标题/文字标签理解；若风格图为黑白或单色，整幅输出必须同样去色/单色；场景与人物参考图只提供环境结构与人物身份外貌，禁止用场景图的彩色霓虹/饱和色覆盖风格图画风。Match the visual look of the style reference image — not its name/title.';

/** 黑白/单色风格额外硬锁，避免被彩色场景参考图带跑 */
export const DIRECTOR_MONOCHROME_STYLE_LOCK_GUARD =
  '【单色/黑白硬性】整幅画面必须严格黑白或单色（monochrome）：禁止彩色、禁止霓虹彩光、禁止彩色皮肤与服装；保留明暗与质感，但色相必须去色。Entire image must be black-and-white / monochrome — no color.';

/** 从风格文案判断是否偏黑白/单色 */
export function directorStyleLooksMonochrome(styleText: string | undefined | null): boolean {
  return /黑白|单色|无彩色|灰度|灰阶|monochrome|grayscale|grey\s*scale|black[\s-]*and[\s-]*white|\bb\s*&\s*w\b|\bnoir\b/i.test(
    String(styleText || ''),
  );
}

/**
 * 对口型生成硬性约束：人物须朝向镜头且嘴巴可见，避免转身/背影导致口型失效。
 */
export const DIRECTOR_LIPSYNC_MOUTH_VISIBLE_GUARD =
  '【对口型硬性约束】人物须全程正面或四分之三正面朝向镜头，嘴巴清晰可见并跟唱口型；禁止转身背对镜头、禁止背影/后脑勺、禁止侧脸或低头藏住嘴巴；可轻微手势与律动，但面部始终朝向镜头且口部可见。Keep face toward camera, mouth clearly visible for lip-sync; no turning away, no back view.';

/** 推荐对口型 / 用户打开对口型时，置于视频提示词最前 */
export const DIRECTOR_LIPSYNC_SINGING_FRONT = '人物正在面对镜头唱歌';

/** 弱化与对口型冲突的背身/转身表述，再前置唱歌句并追加硬性约束 */
export function ensureDirectorLipsyncMouthVisiblePrompt(prompt: string): string {
  let t = String(prompt || '').trim();
  if (t) {
    t = t
      .replace(/背对镜头|背影|背面全身|后脑勺|从背后拍摄|从背后/gi, '正面朝向镜头')
      .replace(/facing\s*away|from\s*behind|rear\s*view|back\s*(to|toward)\s*(camera|viewer)/gi, 'facing camera')
      .replace(/转身(?:离开|背对|离去)|转过身去/gi, '面向镜头')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (!t.includes(DIRECTOR_LIPSYNC_SINGING_FRONT) && !/面对镜头唱歌/.test(t)) {
    t = t ? `${DIRECTOR_LIPSYNC_SINGING_FRONT}。${t}` : DIRECTOR_LIPSYNC_SINGING_FRONT;
  }
  if (/对口型硬性约束|mouth clearly visible for lip-sync|嘴巴清晰可见并跟唱/.test(t)) {
    return t;
  }
  if (!t) return `${DIRECTOR_LIPSYNC_SINGING_FRONT}。${DIRECTOR_LIPSYNC_MOUTH_VISIBLE_GUARD}`;
  const sep = /[。.!？?]$/.test(t) ? '' : '。';
  return `${t}${sep}${DIRECTOR_LIPSYNC_MOUTH_VISIBLE_GUARD}`;
}

/**
 * 从画面描述里抽出「主体运动」：去掉场景短名包装，避免图生视频再复述已定画面。
 */
export function extractDirectorSubjectMotion(desc: string | undefined | null): string {
  let t = String(desc || '').trim();
  if (!t) return '';
  t = t
    .replace(/（\s*场景\s*[：:][^）]*）/g, '')
    .replace(/\(\s*场景\s*[：:][^)]*\)/gi, '')
    .replace(/(?:^|[。；;\n，,])\s*场景\s*[：:]\s*[^。；;\n，,]*/gi, '')
    .replace(/空镜\s*[/／]\s*无人物[。．.\s]*/gi, '')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。；;，,\s]+|[。；;，,\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}

/**
 * 视频生成提示词：图生已有分镜图，只保留运镜 / 机位 / 主体运动 / 焦距。
 * 对口型开启时最前加入「人物正在面对镜头唱歌」。
 */
export function composeDirectorShotVideoPrompt(
  shot: Partial<Pick<DirectorShot, '画面描述' | '镜头角度' | '焦距' | '运镜'>>,
  opts?: { lipsync?: boolean },
): string {
  const parts: string[] = [];
  if (opts?.lipsync) {
    parts.push(DIRECTOR_LIPSYNC_SINGING_FRONT);
  }
  const angle = String(shot['镜头角度'] || '').trim();
  const focal = String(shot['焦距'] || '').trim();
  const move = String(shot['运镜'] || '').trim();
  const motion = extractDirectorSubjectMotion(shot['画面描述']);
  if (angle && angle !== '—') parts.push(`机位：${angle}`);
  if (focal && focal !== '—') parts.push(`焦距：${focal}`);
  if (move && move !== '—') parts.push(`运镜：${move}`);
  if (motion) parts.push(`主体运动：${motion}`);
  return parts
    .join('。')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。]+|[。]+$/g, '')
    .trim();
}

/** 从提示词中去掉对白/旁白段落（避免分镜图把歌词画进画面） */
export function stripDirectorDialogueFromPrompt(text: string | undefined | null): string {
  let t = String(text || '').trim();
  if (!t) return '';
  t = t
    .replace(/(?:^|[。；;\n])\s*对白\s*[/／]?\s*旁白\s*[：:]\s*[^。；;\n]*/gi, '')
    .replace(/(?:^|[。；;\n])\s*对白旁白\s*[：:]\s*[^。；;\n]*/gi, '')
    .replace(/(?:^|[。；;\n])\s*(?:dialogue|lyrics?)\s*[：:]\s*[^。；;\n]*/gi, '')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。；;\s]+|[。；;\s]+$/g, '')
    .trim();
  return t;
}

function isInstrumentalDialogue(dialogue: string): boolean {
  const t = String(dialogue || '').trim();
  if (!t) return true;
  return isDirectorInstrumentalLyricText(t);
}

function composeDirectorShotVisualParts(
  shot: Partial<Pick<DirectorShot, '画面描述' | '镜头角度' | '焦距' | '景别' | '光影氛围' | '运镜'>>,
  globalStyle?: string,
  opts?: { instrumental?: boolean; mode?: 'image' | 'video' },
): string[] {
  const parts: string[] = [];
  const style = String(globalStyle || '').trim();
  if (style) {
    parts.push(`画风：${style}`);
    parts.push(DIRECTOR_STYLE_ON_CAST_AND_SCENE_GUARD);
  }

  let desc = String(shot['画面描述'] || '').trim();
  if (opts?.instrumental) desc = stripDirectorSingingPerformanceFromText(desc);
  if (desc) parts.push(desc);

  const lensBlock = composeDirectorCinematicLensPromptBlock({
    angle: shot['镜头角度'],
    focal: shot['焦距'],
    size: shot['景别'],
    cameraMove: shot['运镜'],
    mode: opts?.mode || 'video',
  });
  if (lensBlock) parts.push(lensBlock);

  const light = String(shot['光影氛围'] || '').trim();
  if (light) parts.push(`光影氛围：${light}`);

  return parts;
}

/** 由镜头表字段拼出「最终提示词」草稿（风格 + 画面 + 展开镜头语言 + 光影 + 歌词对白；不含音效） */
export function composeDirectorShotFinalPrompt(
  shot: Partial<
    Pick<
      DirectorShot,
      '画面描述' | '镜头角度' | '焦距' | '景别' | '光影氛围' | '对白旁白' | '运镜' | '最终提示词' | '音效'
    >
  >,
  globalStyle?: string,
): string {
  const dialogue = String(shot['对白旁白'] || '').trim();
  const instrumental = isInstrumentalDialogue(dialogue);
  const parts = composeDirectorShotVisualParts(shot, globalStyle, {
    instrumental,
    mode: 'video',
  });

  if (dialogue && !instrumental) parts.push(`对白/旁白：${dialogue}`);
  if (instrumental) parts.push(DIRECTOR_INSTRUMENTAL_NO_SING_GUARD);

  return parts
    .join('。')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。]+|[。]+$/g, '')
    .trim();
}

/**
 * 分镜图专用提示词：按公式拼装，不含对白/歌词，并强制无文字画面。
 * 公式：（镜头语言+光影）+主体(主体描述)+主体运动+场景(场景描述)+(氛围)
 * 括号内为可选项；有风格参考图时氛围对齐其画面本身（勿按风格名称）。
 *
 * 注意：不要写死「参考图N=某角色」——实际顺序由调用方决定（风格→场景→人物1→人物2），
 * 序号说明在 DirectorNode 侧按真实顺序追加。空槽不发送。
 */
export function composeDirectorShotStoryboardPrompt(
  shot: Partial<
    Pick<
      DirectorShot,
      '画面描述' | '镜头角度' | '焦距' | '景别' | '光影氛围' | '对白旁白' | '音效' | '运镜' | '最终提示词'
    >
  >,
  globalStyle?: string,
  opts?: { hasStyleReferenceImage?: boolean; closeUpFraming?: boolean },
): string {
  const instrumental = isInstrumentalDialogue(String(shot['对白旁白'] || ''));
  const light = String(shot['光影氛围'] || '').trim();
  let desc = String(shot['画面描述'] || '').trim();
  if (instrumental) desc = stripDirectorSingingPerformanceFromText(desc);

  let fromFinal = stripDirectorDialogueFromPrompt(shot['最终提示词']);
  if (instrumental) fromFinal = stripDirectorSingingPerformanceFromText(fromFinal);
  fromFinal = stripDirectorImageMentionsLoose(fromFinal);

  const parts: string[] = [];
  parts.push(
    '【分镜图公式】（镜头语言+光影）+主体(主体描述)+主体运动+场景(场景描述)+(氛围)。括号内为可选项，缺项可省略。',
  );
  parts.push(DIRECTOR_CINEMATIC_TECHNIQUE_INVENTORY);
  parts.push(DIRECTOR_MV_SCENE_PROMPT_FORMULA_GUIDE);
  parts.push(DIRECTOR_MV_PERFORMANCE_DYNAMICS_GUIDE);
  if (opts?.closeUpFraming !== undefined) {
    parts.push(resolveDirectorMvCloseUpFramingGuide(!!opts.closeUpFraming));
  }
  parts.push(
    composeDirectorCinematicLensPromptBlock({
      angle: shot['镜头角度'],
      focal: shot['焦距'],
      size: shot['景别'],
      cameraMove: shot['运镜'],
      mode: 'image',
    }),
  );
  if (light) {
    parts.push(`光影：${light}（可用氛围光、晨光、夕阳、丁达尔效应、侧逆轮廓光等）`);
  }

  const subjectSceneBody = desc.length >= 8 ? desc : fromFinal;
  const emptyShot = /空镜|无人物|无人出镜|空场景/.test(`${desc}\n${fromFinal}`);
  if (subjectSceneBody) {
    if (emptyShot) {
      parts.push(
        `场景(场景描述)：${subjectSceneBody}。纯空镜：按场景公式写年代/地点/物品陈设（名称+位置+状态）/材质/光线，并强制无人物、无人脸、无肢体、无人影；不要写手眼脸运镜表演。镜头语言须作用在透视、景深与构图上。`,
      );
    } else {
      parts.push(
        `主体(主体描述)+主体运动+场景(场景描述)：${subjectSceneBody}。写清主要表现对象（人/物）、外貌姿态、所处环境；动作按「单类型选一条」（手部|眼部|脸部|运镜），禁止四类硬拼。镜头语言必须可见地作用在透视、景深与构图上。`,
      );
    }
  }

  const style = String(globalStyle || '').trim();
  const hasStyleRef = !!opts?.hasStyleReferenceImage;
  if (hasStyleRef) {
    // 有风格参考图：只锁画面视觉，不把风格名称/预设标题写进氛围，避免模型按名字理解
    parts.push(
      '氛围：画风与色调必须严格对齐风格参考图的画面本身（色调、画风、黑白/彩色等视觉观感），勿按风格名称或文字标签理解；须同时作用在主体与场景，禁止只改背景；场景参考图只借环境结构，不得覆盖风格色调；人物参考图只锁身份外貌。',
    );
    parts.push(DIRECTOR_STYLE_REF_IMAGE_LOCK_GUARD);
    if (directorStyleLooksMonochrome(style)) parts.push(DIRECTOR_MONOCHROME_STYLE_LOCK_GUARD);
    parts.push(DIRECTOR_STYLE_ON_CAST_AND_SCENE_GUARD);
  } else if (style) {
    parts.push(`氛围：${style}。全片画风与色调须统一，须同时作用在主体与场景，禁止只改背景。`);
    if (directorStyleLooksMonochrome(style)) parts.push(DIRECTOR_MONOCHROME_STYLE_LOCK_GUARD);
    parts.push(DIRECTOR_STYLE_ON_CAST_AND_SCENE_GUARD);
  }

  if (instrumental) {
    parts.push(DIRECTOR_INSTRUMENTAL_NO_SING_GUARD);
  }

  let body = parts
    .join('。')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。]+|[。]+$/g, '')
    .trim();
  if (!body || body.length < 20) {
    const fallback = composeDirectorShotVisualParts(shot, globalStyle, {
      instrumental,
      mode: 'image',
    })
      .join('。')
      .replace(/[。]{2,}/g, '。')
      .replace(/^[。]+|[。]+$/g, '')
      .trim();
    body = fallback || body;
  }
  if (!body) return '';

  if (/无任何文字|禁止出现任何文字|NO text|no text/i.test(body)) {
    return body;
  }
  return `${body}。${STORYBOARD_NO_TEXT_GUARD}`;
}

/** 去掉最终提示词里的 @图片绑定，避免分镜公式与参考图序号说明冲突 */
function stripDirectorImageMentionsLoose(prompt: string): string {
  return String(prompt || '')
    .replace(/@(?:图片|Image)\s*\d+(?:\s*作为第\d+张参考图[^。；;]*)?/gi, '')
    .replace(/@(?:图片|Image)\s*\d+(?:\s*作为[^，,。；;]*)?/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 在已有最终提示词上追加展开后的电影级镜头语言（保留 @图片 绑定）。
 * 已含「镜头语言」段落则不重复追加。
 */
export function appendDirectorCinematicLensToPrompt(
  prompt: string,
  shot: Partial<Pick<DirectorShot, '镜头角度' | '焦距' | '景别' | '运镜'>>,
  mode: 'image' | 'video' = 'video',
): string {
  const base = String(prompt || '').trim();
  const lens = composeDirectorCinematicLensPromptBlock({
    angle: shot['镜头角度'],
    focal: shot['焦距'],
    size: shot['景别'],
    cameraMove: shot['运镜'],
    mode,
  });
  if (!lens) return base;
  if (/镜头语言/.test(base)) return base;
  if (!base) return lens;
  const sep = /[。.!？?]$/.test(base) ? '' : '。';
  return `${base}${sep}${lens}`;
}

/** 空或占位：可自动回填最终提示词 */
export function shouldAutoSyncDirectorFinalPrompt(finalPrompt: string | undefined | null): boolean {
  const t = String(finalPrompt || '').trim();
  return !t || PENDING_FINAL_PROMPT_RE.test(t);
}

/**
 * 是否允许用镜头字段重拼「最终提示词」。
 * 仅空/占位可重拼，避免覆盖用户手动改过的内容（旧逻辑在未绑 @图片 时也会整段重拼，导致一改就变回去）。
 */
export function canRecomposeDirectorFinalPrompt(finalPrompt: string | undefined | null): boolean {
  return shouldAutoSyncDirectorFinalPrompt(finalPrompt);
}

export function withComposedDirectorFinalPrompts(
  shots: DirectorShot[],
  globalStyle?: string,
  /** true：强制覆盖已有最终提示词（生成镜头表后） */
  force = false,
): DirectorShot[] {
  return (shots || []).map((shot) => {
    if (!force && !canRecomposeDirectorFinalPrompt(shot['最终提示词'])) return shot;
    const composed = composeDirectorShotFinalPrompt(shot, globalStyle);
    if (!composed) return shot;
    return { ...shot, 最终提示词: composed };
  });
}
