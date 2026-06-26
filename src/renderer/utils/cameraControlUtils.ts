/**
 * 3D 视角控制器共享逻辑：摄影语义映射、默认值、预设
 */

import type { CameraControlValue } from '../components/Canvas/CubeCameraController';

export interface CameraPromptMetadata {
  view_tags: string;
  shot_type: string;
  formatted_output: string;
  qwen_instruction: string;
}

export interface CameraParams {
  rot_h: number;
  rot_v: number;
  dist: number;
  fov: number;
}

export interface QwenCameraAPI {
  rotate_degrees: number;
  move_forward: number;
  vertical_tilt: number;
  use_wide_angle: boolean;
}

export interface CameraOutputPayload {
  camera_params: CameraParams;
  qwen_api: QwenCameraAPI;
  prompt_metadata: CameraPromptMetadata;
}

export const DEFAULT_CAMERA_VALUE: CameraControlValue = {
  rotationX: 15,
  rotationY: 35,
  scale: 3.4,
  fov: 45,
};

export const MIN_SCALE = 1.2;
export const MAX_SCALE = 6.5;
export const SCALE_CLOSEUP = 1.5;
export const SCALE_MEDIUM = 3.5;
export const SCALE_WIDE = 5.5;

/** 景别预设 */
export const CAMERA_PRESETS: Array<{ label: string; value: Partial<CameraControlValue> }> = [
  { label: '正面', value: { rotationY: 0, rotationX: 0 } },
  { label: '右45°', value: { rotationY: 45, rotationX: 0 } },
  { label: '左45°', value: { rotationY: -45, rotationX: 0 } },
  { label: '背面', value: { rotationY: 180, rotationX: 0 } },
  { label: '仰拍', value: { rotationX: -30 } },
  { label: '俯拍', value: { rotationX: 30 } },
  { label: '特写', value: { scale: SCALE_CLOSEUP } },
  { label: '中景', value: { scale: SCALE_MEDIUM } },
  { label: '全景', value: { scale: SCALE_WIDE } },
];

