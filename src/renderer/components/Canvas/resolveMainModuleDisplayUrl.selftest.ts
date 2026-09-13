/**
 * ImageNode 主图展示：显式 output 不得因「等于参考图 URL」被清空。
 * 运行：npx tsx src/renderer/components/Canvas/resolveMainModuleDisplayUrl.selftest.ts
 */

function formatImagePath(path: string): string {
  return String(path || '').trim().replace(/\\/g, '/');
}

/** 与 ImageNode.resolveMainModuleDisplayUrl 保持同序 */
function resolveMainModuleDisplayUrl(
  mergedPrimary: string,
  dataOutputImage: string | undefined,
  dataOutputImages: unknown[] | undefined,
  inputRefSet: Set<string>,
  hasIncomingImageSource: boolean,
): string {
  const primary = (mergedPrimary || '').trim();
  if (!primary) return '';

  const primaryKey = formatImagePath(primary);
  if (!inputRefSet.has(primaryKey)) return primary;

  const explicitKey = (dataOutputImage || '').trim()
    ? formatImagePath(String(dataOutputImage).trim())
    : '';
  if (explicitKey && explicitKey === primaryKey) return primary;

  const dataOutList = Array.isArray(dataOutputImages)
    ? dataOutputImages
        .map((u) => formatImagePath(String(u ?? '').trim()))
        .filter(Boolean)
    : [];
  if (dataOutList.length > 0 && dataOutList.includes(primaryKey)) return primary;

  if (hasIncomingImageSource) return '';
  return '';
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const refA = 'local-resource://D:/proj/ref-a.png';
const refB = 'local-resource://D:/proj/ref-b.png';
const outNew = 'local-resource://D:/proj/out-new.png';
const inputSet = new Set([formatImagePath(refA), formatImagePath(refB)]);

assert(
  resolveMainModuleDisplayUrl(outNew, outNew, [outNew], inputSet, true) === outNew,
  '新结果须展示',
);

assert(
  resolveMainModuleDisplayUrl(refB, refB, [refB], inputSet, true) === refB,
  '显式写入的 output（即便等于参考图）须展示，否则画布空 src→加载失败',
);

assert(
  resolveMainModuleDisplayUrl(refB, undefined, undefined, inputSet, true) === '',
  '仅参考图、无显式 output 时主模块仍隐藏',
);

assert(
  resolveMainModuleDisplayUrl(refB, undefined, undefined, inputSet, false) === '',
  '无上游连线且非显式 output 时也不展示裸参考图',
);

console.log('resolveMainModuleDisplayUrl.selftest: OK');
