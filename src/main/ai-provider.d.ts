/** 取消进行中的 FC LLM（导演/LLM 节点取消） */
export function abortInFlightFcLlm(): { aborted: boolean };

export function callFCGenericTask(opts: {
  type?: string;
  taskId: string;
  billing?: string;
  /** FC 退款流水备注（与 ai-provider.js 根级字段一致） */
  refundReason?: string;
  billingModelId?: string;
  /** RunningHub 站点：ai=海外 / cn=国内 */
  rhRegion?: 'cn' | 'ai';
  forward?: {
    provider: string;
    path: string;
    method?: string;
    body?: unknown;
    rhRegion?: 'cn' | 'ai';
  };
  body?: Record<string, unknown>;
}): Promise<{ data: Record<string, unknown>; balance?: number }>;

export function callFCChat(opts: {
  messages: unknown[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: unknown;
}): Promise<{ content: string; balance: number; finishReason?: string }>;
