import {
  isDirectorInstrumentalLyricText,
  DIRECTOR_INSTRUMENTAL_NO_SING_GUARD,
  DIRECTOR_EMPTY_SHOT_NO_PEOPLE_GUARD,
  DIRECTOR_INSTRUMENTAL_EMPTY_SHOT_GUARD,
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
import { composeMinimaxH3ChineseOfficialRefPrompt } from './minimaxH3DramaPrompt.js';
import { formatDirectorStyleFromRefImageHint } from './stylePresets.js';
import {
  stripDirectorPromptInventedLook,
  isDirectorEmptyShotPrompt,
  insertDirectorPromptAfterLookHead,
} from './bindAssetRefs.js';
import {
  isMinimaxH3EnglishSkillPrompt,
  standardizeMinimaxH3VideoPrompt,
} from '../minimaxH3StandardizePrompt.js';

const PENDING_FINAL_PROMPT_RE = /^(待生成提示词|待生成|to\s*be\s*generated|pending(\s*prompt)?)$/i;

/** MV / 分镜：画面内禁止任何可读文字（含歌词台词） */
export const DIRECTOR_MV_NO_ONSCREEN_TEXT_GUARD =
  '画面内禁止出现任何文字、字幕、歌词、台词气泡、水印、logo、标题、字母或数字标注；纯视觉画面，不要渲染可读文本。No on-screen text, lyrics, subtitles, or dialogue captions.';

/**
 * 短剧成片声景硬约束：要台词+环境音，禁止模型即兴配乐/哼唱。
 * （对口型歌曲复用走另一路径，不经过此句。）
 */
export const DIRECTOR_DRAMA_SOUNDSCAPE_GUARD =
  '【短剧声景硬性】成片音频须包含：①按本镜对白清晰可辨的角色台词（有对白时人物须开口说话，口型与台词同步）；②与场景匹配的环境底噪与物理动作音/音效。严禁即兴背景音乐、配乐、歌曲、哼唱、器乐铺底或任何非剧情配乐。';

/**
 * 短剧对白通道（对齐官方 H3 skill §4.4 / §4.5）：
 * 台词只进 <d>；画面字仅双引号点名。避免反复写 subtitle 反促烧录。
 */
export const DIRECTOR_DRAMA_NO_SUBTITLE_GUARD =
  'Spoken lines use only <d>[Chinese] … </d>. Place speaker ID, action, and delivery outside <d>. On-screen banners, signs, labels, or neon use English double quotation marks only when they must appear in the frame; do not place dialogue inside quotation marks as visible text.';

const STORYBOARD_NO_TEXT_GUARD = DIRECTOR_MV_NO_ONSCREEN_TEXT_GUARD;

/** 分镜 / 视频提示词：风格图只锁光色，画风固定真人写实 */
export const DIRECTOR_STYLE_FROM_REF_IMAGE_HINT =
  '光色参考第1张风格图；画风固定真人写实摄影（photorealistic），禁止插画/卡通/二次元/三维CG';

/** 全片光色须同时作用在人物与场景；画风统一真人写实 */
export const DIRECTOR_STYLE_ON_CAST_AND_SCENE_GUARD =
  '全片光色锁：色调与光照必须同时作用在人物与场景——人物的肤色受光、发丝与服装材质受光，以及场景环境光感，均须一致；画风统一为真人写实摄影。禁止只改背景光色而人物像另一套片。';

/** 有风格参考图时：只借光色，不借画风；场景图不得用自身彩色覆盖光色 */
export const DIRECTOR_STYLE_REF_IMAGE_LOCK_GUARD =
  '【风格参考图·硬性】风格参考图只提供光色（色调、对比度、色彩模式含彩色/黑白/单色、受光方向与明暗），禁止按风格名称/标题理解，也禁止照抄风格图的插画/卡通/二次元/概念设定/三维CG画风。画风必须始终为真人写实摄影（photorealistic live-action）。若风格图为黑白或单色，整幅输出必须同样去色/单色。场景与人物参考图只提供环境结构与人物身份外貌，禁止用场景图的彩色霓虹/饱和色覆盖风格图光色。Style ref = lighting/color only; rendering always photorealistic.';

/** 黑白/单色风格额外硬锁，避免被彩色场景参考图带跑 */
export const DIRECTOR_MONOCHROME_STYLE_LOCK_GUARD =
  '【单色/黑白硬性】整幅画面必须严格黑白或单色（monochrome）：禁止彩色、禁止霓虹彩光、禁止彩色皮肤与服装；保留明暗与质感，但色相必须去色。Entire image must be black-and-white / monochrome — no color.';

/** 从风格文案判断是否偏黑白/单色 */
export function directorStyleLooksMonochrome(styleText: string | undefined | null): boolean {
  return /黑白|单色|无彩色|灰度|灰阶|monochrome|grayscale|grey\s*scale|black[\s-]*and[\s-]*white|\bb\s*&\s*w\b|\bnoir\b/i.test(
    String(styleText || ''),
  );
}

export type DirectorStylePromptOpts = {
  lipsync?: boolean;
  shotChangePace?: string | null;
  stylePresetId?: string | null;
  stylePictureLabel?: string | null;
  stylePictureIndex?: number | null;
};

function resolveStylePictureHint(opts?: {
  stylePictureIndex?: number | null;
  stylePictureLabel?: string | null;
}): string {
  return formatDirectorStyleFromRefImageHint(opts?.stylePictureIndex ?? 1);
}

/**
 * 去掉提示词里的画风文字描述 / 风格图名称，改成「光色参考第N张 + 真人写实」。
 */
export function replaceDirectorStyleTextWithImageRef(
  text: string | undefined | null,
  stylePictureIndex?: number | string | null,
): string {
  let t = String(text || '');
  if (!t) return t;
  const hint = formatDirectorStyleFromRefImageHint(stylePictureIndex);
  t = t.replace(/画面风格参考所选风格图片(?:「[^」]*」)?/g, hint);
  t = t.replace(/画面风格参考第\d+张图/g, hint);
  t = t.replace(/光色参考第\d+张风格图；画风固定真人写实摄影[^。\n]*/g, hint);
  t = t.replace(
    /画风\s*[：:]\s*(?!光色参考第\d+张|画面风格参考第\d+张图)[^\n。]*/g,
    `画风：${hint}`,
  );
  t = t.replace(
    /目标视频画风须同时作用在人物与场景[：:][^\n]*/g,
    `目标视频画风须同时作用在人物与场景：${hint}`,
  );
  t = t.replace(
    /目标视频采用电影感\s*MV\s*画风[^。\n]*/g,
    `目标视频画风须同时作用在人物与场景：${hint}`,
  );
  t = t.replace(
    /(^|[。\n；;])氛围：(?!画风与色调必须严格对齐风格参考图|画面风格参考第|光色参考第)[^\n。]{8,}(?:。全片画风与色调须统一[^。]*)?/g,
    `$1氛围：${hint}`,
  );
  return t;
}

/**
 * 对口型生成硬性约束：人物须朝向镜头且嘴巴可见，避免转身/背影导致口型失效。
 * 仅同步口型，不写/不画任何台词歌词。
 */
export const DIRECTOR_LIPSYNC_MOUTH_VISIBLE_GUARD =
  '【对口型硬性约束】人物须全程正面或四分之三正面朝向镜头，嘴巴清晰可见并跟唱口型（仅嘴部动作与歌声同步）；禁止转身背对镜头、禁止背影/后脑勺、禁止侧脸或低头藏住嘴巴；可轻微手势与律动，但面部始终朝向镜头且口部可见；禁止在画面中写出或叠任何歌词/台词/字幕。Keep face toward camera, mouth clearly visible for lip-sync only; no turning away; no on-screen lyrics or dialogue text.';

/** 推荐对口型 / 用户打开对口型时，置于视频提示词最前 */
export const DIRECTOR_LIPSYNC_SINGING_FRONT =
  '指定主角正在面对镜头唱歌（仅该主角对口型，画面无台词）；配角与路人双唇紧闭，禁止跟唱或开口';

/**
 * 非对口型硬性约束：明确禁止开口；MV 本来不需要画面台词。
 */
export const DIRECTOR_NO_LIPSYNC_MOUTH_CLOSED_GUARD =
  '【非对口型硬性】本镜不对口型：所有出场人物必须保持沉默、不要说话、禁止开口、禁止对口型跟唱、禁止唱歌张嘴；嘴部自然闭合；仅用眼神/肢体/运镜表达情绪。Characters remain silent, do not speak, mouths closed, no lip-sync.';

/** 关闭对口型时置于提示词最前 */
export const DIRECTOR_NO_LIPSYNC_SILENT_FRONT =
  '本镜不对口型：所有出场人物保持沉默、不要说话，双唇紧闭，禁止开口';

/** 对口型开启时：仅指定主角跟唱，配角不得莫名开口 */
export const DIRECTOR_LIPSYNC_EXTRAS_MOUTH_CLOSED_GUARD =
  '【配角闭嘴硬性】仅指定主角可对口型跟唱；其余出场人物（配角/路人/群众）必须双唇紧闭，禁止张嘴唱歌、禁止对口型、禁止跟唱。';

const MOUTH_OPEN_OR_SPEAKING_RE =
  /正在(?:面对镜头)?唱歌|面对镜头唱歌|张嘴(?:唱歌|演唱|说话)?|开口(?:说话|唱歌|演唱)?|大声(?:唱|说)|对口型(?:跟唱|唱歌|演唱)?|跟唱口型|嘴巴(?:张开|大张)|lip[\s-]?sync(?:ing)?|singing(?:\s+into)?|mouth\s+open(?:ing)?/gi;

/** 去掉「正在开口/唱歌」类表述（非对口型镜） */
export function stripDirectorMouthOpenPerformanceFromText(text: string | undefined | null): string {
  let t = String(text || '').trim();
  if (!t) return '';
  t = t.replace(MOUTH_OPEN_OR_SPEAKING_RE, '闭嘴沉默');
  t = t.replace(/(闭嘴沉默[，,]?\s*){2,}/g, '闭嘴沉默，');
  t = t.replace(/[。]{2,}/g, '。').replace(/\s{2,}/g, ' ').trim();
  return t;
}

function appendPromptGuard(prompt: string, guard: string): string {
  const t = String(prompt || '').trim();
  const g = String(guard || '').trim();
  if (!g) return t;
  if (t.includes(g.slice(0, Math.min(18, g.length)))) return t;
  if (!t) return g;
  const sep = /[。.!？?]$/.test(t) ? '' : '。';
  return `${t}${sep}${g}`;
}

function withEmptyShotFrontGuards(prompt: string, extra?: string): string {
  const t = String(prompt || '').trim();
  if (!extra) return t;
  return insertDirectorPromptAfterLookHead(t, extra);
}

/** 确保提示词含「画面无文字」约束 */
export function ensureDirectorMvNoOnscreenTextPrompt(
  prompt: string,
  opts?: { skip?: boolean },
): string {
  if (opts?.skip) return String(prompt || '').trim();
  const t = String(prompt || '').trim();
  if (/无任何文字|禁止出现任何文字|No on-screen text|no text|不要渲染可读文本/i.test(t)) {
    return t;
  }
  return appendPromptGuard(t, DIRECTOR_MV_NO_ONSCREEN_TEXT_GUARD);
}

/** 非对口型：清洗开口表述；六段式已含闭嘴声明时不再追加中英双语长守卫 */
export function ensureDirectorNoLipsyncMouthClosedPrompt(
  prompt: string,
  opts?: { emptyShot?: boolean; sourcePrompt?: string; skipOnscreenText?: boolean },
): string {
  const empty =
    !!opts?.emptyShot || isDirectorEmptyShotPrompt(prompt, opts?.sourcePrompt);
  if (empty) {
    let next = stripDirectorPromptInventedLook(String(prompt || ''), opts?.sourcePrompt);
    next = withEmptyShotFrontGuards(next);
    next = next
      .replace(/【非对口型硬性】[^。\n]*/g, '')
      .replace(/Mouth closed for everyone[^。\n]*/gi, '')
      .replace(/口型约束：全员双唇紧闭[^。\n]*/g, '');
    return ensureDirectorMvNoOnscreenTextPrompt(next, { skip: opts?.skipOnscreenText });
  }
  let t = stripDirectorMouthOpenPerformanceFromText(stripDirectorDialogueFromPrompt(prompt));
  t = t
    .replace(/指定主角正在面对镜头唱歌[^。\n]*/g, '')
    .replace(/人物正在面对镜头唱歌[^。\n]*/g, '')
    .replace(/【对口型硬性约束】[^。\n]*/g, '')
    .replace(/【配角闭嘴硬性】[^。\n]*/g, '')
    .replace(/(?:^|[。；;\n])\s*对口型动作\s*[：:]\s*[^。；;\n]*/gi, '')
    .replace(/Keep face toward camera[^。\n]*/gi, '')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。；;\s]+|[。；;\s]+$/g, '')
    .trim();
  if (!t.includes(DIRECTOR_NO_LIPSYNC_SILENT_FRONT) && !/保持沉默.*不要说话|不要说话.*保持沉默/.test(t)) {
    t = t ? `${DIRECTOR_NO_LIPSYNC_SILENT_FRONT}。${t}` : DIRECTOR_NO_LIPSYNC_SILENT_FRONT;
  }
  if (!/保持沉默/.test(t) || !/不要说话/.test(t)) {
    t = appendPromptGuard(t, DIRECTOR_NO_LIPSYNC_MOUTH_CLOSED_GUARD);
  } else if (
    !/非对口型硬性|Mouth closed|本镜不对口型|口型约束：全员双唇紧闭|全员双唇紧闭/.test(t)
  ) {
    t = appendPromptGuard(t, DIRECTOR_NO_LIPSYNC_MOUTH_CLOSED_GUARD);
  }
  return ensureDirectorMvNoOnscreenTextPrompt(t, { skip: opts?.skipOnscreenText });
}

