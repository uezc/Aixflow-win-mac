// @ts-nocheck
import React, { useEffect, useRef } from 'react';

/** Vite public 目录；打包后随 dist 根路径发布 */
export const LOGIN_SILK_VIDEO_SRC = './auth/login-silk.webm';

const LoginSilkVideoBackground: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {
      /* autoplay blocked until user interaction */
    });
  }, []);

  return (
    <video
      ref={videoRef}
      className="nexflow-login-silk-video pointer-events-none absolute"
      src={LOGIN_SILK_VIDEO_SRC}
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      draggable={false}
      aria-hidden
    />
  );
};

export default LoginSilkVideoBackground;
