import { useCallback, useEffect, useRef, useState } from 'react';
import { FEATURE_VIDEOS } from '../data/content';
import { landingVideoCardClass, landingVideoInnerClass } from './landingVideoCard';

export function FeatureVideoPlayer() {
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = FEATURE_VIDEOS[index] ?? FEATURE_VIDEOS[0];

  const playCurrent = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.load();
    playCurrent();
  }, [src, playCurrent]);

  const onEnded = () => {
    if (FEATURE_VIDEOS.length <= 1) {
      playCurrent();
      return;
    }
    setIndex((i) => (i + 1) % FEATURE_VIDEOS.length);
  };

  return (
    <div className={landingVideoCardClass}>
      <video
        ref={videoRef}
        key={src}
        src={src}
        className={landingVideoInnerClass}
        muted
        playsInline
        autoPlay
        preload="metadata"
        onEnded={onEnded}
      />
    </div>
  );
}
