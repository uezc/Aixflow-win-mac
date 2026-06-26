import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { UserRound, RotateCcw, ImageDown, Trash2, BookmarkPlus } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { panoramaPlacementT } from '../../i18n/panoramaPlacementI18n';
import { spatialComposition3DT } from '../../i18n/spatialComposition3DI18n';
import type { TransformControls as StdlibTransformControls } from 'three-stdlib';
import type { SceneObjectKind } from './SpatialComposition3DPanel';
import { PanelOptionDropdown } from './PanelOptionDropdown';
import { PhotoCollageRotationKnob } from './PhotoCollageRotationKnob';

const EQ_RADIUS = 12;
const PLACE_RADIUS = 5.35;
const DEFAULT_FOV = 70;
const MIN_FOV = 26;
const MAX_FOV = 120;
const CAPTURE_OUT_MAX = 2048;
/** 相机相对观察目标的前后距离（与 OrbitControls 缩放一致）：近 ↔ 远 */
const MIN_VIEW_DISTANCE = 0.04;
const MAX_VIEW_DISTANCE = 2.4;
const DEFAULT_VIEW_DISTANCE = 0.18;
/** 预览区滚轮：每档调节 FOV 10% */
const PANO_WHEEL_FOV_STEP = 0.1;

function clampHumanoidScale(s: number) {
  return Math.max(0.2, Math.min(4, s));
}

function clampViewDistance(d: number) {
  return Math.min(MAX_VIEW_DISTANCE, Math.max(MIN_VIEW_DISTANCE, d));
}

function clampPanoFov(fov: number) {
  return Math.min(MAX_FOV, Math.max(MIN_FOV, fov));
}

/** 将单轴欧拉弧度映射为 [0,360)° 浮点，供旋钮与实时预览 */
function eulerRadToDeg0to360Float(rad: number): number {
  let deg = (rad * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

function eulerRadToDeg360Rounded(rad: number): number {
  return Math.round(eulerRadToDeg0to360Float(rad));
}

function clampDeg0to360(deg: number): number {
  let v = deg % 360;
  if (v < 0) v += 360;
  return v;
}

function panoStudioSectionTitle(dark: boolean) {
  return dark
    ? 'text-[10px] font-semibold uppercase tracking-wider text-white/70'
    : 'text-[10px] font-semibold uppercase tracking-wider text-gray-600';
}

function panoStudioGhostBtn(dark: boolean, extra = '') {
  return dark
    ? `rounded-lg border border-white/15 bg-white/[0.06] text-white/85 hover:bg-white/10 transition-colors ${extra}`
    : `rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 transition-colors ${extra}`;
}

function panoStudioVioletActive(dark: boolean) {
  return dark
    ? 'border-violet-500/60 bg-violet-500/15 text-violet-100 ring-1 ring-violet-400/30'
    : 'border-violet-500/50 bg-violet-100 text-violet-900 ring-1 ring-violet-400/40';
}

type MixerVerticalScaleProps = {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  label: string;
  dark: boolean;
};

/** 调音台风格竖向推子：粗轨道 + 大滑块，置于旋转区左侧（-90° 后上=max、下=min） */
function MixerVerticalScale({ value, onChange, disabled, label, dark }: MixerVerticalScaleProps) {
  const trackWebkit = dark
    ? '[&::-webkit-slider-runnable-track]:bg-white/[0.14]'
    : '[&::-webkit-slider-runnable-track]:bg-black/[0.12]';
  const trackMoz = dark ? '[&::-moz-range-track]:bg-white/[0.14]' : '[&::-moz-range-track]:bg-black/[0.12]';
  const thumbFill = dark ? '[&::-webkit-slider-thumb]:bg-zinc-800' : '[&::-webkit-slider-thumb]:bg-white';
  const thumbFillMoz = dark ? '[&::-moz-range-thumb]:bg-zinc-800' : '[&::-moz-range-thumb]:bg-white';
  return (
    <div
      className={`flex min-h-[120px] w-[42px] shrink-0 flex-col items-center gap-0.5 ${
        disabled ? 'cursor-not-allowed opacity-40' : ''
      }`}
      title={label}
    >
      <span className={`px-0.5 text-center text-[8px] font-medium leading-tight ${dark ? 'text-white/55' : 'text-gray-500'}`}>
        {label}
      </span>
      <div className="relative flex min-h-[96px] flex-1 w-full items-center justify-center">
        <input
          type="range"
          min={0.2}
          max={4}
          step={0.02}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          className={`absolute w-[96px] max-w-none cursor-pointer appearance-none bg-transparent accent-violet-500 outline-none ${
            disabled ? 'pointer-events-none' : ''
          } ${trackWebkit} ${trackMoz}
            [&::-webkit-slider-runnable-track]:h-[12px] [&::-webkit-slider-runnable-track]:rounded-full
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-violet-400 [&::-webkit-slider-thumb]:shadow-md
            ${thumbFill}
            [&::-webkit-slider-thumb]:mt-[-5px]
            [&::-moz-range-track]:h-[12px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:border-0
            [&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-violet-400 [&::-moz-range-thumb]:shadow-md ${thumbFillMoz}`}
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: 'center center',
          }}
        />
      </div>
      <span className={`text-[10px] font-semibold tabular-nums ${dark ? 'text-violet-200/95' : 'text-violet-700'}`}>
        {disabled ? '—' : `${value.toFixed(1)}×`}
      </span>
    </div>
  );
}

/** 默认与彩虹绿档一致，便于与 item.color 同步 */
export const HUMANOID_DEFAULT_COLOR = '#22c55e';

/** 7 色彩虹：红、橙、黄、绿、青、蓝、紫 */
export const HUMANOID_RAINBOW = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'] as const;

/** 写入 `PanoPlacedItem.color`：纯白实体（无染色磨砂） */
export const HUMANOID_SURFACE_WHITE = 'nexflow:humanoid:white';
/** 写入 `PanoPlacedItem.color`：高透玻璃（与彩虹染色磨砂区分） */
export const HUMANOID_SURFACE_GLASS = 'nexflow:humanoid:glass';

export function humanoidSurfaceKind(c: string): 'white' | 'glass' | 'tinted' {
  if (c === HUMANOID_SURFACE_WHITE) return 'white';
  if (c === HUMANOID_SURFACE_GLASS) return 'glass';
  return 'tinted';
}

function hexToRgba(hex: string, alpha: number): string {
  let h = (hex || '').trim();
  if (!h.startsWith('#')) return `rgba(148, 163, 184, ${alpha})`;
  h = h.slice(1);
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]+$/.test(h)) return `rgba(148, 163, 184, ${alpha})`;
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 已放置列表：人物行背景跟随模特表面色；其它物体保持原逻辑 */
function placedListRowChrome(
  item: PanoPlacedItem,
  isSelected: boolean,
  dark: boolean,
  textCls: string,
  mutedCls: string
): {
  containerClass: string;
  containerStyle: React.CSSProperties | undefined;
  titleClass: string;
  subClass: string;
} {
  if (item.kind !== 'humanoid') {
    if (isSelected) {
      return {
        containerClass: dark
          ? 'bg-violet-500/15 text-white/95 ring-1 ring-inset ring-violet-400/25'
          : 'bg-violet-100 text-violet-950 ring-1 ring-inset ring-violet-300/50',
        containerStyle: undefined,
        titleClass: dark ? 'text-white/95' : 'text-violet-950',
        subClass: dark ? 'text-white/60' : 'text-violet-900/80',
      };
    }
    return {
      containerClass: dark ? 'bg-white/[0.04] hover:bg-white/8' : 'bg-gray-50 hover:bg-gray-100',
      containerStyle: undefined,
      titleClass: textCls,
      subClass: mutedCls,
    };
  }

  const sk = item.color;
  const k = humanoidSurfaceKind(sk);
  let baseHex = '#64748b';
  if (k === 'tinted' && sk.startsWith('#')) baseHex = sk;
  else if (k === 'white') baseHex = '#e4e4e7';
  else if (k === 'glass') baseHex = '#38bdf8';

  const aSel = k === 'glass' ? 0.22 : k === 'white' ? 0.2 : 0.26;
  const aUn = k === 'glass' ? 0.1 : k === 'white' ? 0.1 : 0.12;
  const aSelLight = k === 'white' ? 0.42 : k === 'glass' ? 0.28 : 0.32;
  const aUnLight = k === 'white' ? 0.2 : k === 'glass' ? 0.14 : 0.16;

  if (isSelected) {
    const bg = dark ? hexToRgba(baseHex, aSel) : hexToRgba(baseHex, aSelLight);
    return {
      containerClass: `ring-1 ring-inset transition-[filter] hover:brightness-110 ${dark ? 'ring-white/25' : 'ring-black/12'}`,
      containerStyle: { backgroundColor: bg },
      titleClass: dark ? 'text-white/95' : 'text-gray-900',
      subClass: dark ? 'text-white/65' : 'text-gray-700',
    };
  }

  const bg = dark ? hexToRgba(baseHex, aUn) : hexToRgba(baseHex, aUnLight);
  return {
    containerClass: 'transition-[filter] hover:brightness-110',
    containerStyle: { backgroundColor: bg },
    titleClass: textCls,
    subClass: mutedCls,
  };
}

export interface PanoPlacedItem {
  id: string;
  kind: SceneObjectKind;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  color: string;
  /** 方块人体型：标准 / 瘦（仅 kind === 'humanoid' 时有效） */
  humanoidBuild?: PanoHumanoidBuild;
  /** 人台 OpenPose 式关节角度（度），缺省为直立 */
  pose?: PanoHumanoidPose;
}

export type PanoHumanoidBuild = 'standard' | 'thin';

export type PanoHumanoidPose = {
  waistX?: number;
  waistY?: number;
  waistZ?: number;
  neckX?: number;
  neckY?: number;
  neckZ?: number;
  lArmX?: number;
  lArmY?: number;
  lArmZ?: number;
  rArmX?: number;
  rArmY?: number;
  rArmZ?: number;
  lElbowX?: number;
  lElbowY?: number;
  lElbowZ?: number;
  rElbowX?: number;
  rElbowY?: number;
  rElbowZ?: number;
  lLegX?: number;
  lLegY?: number;
  lLegZ?: number;
  rLegX?: number;
  rLegY?: number;
  rLegZ?: number;
  lKneeX?: number;
  lKneeY?: number;
  lKneeZ?: number;
  rKneeX?: number;
  rKneeY?: number;
  rKneeZ?: number;
};

export const DEFAULT_PANO_HUMANOID_POSE: Required<PanoHumanoidPose> = {
  waistX: 0,
  waistY: 0,
  waistZ: 0,
  neckX: 0,
  neckY: 0,
  neckZ: 0,
  lArmX: 0,
  lArmY: 0,
  lArmZ: 0,
  rArmX: 0,
  rArmY: 0,
  rArmZ: 0,
  lElbowX: 0,
  lElbowY: 0,
  lElbowZ: 0,
  rElbowX: 0,
  rElbowY: 0,
  rElbowZ: 0,
  lLegX: 0,
  lLegY: 0,
  lLegZ: 0,
  rLegX: 0,
  rLegY: 0,
  rLegZ: 0,
  lKneeX: 0,
  lKneeY: 0,
  lKneeZ: 0,
  rKneeX: 0,
  rKneeY: 0,
  rKneeZ: 0,
};

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const OPENPOSE_PRESETS_STORAGE_KEY = 'nexflow-pano-openpose-presets-v1';

