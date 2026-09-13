/**
 * 与 src/main/utils/videoBillingSku.ts 规则一致（无 console）V2.3
 * 海螺按 6s/10s 单档计费（不区分分辨率）；Veo 3.1 为 veo-3-1-{分辨率}-{variant}
 */

import {
  normalizeGrok3DurationSec,
  normalizeRhartVideoXDurationSec,
  normalizeGrok3StableDurationSec,
  normalizeLtx23DurationSec,
  normalizeSeedanceDurationSec,
  normalizeGeminiOmniDurationSec,
  normalizeGeminiOmniFlashDurationSec,
  normalizeMinimaxH3DurationSec,
  normalizeMinimaxH3AudioDurationSec,
  normalizeMinimaxH3Resolution,
} from './cost_table.mjs';

function lc(s) {
  return String(s || '').trim().toLowerCase();
}

function joinKey(...parts) {
  const out = [];
  for (const p of parts) {
    if (p == null || p === false) continue;
    const t = lc(String(p));
    if (!t) continue;
    out.push(t);
  }
  return out.join('-');
}

const IMAGE_REVERSE_KEYS = {
  'gpt-4o': 'gpt-4o-image-reverse',
  'joy-caption-two': 'joy-caption-two-image-reverse',
  'openai/gpt-5.6-terra': 'openai/gpt-5.6-terra-image-reverse',
};

function klingO1CapabilitySuffix(model) {
  const m = lc(model);
  const p = 'kling-video-o1';
  if (!m.startsWith(p)) return '';
  if (m.length <= p.length) return '';
  return m.slice(p.length + 1);
}

function hailuoSeriesAndI2v(model) {
  const m = lc(model);
  if (!m.startsWith('hailuo-')) return null;
  if (m.startsWith('hailuo-02-')) return { series: '02', isI2v: m.includes('i2v') };
  if (m.startsWith('hailuo-2.3-')) return { series: '2-3', isI2v: m.includes('i2v') };
  return null;
}

function veoVariantFromRhart(model) {
  const m = lc(model);
  const prefix = 'rhart-v3.1-';
  if (!m.startsWith(prefix)) return null;
  return m.slice(prefix.length);
}

/**
 * @param {string} baseModel
 * @param {Record<string, unknown>} input
 */