/** 弱化与对口型冲突的背身/转身表述，再前置唱歌句并追加硬性约束 */
export function ensureDirectorLipsyncMouthVisiblePrompt(
  prompt: string,
  opts?: { skipOnscreenText?: boolean },
): string {
  let t = stripDirectorDialogueFromPrompt(String(prompt || '').trim());
  // 去掉「非对口型」残留，避免开关打开后矛盾
  t = t
    .replace(/【非对口型硬性】[^。\n]*/g, '')
    .replace(/本镜对口型开关关闭[^。\n]*/g, '')
    .replace(/本镜不对口型[^。\n]*/g, '')
    .replace(/所有出场人物必须保持沉默[^。\n]*/g, '')
    .replace(/所有出场人物保持沉默[^。\n]*/g, '')
    .replace(/口型约束：全员保持沉默[^。\n]*/g, '')
    .replace(/口型约束：全员双唇紧闭[^。\n]*/g, '')
    .replace(/不对口型：全员保持沉默[^。\n]*/g, '')
    .replace(/Characters remain silent[^。\n]*/gi, '')
    .replace(/Mouth closed for everyone[^。\n]*/gi, '')
    .replace(/[。]{2,}/g, '。')
    .trim();
  if (t) {
    t = t
      .replace(/背对镜头|背影|背面全身|后脑勺|从背后拍摄|从背后/gi, '正面朝向镜头')
      .replace(/facing\s*away|from\s*behind|rear\s*view|back\s*(to|toward)\s*(camera|viewer)/gi, 'facing camera')
      .replace(/转身(?:离开|背对|离去)|转过身去/gi, '面向镜头')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (!t.includes(DIRECTOR_LIPSYNC_SINGING_FRONT) && !/指定主角正在面对镜头唱歌|面对镜头唱歌/.test(t)) {
    t = t ? `${DIRECTOR_LIPSYNC_SINGING_FRONT}。${t}` : DIRECTOR_LIPSYNC_SINGING_FRONT;
  }
  if (!/对口型硬性约束|mouth clearly visible for lip-sync|嘴巴清晰可见并跟唱/.test(t)) {
    if (!t) t = `${DIRECTOR_LIPSYNC_SINGING_FRONT}。${DIRECTOR_LIPSYNC_MOUTH_VISIBLE_GUARD}`;
    else {
      const sep = /[。.!？?]$/.test(t) ? '' : '。';
      t = `${t}${sep}${DIRECTOR_LIPSYNC_MOUTH_VISIBLE_GUARD}`;
    }
  }
  if (!/配角闭嘴硬性|其余出场人物.*双唇紧闭/.test(t)) {
    t = appendPromptGuard(t, DIRECTOR_LIPSYNC_EXTRAS_MOUTH_CLOSED_GUARD);
  }
  return ensureDirectorMvNoOnscreenTextPrompt(t, { skip: opts?.skipOnscreenText });
}

/**
 * MV 视频生成提示词统一守卫：去台词 + 无字幕；对口型开/关分别约束嘴部。
 * 对口型开启时追加镜头表「对口型动作」栏目；关闭时不链接该栏目。
 */
export function ensureDirectorMvVideoPromptGuards(
  prompt: string,
  opts?: {
    lipsync?: boolean;
    lipsyncAction?: string;
    sourcePrompt?: string;
    emptyShot?: boolean;
    skipOnscreenText?: boolean;
  },
): string {
  const body = stripDirectorDialogueFromPrompt(prompt) || String(prompt || '').trim();
  const empty =
    !!opts?.emptyShot || isDirectorEmptyShotPrompt(body, opts?.sourcePrompt);
  if (empty) {
    return ensureDirectorNoLipsyncMouthClosedPrompt(body, {
      emptyShot: true,
      sourcePrompt: opts?.sourcePrompt,
      skipOnscreenText: opts?.skipOnscreenText,
    });
  }
  if (opts?.lipsync) {
    let next = ensureDirectorLipsyncMouthVisiblePrompt(body, {
      skipOnscreenText: opts?.skipOnscreenText,
    });
    const lip = String(opts.lipsyncAction || '').trim();
    if (lip && lip !== '—' && !next.includes(lip)) {
      next = appendPromptGuard(next, `对口型动作：${lip}`);
    }
    return next;
  }
  return ensureDirectorNoLipsyncMouthClosedPrompt(body, {
    skipOnscreenText: opts?.skipOnscreenText,
  });
}

const LTX_I2V_SAME_SCENE_LOCK =
  '输入图即首帧。整段只在该画面空间内连续运动，不要切换到无关场景。';

const LTX_MOUTH_CLOSED_SAFE = '人物闭嘴，不说话、不对口型。';

/**
 * LTX 把整段 prompt 当正面词：出现 subtitle/caption/字幕/水印 就会画到画面上。
 * 闭嘴约束只保留嘴部动作，不提字幕。
 */
function stripLtxPositiveOnscreenTextMentions(text: string): string {
  let s = String(text || '');
  if (s.includes(DIRECTOR_NO_LIPSYNC_MOUTH_CLOSED_GUARD)) {
    s = s.split(DIRECTOR_NO_LIPSYNC_MOUTH_CLOSED_GUARD).join(LTX_MOUTH_CLOSED_SAFE);
  }
  if (s.includes(DIRECTOR_MV_NO_ONSCREEN_TEXT_GUARD)) {
    s = s.split(DIRECTOR_MV_NO_ONSCREEN_TEXT_GUARD).join('');
  }
  if (s.includes(DIRECTOR_LIPSYNC_MOUTH_VISIBLE_GUARD)) {
    s = s.split(DIRECTOR_LIPSYNC_MOUTH_VISIBLE_GUARD).join(
      '人物正面朝向镜头，嘴巴可见并跟唱口型。',
    );
  }
  s = s
    .replace(/【非对口型硬性】[\s\S]{0,280}?no on-screen lyrics\.?/gi, LTX_MOUTH_CLOSED_SAFE)
    .replace(/【对口型硬性约束】[\s\S]{0,280}?no on-screen lyrics or dialogue text\.?/gi, '人物正面朝向镜头，嘴巴可见并跟唱口型。')
    .replace(/画面内禁止出现任何文字[^.。]{0,100}[。.]?/g, '')
    .replace(/画面禁止出现任何歌词[^.。]{0,40}[。.]?/g, '')
    .replace(/禁止在画面中写出或叠任何歌词[^.。]{0,40}[。.]?/g, '')
    .replace(/No on-screen text[^.。]{0,80}[。.]?/gi, '')
    .replace(/no on-screen (?:text|lyrics|dialogue)[^.。]{0,80}[。.]?/gi, '')
    .replace(/no burned-in[^.。]{0,80}[。.]?/gi, '')
    .replace(/Mouth closed for everyone[^.。]{0,80}[。.]?/gi, LTX_MOUTH_CLOSED_SAFE)
    .replace(/\b(?:subtitles?|captions?|watermarks?|closed[\s-]?captions?)\b/gi, '')
    .replace(/烧录字幕|底部字幕条|台词气泡|叠字|字幕条|水印|字幕|画面无台词|零文字|零字幕/g, '')
    .replace(/\bNegative:\s*[^\n]{0,240}/gi, '');
  return s;
}

/**
 * LTX2.3 图生/对口型只有 1 张参考图（分镜），且把整段 prompt 写入 Comfy 正面词。
 * H3/Seedance 的「图片2角色锁」和 Negative: text/golden hour 会当成要画的内容，必须剥掉。
 */
export function adaptDirectorPromptForLtxI2v(prompt: string): string {
  let t = String(prompt || '').trim();
  if (!t) return LTX_I2V_SAME_SCENE_LOCK;

  t = t.replace(/参考图对照[：:][。.\s]*/g, '');
  t = t.replace(/<图片\s*\d+>为本镜分镜图，构图、场景、画风与光色参考第\d+张图。[。.]?/g, '');
  t = t.replace(/<图片\s*\d+>/g, '');
  t = t.replace(/<Picture\s*\d+>/gi, '');
  t = t.replace(/@图片\s*\d+\s*作为第\d+张参考图｜[^\n@]{0,80}/g, '');
  t = t.replace(/@(?:图片|Image)\s*\d+/gi, '');
  t = t.replace(/「[^」]{0,12}」外貌参考第\d+张图[。.]?/g, '');
  t = t.replace(/角色图只提供外貌身份[。.]?/g, '');
  t = t.replace(/成片画风参考第\d+张分镜图[。.]?/g, '');
  t = t.replace(
    /Keep Picture 1 colors and rendering as they appear in the image[;；.。]?\s*/gi,
    '',
  );
  t = t.replace(/do not regrade[;；.。]?\s*/gi, '');
  t = t.replace(/do not restyle into 3D CGI[;；.。]?\s*/gi, '');
  t = t.replace(/光色与渲染严格跟第1张分镜图画面，禁止重新调色。[。.]?\s*/g, '');
  t = t.replace(
    /以第1张分镜图为首帧与视觉锚点，[^。]*。(?:所有镜头移动[^。]*。)?(?:Only describe what is visible in Picture 1\.\s*)?(?:Do not name colors\.\s*)?(?:Do not write lighting, time of day, mood, or atmosphere words\.\s*)?/g,
    '',
  );
  t = t.replace(/Only describe what is visible in Picture 1\.\s*/gi, '');
  t = t.replace(/Do not name colors\.\s*/gi, '');
  t = t.replace(/Do not write lighting, time of day, mood, or atmosphere words\.\s*/gi, '');
  t = t.replace(
    /Negative:\s*unrealistic color shift[\s\S]{0,280}?logo\.\s*/gi,
    '',
  );
  t = t.replace(/The main character['’]s appearance matches[^.。]{0,120}[.。]/gi, '');
  t = t.replace(/appearance matches (?:his|her|their) identity reference[^.。]{0,80}[.。]/gi, '');
  t = t.replace(/the setting reflects the interior of the car from\s*,/gi, 'the setting is the car interior,');
  t = t.replace(/\bthe shot transitions to\b/gi, 'the camera continues with');
  t = t.replace(/The shot structure follows seamlessly\.?/gi, '');
  t = t.replace(/non_diegetic_music\s*:\s*N\/A\s*\.?/gi, '');
  t = t.replace(/(?:^|\s)参考图(?:\s|$)/g, ' ');
  t = stripLtxPositiveOnscreenTextMentions(t);
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, '').trim();

  if (!t) return LTX_I2V_SAME_SCENE_LOCK;
  if (t.startsWith(LTX_I2V_SAME_SCENE_LOCK)) return t;
  return `${LTX_I2V_SAME_SCENE_LOCK} ${t}`.replace(/\s{2,}/g, ' ').trim();
}

function stripDirectorMvLipsyncGuardsFromDramaPrompt(text: string): string {
  return String(text || '')
    .replace(/指定主角正在面对镜头唱歌[^。\n]*/g, '')
    .replace(/人物正在面对镜头唱歌[^。\n]*/g, '')
    .replace(/【对口型硬性约束】[\s\S]{0,400}?no on-screen lyrics or dialogue text\.?/gi, '')
    .replace(/【对口型硬性约束】[^。\n]*/g, '')
    .replace(/【配角闭嘴硬性】[^。\n]*/g, '')
    .replace(/Keep face toward camera[^。\n]*/gi, '')
    .replace(/人物须全程正面或四分之三正面朝向镜头[^。\n]*/g, '')
    .replace(/仅指定主角可对口型跟唱[^。\n]*/g, '')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。；;\s]+|[。；;\s]+$/g, '')
    .trim();
}

