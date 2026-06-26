/**
 * 画布渲染引擎：独立于 React 的画布 transform 矩阵管理。
 * 用于让 EdgeCanvasLayer 等画布渲染循环脱离 React 更新，由 RAF 驱动，
 * Pan/Zoom 时仅更新矩阵，不触发 React 状态更新。
 *
 * 按需渲染（ComfyUI 范式）：needsUpdate 控制是否继续 RAF 循环；
 * 画布静止时进入睡眠，CPU 占用降至 0%。
 */
export type TransformTuple = [number, number, number]; // [tx, ty, zoom]

const LERP_FACTOR = 1;
const LERP_THRESHOLD = 0.5; // current 与 target 差值小于此视为收敛

export class CanvasEngine {
  private _targetTransform: TransformTuple = [0, 0, 1];
  private _currentTransform: TransformTuple = [0, 0, 1];
  private _listeners = new Set<(t: TransformTuple, draggingNode: typeof this._draggingNode) => void>();
  private _requestUpdateListeners = new Set<() => void>();
  private _isPanning = false;
  private _draggingNode: { nodeId: string; x: number; y: number; width: number; height: number } | null = null;
  private _hasInitialSync = false;

  /** 按需渲染：为 true 时 RAF 继续，收敛且无交互时置 false 进入睡眠 */
  private _needsUpdate = true;

  /** 获取当前用于渲染的 transform（Lerp 插值后） */
  getTransform(): TransformTuple {
    return this._currentTransform;
  }

  /** 更新目标 transform，不触发 React 更新；实际渲染用 current（由 tick 插值） */
  setTransform(tx: number, ty: number, zoom: number): void {
    this._targetTransform = [tx, ty, zoom];
    if (!this._hasInitialSync) {
      this._currentTransform = [tx, ty, zoom];
      this._hasInitialSync = true;
    } else if (this._isPanning || this._draggingNode) {
      this._currentTransform = [tx, ty, zoom];
    }
    this.requestUpdate();
  }

  /** 请求重绘：将 needsUpdate 置 true 并唤醒订阅者（EdgeCanvasLayer 的 RAF 循环） */
  requestUpdate(): void {
    this._needsUpdate = true;
    this._requestUpdateListeners.forEach((fn) => fn());
  }

  /** 订阅重绘请求：requestUpdate 调用时触发，用于唤醒 RAF 循环 */
  subscribeToRequestUpdate(listener: () => void): () => void {
    this._requestUpdateListeners.add(listener);
    return () => this._requestUpdateListeners.delete(listener);
  }

  /** 每帧调用：Lerp 插值，current 平滑趋向 target；平移中直接同步，避免跟手滞后 */
  tick(): void {
    if (this._isPanning) {
      this._currentTransform = [...this._targetTransform] as TransformTuple;
    } else {
      for (let i = 0; i < 3; i++) {
        this._currentTransform[i] += (this._targetTransform[i] - this._currentTransform[i]) * LERP_FACTOR;
      }
    }
    this._listeners.forEach((fn) => fn(this._currentTransform, this._draggingNode));
  }

  /**
   * 检查是否可进入睡眠：Lerp 已收敛 且 无 pan/drag 交互。
   * 若可睡眠，将 needsUpdate 置 false 并返回 true。
   */
  trySleep(): boolean {
    if (this._isPanning || this._draggingNode) return false;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(this._targetTransform[i] - this._currentTransform[i]) >= LERP_THRESHOLD) return false;
    }
    this._needsUpdate = false;
    return true;
  }

  /** 当前是否需要继续渲染（供 RAF 循环判断是否 schedule 下一帧） */
  getNeedsUpdate(): boolean {
    return this._needsUpdate;
  }

  /** 从 React Flow 的 viewport 对象同步（写入 target） */
  syncFromViewport(viewport: { x: number; y: number; zoom: number }): void {
    this.setTransform(viewport.x, viewport.y, viewport.zoom);
  }

  /** 订阅 transform 变化（用于 HitLayer 等）；立即用当前值回调一次；每次 tick 通知 (transform, draggingNode) */
  subscribe(listener: (t: TransformTuple, draggingNode: { nodeId: string; x: number; y: number; width: number; height: number } | null) => void): () => void {
    this._listeners.add(listener as any);
    listener([...this._currentTransform], this._draggingNode);
    return () => this._listeners.delete(listener as any);
  }

  setPanning(v: boolean): void {
    this._isPanning = v;
  }

  getPanning(): boolean {
    return this._isPanning;
  }

  /** 节点拖拽期间设置实时位置，用于连接线重算与影子渲染 */
  setDraggingNode(nodeId: string | null, pos: { x: number; y: number; width?: number; height?: number } | null): void {
    if (!nodeId || !pos) {
      this._draggingNode = null;
      return;
    }
    this._draggingNode = {
      nodeId,
      x: pos.x,
      y: pos.y,
      width: pos.width ?? 300,
      height: pos.height ?? 200,
    };
  }

  getDraggingNode(): { nodeId: string; x: number; y: number; width: number; height: number } | null {
    return this._draggingNode;
  }

  /**
   * Flow 坐标转 Screen 坐标，Math.round 消除亚像素抖动（用于 HitLayer、剪刀等需对齐的位置）
   */
  flowToScreenPosition(flowX: number, flowY: number): { x: number; y: number } {
    const [tx, ty, zoom] = this._currentTransform;
    return {
      x: Math.round(flowX * zoom + tx),
      y: Math.round(flowY * zoom + ty),
    };
  }

  /**
   * Flow 转 Screen，保留亚像素精度，用于路径绘制以消除低缩放时的锯齿
   */
  flowToScreenPositionSmooth(flowX: number, flowY: number): { x: number; y: number } {
    const [tx, ty, zoom] = this._currentTransform;
    return {
      x: flowX * zoom + tx,
      y: flowY * zoom + ty,
    };
  }

  /**
   * Screen 坐标转 Flow 坐标，Math.round 消除亚像素抖动
   */
  screenToFlowPosition(screenX: number, screenY: number): { x: number; y: number } {
    const [tx, ty, zoom] = this._currentTransform;
    return {
      x: Math.round((screenX - tx) / zoom),
      y: Math.round((screenY - ty) / zoom),
    };
  }
}
