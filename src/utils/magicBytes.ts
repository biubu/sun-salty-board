const MAGIC_BYTES: [number[], string][] = [
  [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'image/png'],
  [[0xFF, 0xD8, 0xFF], 'image/jpeg'],
  [[0x42, 0x4D], 'image/bmp'],
  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], 'image/gif'],
  [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'image/gif'],
  [[0x52, 0x49, 0x46, 0x46], 'image/webp'],
]

export function detectImageMimeType(data: Uint8Array | number[]): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  for (const [signature, mime] of MAGIC_BYTES) {
    if (signature.length > bytes.length) continue
    if (signature.every((b, i) => bytes[i] === b)) return mime
  }
  return 'image/png'
}

export function formatLabel(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/bmp': 'BMP',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
  }
  return map[mime] || 'Image'
}