/**
 * 短剧成片守卫：保留对白供声轨生成；禁止字幕；禁止即兴配乐；有对白时允许开口说话。
 * 切勿套用 MV 的「全员闭嘴 / 去台词 / 面对镜头唱歌」逻辑。
 */
export function ensureDirectorDramaVideoPromptGuards(
  prompt: string,
  opts?: {
    sourcePrompt?: string;
    emptyShot?: boolean;
    dialogue?: string;
    sfx?: string;
    /** 执行表已含分段对白/音效时，不再压扁成一句追加 */
    skipDialogueSfxFlatten?: boolean;
    skipSoundscapeGuard?: boolean;
    hasDialogue?: boolean;
    /**
     * 保留 <d> 外中文（api 中文自然语言终稿）。
     * 未传时：若检出 [场景概述] 等中文 api 结构则自动保留。
     */
    preserveChinese?: boolean;
  },
): string {
  let body = stripDirectorMvLipsyncGuardsFromDramaPrompt(String(prompt || '').trim());
  const empty =
    !!opts?.emptyShot || isDirectorEmptyShotPrompt(body, opts?.sourcePrompt);
  // 去掉误注入的 MV 闭嘴硬句，避免短剧对白被压掉
  body = body
    .replace(/【非对口型硬性】[^。\n]*/g, '')
    .replace(/本镜对口型开关关闭[^。\n]*/g, '')
    .replace(/Mouth closed for everyone[^。\n]*/gi, '')
    .replace(/[。]{2,}/g, '。')
    .trim();

  const dialogue = String(opts?.dialogue || '').trim();
  const sfx = String(opts?.sfx || '').trim();
  const noDialogueMode =
    opts?.hasDialogue === false || /\[NO_DIALOGUE\]/.test(body);
  if (noDialogueMode) {
    body = body.replace(/【短剧声景硬性】[^【]*/g, '').replace(/\s+$/g, '').trim();
  }
  // 对白通道只声明一次（Compiler 已含 Spoken lines use only <d> 则不再堆叠）
  // 中文 api 终稿已自带结构时，勿再前置英文通道说明
  const preserveChinese =
    opts?.preserveChinese === true ||
    (opts?.preserveChinese !== false && isDramaH3ZhNaturalApiPrompt(body));
  // 禁字幕：中文终稿也要保留一句英文硬锁（勿反复堆叠）
  if (
    !/Spoken lines use only <d>|短剧禁字幕|NO_SUBTITLE|No burned-in subtitles|burned-in subtitle/i.test(
      body,
    )
  ) {
    const subtitleGuard =
      opts?.hasDialogue === false
        ? 'Do not write spoken lines. No burned-in subtitles, captions, dialogue bubbles, watermarks, or on-screen UI text.'
        : `${DIRECTOR_DRAMA_NO_SUBTITLE_GUARD} No burned-in subtitles, captions, dialogue bubbles, watermarks, or on-screen UI text.`;
    if (preserveChinese) {
      // 中文混排：放文末，避免顶栏英文锁块再次盖住格式
      body = body ? `${body}\n${subtitleGuard}` : subtitleGuard;
    } else {
      body = body ? `${subtitleGuard}\n\n${body}` : subtitleGuard;
    }
  }
  if (empty) {
    body = appendPromptGuard(body, DIRECTOR_EMPTY_SHOT_NO_PEOPLE_GUARD);
    body = appendPromptGuard(
      body,
      `【短剧空镜声景】仅环境底噪与场景音效${sfx ? `（${sfx}）` : ''}；禁止人物台词、禁止即兴 BGM/配乐/歌曲；画面零文字。`,
    );
  } else if (!opts?.skipDialogueSfxFlatten && !isMinimaxH3EnglishSkillPrompt(body)) {
    const speak =
      dialogue && dialogue !== '—'
        ? `本镜对白仅作音频与口型驱动（人物开口说出，严禁画面叠字）：音频内容「${dialogue.slice(0, 280)}」；说话者口型与台词同步，无对白者闭嘴。`
        : '本镜无对白：人物闭嘴；仅环境音与动作音；画面零文字。';
    const sfxLine = sfx && sfx !== '—' ? `环境音效按导演指示：${sfx.slice(0, 160)}。` : '';
    body = appendPromptGuard(body, `${speak}${sfxLine}`);
  }
  if (!opts?.skipSoundscapeGuard && !noDialogueMode && opts?.hasDialogue !== false) {
    body = appendPromptGuard(body, DIRECTOR_DRAMA_SOUNDSCAPE_GUARD);
  }

  // 若已是六段式，强化「整体声景 / 非剧情配乐」两段，并在概述补禁字幕
  if (!opts?.skipDialogueSfxFlatten && isDirectorH3ZhSixSectionPrompt(body)) {
    const soundBody = empty
      ? `仅环境底噪与物理动作音${sfx ? `（${sfx}）` : ''}；禁止台词、禁止即兴 BGM/配乐/歌曲；画面零文字、零字幕。`
      : dialogue && dialogue !== '—'
        ? `角色台词仅进音频轨（可听、可口型），内容：「${dialogue.slice(0, 200)}」；环境音效${sfx && sfx !== '—' ? `：${sfx.slice(0, 120)}` : '与场景匹配'}；禁止即兴背景音乐/配乐/歌曲/哼唱；严禁烧录字幕、台词叠字、对话气泡。`
        : `无对白：仅环境底噪与物理动作音${sfx && sfx !== '—' ? `（${sfx}）` : ''}；禁止即兴 BGM/配乐/歌曲；画面零文字、零字幕。`;
    body = body
      .replace(
        /整体声景\s*[：:][\s\S]*?(?=\n\s*非剧情配乐\s*[：:]|$)/,
        `整体声景：\n${soundBody}\n\n`,
      )
      .replace(/非剧情配乐\s*[：:][\s\S]*?$/m, '非剧情配乐：\n无（严禁生成任何配乐/BGM）');
    if (!/非剧情配乐\s*[：:]/.test(body)) {
      body = `${body}\n\n非剧情配乐：\n无（严禁生成任何配乐/BGM）`;
    }
    if (/概述\s*[：:]/.test(body) && !/禁字幕|零字幕|burned-in/i.test(body.match(/概述\s*[：:][\s\S]*?(?=\n\s*内容保留分析|$)/)?.[0] || '')) {
      body = body.replace(
        /(概述\s*[：:]\s*)/,
        `$1【禁字幕】画面不得出现任何字幕/叠字/对话气泡；对白只在音频。`,
      );
    }
  }
  body = stripDirectorMvLipsyncGuardsFromDramaPrompt(body);
  // 英文六段 / 旧编译稿：剥 <d> 外汉字，防 H3 念成旁白。
  // 中文 api 整合稿（含 [场景概述]）：必须原样上云，否则会变成空括号残片。
  if (!preserveChinese) {
    body = stripChineseOutsideH3DialogueTags(body);
  }
  if (isMinimaxH3EnglishSkillPrompt(body)) {
    body = standardizeMinimaxH3VideoPrompt(body);
  }
  return body;
}