/** 侧栏保存的 OpenPose + 体型（localStorage） */
export type PanoOpenPosePresetStored = {
  id: string;
  name: string;
  pose: Required<PanoHumanoidPose>;
  build: PanoHumanoidBuild;
  /** 保存时小人表面色，用于左侧缩略图与「应用」时恢复 */
  figureColor?: string;
};

function normalizeStoredOpenPose(raw: unknown): Required<PanoHumanoidPose> {
  const base = { ...DEFAULT_PANO_HUMANOID_POSE };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(base) as (keyof PanoHumanoidPose)[]) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) (base as any)[k] = v;
    }
  }
  return base;
}

function readOpenPosePresetsFromStorage(): PanoOpenPosePresetStored[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(OPENPOSE_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: PanoOpenPosePresetStored[] = [];
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      if (typeof r.id !== 'string' || typeof r.name !== 'string') continue;
      const build: PanoHumanoidBuild = r.build === 'thin' ? 'thin' : 'standard';
      const figureColor =
        typeof r.figureColor === 'string' && r.figureColor.trim().length > 0 ? r.figureColor.trim() : undefined;
      out.push({ id: r.id, name: r.name, pose: normalizeStoredOpenPose(r.pose), build, figureColor });
    }
    return out;
  } catch {
    return [];
  }
}

function writeOpenPosePresetsToStorage(list: PanoOpenPosePresetStored[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(OPENPOSE_PRESETS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}

type OpenPoseDragHandle =
  | 'waist'
  | 'neck'
  | 'lElbow'
  | 'lWrist'
  | 'rElbow'
  | 'rWrist'
  | 'lThigh'
  | 'rThigh'
  | 'lKnee'
  | 'lAnkle'
  | 'rKnee'
  | 'rAnkle';

const OPENPOSE_THUMB_NOOP_FIELD = (_k: keyof PanoHumanoidPose, _v: number) => {};
const OPENPOSE_THUMB_NOOP_SELECT = (_j: OpenPoseDragHandle | null) => {};
const OPENPOSE_THUMB_HANDLE_LABELS: Record<OpenPoseDragHandle, string> = {
  waist: '',
  neck: '',
  lElbow: '',
  lWrist: '',
  rElbow: '',
  rWrist: '',
  lThigh: '',
  rThigh: '',
  lKnee: '',
  lAnkle: '',
  rKnee: '',
  rAnkle: '',
};

type JointSliderAxis = 0 | 1 | 2;

/** 侧栏三滑块：每关节三轴独立增量（度） */
function bumpOpenPoseJointSlider(
  joint: OpenPoseDragHandle,
  axis: JointSliderAxis,
  deltaDeg: number,
  p: Required<PanoHumanoidPose>,
  onField: (key: keyof PanoHumanoidPose, v: number) => void
) {
  switch (joint) {
    case 'waist':
      if (axis === 0) onField('waistX', p.waistX + deltaDeg);
      else if (axis === 1) onField('waistY', p.waistY + deltaDeg);
      else onField('waistZ', p.waistZ + deltaDeg);
      break;
    case 'neck':
      if (axis === 0) onField('neckX', p.neckX + deltaDeg);
      else if (axis === 1) onField('neckY', p.neckY + deltaDeg);
      else onField('neckZ', p.neckZ + deltaDeg);
      break;
    case 'lElbow':
      if (axis === 0) onField('lArmX', p.lArmX + deltaDeg);
      else if (axis === 1) onField('lArmY', p.lArmY + deltaDeg);
      else onField('lArmZ', p.lArmZ + deltaDeg);
      break;
    case 'rElbow':
      if (axis === 0) onField('rArmX', p.rArmX + deltaDeg);
      else if (axis === 1) onField('rArmY', p.rArmY + deltaDeg);
      else onField('rArmZ', p.rArmZ + deltaDeg);
      break;
    case 'lWrist':
      if (axis === 0) onField('lElbowX', p.lElbowX + deltaDeg);
      else if (axis === 1) onField('lElbowY', p.lElbowY + deltaDeg);
      else onField('lElbowZ', p.lElbowZ + deltaDeg);
      break;
    case 'rWrist':
      if (axis === 0) onField('rElbowX', p.rElbowX + deltaDeg);
      else if (axis === 1) onField('rElbowY', p.rElbowY + deltaDeg);
      else onField('rElbowZ', p.rElbowZ + deltaDeg);
      break;
    case 'lThigh':
      if (axis === 0) onField('lLegX', p.lLegX + deltaDeg);
      else if (axis === 1) onField('lLegY', p.lLegY + deltaDeg);
      else onField('lLegZ', p.lLegZ + deltaDeg);
      break;
    case 'rThigh':
      if (axis === 0) onField('rLegX', p.rLegX + deltaDeg);
      else if (axis === 1) onField('rLegY', p.rLegY + deltaDeg);
      else onField('rLegZ', p.rLegZ + deltaDeg);
      break;
    case 'lKnee':
      if (axis === 0) onField('lKneeX', p.lKneeX + deltaDeg);
      else if (axis === 1) onField('lKneeY', p.lKneeY + deltaDeg);
      else onField('lKneeZ', p.lKneeZ + deltaDeg);
      break;
    case 'rKnee':
      if (axis === 0) onField('rKneeX', p.rKneeX + deltaDeg);
      else if (axis === 1) onField('rKneeY', p.rKneeY + deltaDeg);
      else onField('rKneeZ', p.rKneeZ + deltaDeg);
      break;
    case 'lAnkle':
      if (axis === 0) onField('lKneeY', p.lKneeY + deltaDeg);
      else if (axis === 1) onField('lKneeZ', p.lKneeZ + deltaDeg);
      else onField('lLegZ', p.lLegZ + deltaDeg);
      break;
    case 'rAnkle':
      if (axis === 0) onField('rKneeY', p.rKneeY + deltaDeg);
      else if (axis === 1) onField('rKneeZ', p.rKneeZ + deltaDeg);
      else onField('rLegZ', p.rLegZ + deltaDeg);
      break;
    default:
      break;
  }
}

/** 滑条行程大、单步角度增益高（与滑条 ± 行程相乘） */
const OPENPOSE_JOINT_SLIDER_RANGE = 160;
/** 肩/上臂根（UI 里 lElbow、rElbow 手柄）：放宽行程，单次拖动可接近一整圈 */
const OPENPOSE_SHOULDER_SLIDER_RANGE = 600;
const OPENPOSE_JOINT_SLIDER_SENS = 0.62;

function OpenPoseJointSliders({
  joint,
  poseRef,
  onField,
  dark,
  labels,
}: {
  joint: OpenPoseDragHandle;
  poseRef: React.MutableRefObject<Required<PanoHumanoidPose>>;
  onField: (key: keyof PanoHumanoidPose, v: number) => void;
  dark: boolean;
  labels: { axis0: string; axis1: string; axis2: string };
}) {
  const last0 = useRef(0);
  const last1 = useRef(0);
  const last2 = useRef(0);
  useEffect(() => {
    last0.current = 0;
    last1.current = 0;
    last2.current = 0;
  }, [joint]);

  const track =
    dark ? 'accent-violet-500 h-1.5 w-full cursor-pointer rounded-full bg-white/10' : 'accent-violet-600 h-1.5 w-full cursor-pointer rounded-full bg-gray-200';
  const lab = dark ? 'text-[8px] text-white/65' : 'text-[8px] text-gray-600';
  const isShoulder = joint === 'lElbow' || joint === 'rElbow';
  const rng = isShoulder ? OPENPOSE_SHOULDER_SLIDER_RANGE : OPENPOSE_JOINT_SLIDER_RANGE;
  const mn = -rng;
  const mx = rng;

  const mk = (axis: JointSliderAxis, key: string, label: string, lastRef: React.MutableRefObject<number>) => (
    <label key={key} className={`flex flex-col gap-0.5 ${lab}`}>
      <span>{label}</span>
      <input
        type="range"
        min={mn}
        max={mx}
        step={1}
        defaultValue={0}
        className={track}
        aria-label={label}
        onInput={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          const d = v - lastRef.current;
          lastRef.current = v;
          bumpOpenPoseJointSlider(joint, axis, d * OPENPOSE_JOINT_SLIDER_SENS, poseRef.current, onField);
        }}
      />
    </label>
  );

  return (
    <div className="mt-1 space-y-1">
      {mk(0, `a0-${joint}`, labels.axis0, last0)}
      {mk(1, `a1-${joint}`, labels.axis1, last1)}
      {mk(2, `a2-${joint}`, labels.axis2, last2)}
    </div>
  );
}

function OpenPose3DScene({
  pose,
  figureColor,
  disabled,
  handleLabels,
  onField,
  headFaceLabel,
  selectedJoint,
  onSelectJoint,
  bodyBuild,
}: {
  pose: Required<PanoHumanoidPose>;
  figureColor: string;
  disabled: boolean;
  handleLabels: Record<OpenPoseDragHandle, string>;
  onField: (key: keyof PanoHumanoidPose, v: number) => void;
  headFaceLabel: string;
  selectedJoint: OpenPoseDragHandle | null;
  onSelectJoint: (j: OpenPoseDragHandle | null) => void;
  bodyBuild: PanoHumanoidBuild;
}) {
  const ph = useMemo(
    () => ({
      disabled: !!disabled,
      labels: handleLabels,
      selectedJoint,
      onSelectJoint,
    }),
    [disabled, handleLabels, selectedJoint, onSelectJoint]
  );

  return (
    <>
      <ambientLight intensity={0.42} />
      <directionalLight position={[2.2, 4.5, 2.8]} intensity={0.95} castShadow shadow-mapSize={[512, 512]} />
      <HumanoidStand
        color={figureColor}
        pose={pose}
        poseHandleProps={ph}
        headFaceLabel={headFaceLabel}
        bodyBuild={bodyBuild}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[5.5, 5.5]} />
        <meshStandardMaterial color="#141418" roughness={1} metalness={0} />
      </mesh>
      <OrbitControls
        makeDefault
        enablePan={false}
        target={[0, 0.58, 0]}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2 + 0.08}
        minDistance={1.35}
        maxDistance={3.4}
        rotateSpeed={0.65}
      />
    </>
  );
}

