import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  Box,
  Circle,
  Cylinder,
  Cone,
  UserRound,
  Table,
  Armchair,
  Trash2,
  Maximize2,
  Minimize2,
  ImageDown,
} from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { spatialComposition3DT } from '../../i18n/spatialComposition3DI18n';

type PaletteLabelKey = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'humanoid' | 'table' | 'chair';

const PRESET = ['#7c3aed', '#22c55e', '#eab308', '#3b82f6', '#f97316', '#ec4899', '#06b6d4', '#94a3b8'];

export type SceneObjectKind = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'humanoid' | 'table' | 'chair';

export interface SceneItem {
  id: string;
  kind: SceneObjectKind;
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `o-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const KIND_BASE_Y: Record<SceneObjectKind, number> = {
  cube: 0.5,
  sphere: 0.52,
  cylinder: 0.55,
  cone: 0.525,
  /** 人形本地坐标脚底在 y≈0，整体略抬避免与网格 z-fight */
  humanoid: 0.02,
  table: 0.42,
  chair: 0.48,
};

function randomColor() {
  return PRESET[Math.floor(Math.random() * PRESET.length)]!;
}

function HumanoidMesh({ color }: { color: string }) {
  const c = color;
  const legC = '#3d5a80';
  const legH = 0.52;
  const legR = 0.068;
  const legY = legH / 2;
  const armR = 0.048;
  const armLen = 0.42;
  const torsoH = 0.46;
  const torsoY = legH + torsoH / 2;
  const shoulderY = legH + torsoH - 0.02;
  const armCenterY = shoulderY - armLen / 2;
  const armX = 0.17 + armR + 0.01;
  const headR = 0.15;
  const headY = legH + torsoH + headR;
  return (
    <group>
      <mesh castShadow receiveShadow position={[-0.1, legY, 0]}>
        <cylinderGeometry args={[legR, legR, legH, 18]} />
        <meshStandardMaterial color={legC} roughness={0.52} metalness={0.04} />
      </mesh>
      <mesh castShadow receiveShadow position={[0.1, legY, 0]}>
        <cylinderGeometry args={[legR, legR, legH, 18]} />
        <meshStandardMaterial color={legC} roughness={0.52} metalness={0.04} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, torsoY, 0]}>
        <boxGeometry args={[0.34, torsoH, 0.2]} />
        <meshStandardMaterial color={c} roughness={0.42} metalness={0.06} />
      </mesh>
      <mesh castShadow receiveShadow position={[-armX, armCenterY, 0]}>
        <cylinderGeometry args={[armR, armR, armLen, 16]} />
        <meshStandardMaterial color={c} roughness={0.44} metalness={0.06} />
      </mesh>
      <mesh castShadow receiveShadow position={[armX, armCenterY, 0]}>
        <cylinderGeometry args={[armR, armR, armLen, 16]} />
        <meshStandardMaterial color={c} roughness={0.44} metalness={0.06} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, headY, 0]}>
        <sphereGeometry args={[headR, 28, 24]} />
        <meshStandardMaterial color={c} roughness={0.35} metalness={0.05} />
      </mesh>
    </group>
  );
}

function TableMesh() {
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

function ChairMesh() {
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

function KindMesh({ item }: { item: SceneItem }) {
  const { kind, color } = item;
  const mat = (rough: number) => (
    <meshStandardMaterial color={color} roughness={rough} metalness={0.08} />
  );
  switch (kind) {
    case 'cube':
      return (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          {mat(0.42)}
        </mesh>
      );
    case 'sphere':
      return (
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[0.52, 28, 28]} />
          {mat(0.35)}
        </mesh>
      );
    case 'cylinder':
      return (
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.45, 0.45, 1.1, 24]} />
          {mat(0.4)}
        </mesh>
      );
    case 'cone':
      return (
        <mesh castShadow receiveShadow>
          <coneGeometry args={[0.55, 1.05, 28]} />
          {mat(0.4)}
        </mesh>
      );
    case 'humanoid':
      return <HumanoidMesh color={color} />;
    case 'table':
      return <TableMesh />;
    case 'chair':
      return <ChairMesh />;
    default:
      return null;
  }
}

function SceneCapture({ saveRef }: { saveRef: React.MutableRefObject<(() => string | null) | null> }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    saveRef.current = () => {
      try {
        gl.render(scene, camera);
        return gl.domElement.toDataURL('image/png');
      } catch {
        return null;
      }
    };
    return () => {
      saveRef.current = null;
    };
  }, [gl, scene, camera, saveRef]);
  return null;
}

function SceneContent({
  items,
  setItems,
  selectedId,
  setSelectedId,
  pendingKind,
  setPendingKind,
  depthPreview,
  itemsRootRef,
  saveRef,
}: {
  items: SceneItem[];
  setItems: React.Dispatch<React.SetStateAction<SceneItem[]>>;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  pendingKind: SceneObjectKind | null;
  setPendingKind: (k: SceneObjectKind | null) => void;
  depthPreview: boolean;
  itemsRootRef: React.RefObject<THREE.Group>;
  saveRef: React.MutableRefObject<(() => string | null) | null>;
}) {
  const selectedGroupRef = useRef<THREE.Group | null>(null);
  const [transformObject, setTransformObject] = useState<THREE.Object3D | null>(null);

  useLayoutEffect(() => {
    setTransformObject(selectedId ? selectedGroupRef.current : null);
  }, [selectedId, items]);

  useEffect(() => {
    const root = itemsRootRef.current;
    if (!root || !depthPreview) return;
    const map = new Map<string, THREE.Material | THREE.Material[]>();
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) {
        map.set(m.uuid, m.material);
        m.material = new THREE.MeshDepthMaterial();
      }
    });
    return () => {
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh) {
          const prev = map.get(m.uuid);
          if (prev !== undefined) m.material = prev;
        }
      });
    };
  }, [depthPreview, items, itemsRootRef]);

  const syncSelectedFromObject = useCallback(() => {
    const o = selectedGroupRef.current;
    const sid = selectedId;
    if (!o || !sid) return;
    setItems((prev) =>
      prev.map((it) =>
        it.id === sid
          ? {
              ...it,
              position: [o.position.x, o.position.y, o.position.z],
              rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
            }
          : it
      )
    );
  }, [selectedId, setItems]);

  const addAt = (kind: SceneObjectKind, x: number, z: number) => {
    const y = KIND_BASE_Y[kind];
    const col =
      kind === 'humanoid'
        ? '#8ecae6'
        : kind === 'table'
          ? '#8b5a2b'
          : kind === 'chair'
            ? '#64748b'
            : randomColor();
    const item: SceneItem = {
      id: newId(),
      kind,
      position: [x, y, z],
      rotation: [0, Math.random() * Math.PI * 2, 0],
      color: col,
    };
    setItems((p) => [...p, item]);
    setSelectedId(item.id);
  };

  return (
    <>
      <color attach="background" args={['#1a1a22']} />
      <hemisphereLight intensity={0.55} groundColor="#334155" color="#e2e8f0" />
      <directionalLight castShadow position={[10, 18, 8]} intensity={1.15} shadow-mapSize={[2048, 2048]} />
      <Grid
        renderOrder={-1}
        position={[0, 0, 0]}
        infiniteGrid
        cellSize={0.5}
        sectionSize={2.5}
        fadeDistance={55}
        sectionColor="#5c5c6a"
        cellColor="#3f3f4a"
        sectionThickness={1}
        cellThickness={0.6}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.015, 0]}
        onClick={(e) => {
          e.stopPropagation();
          if (pendingKind) {
            addAt(pendingKind, e.point.x, e.point.z);
            setPendingKind(null);
          } else {
            setSelectedId(null);
          }
        }}
      >
        <planeGeometry args={[120, 120]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
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
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(item.id);
              }}
            >
              <KindMesh item={item} />
            </group>
          );
        })}
      </group>
      {transformObject && !depthPreview && (
        <TransformControls
          key={selectedId ?? 'none'}
          object={transformObject}
          mode="translate"
          onMouseUp={syncSelectedFromObject}
        />
      )}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={42}
        maxPolarAngle={Math.PI / 2 - 0.04}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
      <SceneCapture saveRef={saveRef} />
    </>
  );
}

export interface SpatialComposition3DPanelProps {
  isDarkMode?: boolean;
  onOutput: (dataUrl: string) => void;
  /** 外层弹窗是否全屏（由宿主如 Workspace 控制） */
  hostFullscreen?: boolean;
  onHostFullscreenChange?: (full: boolean) => void;
}

const PALETTE: { kind: SceneObjectKind; Icon: React.ComponentType<{ className?: string }>; labelKey: PaletteLabelKey }[] = [
  { kind: 'cube', Icon: Box, labelKey: 'cube' },
  { kind: 'sphere', Icon: Circle, labelKey: 'sphere' },
  { kind: 'cylinder', Icon: Cylinder, labelKey: 'cylinder' },
  { kind: 'cone', Icon: Cone, labelKey: 'cone' },
  { kind: 'humanoid', Icon: UserRound, labelKey: 'humanoid' },
  { kind: 'table', Icon: Table, labelKey: 'table' },
  { kind: 'chair', Icon: Armchair, labelKey: 'chair' },
];

const SpatialComposition3DPanel: React.FC<SpatialComposition3DPanelProps> = ({
  isDarkMode,
  onOutput,
  hostFullscreen = false,
  onHostFullscreenChange,
}) => {
  const { locale } = useAppLocale();
  const tt = useMemo(() => spatialComposition3DT(locale), [locale]);
  const [items, setItems] = useState<SceneItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<SceneObjectKind | null>(null);
  const [depthPreview, setDepthPreview] = useState(false);
  const [viewportExpanded, setViewportExpanded] = useState(false);
  const saveRef = useRef<(() => string | null) | null>(null);
  const itemsRootRef = useRef<THREE.Group>(null);
  const handleOutput = useCallback(() => {
    const fn = saveRef.current;
    if (!fn) return;
    const dataUrl = fn();
    if (dataUrl) onOutput(dataUrl);
  }, [onOutput]);

  const clearScene = () => {
    setItems([]);
    setSelectedId(null);
    setPendingKind(null);
  };

  const dark = isDarkMode ?? true;
  const panelBg = dark ? 'nexflow-glass-panel' : 'bg-slate-100';
  const textMuted = dark ? 'text-zinc-400' : 'text-slate-600';
  const btnBase = dark ? 'border-zinc-600 bg-zinc-800 hover:bg-zinc-700' : 'border-slate-200 bg-white hover:bg-slate-50';

  const viewportHeightClass = hostFullscreen
    ? 'h-full min-h-0 flex-1'
    : viewportExpanded
      ? 'h-[min(72vh,640px)]'
      : 'h-[min(42vh,380px)]';

  return (
    <div
      className={`flex flex-col overflow-hidden min-h-0 flex-1 ${hostFullscreen ? `h-full rounded-none border-0 ${dark ? 'bg-zinc-900' : 'bg-slate-50'}` : `rounded-xl border ${dark ? 'border-zinc-700' : 'border-slate-200'} ${panelBg}`}`}
    >
      <div className={`relative min-h-[220px] ${hostFullscreen ? 'flex-1 min-h-0' : 'flex-shrink-0'} ${viewportHeightClass}`}>
        {!onHostFullscreenChange && (
          <button
            type="button"
            className={`absolute top-2 right-2 z-10 rounded-lg border p-1.5 ${dark ? 'border-zinc-600 bg-zinc-800/90' : 'border-slate-200 bg-white'} ${textMuted}`}
            title={tt.expandViewport}
            onClick={() => setViewportExpanded((v) => !v)}
          >
            {viewportExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}
        <div className={`absolute bottom-2 left-2 z-10 text-[11px] ${textMuted}`}>{tt.objectsCount(items.length)}</div>
        <Canvas
          className="h-full w-full"
          shadows
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          camera={{ position: [11, 9, 11], fov: 42, near: 0.1, far: 200 }}
          onPointerMissed={() => {
            if (!pendingKind) setSelectedId(null);
          }}
        >
          <SceneContent
            items={items}
            setItems={setItems}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            pendingKind={pendingKind}
            setPendingKind={setPendingKind}
            depthPreview={depthPreview}
            itemsRootRef={itemsRootRef}
            saveRef={saveRef}
          />
        </Canvas>
      </div>

      <div className={`p-3 grid grid-cols-4 gap-2 flex-shrink-0 ${dark ? 'bg-zinc-900/80' : 'bg-slate-50'}`}>
        {PALETTE.map(({ kind, Icon, labelKey }) => {
          const active = pendingKind === kind;
          return (
            <button
              key={kind}
              type="button"
              title={tt[labelKey]}
              onClick={() => setPendingKind((k) => (k === kind ? null : kind))}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-[11px] transition-colors ${
                active ? 'border-sky-500 bg-sky-500/15 text-sky-200' : `${btnBase} ${textMuted}`
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{tt[labelKey]}</span>
            </button>
          );
        })}
        <button
          type="button"
          title={tt.clear}
          onClick={clearScene}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-[11px] transition-colors border-red-900/50 bg-red-950/30 text-red-200 hover:bg-red-950/50`}
        >
          <Trash2 className="w-5 h-5" />
          <span>{tt.clear}</span>
        </button>
      </div>

      <div className={`flex gap-2 px-3 pb-2 flex-shrink-0`}>
        <button
          type="button"
          onClick={() => setDepthPreview(false)}
          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
            !depthPreview ? (dark ? 'bg-zinc-700 text-white border-zinc-500' : 'bg-slate-800 text-white border-slate-700') : `${btnBase} ${textMuted}`
          }`}
        >
          {tt.materialShading}
        </button>
        <button
          type="button"
          onClick={() => setDepthPreview(true)}
          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
            depthPreview ? (dark ? 'bg-zinc-700 text-white border-zinc-500' : 'bg-slate-800 text-white border-slate-700') : `${btnBase} ${textMuted}`
          }`}
        >
          {tt.zDepthChannel}
        </button>
      </div>

      <div className="px-3 pb-3 flex-shrink-0">
        <button
          type="button"
          onClick={handleOutput}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold shadow ${
            dark ? 'bg-zinc-100 text-zinc-900 hover:bg-white' : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          <ImageDown className="w-4 h-4" />
          {tt.outputToNode}
        </button>
        <p className={`mt-2 text-center text-[10px] leading-relaxed ${textMuted}`}>{tt.controlsHint}</p>
        {pendingKind && <p className={`mt-1 text-center text-[10px] ${dark ? 'text-sky-300' : 'text-sky-700'}`}>{tt.placeHint}</p>}
      </div>
    </div>
  );
};

export default SpatialComposition3DPanel;
