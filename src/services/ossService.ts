import { checkWriteSafety, type ControlRegion } from './controlPlane.js';

type OssWriteInput = {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
};

/**
 * HK 单一生产写入口。所有 OSS 写入必须从此处进入。
 */
export async function writeOssObject(
  region: ControlRegion,
  writer: (input: OssWriteInput) => Promise<void>,
  input: OssWriteInput,
): Promise<void> {
  checkWriteSafety(region, 'write');
  await writer(input);
}

/**
 * // [BE-ONLY] Cold Storage / Legacy Archive - READ ONLY
 */
export async function readOssObject<T>(
  reader: () => Promise<T>,
): Promise<T> {
  return reader();
}