export function getPhotographyPrompt(value: CameraControlValue): {
  payload: CameraOutputPayload;
  statusText: string;
  isKeyPose: boolean;
} {
  const rotH = Math.round(value.rotationY * 10) / 10;
  const rotV = Math.round(value.rotationX * 10) / 10;
  const dist = Math.round(value.scale * 100) / 100;
  const fov = Math.round(value.fov);
  const absYaw = Math.abs(rotH);

  const moveForward = Number(((MAX_SCALE - value.scale) / (MAX_SCALE - MIN_SCALE) * 5).toFixed(2));
  const verticalTilt = Number((rotV / 45).toFixed(2));
  const qwenApi: QwenCameraAPI = {
    rotate_degrees: rotH,
    move_forward: Math.max(0, Math.min(5, moveForward)),
    vertical_tilt: Math.max(-1, Math.min(1, verticalTilt)),
    use_wide_angle: false,
  };

  // 水平方位：与方框朝向匹配（正面、右前、左前、右侧、左侧、右后、左后、背面）
  let viewTag = 'front view';
  let viewLabel = '正面';
  if (absYaw <= 10) {
    viewTag = 'front view';
    viewLabel = '正面';
  } else if (absYaw >= 170) {
    viewTag = 'back view';
    viewLabel = '背面';
  } else if (rotH > 120 && rotH < 170) {
    viewTag = 'right-back view';
    viewLabel = '右后方';
  } else if (rotH < -120 && rotH > -170) {
    viewTag = 'left-back view';
    viewLabel = '左后方';
  } else if (rotH > 60 && rotH <= 120) {
    viewTag = 'right side view';
    viewLabel = '右方';
  } else if (rotH < -60 && rotH >= -120) {
    viewTag = 'left side view';
    viewLabel = '左方';
  } else if (rotH > 10 && rotH <= 60) {
    viewTag = 'right-front three-quarter view';
    viewLabel = '右前方';
  } else {
    viewTag = 'left-front three-quarter view';
    viewLabel = '左前方';
  }

  // 垂直高度：平视、俯拍、仰拍、斜上、斜下
  let pitchTag = 'eye-level shot';
  let pitchLabel = '平视';
  if (rotV > 15) {
    pitchTag = 'high angle shot';
    pitchLabel = '俯拍';
  } else if (rotV < -15) {
    pitchTag = 'low angle shot';
    pitchLabel = '仰拍';
  } else if (rotV > 5) {
    pitchTag = 'slightly high angle';
    pitchLabel = '斜上';
  } else if (rotV < -5) {
    pitchTag = 'slightly low angle';
    pitchLabel = '斜下';
  }

  let shotType = 'medium shot';
  let shotLabel = '中景';
  if (dist <= 2.5) {
    shotType = 'close-up shot';
    shotLabel = '特写';
  } else if (dist > 4.5) {
    shotType = 'wide shot';
    shotLabel = '全景';
  }

  const viewTags = `${viewTag}, ${pitchTag}`;
  const parts: string[] = [];
  if (absYaw >= 170) {
    parts.push("Turn the camera to the back view.");
  } else if (rotH > 120 && rotH < 170) {
    parts.push("Turn the camera to the right-back view.");
  } else if (rotH < -120 && rotH > -170) {
    parts.push("Turn the camera to the left-back view.");
  } else if (rotH > 60 && rotH <= 120) {
    parts.push("Turn the camera to the right side.");
  } else if (rotH < -60 && rotH >= -120) {
    parts.push("Turn the camera to the left side.");
  } else if (rotH > 10 && rotH <= 60) {
    parts.push(`Rotate the camera ${Math.round(rotH)} degrees to the right (right-front).`);
  } else if (rotH < -10 && rotH >= -60) {
    parts.push(`Rotate the camera ${Math.round(Math.abs(rotH))} degrees to the left (left-front).`);
  }
  if (rotV > 15) {
    parts.push("Turn the camera to a high-angle top-down view.");
  } else if (rotV < -15) {
    parts.push("Turn the camera to a low-angle view.");
  } else if (rotV > 5) {
    parts.push("Slightly tilt the camera upward.");
  } else if (rotV < -5) {
    parts.push("Slightly tilt the camera downward.");
  } else if (Math.abs(rotH) < 10 && Math.abs(rotV) <= 5) {
    parts.push("Front view, eye-level shot.");
  }
  if (dist <= 2.5) {
    parts.push("Turn the camera to a close-up.");
  } else if (dist > 4.5) {
    parts.push("Turn the camera to a wide shot.");
  }
  if (moveForward > 3.5) {
    parts.push("Move the camera forward.");
  } else if (moveForward < 1.5 && dist > 3) {
    parts.push("Move the camera backward.");
  }
  const qwenInstruction = parts.length > 0 ? parts.join(' ') : "Front view, eye-level, medium shot.";

  const formattedOutput = `${viewTags}, ${shotType}`;
  const cameraParams: CameraParams = { rot_h: rotH, rot_v: rotV, dist, fov };
  const promptMetadata: CameraPromptMetadata = {
    view_tags: viewTags,
    shot_type: shotType,
    formatted_output: formattedOutput,
    qwen_instruction: qwenInstruction,
  };

  const isKeyPose = absYaw <= 3 || Math.abs(absYaw - 45) <= 3 || Math.abs(absYaw - 90) <= 3 || Math.abs(absYaw - 135) <= 3 || absYaw >= 177 || Math.abs(rotV) <= 3;
  const statusText = `${viewLabel} · ${pitchLabel} · ${shotLabel}`;

  return {
    payload: {
      camera_params: cameraParams,
      qwen_api: qwenApi,
      prompt_metadata: promptMetadata,
    },
    statusText,
    isKeyPose,
  };
}