/**
 * 拼接+整合产出的中文 api 终稿：靠 Context-IR 读中文叙事，禁止再剥汉字。
 * 含旧六段中文稿，以及白话 @图片 / 风格色调 / 剧情。
 */
export function isDramaH3ZhNaturalApiPrompt(prompt: string): boolean {
  const t = String(prompt || '');
  if (!t.trim()) return false;
  if (
    /@图片\s*\d+\s*是/.test(t) &&
    (/风格色调\s*[：:]/.test(t) || /剧情\s*[：:]/.test(t))
  ) {
    return true;
  }
  return (
    /\[场景概述\]/.test(t) ||
    /\[场景锚点锁定\]/.test(t) ||
    /\[镜头时间线\]/.test(t) ||
    /\[视觉风格\]/.test(t) ||
    /\[负面清单\]/.test(t) ||
    /\[声音描述\]/.test(t) ||
    (/\[镜头\s*\d+\]/.test(t) && /<(?:Picture|Subject|Audio)\s*\d+>/.test(t)) ||
    (/主体定义\s*[：:]/.test(t) && /详细描述\s*[：:]/.test(t)) ||
    /综合多模态描述\s*[：:]/.test(t) ||
    // 英文段名 + 中文正文（短剧 Skill 范例）
    (/detailed_description\s*:/i.test(t) &&
      /[\u4e00-\u9fff]/.test(t) &&
      (/<Picture\s+\d+>/i.test(t) || /\[Shot\s*\d+\]/i.test(t) || /<d>\s*\[Chinese/i.test(t)))
  );
}

/**
 * 剥离 MiniMax H3 提示词中 `<d>…</d>` 之外的汉字。
 * 保留：`<d>` 台词、`<图片N>` / `<主体N>` / `<音频N>` / `<图N>` 引用标签。
 * 其余 CJK（含导演说明、中文六段标题）一律删除，避免被念成旁白。
 * 注意：中文 api 终稿请先用 isDramaH3ZhNaturalApiPrompt 判断，勿对本函数输入。
 */
export function stripChineseOutsideH3DialogueTags(prompt: string): string {
  const text = String(prompt || '');
  if (!text) return '';
  const protectedBlocks: string[] = [];
  const protect = (m: string) => {
    const i = protectedBlocks.length;
    protectedBlocks.push(m);
    return `\u0000H3SAFE${i}\u0000`;
  };
  let out = text.replace(/<d\b[^>]*>[\s\S]*?<\/d>/gi, protect);
  out = out.replace(/<(?:图片|主体|音频|图|Picture|Subject|Audio)\s*\d+\s*>/g, protect);
  out = out.replace(/[（(]S\d+[）)]/g, protect);
  // 画面字（弹幕/招牌/霓虹）按 H3 约定写在英文双引号内，剥汉字时必须保留
  out = out.replace(/"(?:\\.|[^"\\])*"/g, protect);
  // CJK 统一表意文字 + 兼容汉字 + CJK 标点/全角
  out = out.replace(/[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]+/g, ' ');
  out = out.replace(/\u0000H3SAFE(\d+)\u0000/g, (_, n) => protectedBlocks[Number(n)] || '');
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 对口型开关切换时改写「最终提示词」：开→注入主角对口型+配角闭嘴；关→清洗开口并全员闭嘴。
 * 即使用户已改过提示词，开关仍应管理口型相关子句。
 */
export function applyDirectorLipsyncToggleToFinalPrompt(
  finalPrompt: string | undefined | null,
  opts?: { lipsync?: boolean; lipsyncAction?: string },
): string {
  const raw = String(finalPrompt || '').trim();
  if (!raw || shouldAutoSyncDirectorFinalPrompt(raw)) {
    return raw;
  }
  return ensureDirectorMvVideoPromptGuards(raw, opts);
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
  shot: Partial<Pick<DirectorShot, '画面描述' | '镜头角度' | '焦距' | '运镜' | '对口型动作'>>,
  opts?: { lipsync?: boolean },
): string {
  const parts: string[] = [];
  if (opts?.lipsync) {
    parts.push(DIRECTOR_LIPSYNC_SINGING_FRONT);
  }
  const angle = String(shot['镜头角度'] || '').trim();
  const focal = String(shot['焦距'] || '').trim();
  const move = String(shot['运镜'] || '').trim();
  let motion = extractDirectorSubjectMotion(shot['画面描述']);
  if (!opts?.lipsync) motion = stripDirectorMouthOpenPerformanceFromText(motion);
  if (angle && angle !== '—') parts.push(`机位：${angle}`);
  if (focal && focal !== '—') parts.push(`焦距：${focal}`);
  if (move && move !== '—') parts.push(`运镜：${move}`);
  if (motion) {
    parts.push(/动作时轴|^\s*\d+(?:\.\d+)?\s*[–\-〜~到至]/.test(motion) ? motion : `主体运动：${motion}`);
  }
  const body = parts
    .join('。')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。]+|[。]+$/g, '')
    .trim();
  return ensureDirectorMvVideoPromptGuards(body, {
    lipsync: opts?.lipsync,
    lipsyncAction: shot['对口型动作'],
  });
}