export function buildVideoBillingSkuKey(baseModel, input) {
  const model = String(baseModel || '').trim();
  if (!model) return '';

  const m = lc(model);

  const rev = IMAGE_REVERSE_KEYS[m];
  if (rev) return rev;

  const hi = hailuoSeriesAndI2v(m);
  if (hi) {
    const durSec = input.durationHailuo02 === '10' ? 10 : 6;
    const durSeg = `${durSec}s`;
    // 海螺 02 / 2.3 均不区分分辨率计费：统一按时长档计费
    if (hi.isI2v) return joinKey('hailuo', hi.series, 'i2v', durSeg);
    return joinKey('hailuo', hi.series, durSeg);
  }

  if (m === 'wan-2.6') {
    const resRaw =
      input.resolutionWan26 != null && String(input.resolutionWan26).trim() !== ''
        ? lc(String(input.resolutionWan26))
        : '';
    const resSeg = resRaw === '720p' ? '720p' : undefined;
    let durNum;
    if (input.duration === '15') durNum = 15;
    else if (input.duration === '10') durNum = 10;
    else if (input.duration === '5') durNum = 5;
    const durSeg = durNum != null && durNum !== 10 ? `${durNum}s` : undefined;
    return joinKey('wan', '2-6', resSeg, durSeg);
  }

  if (m === 'wan-2.6-flash') {
    const resRaw =
      input.resolutionWan26 != null && String(input.resolutionWan26).trim() !== ''
        ? lc(String(input.resolutionWan26))
        : '';
    const resSeg = resRaw === '720p' ? '720p' : undefined;
    const n = parseInt(String(input.durationWan26Flash ?? ''), 10);
    const durNum = Number.isFinite(n) ? Math.max(2, Math.min(15, n)) : undefined;
    const durSeg = durNum != null && durNum !== 5 ? `${durNum}s` : undefined;
    const audioSeg = input.enableAudio === false ? 'noaudio' : undefined;
    return joinKey('wan', '2-6', 'flash', resSeg, durSeg, audioSeg);
  }

  if (m === 'wan-animate') {
    const resRaw = String(input.resolutionWanAnimate ?? '').trim().toLowerCase();
    const resSeg =
      resRaw === '1080p' || resRaw === '1080' || resRaw === '1920x1080' || resRaw === '1080x1920'
        ? '1080p'
        : '720p';
    const clipRaw = String(input.wanAnimateClipSec ?? '8').trim();
    const sec = clipRaw === '5' || clipRaw === '10' || clipRaw === '15' ? clipRaw : '8';
    return joinKey('wan', 'animate', resSeg, `${sec}s`);
  }

  // Wan animate2：按原视频秒数计费；SKU 仅分辨率，Quantity = mediaDurationSec（ceil）
  if (m === 'wan-animate-2') {
    const resRaw = String(input.resolutionWanAnimate ?? '').trim().toLowerCase();
    const resSeg =
      resRaw === '1080p' || resRaw === '1080' || resRaw === '1920x1080' || resRaw === '1080x1920'
        ? '1080p'
        : '720p';
    return joinKey('wan', 'animate', '2', resSeg);
  }

  if (m === 'hey-gem') {
    return joinKey('hey', 'gem', 'plus');
  }

  if (m === 'seedance-2.0-fast') {
    const resRaw = String(input.resolutionSeedance ?? '').trim().toLowerCase();
    const resSeg = resRaw === '1080p' ? '1080p' : '720p';
    const durNum = normalizeSeedanceDurationSec(input.durationSeedance, 10);
    return joinKey('seedance', '2-0-fast', resSeg, `${durNum}s`);
  }

  if (m === 'seedance-2.0-mini') {
    const resRaw = String(input.resolutionSeedance ?? '').trim().toLowerCase();
    let resSeg = '720p';
    if (resRaw === '4k' || resRaw === '2160p') resSeg = '4k';
    else if (resRaw === '2k' || resRaw === '1440p') resSeg = '2k';
    else if (resRaw === '1080p' || resRaw === '1080') resSeg = '1080p';
    else if (resRaw === '480p' || resRaw === '480') resSeg = '480p';
    const durNum = normalizeSeedanceDurationSec(input.durationSeedance, 10);
    return joinKey('seedance', '2-0-mini', resSeg, `${durNum}s`);
  }

  if (m === 'gemini-omni') {
    const resRaw = String(input.resolutionGeminiOmni ?? '').trim().toLowerCase();
    const resSeg = resRaw === '1080p' || resRaw === '4k' ? resRaw : '720p';
    const durNum = normalizeGeminiOmniDurationSec(input.durationGeminiOmni, 6);
    return joinKey('gemini', 'omni', resSeg, `${durNum}s`);
  }

  if (m === 'gemini-omni-flash') {
    const resRaw = String(input.resolutionGeminiOmni ?? '').trim().toLowerCase();
    const resSeg = resRaw === '1080p' || resRaw === '4k' ? resRaw : '720p';
    const durNum = normalizeGeminiOmniFlashDurationSec(input.durationGeminiOmni, 6);
    return joinKey('gemini', 'omni', 'flash', resSeg, `${durNum}s`);
  }

  if (m === 'kling-v2.6-pro') {
    let durNum;
    if (input.duration === '10') durNum = 10;
    else if (input.duration === '5') durNum = 5;
    const durSeg = durNum != null && durNum !== 10 ? `${durNum}s` : undefined;
    const audioSeg = input.sound === 'true' ? 'audio' : undefined;
    return joinKey('kling', 'v2-6', 'pro', durSeg, audioSeg);
  }

  if (m.startsWith('kling-video-o1')) {
    const cap = klingO1CapabilitySuffix(model);
    const modeSeg = input.modeKlingO1 === 'pro' ? 'pro' : '';
    let durNum;
    if (input.durationKlingO1 === '10') durNum = 10;
    else if (input.durationKlingO1 === '5') durNum = 5;
    const durSeg = durNum != null && durNum !== 5 ? `${durNum}s` : undefined;
    const variant = joinKey(cap, modeSeg);
    return joinKey('kling', 'o1', variant || undefined, durSeg);
  }

  if (m === 'grok-3-stable') {
    const durNum = normalizeGrok3StableDurationSec(input.durationGrok3, 10);
    return joinKey('grok-3-stable', '720p', `${durNum}s`);
  }

  if (m === 'rhart-video-x') {
    const durNum = normalizeRhartVideoXDurationSec(input.durationGrok3, 10);
    return joinKey('rhart-video-x', '720p', `${durNum}s`);
  }

  if (m === 'grok-3' || m === 'rhart-video-g') {
    const resSeg = '720p';
    let durNum;
    if (m === 'rhart-video-g') {
      const dg = String(input.durationRhartVideoG || '').toLowerCase();
      durNum = dg === '10s' || dg === '10' ? 10 : 6;
    } else {
      durNum = normalizeGrok3DurationSec(input.durationGrok3, 10);
    }
    return joinKey('grok-3', resSeg, `${durNum}s`);
  }

  const vv = veoVariantFromRhart(m);
  if (vv && m !== 'rhart-v3.1-pro-official-i2v') {
    const resRaw =
      input.resolutionRhartV31 != null && String(input.resolutionRhartV31).trim() !== ''
        ? lc(String(input.resolutionRhartV31))
        : '';
    const res =
      resRaw === '720p' || resRaw === '1080p' || resRaw === '4k' ? resRaw : '1080p';
    return joinKey('veo', '3-1', res, vv);
  }

  if (m === 'rhart-v3.1-pro-official-i2v') {
    const resRaw =
      input.resolutionRhartV31 != null && String(input.resolutionRhartV31).trim() !== ''
        ? lc(String(input.resolutionRhartV31))
        : '';
    const res =
      resRaw === '720p' || resRaw === '1080p' || resRaw === '4k' ? resRaw : '1080p';
    const d = String(input.durationVeo31ProOfficial || '');
    const durNum = d === '8' ? 8 : d === '6' ? 6 : d === '4' ? 4 : undefined;
    const durSeg = durNum != null && durNum !== 4 ? `${durNum}s` : undefined;
    const audioSeg = input.generateAudioVeo31ProOfficial === true ? 'audio' : undefined;
    return joinKey('veo', '3-1', res, 'official-i2v', durSeg, audioSeg);
  }

  if (m === 'ltx-2.3-lipsync') {
    const resRaw =
      input.resolutionLtx23Lipsync != null && String(input.resolutionLtx23Lipsync).trim() !== ''
        ? String(input.resolutionLtx23Lipsync).trim()
        : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    return joinKey('ltx', '2-3', 'lipsync', res);
  }

  if (m === 'ltx-2.3-i2v') {
    const resRaw =
      input.resolutionLtx23I2v != null && String(input.resolutionLtx23I2v).trim() !== ''
        ? String(input.resolutionLtx23I2v).trim()
        : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    const durNum = normalizeLtx23DurationSec(input.durationLtx23I2v, 10);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', 'i2v', res, dur);
  }

  if (m === 'ltx-2.3-t2v') {
    const resRaw =
      input.resolutionLtx23T2v != null && String(input.resolutionLtx23T2v).trim() !== ''
        ? String(input.resolutionLtx23T2v).trim()
        : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    const durNum = normalizeLtx23DurationSec(input.durationLtx23T2v, 10);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', res, dur);
  }

  if (m === 'minimax-h3-t2v') {
    const res = normalizeMinimaxH3Resolution(input.resolutionMinimaxH3); // 480P=0.4 / 720P=0.9
    const durSec = normalizeMinimaxH3DurationSec(input.durationMinimaxH3, 10);
    return joinKey('minimax', 'h3', 't2v', res, `${durSec}s`);
  }
  if (m === 'minimax-h3-i2v') {
    const res = normalizeMinimaxH3Resolution(input.resolutionMinimaxH3); // 480P=0.4 / 720P=0.9
    const durSec = normalizeMinimaxH3DurationSec(input.durationMinimaxH3, 10);
    return joinKey('minimax', 'h3', 'i2v', res, `${durSec}s`);
  }
  // 全能参考：480p|720p × 时长 6|10|15|20（OTS: minimax-h3-multi-{480p|720p}-{6|10|15|20}s）
  if (m === 'minimax-h3-multi') {
    const res = normalizeMinimaxH3Resolution(input.resolutionMinimaxH3);
    const durSec = normalizeMinimaxH3DurationSec(input.durationMinimaxH3, 10);
    return joinKey('minimax', 'h3', 'multi', res, `${durSec}s`);
  }
  // 口型同步：480p|720p × 时长 6|10|15|20（OTS: minimax-h3-audio-{480p|720p}-{6|10|15|20}s；已删 5s）
  if (m === 'minimax-h3-audio') {
    const res = normalizeMinimaxH3Resolution(input.resolutionMinimaxH3);
    const durSec = normalizeMinimaxH3AudioDurationSec(input.durationMinimaxH3, 20);
    return joinKey('minimax', 'h3', 'audio', res, `${durSec}s`);
  }

  if (m === 'ltx-2.3-hdr-multi') {
    const resRaw =
      input.resolutionLtx23HdrMulti != null && String(input.resolutionLtx23HdrMulti).trim() !== ''
        ? String(input.resolutionLtx23HdrMulti).trim()
        : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    const durNum = normalizeLtx23DurationSec(input.durationLtx23HdrMulti, 15);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', 'hdr-multi', res, dur);
  }

  if (m === 'ltx-2.3-msr-av') {
    const resRaw =
      input.resolutionLtx23HdrMulti != null && String(input.resolutionLtx23HdrMulti).trim() !== ''
        ? String(input.resolutionLtx23HdrMulti).trim()
        : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    const durNum = normalizeLtx23DurationSec(input.durationLtx23HdrMulti, 10);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', 'msr-av', res, dur);
  }

  if (m === 'rh-video-start-end') {
    const resRaw =
      input.resolutionRhartV31 != null && String(input.resolutionRhartV31).trim() !== ''
        ? lc(String(input.resolutionRhartV31))
        : '';
    const res =
      resRaw === '720' || resRaw === '720p'
        ? '720p'
        : resRaw === '1920' || resRaw === '1920p' || resRaw === '4k' || resRaw === '2160p'
          ? '1920p'
          : '1080p';
    const d = parseInt(String(input.duration ?? ''), 10);
    const durNum = Number.isFinite(d) && d > 0 ? Math.max(5, Math.min(15, d)) : 5;
    const dur = durNum >= 15 ? '15s' : durNum >= 10 ? '10s' : '5s';
    return joinKey('ltx', '2-3', 'start-end', res, dur);
  }

  // 视频超分放大：rhart-video-upscaler-{720p|1080p|2k|4k}
  if (m === 'rhart-video-upscaler') {
    const r = lc(String(input.targetResolution ?? '1080p'));
    const res = r === '720p' || r === '1080p' || r === '2k' || r === '4k' ? r : '1080p';
    return joinKey('rhart', 'video', 'upscaler', res);
  }

  return lc(model);
}
