import React from 'react';

const SunburstIcon: React.FC<{ className?: string }> = ({ className = 'h-6 w-6' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <circle cx="12" cy="12" r="2.5" fill="white" />
    {Array.from({ length: 12 }).map((_, i) => {
      const angle = (i * 30 * Math.PI) / 180;
      const x1 = 12 + Math.cos(angle) * 4;
      const y1 = 12 + Math.sin(angle) * 4;
      const x2 = 12 + Math.cos(angle) * 11;
      const y2 = 12 + Math.sin(angle) * 11;
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1.5" strokeLinecap="round" />;
    })}
  </svg>
);

export default SunburstIcon;