/**
 * 生成视频用提示词：优先用镜头表「最终提示词」（用户改过则不再用机位短句覆盖）。
 * 空/占位时回退到 composeDirectorShotVideoPrompt。
 * 对口型开关关闭时不链接「对口型动作」栏目。
 * drama=true：保留对白、禁止套用 MV 闭嘴/去台词（短剧要台词+环境音）。
 */
export function resolveDirectorShotVideoPromptForGen(
  shot: Partial<
    Pick<
      DirectorShot,
      '最终提示词' | '画面描述' | '镜头角度' | '焦距' | '运镜' | '对口型动作' | '对白旁白' | '音效'
    >
  >,
  opts?: {
    lipsync?: boolean;
    drama?: boolean;
    stylePictureLabel?: string | null;
    stylePresetId?: string | null;
  },
): string {
  const finalRaw = String(shot['最终提示词'] || '').trim();
  if (finalRaw && !shouldAutoSyncDirectorFinalPrompt(finalRaw)) {
    let body = finalRaw;
    if (opts?.drama) {
      return ensureDirectorDramaVideoPromptGuards(
        stripDirectorPromptInventedLook(replaceDirectorStyleTextWithImageRef(body, 1)),
        {
          dialogue: String(shot['对白旁白'] || '').trim(),
          sfx: String(shot['音效'] || '').trim(),
          sourcePrompt: String(shot['画面描述'] || ''),
        },
      );
    }
    // 非对口型：去掉 <d>；始终去掉「对白旁白：」行，避免被画成字幕
    if (!opts?.lipsync) {
      body = stripDirectorH3DialogueTags(body);
    }
    body = stripDirectorDialogueFromPrompt(body);
    if (!body) body = finalRaw;
    if (!opts?.lipsync) {
      body = body
        .replace(/(?:^|[。；;\n])\s*对口型动作\s*[：:]\s*[^。；;\n]*/gi, '')
        .replace(/[。]{2,}/g, '。')
        .replace(/^[。；;\s]+|[。；;\s]+$/g, '')
        .trim();
    }
    return ensureDirectorMvVideoPromptGuards(
      stripDirectorPromptInventedLook(replaceDirectorStyleTextWithImageRef(body, 1)),
      {
        lipsync: opts?.lipsync,
        lipsyncAction: shot['对口型动作'],
      },
    );
  }
  if (opts?.drama) {
    const composed = composeDirectorShotVideoPrompt(shot, { lipsync: false });
    return ensureDirectorDramaVideoPromptGuards(composed, {
      dialogue: String(shot['对白旁白'] || '').trim(),
      sfx: String(shot['音效'] || '').trim(),
      sourcePrompt: String(shot['画面描述'] || ''),
    });
  }
  return composeDirectorShotVideoPrompt(shot, opts);
}

