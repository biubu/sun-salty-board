// Cache of blob: URLs for clipboard image previews.
//
// Why we keep this in a module-level Map instead of `URL.createObjectURL`
// per <img> render:
//   * imageData bytes come over IPC already as a Uint8Array; we wrap once
//     in a Blob and create the URL once.
//   * When the underlying item is deleted / replaced, the renderer would
//     normally keep the URL alive until GC; we explicitly revoke on
//     imageUnref so memory doesn't grow unbounded with copy/paste usage.
//   * WeakMap isn't enough because Blob → URL is one-way — we need a
//     deterministic lookup by Uint8Array reference.
const urlCache = new WeakMap<Uint8Array, string>()
const refCounts = new WeakMap<Uint8Array, number>()

/**
 * Get a blob URL for an image buffer, bumping its refcount. The caller must
 * call imageUnref when the URL is no longer needed (component unmount,
 * cache eviction, etc).
 */
export function imageRef(buf: Uint8Array, mime?: string): string {
  const existing = urlCache.get(buf)
  if (existing) {
    refCounts.set(buf, (refCounts.get(buf) ?? 0) + 1)
    return existing
  }
  // mime default is image/png because clipboard images on most platforms
  // are PNGs; storage layer also stamps the actual detected mime.
  // Wrap the bytes in a fresh Uint8Array<ArrayBuffer> so the BlobPart type
  // narrows regardless of whether `buf.buffer` is an ArrayBuffer or
  // SharedArrayBuffer (TS 5.7 lib.dom tightened this).
  const view = new Uint8Array(buf.byteLength)
  view.set(buf)
  const url = URL.createObjectURL(new Blob([view], { type: mime || 'image/png' }))
  urlCache.set(buf, url)
  refCounts.set(buf, 1)
  return url
}

/**
 * Decrement the refcount and revoke the blob URL when it hits zero.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export function imageUnref(buf: Uint8Array): void {
  const n = (refCounts.get(buf) ?? 0) - 1
  if (n > 0) {
    refCounts.set(buf, n)
    return
  }
  refCounts.delete(buf)
  const url = urlCache.get(buf)
  if (url) {
    urlCache.delete(buf)
    URL.revokeObjectURL(url)
  }
}
