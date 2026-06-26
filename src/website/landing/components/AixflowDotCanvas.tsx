import { useEffect, useRef } from 'react';

const BG = '#05070A';
const DOT_SPACING = 32;
const DOT_RADIUS = 1.25;
const BASE_ALPHA = 0.14;
const GLOW_RADIUS = 140;

type Particle = { x: number; y: number; vx: number; vy: number };

export function AixflowDotCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const smoothMouseRef = useRef({ x: -9999, y: -9999 });
  const particlesRef = useRef<Particle[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const linkDist = () => (sizeRef.current.w < 640 ? 88 : 118);
    const speed = () => (sizeRef.current.w < 640 ? 0.11 : 0.14);
    const count = () => (sizeRef.current.w < 640 ? 24 : 46);

    const spawnParticles = () => {
      const { w, h } = sizeRef.current;
      const n = count();
      const sp = speed();
      particlesRef.current = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * sp * 2,
        vy: (Math.random() - 0.5) * sp * 2,
      }));
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rw = window.innerWidth;
      const rh = window.innerHeight;
      canvas.width = Math.floor(rw * dpr);
      canvas.height = Math.floor(rh * dpr);
      canvas.style.width = `${rw}px`;
      canvas.style.height = `${rh}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w: rw, h: rh };
      spawnParticles();
    };

    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) mouseRef.current = { x: t.clientX, y: t.clientY };
    };
    const onLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('mouseleave', onLeave);
    resize();

    const wrap = (v: number, max: number) => {
      if (v < 0) return v + max;
      if (v >= max) return v - max;
      return v;
    };

    const distWrap = (ax: number, ay: number, bx: number, by: number, w: number, h: number) => {
      let dx = ax - bx;
      let dy = ay - by;
      if (dx > w * 0.5) dx -= w;
      else if (dx < -w * 0.5) dx += w;
      if (dy > h * 0.5) dy -= h;
      else if (dy < -h * 0.5) dy += h;
      return Math.hypot(dx, dy);
    };

    let raf = 0;
    const step = () => {
      const { w, h } = sizeRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      smoothMouseRef.current.x += (mx - smoothMouseRef.current.x) * 0.12;
      smoothMouseRef.current.y += (my - smoothMouseRef.current.y) * 0.12;
      const smx = smoothMouseRef.current.x;
      const smy = smoothMouseRef.current.y;

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      // 鼠标周围紫青柔光
      if (smx > -1000) {
        const glow = ctx.createRadialGradient(smx, smy, 0, smx, smy, GLOW_RADIUS * 1.4);
        glow.addColorStop(0, 'rgba(139, 92, 246, 0.12)');
        glow.addColorStop(0.45, 'rgba(6, 182, 212, 0.06)');
        glow.addColorStop(1, 'rgba(5, 7, 10, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
      }

      // 波点网格 + 鼠标 proximity 高亮
      for (let x = 0; x <= w + DOT_SPACING; x += DOT_SPACING) {
        for (let y = 0; y <= h + DOT_SPACING; y += DOT_SPACING) {
          const d = Math.hypot(x - smx, y - smy);
          let alpha = BASE_ALPHA;
          let r = DOT_RADIUS;

          if (d < GLOW_RADIUS) {
            const t = 1 - d / GLOW_RADIUS;
            const eased = t * t;
            alpha = BASE_ALPHA + eased * 0.72;
            r = DOT_RADIUS + eased * 1.1;
            const violet = Math.round(226 + eased * 29);
            const cyan = Math.round(232 + eased * 23);
            ctx.fillStyle = `rgba(${violet}, ${cyan}, 255, ${alpha.toFixed(3)})`;
          } else {
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
          }

          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 流动粒子与连线（原 AIXflow 官网）
      const ld = linkDist();
      const sp = speed();
      const particles = particlesRef.current;

      for (const p of particles) {
        p.x = wrap(p.x + p.vx, w);
        p.y = wrap(p.y + p.vy, h);
        p.vx += (Math.random() - 0.5) * 0.012;
        p.vy += (Math.random() - 0.5) * 0.012;
        const m = sp * 1.8;
        p.vx = Math.max(-m, Math.min(m, p.vx));
        p.vy = Math.max(-m, Math.min(m, p.vy));
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const d = distWrap(a.x, a.y, b.x, b.y, w, h);
          if (d < ld && d > 1) {
            const t = 1 - d / ld;
            ctx.strokeStyle = `rgba(167, 180, 198, ${(t * 0.1).toFixed(3)})`;
            ctx.lineWidth = 0.55;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        const d = Math.hypot(p.x - smx, p.y - smy);
        const boost = d < GLOW_RADIUS ? (1 - d / GLOW_RADIUS) * 0.35 : 0;
        ctx.fillStyle = `rgba(226, 232, 240, ${(0.22 + boost).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.85 + boost * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}
