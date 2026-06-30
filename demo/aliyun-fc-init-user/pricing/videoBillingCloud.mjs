/**
 * 与 src/renderer/utils/cloudModelPricing.getVideoQuantityForCloudKey
 * 及 src/renderer/utils/videoBillingSku（buildVideoBillingModelIdCore / getVideoBillingQuantity）一致，
 * 供 FC nx_model_config 视频扣费 quantity 与客户端预估对齐。
 */

import {
  normalizeGrok3DurationSec,
  normalizeGrok3StableDurationSec,
  normalizeLtx23DurationSec,
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

export function buildVideoBillingModelIdCore(baseModel, input) {
  const model = String(baseModel || '').trim();
  if (!model) return '';

  const m = lc(model);
  const inp = input && typeof input === 'object' ? input : {};

  const rev = IMAGE_REVERSE_KEYS[m];
  if (rev) return rev;

  const hi = hailuoSeriesAndI2v(m);
  if (hi) {
    const resRaw =
      inp.resolutionHailuo != null && String(inp.resolutionHailuo).trim() !== ''
        ? lc(String(inp.resolutionHailuo))
        : '';
    const res = resRaw === '720p' || resRaw === '1080p' || resRaw === '4k' ? resRaw : '';
    const durSec = inp.durationHailuo02 === '10' ? 10 : 6;
    const durSeg = `${durSec}s`;
    if (hi.isI2v) {
      return joinKey('hailuo', hi.series, 'i2v', res, durSeg);
    }
    return joinKey('hailuo', hi.series, res, durSeg);
  }

  if (m === 'wan-2.6') {
    const resRaw =
      inp.resolutionWan26 != null && String(inp.resolutionWan26).trim() !== '' ? lc(String(inp.resolutionWan26)) : '';
    const resSeg = resRaw === '720p' ? '720p' : undefined;
    let durNum;
    if (inp.duration === '15') durNum = 15;
    else if (inp.duration === '10') durNum = 10;
    else if (inp.duration === '5') durNum = 5;
    const durSeg = durNum != null && durNum !== 10 ? `${durNum}s` : undefined;
    return joinKey('wan', '2-6', resSeg, durSeg);
  }

  if (m === 'wan-2.6-flash') {
    const resRaw =
      inp.resolutionWan26 != null && String(inp.resolutionWan26).trim() !== '' ? lc(String(inp.resolutionWan26)) : '';
    const resSeg = resRaw === '720p' ? '720p' : undefined;
    const n = parseInt(String(inp.durationWan26Flash ?? ''), 10);
    const durNum = Number.isFinite(n) ? Math.max(2, Math.min(15, n)) : undefined;
    const durSeg = durNum != null && durNum !== 5 ? `${durNum}s` : undefined;
    const audioSeg = inp.enableAudio === false ? 'noaudio' : undefined;
    return joinKey('wan', '2-6', 'flash', resSeg, durSeg, audioSeg);
  }

  if (m === 'wan-animate') {
    const resRaw = String(inp.resolutionWanAnimate ?? '').trim().toLowerCase();
    const resSeg =
      resRaw === '1080p' || resRaw === '1080' || resRaw === '1920x1080' || resRaw === '1080x1920'
        ? '1080p'
        : '720p';
    const clipRaw = String(inp.wanAnimateClipSec ?? '8').trim();
    const sec = clipRaw === '5' || clipRaw === '10' || clipRaw === '15' ? clipRaw : '8';
    return joinKey('wan', 'animate', resSeg, `${sec}s`);
  }

  if (m === 'hey-gem') {
    return joinKey('hey', 'gem', 'plus');
  }

  if (m === 'kling-v2.6-pro') {
    let durNum;
    if (inp.duration === '10') durNum = 10;
    else if (inp.duration === '5') durNum = 5;
    const durSeg = durNum != null && durNum !== 10 ? `${durNum}s` : undefined;
    const audioSeg = inp.sound === 'true' ? 'audio' : undefined;
    return joinKey('kling', 'v2-6', 'pro', durSeg, audioSeg);
  }

  if (m.startsWith('kling-video-o1')) {
    const cap = klingO1CapabilitySuffix(model);
    const modeSeg = inp.modeKlingO1 === 'pro' ? 'pro' : '';
    let durNum;
    if (inp.durationKlingO1 === '10') durNum = 10;
    else if (inp.durationKlingO1 === '5') durNum = 5;
    const durSeg = durNum != null && durNum !== 5 ? `${durNum}s` : undefined;
    const variant = joinKey(cap, modeSeg);
    return joinKey('kling', 'o1', variant || undefined, durSeg);
  }

  if (m === 'grok-3-stable') {
    const durNum = normalizeGrok3StableDurationSec(inp.durationGrok3, 10);
    return joinKey('grok-3-stable', '720p', `${durNum}s`);
  }

  if (m === 'grok-3' || m === 'rhart-video-g') {
    const resSeg = '720p';
    let durNum;
    if (m === 'rhart-video-g') {
      const dg = String(inp.durationRhartVideoG || '').toLowerCase();
      durNum = dg === '10s' || dg === '10' ? 10 : 6;
    } else {
      durNum = normalizeGrok3DurationSec(inp.durationGrok3, 10);
    }
    return joinKey('grok-3', resSeg, `${durNum}s`);
  }

  const vv = veoVariantFromRhart(m);
  if (vv && m !== 'rhart-v3.1-pro-official-i2v') {
    const resRaw =
      inp.resolutionRhartV31 != null && String(inp.resolutionRhartV31).trim() !== ''
        ? lc(String(inp.resolutionRhartV31))
        : '';
    const res = resRaw === '720p' || resRaw === '1080p' || resRaw === '4k' ? resRaw : '1080p';
    return joinKey('veo', '3-1', res, vv);
  }

  if (m === 'rhart-v3.1-pro-official-i2v') {
    const resRaw =
      inp.resolutionRhartV31 != null && String(inp.resolutionRhartV31).trim() !== ''
        ? lc(String(inp.resolutionRhartV31))
        : '';
    const res = resRaw === '720p' || resRaw === '1080p' || resRaw === '4k' ? resRaw : '1080p';
    const d = String(inp.durationVeo31ProOfficial || '');
    const durNum = d === '8' ? 8 : d === '6' ? 6 : d === '4' ? 4 : undefined;
    const durSeg = durNum != null && durNum !== 4 ? `${durNum}s` : undefined;
    const audioSeg = inp.generateAudioVeo31ProOfficial === true ? 'audio' : undefined;
    return joinKey('veo', '3-1', res, 'official-i2v', durSeg, audioSeg);
  }

  if (m === 'ltx-2.3-lipsync') {
    const resRaw =
      inp.resolutionLtx23Lipsync != null && String(inp.resolutionLtx23Lipsync).trim() !== ''
        ? String(inp.resolutionLtx23Lipsync).trim()
        : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    return joinKey('ltx', '2-3', 'lipsync', res);
  }

  if (m === 'ltx-2.3-i2v') {
    const resRaw =
      inp.resolutionLtx23I2v != null && String(inp.resolutionLtx23I2v).trim() !== ''
        ? String(inp.resolutionLtx23I2v).trim()
        : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    const durNum = normalizeLtx23DurationSec(inp.durationLtx23I2v, 10);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', 'i2v', res, dur);
  }

  if (m === 'ltx-2.3-t2v') {
    const resRaw =
      inp.resolutionLtx23T2v != null && String(inp.resolutionLtx23T2v).trim() !== ''
        ? String(inp.resolutionLtx23T2v).trim()
        : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    const durNum = normalizeLtx23DurationSec(inp.durationLtx23T2v, 10);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', res, dur);
  }

  if (m === 'ltx-2.3-hdr-multi') {
    const resRaw =
      inp.resolutionLtx23HdrMulti != null && String(inp.resolutionLtx23HdrMulti).trim() !== ''
        ? String(inp.resolutionLtx23HdrMulti).trim()
        : '';
    const res = ['720', '1280', '1920'].includes(resRaw) ? lc(resRaw) : '';
    const durNum = normalizeLtx23DurationSec(inp.durationLtx23HdrMulti, 15);
    const dur = `${durNum}s`;
    return joinKey('ltx', '2-3', 'hdr-multi', res, dur);
  }

  if (m === 'rh-video-start-end') {
    const resRaw =
      inp.resolutionRhartV31 != null && String(inp.resolutionRhartV31).trim() !== ''
        ? lc(String(inp.resolutionRhartV31))
        : '';
    const res = resRaw === '720p' || resRaw === '1080p' || resRaw === '4k' ? resRaw : '1080p';
    const d = parseInt(String(inp.duration ?? ''), 10);
    const durNum = Number.isFinite(d) && d > 0 ? Math.max(5, Math.min(15, d)) : 5;
    const dur = durNum >= 15 ? '15s' : durNum >= 10 ? '10s' : '5s';
    return joinKey('ltx', '2-3', 'start-end', res, dur);
  }

  return lc(model);
}

/**
 * 与 getVideoDisplayPrice 中 getVideoBillingQuantity 一致：从复合 SKU 中取最后一段 `-{N}s` 作为「UI 秒数」基准。
 */
export function getVideoBillingQuantity(baseModel, input) {
  const sku = buildVideoBillingModelIdCore(baseModel, input);
  const matches = [...sku.matchAll(/-(\d+)s(?=-|$)/gi)];
  if (matches.length === 0) return 1;
  const last = matches[matches.length - 1];
  const sec = parseInt(last[1], 10);
  if (Number.isFinite(sec) && sec > 0) return sec;
  return 1;
}

/**
 * 与 src/renderer/utils/cloudModelPricing.getVideoQuantityForCloudKey 一致。
 */
export function getVideoQuantityForCloudKey(cloudKey, uiSeconds) {
  const m = String(cloudKey || '').match(/-(\d+)s(?:-(?:audio|noaudio))?$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return 1;
  }
  return Math.max(1, uiSeconds);
}

/** 无 body.model 时，仅从计费 id 字符串推断 UI 秒数（与 getVideoBillingQuantity 在仅有 SKU 时的语义一致） */
export function inferUiSecondsFromBillingSkuOnly(sku) {
  const matches = [...String(sku || '').matchAll(/-(\d+)s(?=-|$)/gi)];
  if (matches.length === 0) return 1;
  const last = matches[matches.length - 1];
  const sec = parseInt(last[1], 10);
  if (Number.isFinite(sec) && sec > 0) return sec;
  return 1;
}