function OpenPose3DPanel({
  pose,
  figureColor,
  disabled,
  dark,
  labels,
  onField,
  bodyBuild,
  sliderLayoutKey,
}: {
  pose: Required<PanoHumanoidPose>;
  figureColor: string;
  disabled: boolean;
  dark: boolean;
  labels: {
    hint: string;
    headLabel: string;
    sliderFrontBack: string;
    sliderLeftRight: string;
    sliderTwist: string;
    sliderHint: string;
    neck: string;
    waist: string;
    lArm: string;
    rArm: string;
    lElbow: string;
    rElbow: string;
    lKnee: string;
    rKnee: string;
    thighL: string;
    thighR: string;
    ankleL: string;
    ankleR: string;
  };
  onField: (key: keyof PanoHumanoidPose, v: number) => void;
  bodyBuild: PanoHumanoidBuild;
  /** 变化时关节行程滑条重挂载，把手回到正中 */
  sliderLayoutKey: number;
}) {
  const bg = dark ? '#0a0a0d' : '#e8edf2';
  const [selectedJoint, setSelectedJoint] = useState<OpenPoseDragHandle | null>(null);
  const poseRefForSliders = useRef(pose);
  poseRefForSliders.current = pose;

  useEffect(() => {
    if (disabled) setSelectedJoint(null);
  }, [disabled]);

  const handleLabels = useMemo(
    (): Record<OpenPoseDragHandle, string> => ({
      waist: labels.waist,
      neck: labels.neck,
      lElbow: labels.lArm,
      lWrist: labels.lElbow,
      rElbow: labels.rArm,
      rWrist: labels.rElbow,
      lThigh: labels.thighL,
      rThigh: labels.thighR,
      lKnee: labels.lKnee,
      lAnkle: labels.ankleL,
      rKnee: labels.rKnee,
      rAnkle: labels.ankleR,
    }),
    [labels]
  );

  const dimChrome = disabled;

  return (
    <div className={`relative w-full ${dimChrome ? 'opacity-45' : ''}`}>
      <div
        className={`relative h-[min(128px,24vh)] w-full min-h-[108px] overflow-hidden rounded-md ${
          dark ? 'ring-1 ring-inset ring-white/10' : 'ring-1 ring-inset ring-black/10'
        }`}
        style={{ maxHeight: 128 }}
      >
        <Canvas
          className="h-full w-full touch-none"
          shadows
          camera={{ position: [1.42, 0.66, 1.18], fov: 36, near: 0.02, far: 20 }}
          gl={{ antialias: true, alpha: false }}
          onPointerMissed={() => setSelectedJoint(null)}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color(bg), 1);
          }}
        >
          <OpenPose3DScene
            pose={pose}
            figureColor={figureColor}
            disabled={disabled}
            handleLabels={handleLabels}
            onField={onField}
            headFaceLabel={labels.headLabel}
            selectedJoint={selectedJoint}
            onSelectJoint={setSelectedJoint}
            bodyBuild={bodyBuild}
          />
        </Canvas>
      </div>
      <p
        className={`mt-0.5 line-clamp-2 text-[8px] leading-snug ${dark ? 'text-white/35' : 'text-gray-500'} ${
          selectedJoint && !disabled ? 'hidden' : ''
        }`}
        title={labels.hint}
      >
        {labels.hint}
      </p>
      {selectedJoint && !disabled ? (
        <div
          className={`mt-1 rounded-md border px-1.5 py-1.5 ${
            dark ? 'border-white/10 bg-white/[0.04]' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className={`mb-0.5 text-[8px] font-medium ${dark ? 'text-violet-200/90' : 'text-violet-800'}`}>
            {handleLabels[selectedJoint]}
          </div>
          <OpenPoseJointSliders
            key={`sliders-${selectedJoint}-${sliderLayoutKey}`}
            joint={selectedJoint}
            poseRef={poseRefForSliders}
            onField={onField}
            dark={dark}
            labels={{
              axis0: labels.sliderFrontBack,
              axis1: labels.sliderLeftRight,
              axis2: labels.sliderTwist,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 左侧已存姿势：只读三维缩略（与侧栏 OpenPose 同场景与相机） */
function OpenPosePresetThumbCanvas({
  pose,
  figureColor,
  bodyBuild,
  dark,
}: {
  pose: Required<PanoHumanoidPose>;
  figureColor: string;
  bodyBuild: PanoHumanoidBuild;
  dark: boolean;
}) {
  const bg = dark ? '#0a0a0d' : '#e8edf2';
  return (
    <div
      className={`relative h-[92px] w-full min-h-[72px] overflow-hidden rounded-md ${
        dark ? 'ring-1 ring-inset ring-white/10' : 'ring-1 ring-inset ring-black/10'
      }`}
    >
      <Canvas
        key={dark ? 'pose-thumb-d' : 'pose-thumb-l'}
        className="h-full w-full touch-none"
        dpr={[1, 1.25]}
        frameloop="demand"
        shadows={false}
        camera={{ position: [1.42, 0.66, 1.18], fov: 36, near: 0.02, far: 20 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl, invalidate }) => {
          gl.setClearColor(new THREE.Color(bg), 1);
          invalidate();
        }}
      >
        <OpenPose3DScene
          pose={pose}
          figureColor={figureColor}
          disabled
          handleLabels={OPENPOSE_THUMB_HANDLE_LABELS}
          onField={OPENPOSE_THUMB_NOOP_FIELD}
          headFaceLabel=""
          selectedJoint={null}
          onSelectJoint={OPENPOSE_THUMB_NOOP_SELECT}
          bodyBuild={bodyBuild}
        />
      </Canvas>
    </div>
  );
}

/** 人台主体材质：`color` 为 hex 时用染色磨砂；特殊令牌为白实体 / 玻璃 */
function mannequinPhysicalProps(surfaceKey: string) {
  const kind = humanoidSurfaceKind(surfaceKey);
  if (kind === 'white') {
    return {
      color: '#f4f4f5',
      roughness: 0.52,
      metalness: 0.04,
      transmission: 0,
      thickness: 0,
      transparent: false,
      opacity: 1,
      envMapIntensity: 0.26,
      ior: 1.5,
      attenuationColor: '#f4f4f5',
      attenuationDistance: 0.4,
    } as const;
  }
  if (kind === 'glass') {
    // 透明蓝玻璃：表面偏青蓝 + 体积吸收用深蓝，短 attenuation 让厚处更「蓝」
    return {
      color: '#7dd3fc',
      roughness: 0.02,
      metalness: 0,
      transmission: 0.94,
      thickness: 0.85,
      transparent: true,
      opacity: 0.18,
      envMapIntensity: 1.05,
      ior: 1.52,
      specularIntensity: 1.1,
      attenuationColor: '#1e40af',
      attenuationDistance: 0.42,
    } as const;
  }
  return {
    color: surfaceKey,
    roughness: 0.42,
    metalness: 0.02,
    transmission: 0.22,
    thickness: 0.55,
    transparent: true,
    opacity: 0.9,
    envMapIntensity: 0.32,
    ior: 1.42,
    attenuationColor: surfaceKey,
    attenuationDistance: 0.55,
  } as const;
}

function mannequinEdgeLineProps(surfaceKey: string) {
  const kind = humanoidSurfaceKind(surfaceKey);
  if (kind === 'white') return { lineColor: '#64748b', lineOpacity: 0.38 } as const;
  if (kind === 'glass') return { lineColor: '#38bdf8', lineOpacity: 0.62 } as const;
  return { lineColor: '#f8fafc', lineOpacity: 0.42 } as const;
}

/** OpenPose：选中部位时主体材质微发光 */
function mannequinHighlightProps(selected: boolean) {
  if (!selected) return {};
  return { emissive: '#34d399', emissiveIntensity: 0.52 } as const;
}

function quatAlignYToDir(dx: number, dy: number, dz: number): THREE.Quaternion {
  const dir = new THREE.Vector3(dx, dy, dz);
  const len = dir.length();
  if (len < 1e-8) return new THREE.Quaternion();
  dir.multiplyScalar(1 / len);
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  if (Math.abs(dir.dot(up)) > 0.998) {
    if (dir.y < 0) q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    return q;
  }
  q.setFromUnitVectors(up, dir);
  return q;
}

function FrostBox({
  color,
  size,
  position,
  rotation,
  quaternion,
  selected,
}: {
  color: string;
  size: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  quaternion?: THREE.Quaternion;
  selected?: boolean;
}) {
  const [sx, sy, sz] = size;
  const { geom, edges } = useMemo(() => {
    const geom = new THREE.BoxGeometry(sx, sy, sz);
    const edges = new THREE.EdgesGeometry(geom, 38);
    return { geom, edges };
  }, [sx, sy, sz]);
  useEffect(() => {
    return () => {
      geom.dispose();
      edges.dispose();
    };
  }, [geom, edges]);
  const edge = mannequinEdgeLineProps(color);
  return (
    <group position={position} rotation={rotation} quaternion={quaternion}>
      <mesh castShadow geometry={geom}>
        <meshPhysicalMaterial {...mannequinPhysicalProps(color)} {...mannequinHighlightProps(!!selected)} />
      </mesh>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial color={edge.lineColor} transparent opacity={edge.lineOpacity} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

function FrostIcoSphere({
  color,
  r,
  position,
  selected,
}: {
  color: string;
  r: number;
  position: [number, number, number];
  selected?: boolean;
}) {
  const { geom, edges } = useMemo(() => {
    const geom = new THREE.IcosahedronGeometry(r, 0);
    const edges = new THREE.EdgesGeometry(geom, 18);
    return { geom, edges };
  }, [r]);
  useEffect(() => {
    return () => {
      geom.dispose();
      edges.dispose();
    };
  }, [geom, edges]);
  const edge = mannequinEdgeLineProps(color);
  return (
    <group position={position}>
      <mesh castShadow geometry={geom}>
        <meshPhysicalMaterial {...mannequinPhysicalProps(color)} {...mannequinHighlightProps(!!selected)} />
      </mesh>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial color={edge.lineColor} transparent opacity={Math.min(1, edge.lineOpacity + 0.03)} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

function FrostCylBetween({
  color,
  a,
  b,
  r,
  radialSegments = 8,
  selected,
}: {
  color: string;
  a: [number, number, number];
  b: [number, number, number];
  r: number;
  radialSegments?: number;
  selected?: boolean;
}) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const mz = (a[2] + b[2]) / 2;
  const q = useMemo(() => quatAlignYToDir(dx, dy, dz), [dx, dy, dz]);
  const { geom, edges } = useMemo(() => {
    const L = Math.max(len, 1e-6);
    const geom = new THREE.CylinderGeometry(r, r, L, radialSegments, 1, false);
    const edges = new THREE.EdgesGeometry(geom, 28);
    return { geom, edges };
  }, [len, r, radialSegments]);
  useEffect(() => {
    return () => {
      geom.dispose();
      edges.dispose();
    };
  }, [geom, edges]);
  if (len < 1e-6) return null;
  const edge = mannequinEdgeLineProps(color);
  return (
    <group position={[mx, my, mz]} quaternion={q}>
      <mesh castShadow geometry={geom}>
        <meshPhysicalMaterial {...mannequinPhysicalProps(color)} {...mannequinHighlightProps(!!selected)} />
      </mesh>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial color={edge.lineColor} transparent opacity={edge.lineOpacity * 0.95} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

/** 长方体骨骼段：沿 a→b，局部 Y 为长度 */
function BoxBetween({
  color,
  a,
  b,
  wx,
  wz,
  selected,
}: {
  color: string;
  a: [number, number, number];
  b: [number, number, number];
  wx: number;
  wz: number;
  selected?: boolean;
}) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return null;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const mz = (a[2] + b[2]) / 2;
  const q = quatAlignYToDir(dx, dy, dz);
  return <FrostBox color={color} size={[wx, len, wz]} position={[mx, my, mz]} quaternion={q} selected={selected} />;
}

/** 头部正面极简笑脸：仅双眼 + 嘴弧（无整脸底色） */
function HumanoidHeadSmileyMinimal({ selected }: { selected?: boolean }) {
  const map = useMemo(() => {
    const w = 256;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = w;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (!ctx) {
      tex.needsUpdate = true;
      return tex;
    }
    ctx.clearRect(0, 0, w, w);
    const cx = w / 2;
    const eyeY = 96;
    const eyeRx = 19;
    const eyeRy = 24;
    const eyeGap = 44;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.beginPath();
    ctx.ellipse(cx - eyeGap, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + eyeGap, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 68, 138);
    ctx.quadraticCurveTo(cx, 182, cx + 68, 138);
    ctx.stroke();
    tex.needsUpdate = true;
    return tex;
  }, []);
  useEffect(() => () => map.dispose(), [map]);
  return (
    <mesh position={[0, 0.03, 0.089]} renderOrder={4}>
      <planeGeometry args={[0.24, 0.24]} />
      <meshBasicMaterial
        map={map}
        color={selected ? '#cffafe' : '#ffffff'}
        transparent
        toneMapped={false}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * 站立人台：方块头 + 躯干 + 四肢；肩/肘/髋/膝用局部 group 旋转，供 OpenPose 侧栏调节。
 */
function vsub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function d2r(deg: number) {
  return (deg * Math.PI) / 180;
}

/** 肩关节三轴：YXZ 减轻万向节锁，便于各轴大角度（含近 360°）调节 */
function PanoShoulderRotGroup({
  position,
  axDeg,
  ayDeg,
  azDeg,
  children,
}: {
  position: [number, number, number];
  axDeg: number;
  ayDeg: number;
  azDeg: number;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    g.rotation.order = 'YXZ';
    g.rotation.set(d2r(axDeg), d2r(ayDeg), d2r(azDeg));
  }, [axDeg, ayDeg, azDeg]);
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

function HumanoidStand({
  color,
  pose,
  poseHandleProps,
  headFaceLabel,
  bodyBuild = 'standard',
}: {
  color: string;
  pose?: PanoHumanoidPose;
  poseHandleProps?: {
    disabled: boolean;
    labels: Record<OpenPoseDragHandle, string>;
    selectedJoint: OpenPoseDragHandle | null;
    onSelectJoint: (j: OpenPoseDragHandle) => void;
  };
  /** 仅 OpenPose 侧栏：头部正面文字贴图 */
  headFaceLabel?: string;
  /** 横向收窄 + 肢体变细 */
  bodyBuild?: PanoHumanoidBuild;
}) {
  const p = { ...DEFAULT_PANO_HUMANOID_POSE, ...pose };
  const ph = poseHandleProps;
  const thin = bodyBuild === 'thin';
  const PX = thin ? 0.78 : 1;
  const SC = thin ? 0.82 : 1;
  const HX = thin ? 0.9 : 1;
  const TT = PX * SC;
  const WA = 0.658;
  const rel = (x: number, y: number, z: number): [number, number, number] => [x * PX, y - WA, z * PX];
  const p3 = (x: number, y: number, z: number): [number, number, number] => [x * PX, y, z * PX];
  const lHip: [number, number, number] = p3(-0.102, 0.505, 0);
  const lKnee: [number, number, number] = p3(-0.102, 0.275, 0);
  const lAnk: [number, number, number] = p3(-0.102, 0.036, 0);
  const rHip: [number, number, number] = p3(0.102, 0.505, 0);
  const rKnee: [number, number, number] = p3(0.102, 0.275, 0);
  const rAnk: [number, number, number] = p3(0.102, 0.036, 0);
  const lShoulder: [number, number, number] = p3(-0.198, 0.798, 0.018);
  const lElbow: [number, number, number] = p3(-0.232, 0.628, 0.028);
  const lWrist: [number, number, number] = p3(-0.252, 0.448, 0.032);
  const rShoulder: [number, number, number] = p3(0.198, 0.798, 0.018);
  const rElbow: [number, number, number] = p3(0.232, 0.628, 0.028);
  const rWrist: [number, number, number] = p3(0.252, 0.448, 0.032);
  const hipConnL0: [number, number, number] = p3(-0.055, 0.526, 0);
  const hipConnR0: [number, number, number] = p3(0.055, 0.526, 0);
  const shoulderConnL0: [number, number, number] = p3(-0.145, 0.805, 0.03);
  const shoulderConnR0: [number, number, number] = p3(0.145, 0.805, 0.03);

  const lkRel = vsub(lKnee, lHip);
  const laRel = vsub(lAnk, lKnee);
  const rkRel = vsub(rKnee, rHip);
  const raRel = vsub(rAnk, rKnee);
  const leL = vsub(lElbow, lShoulder);
  const lwL = vsub(lWrist, lElbow);
  const leR = vsub(rElbow, rShoulder);
  const lwR = vsub(rWrist, rElbow);

  const pick =
    ph && !ph.disabled
      ? (j: OpenPoseDragHandle) => (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          ph.onSelectJoint(j);
        }
      : null;
  const lit = (j: OpenPoseDragHandle) => !!(ph && ph.selectedJoint === j && !ph.disabled);

  return (
    <group>
      <FrostCylBetween color={color} a={hipConnL0} b={lHip} r={0.034 * SC} />
      <group position={lHip} rotation={[d2r(p.lLegX), d2r(p.lLegY), d2r(p.lLegZ)]}>
        <group onPointerDown={pick ? pick('lThigh') : undefined}>
          <BoxBetween color={color} a={[0, 0, 0]} b={lkRel} wx={0.095 * SC} wz={0.072 * SC} selected={lit('lThigh')} />
          <FrostCylBetween
            color={color}
            a={[lkRel[0], 0.017, lkRel[2]]}
            b={[lkRel[0], -0.017, lkRel[2]]}
            r={0.038 * SC}
            selected={lit('lThigh')}
          />
        </group>
        <group position={lkRel} rotation={[d2r(p.lKneeX), d2r(p.lKneeY), d2r(p.lKneeZ)]}>
          <group onPointerDown={pick ? pick('lKnee') : undefined}>
            <BoxBetween color={color} a={[0, 0, 0]} b={laRel} wx={0.082 * SC} wz={0.064 * SC} selected={lit('lKnee')} />
          </group>
          <group onPointerDown={pick ? pick('lAnkle') : undefined}>
            <FrostBox
              color={color}
              size={[0.12 * TT, 0.03 * SC, 0.15 * TT]}
              position={[laRel[0], laRel[1] - 0.014 * SC, laRel[2] + 0.048 * PX]}
              selected={lit('lAnkle')}
            />
          </group>
        </group>
      </group>

      <FrostCylBetween color={color} a={hipConnR0} b={rHip} r={0.034 * SC} />
      <group position={rHip} rotation={[d2r(p.rLegX), d2r(-p.rLegY), d2r(p.rLegZ)]}>
        <group onPointerDown={pick ? pick('rThigh') : undefined}>
          <BoxBetween color={color} a={[0, 0, 0]} b={rkRel} wx={0.095 * SC} wz={0.072 * SC} selected={lit('rThigh')} />
          <FrostCylBetween
            color={color}
            a={[rkRel[0], 0.017, rkRel[2]]}
            b={[rkRel[0], -0.017, rkRel[2]]}
            r={0.038 * SC}
            selected={lit('rThigh')}
          />
        </group>
        <group position={rkRel} rotation={[d2r(p.rKneeX), d2r(p.rKneeY), d2r(p.rKneeZ)]}>
          <group onPointerDown={pick ? pick('rKnee') : undefined}>
            <BoxBetween color={color} a={[0, 0, 0]} b={raRel} wx={0.082 * SC} wz={0.064 * SC} selected={lit('rKnee')} />
          </group>
          <group onPointerDown={pick ? pick('rAnkle') : undefined}>
            <FrostBox
              color={color}
              size={[0.12 * TT, 0.03 * SC, 0.15 * TT]}
              position={[raRel[0], raRel[1] - 0.014 * SC, raRel[2] + 0.048 * PX]}
              selected={lit('rAnkle')}
            />
          </group>
        </group>
      </group>

      <group onPointerDown={pick ? pick('waist') : undefined}>
        <FrostBox color={color} size={[0.27 * TT, 0.14, 0.19 * TT]} position={[0, 0.586, 0]} selected={lit('waist')} />
      </group>

      <group position={[0, WA, 0]} rotation={[d2r(p.waistX), d2r(p.waistY), d2r(p.waistZ)]}>
        <group onPointerDown={pick ? pick('waist') : undefined}>
          <FrostCylBetween color={color} a={[0, 0, 0]} b={[0, 0.026, 0]} r={0.052 * SC} radialSegments={10} selected={lit('waist')} />
          <FrostBox color={color} size={[0.32 * TT, 0.142, 0.21 * TT]} position={rel(0, 0.755, 0)} selected={lit('waist')} />
        </group>
        <group onPointerDown={pick ? pick('lElbow') : undefined}>
          <FrostCylBetween
            color={color}
            a={rel(shoulderConnL0[0], shoulderConnL0[1], shoulderConnL0[2])}
            b={rel(-0.178 * PX, 0.802, 0.022 * PX)}
            r={0.026 * SC}
            selected={lit('lElbow')}
          />
        </group>
        <group onPointerDown={pick ? pick('rElbow') : undefined}>
          <FrostCylBetween
            color={color}
            a={rel(shoulderConnR0[0], shoulderConnR0[1], shoulderConnR0[2])}
            b={rel(0.178 * PX, 0.802, 0.022 * PX)}
            r={0.026 * SC}
            selected={lit('rElbow')}
          />
        </group>

        <PanoShoulderRotGroup
          position={rel(lShoulder[0], lShoulder[1], lShoulder[2])}
          axDeg={p.lArmX}
          ayDeg={p.lArmY}
          azDeg={p.lArmZ}
        >
          <group onPointerDown={pick ? pick('lElbow') : undefined}>
            <BoxBetween color={color} a={[0, 0, 0]} b={leL} wx={0.07 * SC} wz={0.062 * SC} selected={lit('lElbow')} />
          </group>
          <group position={leL} rotation={[d2r(p.lElbowX), d2r(p.lElbowY), d2r(p.lElbowZ)]}>
            <group onPointerDown={pick ? pick('lWrist') : undefined}>
              <FrostIcoSphere color={color} r={0.046 * SC} position={[0, 0, 0]} selected={lit('lWrist')} />
              <BoxBetween color={color} a={[0, 0, 0]} b={lwL} wx={0.06 * SC} wz={0.056 * SC} selected={lit('lWrist')} />
            </group>
          </group>
        </PanoShoulderRotGroup>

        <PanoShoulderRotGroup
          position={rel(rShoulder[0], rShoulder[1], rShoulder[2])}
          axDeg={p.rArmX}
          ayDeg={p.rArmY}
          azDeg={-p.rArmZ}
        >
          <group onPointerDown={pick ? pick('rElbow') : undefined}>
            <BoxBetween color={color} a={[0, 0, 0]} b={leR} wx={0.07 * SC} wz={0.062 * SC} selected={lit('rElbow')} />
          </group>
          <group position={leR} rotation={[d2r(p.rElbowX), d2r(p.rElbowY), d2r(p.rElbowZ)]}>
            <group onPointerDown={pick ? pick('rWrist') : undefined}>
              <FrostIcoSphere color={color} r={0.046 * SC} position={[0, 0, 0]} selected={lit('rWrist')} />
              <BoxBetween color={color} a={[0, 0, 0]} b={lwR} wx={0.06 * SC} wz={0.056 * SC} selected={lit('rWrist')} />
            </group>
          </group>
        </PanoShoulderRotGroup>

        <group position={rel(0, 0.824, 0)} rotation={[d2r(p.neckX), d2r(p.neckY), d2r(p.neckZ)]}>
          <group onPointerDown={pick ? pick('neck') : undefined}>
            <FrostCylBetween color={color} a={[0, 0, 0]} b={[0, 0.04, 0]} r={0.036 * SC} radialSegments={8} selected={lit('neck')} />
            <group position={[0, 0.134, 0]}>
              <FrostBox color={color} size={[0.19 * HX * SC, 0.19, 0.17 * HX * SC]} position={[0, 0, 0]} selected={lit('neck')} />
              {headFaceLabel ? <HumanoidHeadSmileyMinimal selected={lit('neck')} /> : null}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function HumanoidFigure({
  color,
  pose,
  poseHandleProps,
  headFaceLabel,
  bodyBuild = 'standard',
}: {
  color: string;
  pose?: PanoHumanoidPose;
  poseHandleProps?: {
    disabled: boolean;
    labels: Record<OpenPoseDragHandle, string>;
    selectedJoint: OpenPoseDragHandle | null;
    onSelectJoint: (j: OpenPoseDragHandle) => void;
  };
  headFaceLabel?: string;
  bodyBuild?: PanoHumanoidBuild;
}) {
  return (
    <HumanoidStand
      color={color}
      pose={pose}
      poseHandleProps={poseHandleProps}
      headFaceLabel={headFaceLabel}
      bodyBuild={bodyBuild}
    />
  );
}

function TableMeshPano() {
  const wood = '#6b4423';
  return (
    <group>
      <mesh castShadow position={[0, 0.82, 0]}>
        <boxGeometry args={[2.1, 0.07, 1.15]} />
        <meshStandardMaterial color={wood} roughness={0.65} />
      </mesh>
      {[[-0.85, 0.38, -0.45], [0.85, 0.38, -0.45], [-0.85, 0.38, 0.45], [0.85, 0.38, 0.45]].map((p, i) => (
        <mesh key={i} castShadow position={p as [number, number, number]}>
          <boxGeometry args={[0.1, 0.76, 0.1]} />
          <meshStandardMaterial color="#4a3728" roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function ChairMeshPano() {
  const wood = '#5c4033';
  const fabric = '#475569';
  return (
    <group>
      <mesh castShadow position={[0, 0.45, 0]}>
        <boxGeometry args={[0.52, 0.06, 0.5]} />
        <meshStandardMaterial color={fabric} roughness={0.85} />
      </mesh>
      <mesh castShadow position={[0, 0.72, -0.22]}>
        <boxGeometry args={[0.52, 0.55, 0.07]} />
        <meshStandardMaterial color={fabric} roughness={0.85} />
      </mesh>
      {[[-0.2, 0.2, -0.2], [0.2, 0.2, -0.2], [-0.2, 0.2, 0.2], [0.2, 0.2, 0.2]].map((p, i) => (
        <mesh key={i} castShadow position={p as [number, number, number]}>
          <boxGeometry args={[0.06, 0.4, 0.06]} />
          <meshStandardMaterial color={wood} roughness={0.65} />
        </mesh>
      ))}
    </group>
  );
}

function EquirectMesh({ url }: { url: string }) {
  const map = useTexture(url);
  useEffect(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return () => {
      map.dispose();
    };
  }, [map]);
  return (
    <mesh>
      <sphereGeometry args={[EQ_RADIUS, 64, 32]} />
      <meshBasicMaterial map={map} side={THREE.BackSide} />
    </mesh>
  );
}

function PanoCameraFov({ fov }: { fov: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const c = camera as THREE.PerspectiveCamera;
    if (c.isPerspectiveCamera) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }, [camera, fov]);
  return null;
}

function OrbitResetRegistrar({ onRegister }: { onRegister: (fn: () => void) => void }) {
  const controls = useThree((s) => s.controls) as { reset?: () => void } | null | undefined;
  useEffect(() => {
    if (controls && typeof controls.reset === 'function') {
      const reset = controls.reset.bind(controls);
      onRegister(() => reset());
    }
  }, [controls, onRegister]);
  return null;
}

/** 启用 Orbit 滚轮缩放，并与 React 中的视距 state 双向同步（滑条 / 滚轮） */
function PanoOrbitControls({
  viewDistance,
  setViewDistance,
  orbitResetRef,
}: {
  viewDistance: number;
  setViewDistance: (d: number) => void;
  orbitResetRef: React.MutableRefObject<(() => void) | null>;
}) {
  const ctrlRef = useRef<any>(null);
  const { camera } = useThree();

  useLayoutEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    const target = ctrl.target;
    const offset = camera.position.clone().sub(target);
    if (offset.lengthSq() < 1e-12) {
      offset.set(0, 0.06, 0.18);
    }
    const cur = offset.length();
    if (Math.abs(cur - viewDistance) < 0.0008) return;
    offset.normalize().multiplyScalar(viewDistance);
    camera.position.copy(target).add(offset);
    ctrl.update();
  }, [viewDistance, camera]);

  return (
    <>
      <OrbitControls
        ref={ctrlRef}
        makeDefault
        enablePan={false}
        enableZoom={false}
        minDistance={MIN_VIEW_DISTANCE}
        maxDistance={MAX_VIEW_DISTANCE}
        enableDamping
        dampingFactor={0.068}
        rotateSpeed={-0.42}
        minPolarAngle={0.055}
        maxPolarAngle={Math.PI - 0.055}
        zoomSpeed={0.65}
        onChange={() => {
          const ctrl = ctrlRef.current;
          if (!ctrl) return;
          const d = clampViewDistance(ctrl.getDistance());
          if (Math.abs(d - viewDistance) > 0.002) {
            setViewDistance(d);
          }
        }}
      />
      <OrbitResetRegistrar
        onRegister={(fn) => {
          orbitResetRef.current = fn;
        }}
      />
    </>
  );
}

function ratioForPanoAspect(id: string): number | null {
  if (id === 'adaptive') return null;
  if (id === '16_9') return 16 / 9;
  if (id === '9_16') return 9 / 16;
  if (id === '1_1') return 1;
  if (id === '4_3') return 4 / 3;
  if (id === '3_4') return 3 / 4;
  if (id === '3_2') return 3 / 2;
  if (id === '21_9') return 21 / 9;
  if (id === '235_100') return 2.35;
  return null;
}

/** 中央 3D 预览框 Tailwind 比例类（与右侧「输出比例」一致；adaptive 填满可用区域） */
function aspectPreviewClassForId(id: string): string {
  switch (id) {
    case '16_9':
      return 'aspect-video';
    case '9_16':
      return 'aspect-[9/16]';
    case '1_1':
      return 'aspect-square';
    case '4_3':
      return 'aspect-[4/3]';
    case '3_4':
      return 'aspect-[3/4]';
    case '3_2':
      return 'aspect-[3/2]';
    case '21_9':
      return 'aspect-[21/9]';
    case '235_100':
      return 'aspect-[2.35/1]';
    default:
      return 'aspect-[4/3]';
  }
}

/** 横屏比例优先撑满中央栏宽度，竖屏比例优先撑满高度，避免预览框被挤成近方形 */
function aspectPreviewLayoutClassForId(id: string): string {
  const ratio = ratioForPanoAspect(id);
  const aspect = aspectPreviewClassForId(id);
  if (ratio == null) {
    return `${aspect} h-full max-h-full w-full max-w-full min-h-0 min-w-0`;
  }
  if (ratio >= 1) {
    return `${aspect} w-full max-w-full h-auto max-h-full min-h-0 min-w-0`;
  }
  return `${aspect} h-full max-h-full w-auto max-w-full min-h-0 min-w-0`;
}

/** 与 Panorama360Viewer 截图一致的裁切与最长边缩放（用于导出与底部「输出」文案） */
function computePanoExportDimensions(
  sw: number,
  sh: number,
  aspectId: string
): { dw: number; dh: number; sx: number; sy: number; sww: number; shh: number } {
  const targetR = ratioForPanoAspect(aspectId);
  let sx = 0;
  let sy = 0;
  let sww = sw;
  let shh = sh;
  if (targetR != null && sw > 1 && sh > 1) {
    const srcR = sw / sh;
    if (srcR > targetR) {
      shh = sh;
      sww = Math.round(sh * targetR);
      sx = Math.floor((sw - sww) / 2);
      sy = 0;
    } else {
      sww = sw;
      shh = Math.round(sw / targetR);
      sx = 0;
      sy = Math.floor((sh - shh) / 2);
    }
  }
  let dw: number;
  let dh: number;
  if (sww >= shh) {
    dw = Math.min(CAPTURE_OUT_MAX, sww);
    dh = Math.round(dw * (shh / sww));
  } else {
    dh = Math.min(CAPTURE_OUT_MAX, shh);
    dw = Math.round(dh * (sww / shh));
  }
  dw = Math.max(1, dw);
  dh = Math.max(1, dh);
  return { dw, dh, sx, sy, sww, shh };
}

function PanoGlCapture({
  saveRef,
  aspectIdRef,
  hideWhileCapturingRef,
}: {
  saveRef: React.MutableRefObject<(() => string | null) | null>;
  aspectIdRef: React.MutableRefObject<string>;
  /** 导出 PNG 时临时隐藏（如 TransformControls 的 XYZ 轴），避免进入输出画面 */
  hideWhileCapturingRef?: React.MutableRefObject<THREE.Object3D | null>;
}) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    saveRef.current = () => {
      const hideObj = hideWhileCapturingRef?.current;
      let prevVisible: boolean | undefined;
      if (hideObj) {
        prevVisible = hideObj.visible;
        hideObj.visible = false;
      }
      try {
        gl.render(scene, camera);
        const canvas = gl.domElement;
        const sw = canvas.width;
        const sh = canvas.height;
        const { dw, dh, sx, sy, sww, shh } = computePanoExportDimensions(sw, sh, aspectIdRef.current);
        const out = document.createElement('canvas');
        out.width = dw;
        out.height = dh;
        const ctx = out.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(canvas, sx, sy, sww, shh, 0, 0, dw, dh);
        return out.toDataURL('image/png');
      } catch {
        return null;
      } finally {
        if (hideObj && prevVisible !== undefined) {
          hideObj.visible = prevVisible;
        }
      }
    };
    return () => {
      saveRef.current = null;
    };
  }, [gl, scene, camera, saveRef, aspectIdRef, hideWhileCapturingRef]);
  return null;
}

function ItemMesh({ item }: { item: PanoPlacedItem }) {
  const { locale } = useAppLocale();
  const humanoidHeadFaceLabel = panoramaPlacementT(locale).openPoseHeadLabel;
  const { kind, color } = item;
  const mat = (rough: number) => <meshStandardMaterial color={color} roughness={rough} metalness={0.08} />;
  switch (kind) {
    case 'sphere':
      return (
        <mesh castShadow>
          <sphereGeometry args={[0.22, 24, 20]} />
          {mat(0.35)}
        </mesh>
      );
    case 'cube':
      return (
        <mesh castShadow>
          <boxGeometry args={[0.36, 0.36, 0.36]} />
          {mat(0.4)}
        </mesh>
      );
    case 'cylinder':
      return (
        <mesh castShadow>
          <cylinderGeometry args={[0.18, 0.18, 0.44, 20]} />
          {mat(0.4)}
        </mesh>
      );
    case 'cone':
      return (
        <mesh castShadow>
          <coneGeometry args={[0.22, 0.42, 22]} />
          {mat(0.4)}
        </mesh>
      );
    case 'humanoid':
      return (
        <HumanoidFigure
          key={item.id}
          color={color}
          pose={item.pose}
          headFaceLabel={humanoidHeadFaceLabel}
          bodyBuild={item.humanoidBuild ?? 'standard'}
        />
      );
    case 'table':
      return <TableMeshPano />;
    case 'chair':
      return <ChairMeshPano />;
    default:
      return null;
  }
}

function PlacementScene({
  textureUrl,
  fov,
  items,
  setItems,
  selectedId,
  setSelectedId,
  pendingKind,
  setPendingKind,
  saveRef,
  orbitResetRef,
  aspectIdRef,
  pendingHumanoidColor,
  pendingPose,
  pendingHumanoidBuild,
  viewDistance,
  setViewDistance,
}: {
  textureUrl: string;
  fov: number;
  items: PanoPlacedItem[];
  setItems: React.Dispatch<React.SetStateAction<PanoPlacedItem[]>>;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  pendingKind: SceneObjectKind | null;
  setPendingKind: (k: SceneObjectKind | null) => void;
  saveRef: React.MutableRefObject<(() => string | null) | null>;
  orbitResetRef: React.MutableRefObject<(() => void) | null>;
  aspectIdRef: React.MutableRefObject<string>;
  pendingHumanoidColor: string;
  pendingPose: PanoHumanoidPose;
  pendingHumanoidBuild: PanoHumanoidBuild;
  viewDistance: number;
  setViewDistance: (d: number) => void;
}) {
  const selectedGroupRef = useRef<THREE.Group>(null);
  const panoTransformGizmoRef = useRef<StdlibTransformControls | null>(null);
  const [transformObject, setTransformObject] = useState<THREE.Object3D | null>(null);
  const itemsRootRef = useRef<THREE.Group>(null);

  useEffect(() => {
    setTransformObject(selectedId ? selectedGroupRef.current : null);
  }, [selectedId, items]);

  const syncSelected = useCallback(() => {
    const o = selectedGroupRef.current;
    if (!o || !selectedId) return;
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId
          ? {
              ...it,
              position: [o.position.x, o.position.y, o.position.z],
              rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
            }
          : it
      )
    );
  }, [selectedId, setItems]);

  const addAt = (p: THREE.Vector3) => {
    if (!pendingKind) return;
    if (pendingKind === 'humanoid') {
      const item: PanoPlacedItem = {
        id: newId(),
        kind: 'humanoid',
        position: [p.x, p.y, p.z],
        rotation: [0, Math.random() * Math.PI * 2, 0],
        scale: 1,
        color: pendingHumanoidColor,
        humanoidBuild: pendingHumanoidBuild,
        pose: { ...DEFAULT_PANO_HUMANOID_POSE, ...pendingPose },
      };
      setItems((prev) => [...prev, item]);
      setSelectedId(item.id);
      setPendingKind(null);
      return;
    }
  };

  return (
    <>
      <color attach="background" args={['#050508']} />
      <PanoCameraFov fov={fov} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 10, 6]} intensity={0.85} castShadow shadow-mapSize={[1024, 1024]} />
      <Suspense fallback={null}>
        <EquirectMesh url={textureUrl} />
      </Suspense>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          if (pendingKind) {
            addAt(e.point.clone());
          } else {
            setSelectedId(null);
          }
        }}
      >
        <sphereGeometry args={[PLACE_RADIUS, 48, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <group ref={itemsRootRef}>
        {items.map((item) => {
          const sel = item.id === selectedId;
          return (
            <group
              key={item.id}
              ref={sel ? selectedGroupRef : undefined}
              position={item.position}
              rotation={item.rotation}
              scale={[item.scale, item.scale, item.scale]}
              renderOrder={item.kind === 'humanoid' ? 2 : 0}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(item.id);
              }}
            >
              <ItemMesh item={item} />
            </group>
          );
        })}
      </group>
      {transformObject && (
        <TransformControls
          ref={panoTransformGizmoRef}
          key={selectedId ?? 'x'}
          object={transformObject}
          mode="translate"
          onMouseUp={syncSelected}
        />
      )}
      <PanoOrbitControls
        viewDistance={viewDistance}
        setViewDistance={setViewDistance}
        orbitResetRef={orbitResetRef}
      />
      <PanoGlCapture
        saveRef={saveRef}
        aspectIdRef={aspectIdRef}
        hideWhileCapturingRef={panoTransformGizmoRef}
      />
    </>
  );
}

export interface Panorama360PlacementPanelProps {
  textureUrl: string;
  isDarkMode?: boolean;
  onOutput: (dataUrl: string) => void;
  hostFullscreen?: boolean;
  onHostFullscreenChange?: (full: boolean) => void;
}

const Panorama360PlacementPanel: React.FC<Panorama360PlacementPanelProps> = ({
  textureUrl,
  isDarkMode = true,
  onOutput,
  hostFullscreen = false,
}) => {
  const { locale } = useAppLocale();
  const tt = useMemo(() => panoramaPlacementT(locale), [locale]);
  const st = useMemo(() => spatialComposition3DT(locale), [locale]);
  const [items, setItems] = useState<PanoPlacedItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<SceneObjectKind | null>(null);
  const [pendingHumanoidColor, setPendingHumanoidColor] = useState<string>(HUMANOID_RAINBOW[3]);
  const [pendingPose, setPendingPose] = useState<PanoHumanoidPose>({});
  const [pendingHumanoidBuild, setPendingHumanoidBuild] = useState<PanoHumanoidBuild>('standard');
  const [panoFov, setPanoFov] = useState(DEFAULT_FOV);
  const [viewDistance, setViewDistance] = useState(DEFAULT_VIEW_DISTANCE);
  const [aspectId, setAspectId] = useState('4_3');
  const [openPosePresets, setOpenPosePresets] = useState<PanoOpenPosePresetStored[]>(() => readOpenPosePresetsFromStorage());
  /** 递增后强制 OpenPose 关节滑条 DOM 重挂载，使行程条回到正中（与 reset 后的 pose 一致） */
  const [openPoseSliderLayoutKey, setOpenPoseSliderLayoutKey] = useState(0);
  const saveRef = useRef<(() => string | null) | null>(null);
  const orbitResetRef = useRef<(() => void) | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const centerPanelRef = useRef<HTMLDivElement>(null);
  const aspectIdRef = useRef(aspectId);

  useEffect(() => {
    aspectIdRef.current = aspectId;
  }, [aspectId]);

  /** 中央预览区滚轮调节 FOV 滑条（每档 ±10%），阻止冒泡以免触发画布缩放 */
  useEffect(() => {
    const el = centerPanelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY === 0) return;
      const notches = Math.max(1, Math.round(Math.abs(e.deltaY) / 100));
      const factor =
        e.deltaY > 0
          ? Math.pow(1 + PANO_WHEEL_FOV_STEP, notches)
          : Math.pow(1 - PANO_WHEEL_FOV_STEP, notches);
      setPanoFov((prev) => clampPanoFov(prev * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    writeOpenPosePresetsToStorage(openPosePresets);
  }, [openPosePresets]);

  const labelFor = useCallback(
    (item: PanoPlacedItem, indexInKind: number) => {
      switch (item.kind) {
        case 'sphere':
          return tt.modelSphere(indexInKind);
        case 'cube':
          return tt.modelCube(indexInKind);
        case 'humanoid':
          return tt.modelHuman(indexInKind);
        case 'cylinder':
          return tt.modelCylinder(indexInKind);
        case 'cone':
          return tt.modelCone(indexInKind);
        case 'table':
          return tt.modelTable(indexInKind);
        case 'chair':
          return tt.modelChair(indexInKind);
        default:
          return '';
      }
    },
    [tt]
  );

  const aspectOptions = useMemo(
    () =>
      [
        { id: 'adaptive', label: tt.aspectAdaptive },
        { id: '16_9', label: tt.aspect169 },
        { id: '9_16', label: tt.aspect916 },
        { id: '1_1', label: tt.aspect11 },
        { id: '4_3', label: tt.aspect43 },
        { id: '3_4', label: tt.aspect34 },
        { id: '3_2', label: tt.aspect32 },
        { id: '21_9', label: tt.aspect219 },
        { id: '235_100', label: tt.aspect235 },
      ] as const,
    [tt]
  );

  const listRows = useMemo(() => {
    const c = {
      sphere: 0,
      cube: 0,
      cylinder: 0,
      cone: 0,
      humanoid: 0,
      table: 0,
      chair: 0,
    };
    return items.map((it) => {
      c[it.kind]++;
      const idx = c[it.kind];
      const sc = it.scale.toFixed(1);
      const rx = eulerRadToDeg360Rounded(it.rotation[0]);
      const ry = eulerRadToDeg360Rounded(it.rotation[1]);
      const rz = eulerRadToDeg360Rounded(it.rotation[2]);
      const poseExtra =
        it.kind === 'humanoid' && it.humanoidBuild === 'thin' ? ` · ${tt.humanoidBuildThin}` : '';
      return { item: it, title: labelFor(it, idx), sub: tt.itemPlacementDetail(sc, rx, ry, rz, poseExtra) };
    });
  }, [items, labelFor, tt]);

  const clearScene = useCallback(() => {
    setItems([]);
    setSelectedId(null);
    setPendingKind(null);
    setPendingHumanoidColor(HUMANOID_RAINBOW[3]);
    setPendingPose({});
    setPendingHumanoidBuild('standard');
  }, []);

  const setHumanoidScale = useCallback((next: number) => {
    if (!selectedId) return;
    const s = clampHumanoidScale(next);
    setItems((prev) =>
      prev.map((it) =>
        it.id === selectedId && it.kind === 'humanoid' ? { ...it, scale: s } : it
      )
    );
  }, [selectedId]);

  const selectedItem = useMemo(() => items.find((i) => i.id === selectedId), [items, selectedId]);
  const isBlockHumanoidSelected = selectedItem?.kind === 'humanoid';
  const isPanoFigureSelected = selectedItem?.kind === 'humanoid';
  const selectedFigureScale = isPanoFigureSelected ? selectedItem!.scale : null;

  const effectiveOpenPose = useMemo((): Required<PanoHumanoidPose> => {
    const base = { ...DEFAULT_PANO_HUMANOID_POSE };
    if (selectedItem?.kind === 'humanoid') return { ...base, ...selectedItem.pose };
    return { ...base, ...pendingPose };
  }, [selectedItem, pendingPose]);

  const openPoseEnabled = pendingKind === 'humanoid' || isBlockHumanoidSelected;

  const effectiveHumanoidBuild = useMemo((): PanoHumanoidBuild => {
    if (pendingKind === 'humanoid') return pendingHumanoidBuild;
    if (selectedItem?.kind === 'humanoid') return selectedItem.humanoidBuild ?? 'standard';
    return 'standard';
  }, [selectedItem, pendingKind, pendingHumanoidBuild]);

  useEffect(() => {
    if (pendingKind != null) return;
    if (selectedItem?.kind === 'humanoid') {
      setPendingHumanoidBuild(selectedItem.humanoidBuild ?? 'standard');
    }
  }, [pendingKind, selectedItem?.kind, selectedItem?.id, selectedItem?.humanoidBuild]);

  const setHumanoidBuild = useCallback(
    (b: PanoHumanoidBuild) => {
      setPendingHumanoidBuild(b);
      if (pendingKind === 'humanoid') return;
      if (selectedId && selectedItem?.kind === 'humanoid') {
        setItems((prev) =>
          prev.map((it) => (it.id === selectedId && it.kind === 'humanoid' ? { ...it, humanoidBuild: b } : it))
        );
      }
    },
    [selectedId, selectedItem?.kind, pendingKind, setItems]
  );

  const setOpenPoseField = useCallback(
    (key: keyof PanoHumanoidPose, v: number) => {
      if (selectedId && selectedItem?.kind === 'humanoid') {
        setItems((prev) =>
          prev.map((it) =>
            it.id === selectedId && it.kind === 'humanoid' ? { ...it, pose: { ...(it.pose || {}), [key]: v } } : it
          )
        );
      } else {
        setPendingPose((prev) => ({ ...prev, [key]: v }));
      }
    },
    [selectedId, selectedItem?.kind, setItems]
  );

  const resetOpenPose = useCallback(() => {
    setOpenPoseSliderLayoutKey((k) => k + 1);
    setPendingPose({});
    if (selectedId && selectedItem?.kind === 'humanoid') {
      setItems((prev) =>
        prev.map((it) => (it.id === selectedId && it.kind === 'humanoid' ? { ...it, pose: {} } : it))
      );
    }
  }, [selectedId, selectedItem?.kind, setItems]);

  const eulerDeg = useMemo(() => {
    if (!selectedItem) return { x: 0, y: 0, z: 0 };
    return {
      x: eulerRadToDeg0to360Float(selectedItem.rotation[0]),
      y: eulerRadToDeg0to360Float(selectedItem.rotation[1]),
      z: eulerRadToDeg0to360Float(selectedItem.rotation[2]),
    };
  }, [selectedItem]);

  const setEulerAxis = useCallback((axis: 0 | 1 | 2, deg: number) => {
    if (!selectedId) return;
    const wrapped = clampDeg0to360(deg);
    const rad = (wrapped * Math.PI) / 180;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== selectedId) return it;
        const next = [...it.rotation] as [number, number, number];
        next[axis] = rad;
        return { ...it, rotation: next };
      })
    );
  }, [selectedId]);
  const activeHumanoidColor =
    pendingKind === 'humanoid'
      ? pendingHumanoidColor
      : selectedItem?.kind === 'humanoid'
        ? selectedItem.color
        : pendingHumanoidColor;

  const saveCurrentOpenPosePreset = useCallback(() => {
    if (!openPoseEnabled) return;
    const pose = { ...effectiveOpenPose };
    const build = effectiveHumanoidBuild;
    const figureColor = activeHumanoidColor;
    const preset: PanoOpenPosePresetStored = {
      id: newId(),
      name: tt.openposePresetName(openPosePresets.length + 1),
      pose,
      build,
      figureColor,
    };
    setOpenPosePresets((prev) => [...prev, preset]);
  }, [
    openPoseEnabled,
    effectiveOpenPose,
    effectiveHumanoidBuild,
    activeHumanoidColor,
    openPosePresets.length,
    tt,
  ]);

  const applyOpenPosePreset = useCallback(
    (preset: PanoOpenPosePresetStored) => {
      setOpenPoseSliderLayoutKey((k) => k + 1);
      setPendingHumanoidBuild(preset.build);
      const col = preset.figureColor;
      if (col) setPendingHumanoidColor(col);
      const pose: PanoHumanoidPose = { ...preset.pose };
      if (selectedId && selectedItem?.kind === 'humanoid') {
        setItems((prev) =>
          prev.map((it) =>
            it.id === selectedId && it.kind === 'humanoid'
              ? { ...it, pose, humanoidBuild: preset.build, ...(col ? { color: col } : {}) }
              : it
          )
        );
      } else {
        setPendingPose(pose);
      }
    },
    [selectedId, selectedItem?.kind, setItems]
  );

  const deleteOpenPosePreset = useCallback((presetId: string) => {
    setOpenPosePresets((prev) => prev.filter((p) => p.id !== presetId));
  }, []);

  const applyHumanoidSurface = useCallback((key: string) => {
    setPendingHumanoidColor(key);
    if (selectedItem?.kind === 'humanoid' && selectedId) {
      setItems((prev) =>
        prev.map((x) => (x.id === selectedId && x.kind === 'humanoid' ? { ...x, color: key } : x))
      );
    }
  }, [selectedId, selectedItem?.kind]);

  const handleOutput = useCallback(() => {
    const fn = saveRef.current;
    if (!fn) return;
    const dataUrl = fn();
    if (dataUrl) onOutput(dataUrl);
  }, [onOutput]);

  const dark = isDarkMode;
  const bg = dark ? 'bg-transparent' : 'bg-slate-100';
  const bar = dark ? 'border-white/[0.08] bg-black/25 backdrop-blur-md' : 'bg-white/95 backdrop-blur-sm border-b border-black/10';
  const text = dark ? 'text-white/90' : 'text-gray-900';
  const muted = dark ? 'text-white/45' : 'text-gray-600';
  const side = dark ? 'border-white/[0.08] bg-black/20' : 'apple-panel-light border-l border-gray-200';
  const leftSide = dark ? 'border-white/[0.08] bg-black/20' : 'apple-panel-light border-r border-gray-200';

  const humanoidTintUiActive = pendingKind === 'humanoid' || isBlockHumanoidSelected;

  if (!textureUrl.trim()) return null;

  return (
    <div className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden ${bg}`}>
      <div className={`flex min-h-0 flex-1 flex-row overflow-hidden`}>
        <aside className={`flex w-[min(100%,220px)] flex-shrink-0 flex-col overflow-hidden ${leftSide}`}>
          <div className={`flex-shrink-0 border-b p-2.5 ${dark ? 'border-white/[0.08]' : 'border-gray-200'}`}>
            <div className="mb-1.5">
              <span className={panoStudioSectionTitle(dark)}>{tt.openposePresetColumnTitle}</span>
            </div>
            <button
              type="button"
              disabled={!openPoseEnabled}
              onClick={saveCurrentOpenPosePreset}
              className={`inline-flex w-full items-center justify-center gap-1.5 px-2.5 py-2 text-[10px] font-medium ${
                openPoseEnabled
                  ? dark
                    ? 'rounded-lg border border-violet-500/40 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25'
                    : 'rounded-lg border border-violet-500/35 bg-violet-50 text-violet-900 hover:bg-violet-100'
                  : dark
                    ? `${panoStudioGhostBtn(dark)} cursor-not-allowed opacity-40`
                    : 'cursor-not-allowed rounded-lg border border-gray-200 bg-gray-100 text-gray-400'
              }`}
            >
              <BookmarkPlus className="h-3.5 w-3.5 shrink-0" />
              {tt.openposeSavePreset}
            </button>
          </div>
          <div className={`min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 ${dark ? 'pano-placement-panel-scroll' : 'custom-scrollbar'}`}>
            {openPosePresets.map((p) => (
              <div
                key={p.id}
                className={`flex flex-col gap-1.5 rounded-lg border p-2 ${
                  dark ? 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]' : 'border-gray-200 bg-white'
                }`}
              >
                <OpenPosePresetThumbCanvas
                  pose={p.pose}
                  figureColor={p.figureColor ?? HUMANOID_RAINBOW[3]}
                  bodyBuild={p.build}
                  dark={dark}
                />
                <div className={`min-w-0 truncate text-[10px] font-medium ${text}`} title={p.name}>
                  {p.name}
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => applyOpenPosePreset(p)}
                    className={`rounded-md px-2 py-0.5 text-[9px] font-medium transition-colors ${
                      dark
                        ? 'border border-emerald-400/50 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
                        : 'border border-emerald-500/35 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                    }`}
                  >
                    {tt.openposeApplyPreset}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteOpenPosePreset(p.id)}
                    className={`rounded-md px-2 py-0.5 text-[9px] font-medium transition-colors ${
                      dark
                        ? 'bg-red-500/15 text-red-200 hover:bg-red-500/25'
                        : 'bg-red-50 text-red-700 hover:bg-red-100'
                    }`}
                  >
                    {tt.openposeDeletePreset}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
        <div ref={centerPanelRef} className={`flex min-h-0 min-w-0 flex-1 flex-col`}>
          <div className="flex min-h-0 flex-1 w-full items-center justify-center overflow-hidden px-2 pb-2 pt-2">
            <div
              ref={canvasWrapRef}
              className={`relative ${aspectPreviewLayoutClassForId(aspectId)} overflow-hidden rounded-xl ${
                dark
                  ? 'bg-black/30 ring-1 ring-inset ring-white/12 shadow-2xl shadow-black/50'
                  : 'bg-slate-200/80 ring-1 ring-inset ring-black/5'
              }`}
              title={tt.fovBarHint}
            >
            <Canvas
              className="absolute inset-0 h-full w-full touch-none"
              gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
              camera={{ position: [0, 0.05, DEFAULT_VIEW_DISTANCE], fov: panoFov, near: 0.001, far: 100 }}
              dpr={[1, 2]}
              onPointerMissed={() => {
                if (!pendingKind) setSelectedId(null);
              }}
            >
              <PlacementScene
                textureUrl={textureUrl}
                fov={panoFov}
                items={items}
                setItems={setItems}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                pendingKind={pendingKind}
                setPendingKind={setPendingKind}
                saveRef={saveRef}
                orbitResetRef={orbitResetRef}
                aspectIdRef={aspectIdRef}
                pendingHumanoidColor={pendingHumanoidColor}
                pendingPose={pendingPose}
                pendingHumanoidBuild={pendingHumanoidBuild}
                viewDistance={viewDistance}
                setViewDistance={setViewDistance}
              />
            </Canvas>
            </div>
          </div>

          <div className={`flex flex-shrink-0 flex-col gap-1 px-4 py-2 ${bar}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className={`flex-shrink-0 text-[10px] font-medium ${muted}`}>FOV</span>
                <input
                  type="range"
                  min={MIN_FOV}
                  max={MAX_FOV}
                  step={0.2}
                  value={panoFov}
                  onChange={(e) => setPanoFov(Number(e.target.value))}
                  className="h-2 min-w-0 flex-1 cursor-pointer accent-violet-500"
                  aria-label="FOV"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setPanoFov(DEFAULT_FOV);
                  setViewDistance(DEFAULT_VIEW_DISTANCE);
                  try {
                    orbitResetRef.current?.();
                  } catch {
                    /* ignore */
                  }
                }}
                className={`flex flex-shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[11px] ${panoStudioGhostBtn(dark)}`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {tt.resetView}
              </button>
            </div>
          </div>
        </div>

        <aside className={`flex w-[min(100%,340px)] flex-shrink-0 flex-col overflow-hidden min-h-0 ${side}`}>
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden border-b ${dark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className={`flex-shrink-0 p-2 ${dark ? '' : ''}`}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className={panoStudioSectionTitle(dark)}>{tt.sidebarPlacementTitle}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  title={tt.shapeHuman}
                  onClick={() => setPendingKind((p) => (p === 'humanoid' ? null : 'humanoid'))}
                  className={`inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[9px] font-medium ${
                    pendingKind === 'humanoid'
                      ? panoStudioVioletActive(dark)
                      : panoStudioGhostBtn(dark)
                  }`}
                >
                  <UserRound className="h-3 w-3 shrink-0" />
                  <span>{tt.shapeHuman}</span>
                </button>
                <button
                  type="button"
                  title={st.clear}
                  onClick={clearScene}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-1.5 py-1 text-[9px] text-red-200 transition-colors hover:bg-red-500/25"
                >
                  <Trash2 className="h-3 w-3 shrink-0" />
                  <span>{st.clear}</span>
                </button>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div
                className={`w-full min-w-0 rounded-lg border p-1.5 ${
                  dark ? 'border-white/[0.08] bg-black/25' : 'border-gray-200 bg-gray-50/80'
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span className={`text-[9px] font-medium ${text}`}>{tt.openposeSection}</span>
                  <div className="flex items-center gap-1">
                    {openPoseEnabled ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setHumanoidBuild('standard')}
                          className={`rounded px-1.5 py-0.5 text-[8px] font-medium transition-colors ${
                            effectiveHumanoidBuild === 'standard'
                              ? panoStudioVioletActive(dark)
                              : dark
                                ? 'bg-white/[0.06] text-white/75 hover:bg-white/10'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {tt.humanoidBuildStandard}
                        </button>
                        <button
                          type="button"
                          onClick={() => setHumanoidBuild('thin')}
                          className={`rounded px-1.5 py-0.5 text-[8px] font-medium transition-colors ${
                            effectiveHumanoidBuild === 'thin'
                              ? panoStudioVioletActive(dark)
                              : dark
                                ? 'bg-white/[0.06] text-white/75 hover:bg-white/10'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {tt.humanoidBuildThin}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      disabled={!openPoseEnabled}
                      onClick={resetOpenPose}
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] transition-colors ${
                        openPoseEnabled
                          ? dark
                            ? 'text-violet-200/90 hover:bg-white/10'
                            : 'text-violet-700 hover:bg-gray-200'
                          : 'cursor-not-allowed opacity-40'
                      }`}
                    >
                      {tt.openposeReset}
                    </button>
                  </div>
                </div>
                <div className="w-full min-w-0">
                  <OpenPose3DPanel
                    pose={effectiveOpenPose}
                    figureColor={activeHumanoidColor}
                    disabled={!openPoseEnabled}
                    dark={dark}
                    bodyBuild={effectiveHumanoidBuild}
                    sliderLayoutKey={openPoseSliderLayoutKey}
                    labels={{
                      hint: tt.openposeDragHint,
                      headLabel: tt.openPoseHeadLabel,
                      sliderFrontBack: tt.openPoseSliderFrontBack,
                      sliderLeftRight: tt.openPoseSliderLeftRight,
                      sliderTwist: tt.openPoseSliderTwist,
                      sliderHint: tt.openposeSliderHint,
                      neck: tt.openposeNeck,
                      waist: tt.openposeWaist,
                      lArm: tt.openposeArmL,
                      rArm: tt.openposeArmR,
                      lElbow: tt.openposeElbowL,
                      rElbow: tt.openposeElbowR,
                      lKnee: tt.openposeKneeL,
                      rKnee: tt.openposeKneeR,
                      thighL: tt.openposeThighL,
                      thighR: tt.openposeThighR,
                      ankleL: tt.openposeAnkleL,
                      ankleR: tt.openposeAnkleR,
                    }}
                    onField={setOpenPoseField}
                  />
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <MixerVerticalScale
                label={tt.humanoidScaleSection}
                value={selectedFigureScale ?? 1}
                disabled={!isPanoFigureSelected}
                dark={dark}
                onChange={setHumanoidScale}
              />
              <div className="min-w-0 flex-1 border-l pl-2 dark:border-white/[0.08]">
                <div className={`mb-1 ${panoStudioSectionTitle(dark)}`}>{tt.rotationSection}</div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      [0, tt.rotationAxisX, tt.rotationAxisXTitle, eulerDeg.x] as const,
                      [1, tt.rotationAxisY, tt.rotationAxisYTitle, eulerDeg.y] as const,
                      [2, tt.rotationAxisZ, tt.rotationAxisZTitle, eulerDeg.z] as const,
                    ] as const
                  ).map(([axisIdx, label, axisTitle, degVal]) => (
                    <div key={axisIdx} className="flex flex-col items-center gap-0.5">
                      <span className={`text-[8px] ${muted}`}>{label}</span>
                      <PhotoCollageRotationKnob
                        value={degVal}
                        disabled={!selectedItem}
                        isDarkMode={dark}
                        size={28}
                        title={axisTitle}
                        onChange={(d) => setEulerAxis(axisIdx, clampDeg0to360(d))}
                      />
                      <span className={`text-[9px] tabular-nums ${muted}`}>{Math.round(degVal)}°</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div
              className={`mt-1.5 border-t pt-1.5 ${dark ? 'border-white/10' : 'border-gray-200'} ${
                !humanoidTintUiActive ? 'pointer-events-none opacity-40' : ''
              }`}
            >
              <div className={`mb-0.5 text-[9px] ${muted}`}>{tt.humanoidColorLabel}</div>
              <div className="flex flex-wrap gap-1">
                {HUMANOID_RAINBOW.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    title={hex}
                    onClick={() => applyHumanoidSurface(hex)}
                    className={`h-5 w-5 shrink-0 rounded-full border transition-transform hover:scale-105 ${
                      activeHumanoidColor.toLowerCase() === hex.toLowerCase()
                        ? `border-white ring-1 ring-violet-400 ${dark ? 'ring-offset-1 ring-offset-zinc-950' : 'ring-offset-1 ring-offset-white'}`
                        : dark
                          ? 'border-white/25'
                          : 'border-gray-300'
                    }`}
                    style={{ backgroundColor: hex }}
                    aria-label={hex}
                  />
                ))}
                <button
                  type="button"
                  title={tt.humanoidSurfaceWhite}
                  onClick={() => applyHumanoidSurface(HUMANOID_SURFACE_WHITE)}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-transform hover:scale-105 ${
                    activeHumanoidColor === HUMANOID_SURFACE_WHITE
                      ? `border-white ring-1 ring-violet-400 ${dark ? 'ring-offset-1 ring-offset-zinc-950' : 'ring-offset-1 ring-offset-white'}`
                      : dark
                        ? 'border-white/25'
                        : 'border-gray-300'
                  }`}
                  style={{ backgroundColor: '#fafafa' }}
                  aria-label={tt.humanoidSurfaceWhite}
                />
                <button
                  type="button"
                  title={tt.humanoidSurfaceGlass}
                  onClick={() => applyHumanoidSurface(HUMANOID_SURFACE_GLASS)}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-transform hover:scale-105 ${
                    activeHumanoidColor === HUMANOID_SURFACE_GLASS
                      ? `border-white ring-1 ring-violet-400 ${dark ? 'ring-offset-1 ring-offset-zinc-950' : 'ring-offset-1 ring-offset-white'}`
                      : dark
                        ? 'border-white/25'
                        : 'border-gray-300'
                  }`}
                  style={{
                    background:
                      'linear-gradient(150deg, rgba(30,64,175,0.55) 0%, rgba(56,189,248,0.65) 40%, rgba(125,211,252,0.45) 100%)',
                  }}
                  aria-label={tt.humanoidSurfaceGlass}
                />
              </div>
            </div>
          </div>

          {items.length > 0 ? (
          <div className={`min-h-0 max-h-[72px] flex-shrink-0 overflow-y-auto px-2 py-1 ${dark ? 'pano-placement-panel-scroll' : 'custom-scrollbar'}`}>
            <div className={`mb-0.5 ${panoStudioSectionTitle(dark)}`}>{tt.placedListWithCount(items.length)}</div>
            <div className="flex flex-col gap-0.5">
              {listRows.map(({ item, title, sub }) => {
                const row = placedListRowChrome(item, selectedId === item.id, dark, text, muted);
                return (
                <div
                  key={item.id}
                  className={`flex cursor-pointer items-start justify-between gap-2 rounded-lg px-1.5 py-1 text-left text-[9px] ${row.containerClass}`}
                  style={row.containerStyle}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="min-w-0">
                    <div className={`truncate ${row.titleClass}`}>{title}</div>
                    <div className={`truncate ${row.subClass}`}>{sub}</div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
                    title={tt.deleteItem}
                    aria-label={tt.deleteItem}
                    onClick={(e) => {
                      e.stopPropagation();
                      setItems((prev) => prev.filter((x) => x.id !== item.id));
                      if (selectedId === item.id) setSelectedId(null);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                );
              })}
            </div>
          </div>
          ) : null}
          </div>

          <div className={`flex-shrink-0 space-y-1.5 border-t p-2 ${dark ? 'border-white/[0.08]' : 'border-gray-200'}`}>
            <div className="flex flex-col gap-0.5">
              <span className={panoStudioSectionTitle(dark)}>{tt.aspectLabel}</span>
              <PanelOptionDropdown
                value={aspectId}
                options={aspectOptions.map((o) => ({ value: o.id, label: o.label }))}
                onChange={setAspectId}
                isDarkMode={dark}
                title={tt.aspectLabel}
                minWidthPx={120}
                triggerVariant="collage"
                className="w-full"
              />
            </div>
            <button
              type="button"
              onClick={handleOutput}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                dark
                  ? 'border border-sky-400/35 bg-sky-500/15 text-sky-200 shadow-md shadow-black/20 ring-1 ring-white/10 hover:bg-sky-500/25'
                  : 'border border-sky-500/35 bg-sky-50 text-sky-900 hover:bg-sky-100'
              }`}
            >
              <ImageDown className="h-3.5 w-3.5" />
              {tt.outputToNode}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default Panorama360PlacementPanel;
