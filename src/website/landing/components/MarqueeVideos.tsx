import { getMarqueeVideos } from '../data/content';
import { landingVideoCardClass, landingVideoInnerClass } from './landingVideoCard';

export function MarqueeVideos() {
  const list = getMarqueeVideos();
  const videos = [...list, ...list];

  return (
    <section className="mb-16 mt-16 w-full overflow-hidden md:mb-16 md:mt-20">
      <div className="flex w-max animate-marquee">
        {videos.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className={`mx-3 shrink-0 ${landingVideoCardClass}`}
          >
            <video
              src={src}
              className={landingVideoInnerClass}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
