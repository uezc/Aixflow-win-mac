import type { CSSProperties } from 'react';

/** 麦克风输入电平（0–1）工具：Analyser 时域 / Float32 PCM */

export function rmsFromByteTimeDomain(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]! / 128 - 1;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

export function rmsFromFloat32(data: Float32Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

/** 攻击快、释放慢，并把 raw RMS 映射到可视 0–1 */
export function smoothMicLevel(prev: number, rawRms: number): number {
  const boosted = Math.min(1, rawRms * 4.2);
  const attack = 0.42;
  const release = 0.12;
  const next =
    boosted > prev ? prev + (boosted - prev) * attack : prev + (boosted - prev) * release;
  return Math.max(0, Math.min(1, next < 0.02 ? next * 0.6 : next));
}

export function micLevelCssVars(level: number): CSSProperties {
  const clamped = Math.max(0, Math.min(1, level));
  return {
    ['--mic-level' as string]: String(clamped),
  } as CSSProperties;
}
