const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

export interface AttachmentPreview {
  url: string;
  kind: 'image' | 'pdf';
}

export function attachmentPreview(path: string, data: ArrayBuffer): AttachmentPreview | undefined {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  const mime = extension === 'pdf' ? 'application/pdf' : IMAGE_TYPES[extension];
  if (!mime || typeof URL.createObjectURL !== 'function') return undefined;

  return {
    url: URL.createObjectURL(new Blob([data], { type: mime })),
    kind: extension === 'pdf' ? 'pdf' : 'image',
  };
}
