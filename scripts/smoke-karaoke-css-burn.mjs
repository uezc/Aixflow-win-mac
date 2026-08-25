/**
 * 方案 A 烟雾检查（不启 Electron）：确认主进程产物与 overlay 入口文件存在，
 * 且 css burn 走 rawvideo（非 PNG image2pipe）；编辑器固定 Plan A（无 ASS 勾选）；
 * 默认流畅 ≥48fps / 可跟片源；失败不得引导勾 ASS。
 * 用法：先 npm run build:main，再 node scripts/smoke-karaoke-css-burn.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [
  'dist-electron/main/services/karaokeCssBurn.js',
  'dist-electron/preload/karaokeBurnOverlayPreload.js',
  'dist-electron/preload/index.js',
  'karaoke-burn-overlay.html',
  'src/renderer/karaokeBurnOverlay/KaraokeBurnOverlayApp.tsx',
  'src/shared/karaoke/previewLogic.ts',
];

let ok = true;
for (const rel of checks) {
  const p = path.join(root, rel);
  const exists = fs.existsSync(p);
  console.log(exists ? '[ok]' : '[MISSING]', rel);
  if (!exists) ok = false;
}

const overlayPreloadJs = path.join(
  root,
  'dist-electron/preload/karaokeBurnOverlayPreload.js',
);
if (fs.existsSync(overlayPreloadJs)) {
  console.log('[ok] dist-electron/preload/karaokeBurnOverlayPreload.js exists');
} else {
  console.error('[FAIL] missing dist-electron/preload/karaokeBurnOverlayPreload.js');
  ok = false;
}

const cssBurnJs = path.join(root, 'dist-electron/main/services/karaokeCssBurn.js');
if (fs.existsSync(cssBurnJs)) {
  const src = fs.readFileSync(cssBurnJs, 'utf8');
  if (/__dirname,\s*['"]\.\.\/\.\.\/preload/.test(src) || /['"]\.\.\/\.\.\/preload\//.test(src)) {
    console.log('[ok] karaokeCssBurn resolves preload via ../../preload (from services/)');
  } else if (/__dirname,\s*['"]\.\.\/preload['"]/.test(src) && !/\.\.\/\.\.\/preload/.test(src)) {
    console.error(
      '[FAIL] karaokeCssBurn still uses ../preload from services/ → main/preload (wrong)',
    );
    ok = false;
  } else {
    console.error('[FAIL] karaokeCssBurn preload path should include ../../preload');
    ok = false;
  }
  const hasRaw = src.includes('rawvideo') && src.includes('toBitmap');
  const stillPngPipe =
    /image2pipe/.test(src) && /['"]png['"]/.test(src) && /vcodec/.test(src);
  const hasEngineTag = /engine:\s*['"]css['"]/.test(src) || /engine:\s*"css"/.test(src);
  if (hasRaw && !stillPngPipe) {
    console.log('[ok] karaokeCssBurn uses rawvideo + toBitmap');
  } else {
    console.error('[FAIL] karaokeCssBurn should use rawvideo/toBitmap, not PNG image2pipe');
    ok = false;
  }
  if (hasEngineTag) {
    console.log('[ok] karaokeCssBurn returns engine=css');
  } else {
    console.error('[FAIL] karaokeCssBurn should return engine: "css"');
    ok = false;
  }
  if (/isKaraokeCssBurnDev|NODE_ENV === 'development'/.test(src)) {
    console.log('[ok] karaokeCssBurn isDev aligned with main window');
  } else {
    console.error('[FAIL] karaokeCssBurn isDev should match main (development || !packaged)');
    ok = false;
  }
  if (/preferSmooth/.test(src) && /karaokeOverlayNeedsUniqueFrame/.test(src)) {
    console.log('[ok] karaokeCssBurn has preferSmooth + static-frame reuse');
  } else {
    console.error('[FAIL] karaokeCssBurn should preferSmooth and skip static unique frames');
    ok = false;
  }
  if (/needUnique|writeRawRepeat/.test(src)) {
    console.log('[ok] karaokeCssBurn batches static frames / precomputes unique');
  } else {
    console.error('[FAIL] karaokeCssBurn should precompute needUnique + batch static writes');
    ok = false;
  }
  if (/\[1:v\]fps=/.test(src)) {
    console.error('[FAIL] overlay must not re-apply fps= (causes stutter); use setpts only');
    ok = false;
  } else if (/setpts=N\/\$\{fps\}\/TB|setpts=N\//.test(src) || /setpts=PTS-STARTPTS/.test(src)) {
    console.log('[ok] overlay uses setpts without secondary fps= on overlay');
  } else {
    console.error('[FAIL] overlay filter should use setpts');
    ok = false;
  }
  if (/\[0:v\]fps=/.test(src) || /fps=\$\{fps\}/.test(src)) {
    console.log('[ok] base video resampled to burn CFR (fps=)');
  } else {
    console.error('[FAIL] base video should use fps= to match overlay CFR');
    ok = false;
  }
  if (
    /karaokeCssBurnFrameTimeSec/.test(src) ||
    /Math\.round\(\(i \* 1000\) \/ f\)/.test(src)
  ) {
    console.log('[ok] frame timeline uses fixed ms step (karaokeCssBurnFrameTimeSec)');
  } else {
    console.error('[FAIL] missing fixed-step frame time helper');
    ok = false;
  }
  if (/resolveKaraokeCssBurnFps/.test(src) || /normalizeKaraokeSourceFps/.test(src)) {
    console.log('[ok] fps resolver follows source / smooth floor');
  } else {
    console.error('[FAIL] missing resolveKaraokeCssBurnFps / source fps probe');
    ok = false;
  }
  if (/KARAOKE_CSS_BURN_MAX_EDGE\s*=\s*1920/.test(src) || /MAX_EDGE = 1920/.test(src)) {
    console.log('[ok] capture max edge capped at 1920');
  } else {
    console.error('[FAIL] KARAOKE_CSS_BURN_MAX_EDGE should be 1920');
    ok = false;
  }
  if (/cssBurnTiming/.test(src) && /resolveKaraokeCssBurnFps/.test(src)) {
    console.log('[ok] karaokeCssBurn uses shared cssBurnTiming fps helpers');
  } else {
    console.error('[FAIL] karaokeCssBurn should import cssBurnTiming helpers');
    ok = false;
  }
}

const timingSrc = path.join(root, 'src/shared/karaoke/cssBurnTiming.ts');
if (fs.existsSync(timingSrc)) {
  const src = fs.readFileSync(timingSrc, 'utf8');
  if (/KARAOKE_CSS_BURN_SMOOTH_FPS = 48/.test(src) && /KARAOKE_CSS_BURN_MAX_FPS = 60/.test(src)) {
    console.log('[ok] cssBurnTiming SMOOTH=48 MAX=60 (source)');
  } else {
    console.error('[FAIL] cssBurnTiming should set SMOOTH=48 MAX=60');
    ok = false;
  }
  if (/KARAOKE_CSS_BURN_LOW_SPEC_FPS = 24/.test(src)) {
    console.log('[ok] cssBurnTiming LOW_SPEC=24 (office cap)');
  } else {
    console.error('[FAIL] cssBurnTiming LOW_SPEC should be 24');
    ok = false;
  }
  if (
    /KARAOKE_CSS_BURN_FAST_FPS = 16/.test(src) &&
    /KARAOKE_CSS_BURN_STANDARD_FPS = 24/.test(src) &&
    /KARAOKE_CSS_BURN_FLUID_FPS = 30/.test(src) &&
    /karaokeCssBurnOptionsFromQualityPreset/.test(src)
  ) {
    console.log('[ok] cssBurnTiming quality presets fast=16 standard=24 fluid=30');
  } else {
    console.error('[FAIL] cssBurnTiming missing quality preset helpers (16/24/30)');
    ok = false;
  }
  if (/opts\?\.lowSpec/.test(src) && /Math\.min\(cap/.test(src)) {
    console.log('[ok] lowSpec fps caps (does not chase source 50/60)');
  } else {
    console.error('[FAIL] lowSpec path must cap fps instead of Math.max with source');
    ok = false;
  }
} else {
  console.error('[FAIL] missing src/shared/karaoke/cssBurnTiming.ts');
  ok = false;
}

const preloadJs = path.join(root, 'dist-electron/preload/index.js');
if (fs.existsSync(preloadJs)) {
  const src = fs.readFileSync(preloadJs, 'utf8');
  if (src.includes('karaokeCssBurn') && src.includes('karaoke-css-burn')) {
    console.log('[ok] preload exposes karaokeCssBurn IPC');
  } else {
    console.error('[FAIL] preload missing karaokeCssBurn');
    ok = false;
  }
}

const mainJs = path.join(root, 'dist-electron/main/index.js');
if (fs.existsSync(mainJs)) {
  const src = fs.readFileSync(mainJs, 'utf8');
  if (src.includes('karaoke-css-burn') && src.includes('burnKaraokeWithCssPreview')) {
    console.log('[ok] main registers karaoke-css-burn handler');
  } else {
    console.error('[FAIL] main missing karaoke-css-burn handler');
    ok = false;
  }
  if (/preferSmooth:\s*opts\?\.preferSmooth/.test(src) && !/preferSmooth:\s*opts\?\.preferSmooth\s*!==\s*false/.test(src)) {
    console.log('[ok] main IPC passes preferSmooth through (auto when undefined)');
  } else {
    console.error('[FAIL] main karaoke-css-burn must pass preferSmooth through (not force true)');
    ok = false;
  }
}

const editor = path.join(root, 'src/renderer/components/Canvas/KaraokeSubtitleEditor.tsx');
if (fs.existsSync(editor)) {
  const src = fs.readFileSync(editor, 'utf8');
  if (/burnEngineAssFast/.test(src) || /setBurnEngine/.test(src) || /burnEngine === 'ass'/.test(src)) {
    console.error('[FAIL] editor still exposes ASS burn checkbox / burnEngine state');
    ok = false;
  } else {
    console.log('[ok] editor removed ASS burn checkbox / burnEngine toggle');
  }
  if (/setBurnPreferSmooth/.test(src) || /burnPreferSmooth\s*[:=]/.test(src)) {
    console.error('[FAIL] editor still exposes 流畅优先 checkbox');
    ok = false;
  } else {
    console.log('[ok] editor removed 流畅优先 checkbox');
  }
  if (
    /qualityPreset/.test(src) &&
    /burnQualityStart/.test(src) &&
    /composeModalPhase/.test(src) &&
    /handleConfirmComposeQuality/.test(src) &&
    !/preferSmooth:\s*true/.test(src)
  ) {
    console.log('[ok] editor Plan A compose offers FPS quality presets before burn');
  } else {
    console.error('[FAIL] editor must offer qualityPreset pick modal (no forced preferSmooth:true)');
    ok = false;
  }
  if (/burnEngineApiMissing/.test(src) && !/css burn API missing, fallback ASS/.test(src)) {
    console.log('[ok] no silent ASS fallback when Plan A API missing');
  } else {
    console.error('[FAIL] editor must hard-error when karaokeCssBurn missing (no silent ASS)');
    ok = false;
  }
  if (/NO ASS fallback|未回退 ASS|方案 A 失败/.test(src) && !/fallbackAssReason/.test(src)) {
    console.log('[ok] Plan A failure does not auto-fallback ASS');
  } else {
    console.error('[FAIL] remove Plan A → ASS auto-fallback (fallbackAssReason)');
    ok = false;
  }
  if (/可勾选「ASS|勾选「ASS 快速/.test(src)) {
    console.error('[FAIL] editor error copy still prompts checking ASS');
    ok = false;
  } else {
    console.log('[ok] editor errors do not prompt ASS checkbox');
  }
  if (
    /karaokeSungWipeMaskStyles/.test(src) &&
    !/clipPath:\s*karaokeSungWipeClipPathCss/.test(src) &&
    !/calc\(\$\{fillPct\}% \+/.test(src)
  ) {
    console.log('[ok] editor uses overflow wipe mask (karaokeSungWipeMaskStyles)');
  } else {
    console.error(
      '[FAIL] editor must use karaokeSungWipeMaskStyles (overflow:hidden), not clip-path wipe',
    );
    ok = false;
  }
}

const overlay = path.join(root, 'src/renderer/karaokeBurnOverlay/KaraokeBurnOverlayApp.tsx');
if (fs.existsSync(overlay)) {
  const src = fs.readFileSync(overlay, 'utf8');
  if (
    /karaokeSungWipeMaskStyles/.test(src) &&
    !/clipPath:\s*karaokeSungWipeClipPathCss/.test(src) &&
    !/calc\(\$\{fillPct\}% \+/.test(src)
  ) {
    console.log('[ok] overlay uses overflow wipe mask (karaokeSungWipeMaskStyles)');
  } else {
    console.error('[FAIL] overlay must use karaokeSungWipeMaskStyles (overflow:hidden)');
    ok = false;
  }
  if (/双 rAF/.test(src) && /单 rAF/.test(src)) {
    console.log('[ok] overlay documents single rAF (no double rAF)');
  } else {
    console.error('[FAIL] overlay should use single rAF waitPaint');
    ok = false;
  }
}

const previewLogic = path.join(root, 'src/shared/karaoke/previewLogic.ts');
if (fs.existsSync(previewLogic)) {
  const src = fs.readFileSync(previewLogic, 'utf8');
  if (
    /export function karaokeSungWipeMaskStyles/.test(src) &&
    /overflow:\s*'hidden'/.test(src) &&
    /右缘严格/.test(src)
  ) {
    console.log('[ok] karaokeSungWipeMaskStyles: overflow:hidden single-seam wipe');
  } else {
    console.error('[FAIL] missing karaokeSungWipeMaskStyles overflow:hidden helper');
    ok = false;
  }
  if (/export function karaokeSungWipeClipPathCss/.test(src)) {
    console.log('[ok] karaokeSungWipeClipPathCss kept for compat');
  }
}

const buildAss = path.join(root, 'src/shared/karaoke/buildAss.ts');
if (fs.existsSync(buildAss)) {
  const src = fs.readFileSync(buildAss, 'utf8');
  if (/正歌不写描边半扫/.test(src) && /karaokeCssBurn/.test(src)) {
    console.log('[ok] buildAss: Plan A compose path; no lyric outline \\clip on Plan C');
  } else {
    console.error('[FAIL] buildAss header should prefer Plan A and forbid lyric \\clip');
    ok = false;
  }
}

const i18n = path.join(root, 'src/renderer/i18n/karaokeI18n.ts');
if (fs.existsSync(i18n)) {
  const src = fs.readFileSync(i18n, 'utf8');
  if (/默认方案 C/.test(src) && !/方案 A/.test(src)) {
    console.error('[FAIL] styleHint/hints still claim 默认方案 C — should be Plan A');
    ok = false;
  } else if (/固定方案 A|方案 A（预览级/.test(src) || /Fixed Plan A|Plan A/.test(src)) {
    console.log('[ok] i18n defaults to Plan A (preview)');
  } else {
    console.error('[FAIL] i18n should say Plan A / 固定方案 A');
    ok = false;
  }
  if (/可勾选「ASS 快速烧录」|Optionally check ASS fast burn|Check = Plan C ASS/.test(src)) {
    console.error('[FAIL] i18n still advertises ASS fast-burn checkbox');
    ok = false;
  } else {
    console.log('[ok] i18n no longer advertises ASS fast-burn checkbox');
  }
  if (/≥48fps|48fps/.test(src)) {
    console.log('[ok] i18n mentions ≥48fps smooth tier');
  } else {
    console.error('[FAIL] i18n should mention ≥48fps');
    ok = false;
  }
}

const composeCapture = path.join(
  root,
  'src/renderer/utils/karaokePreviewComposeCapture.ts',
);
if (fs.existsSync(composeCapture)) {
  const src = fs.readFileSync(composeCapture, 'utf8');
  if (
    /KARAOKE_PREVIEW_COMPOSE_SMOOTH_FPS = 48/.test(src) ||
    /KARAOKE_PREVIEW_COMPOSE_SMOOTH_FPS = KARAOKE_CSS_BURN_SMOOTH_FPS/.test(src)
  ) {
    console.log('[ok] renderer compose smooth FPS is 48 (or shared alias)');
  } else {
    console.error('[FAIL] KARAOKE_PREVIEW_COMPOSE_SMOOTH_FPS should be 48');
    ok = false;
  }
  if (
    /KARAOKE_PREVIEW_COMPOSE_MAX_FPS = 60/.test(src) ||
    /KARAOKE_PREVIEW_COMPOSE_MAX_FPS = KARAOKE_CSS_BURN_MAX_FPS/.test(src)
  ) {
    console.log('[ok] renderer compose max FPS is 60 (or shared alias)');
  } else {
    console.error('[FAIL] KARAOKE_PREVIEW_COMPOSE_MAX_FPS should be 60');
    ok = false;
  }
  if (
    /qualityPreset/.test(src) &&
    /loadKaraokeComposeQualityPreset/.test(src) &&
    /karaokeCssBurnOptionsFromQualityPreset/.test(src)
  ) {
    console.log('[ok] renderer compose supports qualityPreset + localStorage');
  } else {
    console.error('[FAIL] karaokePreviewComposeCapture missing qualityPreset wiring');
    ok = false;
  }
}

const distOverlay = path.join(root, 'dist/karaoke-burn-overlay.html');
if (fs.existsSync(distOverlay)) {
  console.log('[ok] dist/karaoke-burn-overlay.html (renderer built)');
} else {
  console.log(
    '[info] dist/karaoke-burn-overlay.html 尚未生成 — 请 npm run build:renderer（开发模式走 Vite URL）',
  );
}

// 半扫 mask 几何：右缘必须落在 fill%（左扩 pad 不改变竖缝）
const previewLogicJs = path.join(root, 'dist-electron/shared/karaoke/previewLogic.js');
if (fs.existsSync(previewLogicJs)) {
  try {
    const mod = await import(pathToFileURL(previewLogicJs).href);
    const m = mod.karaokeSungWipeMaskStyles(0.5, 8);
    if (
      m?.mask?.overflow === 'hidden' &&
      String(m.mask.width).includes('50%') &&
      String(m.mask.width).includes('8px') &&
      m.mask.left === -8 &&
      m.inner?.left === 8
    ) {
      console.log('[ok] karaokeSungWipeMaskStyles(0.5,8) geometry');
    } else {
      console.error('[FAIL] karaokeSungWipeMaskStyles geometry unexpected', m);
      ok = false;
    }
  } catch (e) {
    console.error('[FAIL] import previewLogic for mask check', e);
    ok = false;
  }
} else {
  console.log('[info] dist-electron previewLogic 尚未生成 — build:main 后复检 mask');
}

// 烧录 FPS / 时间轴 helper 单元检查（shared，不依赖 Electron）
const timingJs = path.join(root, 'dist-electron/shared/karaoke/cssBurnTiming.js');
if (fs.existsSync(timingJs)) {
  try {
    const mod = await import(pathToFileURL(timingJs).href);
    if (mod.KARAOKE_CSS_BURN_SMOOTH_FPS !== 48 || mod.KARAOKE_CSS_BURN_MAX_FPS !== 60) {
      console.error('[FAIL] cssBurnTiming constants', {
        smooth: mod.KARAOKE_CSS_BURN_SMOOTH_FPS,
        max: mod.KARAOKE_CSS_BURN_MAX_FPS,
      });
      ok = false;
    } else {
      console.log('[ok] cssBurnTiming SMOOTH=48 MAX=60');
    }
    if (typeof mod.karaokeCssBurnOptionsFromQualityPreset === 'function') {
      const fast = mod.karaokeCssBurnOptionsFromQualityPreset('fast', { lowSpecMachine: true });
      const std = mod.karaokeCssBurnOptionsFromQualityPreset('standard', { lowSpecMachine: false });
      const fluid = mod.karaokeCssBurnOptionsFromQualityPreset('smooth');
      const hq = mod.karaokeCssBurnOptionsFromQualityPreset('hq');
      if (
        fast?.fps === 16 &&
        fast?.lowSpec === true &&
        std?.fps === 24 &&
        fluid?.fps === 30 &&
        fluid?.lowSpec === false &&
        hq?.preferSmooth === true &&
        hq?.fps == null
      ) {
        console.log('[ok] karaokeCssBurnOptionsFromQualityPreset 16/24/30/hq');
      } else {
        console.error('[FAIL] quality preset options unexpected', { fast, std, fluid, hq });
        ok = false;
      }
    } else {
      console.error('[FAIL] karaokeCssBurnOptionsFromQualityPreset missing from dist');
      ok = false;
    }
    const n24 = mod.normalizeKaraokeSourceFps(23.976);
    const n30 = mod.normalizeKaraokeSourceFps(29.97);
    const n60 = mod.normalizeKaraokeSourceFps(60);
    if (n24 === 24 && n30 === 30 && n60 === 60) {
      console.log('[ok] normalizeKaraokeSourceFps 23.976→24, 29.97→30, 60→60');
    } else {
      console.error('[FAIL] normalizeKaraokeSourceFps unexpected', { n24, n30, n60 });
      ok = false;
    }
    const a = mod.resolveKaraokeCssBurnFps({ preferSmooth: true, sourceFps: 30 });
    const b = mod.resolveKaraokeCssBurnFps({ preferSmooth: true, sourceFps: 60 });
    const c = mod.resolveKaraokeCssBurnFps({ preferSmooth: true, sourceFps: 24 });
    if (a === 48 && b === 60 && c === 48) {
      console.log('[ok] resolveKaraokeCssBurnFps: 30→48, 60→60, 24→48');
    } else {
      console.error('[FAIL] resolveKaraokeCssBurnFps unexpected', { a, b, c });
      ok = false;
    }
    const low60 = mod.resolveKaraokeCssBurnFps({ preferSmooth: false, lowSpec: true, sourceFps: 60 });
    const low24 = mod.resolveKaraokeCssBurnFps({ preferSmooth: false, lowSpec: true, sourceFps: 24 });
    if (mod.KARAOKE_CSS_BURN_LOW_SPEC_FPS === 24 && low60 === 24 && low24 === 24) {
      console.log('[ok] resolveKaraokeCssBurnFps lowSpec caps 60→24 (office)');
    } else {
      console.error('[FAIL] lowSpec must cap at 24', { low60, low24, const: mod.KARAOKE_CSS_BURN_LOW_SPEC_FPS });
      ok = false;
    }
    const t0 = mod.karaokeCssBurnFrameTimeSec(0, 48);
    const t1 = mod.karaokeCssBurnFrameTimeSec(1, 48);
    const t48 = mod.karaokeCssBurnFrameTimeSec(48, 48);
    if (t0 === 0 && Math.abs(t1 - 0.021) < 1e-9 && t48 === 1) {
      console.log('[ok] karaokeCssBurnFrameTimeSec fixed ms steps @48fps');
    } else {
      console.error('[FAIL] karaokeCssBurnFrameTimeSec unexpected', { t0, t1, t48 });
      ok = false;
    }
  } catch (e) {
    console.error('[FAIL] import cssBurnTiming helpers', e);
    ok = false;
  }
} else {
  console.log('[info] dist-electron cssBurnTiming 尚未生成 — build:main 后复检');
}

process.exit(ok ? 0 : 1);