/** 是否已是 MiniMax-H3 中文六段式 */
export function isDirectorH3ZhSixSectionPrompt(text: string | undefined | null): boolean {
  const t = String(text || '');
  return (
    /主体定义\s*[：:]/.test(t) &&
    /详细描述\s*[：:]/.test(t) &&
    /整体声景\s*[：:]/.test(t)
  );
}

/** 去掉 H3 `<d>…</d>` 台词标签（非对口型镜或分镜图路径） */
export function stripDirectorH3DialogueTags(text: string | undefined | null): string {
  return String(text || '')
    .replace(/<d>\s*\[[^\]]*\][\s\S]*?<\/d>/gi, '')
    .replace(/<d>[\s\S]*?<\/d>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 从提示词中去掉对白/旁白段落（避免分镜图把歌词画进画面）；保留 H3 `<d>` 由调用方处理 */
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
  opts?: {
    instrumental?: boolean;
    mode?: 'image' | 'video';
    stylePresetId?: string | null;
    stylePictureLabel?: string | null;
  },
): string[] {
  const parts: string[] = [];
  const style = String(globalStyle || '').trim();
  if (style || opts?.stylePresetId || opts?.stylePictureLabel) {
    parts.push(`画风：${resolveStylePictureHint(opts)}`);
    parts.push(DIRECTOR_STYLE_ON_CAST_AND_SCENE_GUARD);
  }

  let desc = String(shot['画面描述'] || '').trim();
  if (opts?.instrumental) {
    desc = stripDirectorSingingPerformanceFromText(desc);
    desc = stripDirectorMouthOpenPerformanceFromText(desc);
  }
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

/**
 * 由镜头表字段拼出「最终提示词」草稿：MiniMax-H3 中文六段式 + MM:SS.mmm 时轴。
 * 默认按不对口型写（无 <d>、<音频1>）；对口型开关打开后由客户端再注入。
 */
export function composeDirectorShotFinalPrompt(
  shot: Partial<
    Pick<
      DirectorShot,
      | '画面描述'
      | '镜头角度'
      | '焦距'
      | '景别'
      | '光影氛围'
      | '对白旁白'
      | '运镜'
      | '最终提示词'
      | '音效'
      | '时长'
      | '出场人物'
      | '地点'
    >
  >,
  globalStyle?: string,
  opts?: DirectorStylePromptOpts,
): string {
  const dialogue = String(shot['对白旁白'] || '').trim();
  const instrumental = isInstrumentalDialogue(dialogue);
  const emptyShot = /空镜|无人物|无人出镜/.test(
    `${String(shot['画面描述'] || '')}\n${String(shot['最终提示词'] || '')}`,
  );
  const styleHint = resolveStylePictureHint(opts);
  const h3 = composeMinimaxH3ChineseOfficialRefPrompt({
    shot: shot as Partial<DirectorShot>,
    globalStyle: styleHint,
    stylePictureIndex: opts?.stylePictureIndex ?? 1,
    slots: [],
    lipsync: !!opts?.lipsync && !instrumental && !emptyShot,
    hasLipsyncAudio: !!opts?.lipsync && !instrumental && !emptyShot,
    shotChangePace: opts?.shotChangePace,
  });
  if (h3) {
    if (emptyShot) {
      return withEmptyShotFrontGuards(
        h3,
        instrumental ? DIRECTOR_INSTRUMENTAL_EMPTY_SHOT_GUARD : DIRECTOR_EMPTY_SHOT_NO_PEOPLE_GUARD,
      );
    }
    if (instrumental) {
      return appendPromptGuard(h3, DIRECTOR_INSTRUMENTAL_NO_SING_GUARD);
    }
    return h3;
  }

  const parts = composeDirectorShotVisualParts(shot, globalStyle, {
    instrumental,
    mode: 'video',
    stylePresetId: opts?.stylePresetId,
    stylePictureLabel: opts?.stylePictureLabel,
  });
  if (emptyShot) {
    return withEmptyShotFrontGuards(
      parts
        .join('。')
        .replace(/[。]{2,}/g, '。')
        .replace(/^[。]+|[。]+$/g, '')
        .trim(),
      instrumental ? DIRECTOR_INSTRUMENTAL_EMPTY_SHOT_GUARD : DIRECTOR_EMPTY_SHOT_NO_PEOPLE_GUARD,
    );
  } else if (instrumental) {
    parts.push(DIRECTOR_INSTRUMENTAL_NO_SING_GUARD);
    parts.push(DIRECTOR_NO_LIPSYNC_MOUTH_CLOSED_GUARD);
  } else {
    parts.push(DIRECTOR_MV_NO_ONSCREEN_TEXT_GUARD);
  }
  return parts
    .join('。')
    .replace(/[。]{2,}/g, '。')
    .replace(/^[。]+|[。]+$/g, '')
    .trim();
}

/**
 * 分镜图专用提示词：按公式拼装，不含对白/歌词，并强制无文字画面。
 * 公式：（镜头语言+光影）+主体(主体描述)+主体运动+场景(场景描述)+(氛围)
 * 括号内为可选项；有风格参考图时只对齐其光色（勿按风格名称），画风固定真人写实。
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
  opts?: {
    hasStyleReferenceImage?: boolean;
    closeUpFraming?: boolean;
    stylePresetId?: string | null;
    stylePictureLabel?: string | null;
    stylePictureIndex?: number | null;
  },
): string {
  const instrumental = isInstrumentalDialogue(String(shot['对白旁白'] || ''));
  const light = String(shot['光影氛围'] || '').trim();
  let desc = replaceDirectorStyleTextWithImageRef(String(shot['画面描述'] || '').trim());
  if (instrumental) {
    desc = stripDirectorSingingPerformanceFromText(desc);
    desc = stripDirectorMouthOpenPerformanceFromText(desc);
  }

  let fromFinal = stripDirectorH3DialogueTags(stripDirectorDialogueFromPrompt(shot['最终提示词']));
  if (instrumental) {
    fromFinal = stripDirectorSingingPerformanceFromText(fromFinal);
    fromFinal = stripDirectorMouthOpenPerformanceFromText(fromFinal);
  }
  fromFinal = stripDirectorImageMentionsLoose(fromFinal);
  fromFinal = replaceDirectorStyleTextWithImageRef(fromFinal, opts?.stylePictureIndex ?? 1);

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
        `场景(场景描述)：${subjectSceneBody}。纯空镜：按场景公式写年代/地点/物品陈设（名称+位置+状态）/材质/光线；严禁任何人、人脸、人形、雕像与疑似人形阴影；不要写手眼脸运镜表演。镜头语言须作用在透视、景深与构图上。`,
      );
    } else {
      parts.push(
        `主体(主体描述)+主体运动+场景(场景描述)：${subjectSceneBody}。写清主要表现对象（人/物）、外貌姿态、所处环境；有人镜主体运动须按本镜时长写成秒级时轴（每段：动作｜表情｜场景动态），禁止单句敷衍。镜头语言必须可见地作用在透视、景深与构图上。`,
      );
    }
  }

  const style = String(globalStyle || '').trim();
  const hasStyleRef = !!opts?.hasStyleReferenceImage;
  if (hasStyleRef || style || opts?.stylePresetId || opts?.stylePictureLabel) {
    parts.push(`氛围：${resolveStylePictureHint(opts)}。须同时作用在主体与场景，禁止只改背景。`);
    if (hasStyleRef) parts.push(DIRECTOR_STYLE_REF_IMAGE_LOCK_GUARD);
    if (directorStyleLooksMonochrome(style)) parts.push(DIRECTOR_MONOCHROME_STYLE_LOCK_GUARD);
    parts.push(DIRECTOR_STYLE_ON_CAST_AND_SCENE_GUARD);
  }

  if (!emptyShot && instrumental) {
    parts.push(DIRECTOR_INSTRUMENTAL_NO_SING_GUARD);
    parts.push(DIRECTOR_NO_LIPSYNC_MOUTH_CLOSED_GUARD);
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
      stylePresetId: opts?.stylePresetId,
      stylePictureLabel: opts?.stylePictureLabel,
    })
      .join('。')
      .replace(/[。]{2,}/g, '。')
      .replace(/^[。]+|[。]+$/g, '')
      .trim();
    body = fallback || body;
  }
  if (emptyShot && body) {
    body = withEmptyShotFrontGuards(body, DIRECTOR_EMPTY_SHOT_NO_PEOPLE_GUARD);
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
 * - 空/占位可重拼
 * - 旧版「画风：」短拼（无 H3 六段、无毫秒时轴）可升级，避免界面长期停留在散文格式
 * 不覆盖用户已改成六段式/毫秒时轴的内容。
 */
export function canRecomposeDirectorFinalPrompt(finalPrompt: string | undefined | null): boolean {
  if (shouldAutoSyncDirectorFinalPrompt(finalPrompt)) return true;
  const t = String(finalPrompt || '').trim();
  if (!t) return true;
  if (isDirectorH3ZhSixSectionPrompt(t) && /00:\d{2}\.\d{3}\s*至\s*00:\d{2}\.\d{3}/.test(t)) {
    return false;
  }
  // 旧自动拼接：以「画风：」开头且没有主体定义
  if (/^画风\s*[：:]/.test(t) && !/主体定义\s*[：:]/.test(t)) return true;
  return false;
}

export function withComposedDirectorFinalPrompts(
  shots: DirectorShot[],
  globalStyle?: string,
  /** true：强制覆盖已有最终提示词（生成镜头表后） */
  force = false,
  opts?: DirectorStylePromptOpts,
): DirectorShot[] {
  return (shots || []).map((shot) => {
    if (!force && !canRecomposeDirectorFinalPrompt(shot['最终提示词'])) return shot;
    const composed = composeDirectorShotFinalPrompt(shot, globalStyle, opts);
    if (!composed) return shot;
    if (composed === String(shot['最终提示词'] || '')) return shot;
    return { ...shot, 最终提示词: composed };
  });
}
