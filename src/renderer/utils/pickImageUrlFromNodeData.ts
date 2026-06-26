/** 从 Image 节点 data 取可用于预览/上传的图片 URL */
export function pickImageUrlFromNodeData(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const asset = data.imageAsset as { preview?: string; original?: string } | undefined;
  if (asset?.preview) return asset.preview;
  if (asset?.original) return asset.original;
  return (
    (data.outputImage as string) ||
    (data.originalImageUrl as string) ||
    (Array.isArray(data.outputImages) && (data.outputImages[0] as string)) ||
    (Array.isArray(data.inputImages) && (data.inputImages[0] as string)) ||
    ''
  );
}
