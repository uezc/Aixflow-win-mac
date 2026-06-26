export function callFCGenericTask(opts: {
  type?: string;
  taskId: string;
  billing?: string;
  /** FC 退款流水备注（与 ai-provider.js 根级字段一致） */
  refundReason?: string;
  forward?: {
    provider: string;
    path: string;
    method?: string;
    body?: unknown;
  };
  body?: Record<string, unknown>;
}): Promise<{ data: Record<string, unknown>; balance?: number }>;

export function callFCChat(opts: {
  messages: unknown[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<{ content: string; balance: number }>;
