import React from 'react';

export type CollageAspectGroup = {
  id: string;
  label: string;
  rw: number;
  rh: number;
  resolutions: [number, number][];
};

export const COLLAGE_ASPECT_GROUPS: CollageAspectGroup[] = [
  { id: '1-1', label: '1:1', rw: 1, rh: 1, resolutions: [[512, 512], [640, 640], [768, 768], [800, 800], [1024, 1024], [1080, 1080], [1200, 1200], [1440, 1440], [2048, 2048]] },
  { id: '16-9', label: '16:9', rw: 16, rh: 9, resolutions: [[960, 540], [1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160]] },
  { id: '9-16', label: '9:16', rw: 9, rh: 16, resolutions: [[720, 1280], [1080, 1920], [1440, 2560], [2160, 3840]] },
  { id: '4-3', label: '4:3', rw: 4, rh: 3, resolutions: [[800, 600], [1024, 768], [1280, 960], [1600, 1200], [1920, 1440]] },
  { id: '3-4', label: '3:4', rw: 3, rh: 4, resolutions: [[600, 800], [768, 1024], [960, 1280], [1200, 1600], [1536, 2048]] },
  { id: '3-2', label: '3:2', rw: 3, rh: 2, resolutions: [[768, 512], [1200, 800], [1536, 1024], [1920, 1280], [3000, 2000]] },
  { id: '2-3', label: '2:3', rw: 2, rh: 3, resolutions: [[512, 768], [800, 1200], [1024, 1536], [1080, 1620], [1200, 1800]] },
  { id: '4-5', label: '4:5', rw: 4, rh: 5, resolutions: [[800, 1000], [1080, 1350], [1200, 1500]] },
  { id: '5-4', label: '5:4', rw: 5, rh: 4, resolutions: [[1000, 800], [1350, 1080], [1500, 1200]] },
  { id: '16-10', label: '16:10', rw: 16, rh: 10, resolutions: [[1280, 800], [1440, 900], [1920, 1200], [2560, 1600]] },
  { id: '21-9', label: '21:9', rw: 21, rh: 9, resolutions: [[2520, 1080], [2560, 1080], [3440, 1440], [3840, 1600]] },
  { id: 'og', label: '≈1.91:1', rw: 191, rh: 100, resolutions: [[1200, 630], [1524, 800], [1910, 1000]] },
];

function aspectRatioValue(rw: number, rh: number): number {
  return rw / Math.max(rh, 1);
}

export function findCollageAspectGroupId(cw: number, ch: number): string {
  const r = cw / Math.max(ch, 1);
  let bestId = COLLAGE_ASPECT_GROUPS[0].id;
  let bestDiff = Infinity;
  for (const g of COLLAGE_ASPECT_GROUPS) {
    const tr = aspectRatioValue(g.rw, g.rh);
    const d = Math.abs(r - tr);
    if (d < bestDiff) {
      bestDiff = d;
      bestId = g.id;
    }
  }
  return bestDiff <= 0.035 ? bestId : '__custom__';
}

export function resolveCollage1080pDefaultSize(g: CollageAspectGroup): [number, number] {
  const with1080 = g.resolutions.filter(([w, h]) => w === 1080 || h === 1080);
  if (with1080.length > 0) {
    if (g.rw === g.rh) {
      const square = with1080.find(([w, h]) => w === 1080 && h === 1080);
      if (square) return square;
    }
    if (g.rw > g.rh) {
      const landscape = with1080.find(([w, h]) => h === 1080 && w >= h);
      if (landscape) return landscape;
    }
    if (g.rh > g.rw) {
      const portrait = with1080.find(([w, h]) => w === 1080 && h > w);
      if (portrait) return portrait;
    }
    const ultrawide = with1080.find(([w, h]) => h === 1080);
    if (ultrawide) return ultrawide;
    return with1080[0];
  }

  let best = g.resolutions[0];
  let bestDiff = Infinity;
  for (const res of g.resolutions) {
    const shortSide = Math.min(res[0], res[1]);
    const diff = Math.abs(shortSide - 1080);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = res;
    }
  }
  return best;
}

export function resolveCollageSizeForAspectPick(
  g: CollageAspectGroup,
  _cw?: number,
  _ch?: number,
): [number, number] {
  return resolveCollage1080pDefaultSize(g);
}

export function RatioGlyph({ w, h }: { w: number; h: number }) {
  const vbW = 30;
  const vbH = 18;
  const pad = 2;
  const aw = vbW - pad * 2;
  const ah = vbH - pad * 2;
  const scale = Math.min(aw / w, ah / h);
  const rw = w * scale;
  const rh = h * scale;
  const x = pad + (aw - rw) / 2;
  const y = pad + (ah - rh) / 2;
  return (
    <svg width={vbW} height={vbH} className="shrink-0 text-violet-300" aria-hidden>
      <rect x="0.5" y="0.5" width={vbW - 1} height={vbH - 1} rx="4" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.14)" />
      <rect x={x} y={y} width={rw} height={rh} rx="2" fill="currentColor" opacity={0.88} />
    </svg>
  );
}
