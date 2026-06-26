declare module '@pricing/price_calculator.mjs' {
  export class ModelNotPricedError extends Error {
    modelId: string;
    category: 'image' | 'video' | 'audio' | 'reverse';
  }
  export function isModelNotPricedError(e: unknown): boolean;
  export function getImagePrice(
    params: { model: string; resolution?: string },
    opts?: { applyMarkup?: boolean },
  ): number;
  export function getVideoPrice(params: Record<string, unknown>, opts?: { applyMarkup?: boolean }): number;
  export function getImageReversePrice(model: string, opts?: { applyMarkup?: boolean }): number;
  export function getAudioPrice(model: string, opts?: { applyMarkup?: boolean }): number;
  export function getNodePrice(
    nodeType: string,
    data: Record<string, unknown> | undefined,
    opts?: { applyMarkup?: boolean },
  ): number | null;
  export function getCloudDeductYuanbao(
    taskType: 'llm' | 'image' | 'video' | 'audio',
    env?: Record<string, string | undefined>,
  ): number;
  /** 零售价（元）→ 元宝整数，默认每元 50 元宝，与 FC 一致 */
  export function cnyRetailToYuanbaoInt(
    cny: number,
    env?: Record<string, string | undefined>,
  ): number;
  /** base_price×multiplier×yuanbao_rate×quantity → 元宝 */
  export function yuanbaoCostFromTableDimensions(
    basePrice: number,
    multiplier: number,
    yuanbaoRate: number,
    quantity: number,
  ): number | null;
}
