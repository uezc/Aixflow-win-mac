/**
 * 云端任务追踪：tasks/create 后主进程通知渲染进程开始轮询 /tasks/status
 */
export type NxCloudTrackTaskPayload = {
  taskId: string;
  nodeId: string;
  taskType: 'image' | 'video' | 'audio' | 'llm';
  /** POST /tasks/create 返回的最新元宝，便于渲染进程与顶栏立即同步 */
  balance?: number;
};

type Sender = (payload: NxCloudTrackTaskPayload) => void;

let sendToRenderer: Sender | null = null;

export function setNxCloudTaskTrackSender(fn: Sender | null): void {
  sendToRenderer = fn;
}

export function notifyNxCloudTaskTrack(payload: NxCloudTrackTaskPayload): void {
  if (!sendToRenderer || !payload?.taskId || !payload?.nodeId) return;
  try {
    sendToRenderer(payload);
  } catch {
    /* ignore */
  }
}
