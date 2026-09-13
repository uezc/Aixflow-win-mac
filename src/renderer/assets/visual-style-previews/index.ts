/**
 * 画风 / 色调选择卡预览图（打包后路径稳定）
 */
import lookLive from './look-live.png';
import lookCg from './look-cg.png';
import lookCartoon from './look-cartoon.png';
import lookAnime from './look-anime.png';
import lookInk from './look-ink.png';
import lookOil from './look-oil.png';
import lookClay from './look-clay.png';
import lookSketch from './look-sketch.png';
import lookPixel from './look-pixel.png';
import lookIllustration from './look-illustration.png';

import gradeDarkCyan from './grade-dark_cyan.png';
import gradeColdBlue from './grade-cold_blue.png';
import gradeWarmAmber from './grade-warm_amber.png';
import gradeMutedGray from './grade-muted_gray.png';
import gradeNoir from './grade-noir.png';
import gradeSoftPastel from './grade-soft_pastel.png';
import gradeGoldenHour from './grade-golden_hour.png';
import gradeNeonNight from './grade-neon_night.png';
import gradeEarthy from './grade-earthy.png';
import gradeCleanWhite from './grade-clean_white.png';

export const VISUAL_LOOK_COVERS: Record<string, string> = {
  live: lookLive,
  cg: lookCg,
  cartoon: lookCartoon,
  anime: lookAnime,
  ink: lookInk,
  oil: lookOil,
  clay: lookClay,
  sketch: lookSketch,
  pixel: lookPixel,
  illustration: lookIllustration,
};

export const VISUAL_GRADE_COVERS: Record<string, string> = {
  dark_cyan: gradeDarkCyan,
  cold_blue: gradeColdBlue,
  warm_amber: gradeWarmAmber,
  muted_gray: gradeMutedGray,
  noir: gradeNoir,
  soft_pastel: gradeSoftPastel,
  golden_hour: gradeGoldenHour,
  neon_night: gradeNeonNight,
  earthy: gradeEarthy,
  clean_white: gradeCleanWhite,
};
