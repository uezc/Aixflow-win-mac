import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFeatureVideos } from '../data/content';
import { landingVideoCardClass, landingVideoInnerClass } from './landingVideoCard';

export function FeatureVideoPlayer() {
  const videos = useMemo(() => getFeatureVideos(), []);
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = videos[index] ?? videos[0];

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
    if (videos.length <= 1) {
      playCurrent();
      return;
    }
    setIndex((i) => (i + 1) % videos.length);
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
