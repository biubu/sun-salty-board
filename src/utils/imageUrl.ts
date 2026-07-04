// Blob URL registry for clipboard image previews.
//
// The previous implementation kept WeakMap-keyed refcounts to share a
// single URL.createObjectURL per Uint8Array across remounts. Two problems:
//
//   * The BLOB itself is held strongly in the parent component's state
//     (every item in \`App.items\`), so the WeakMap key never became
//     unreachable and the cached URL was never revoked. The "shared"
//     registry effectively leaked one blob per ever-shown image.
//   * useEffect cleanup driving imageUnref was tied to react-window's
//     virtualised row recycling: when a row was reused for a different
//     item, the refcount math drifted and URLs accumulated.
//
// The renderer has 100 rows tops and Chromium Blob ctor is
// effectively free for a Uint8Array view, so we drop the cache
// entirely: every mount creates a fresh blob URL, every unmount
// revokes it. No globals, no refcount, no leaks.

/**
 * Build a blob: URL for the given image bytes. The URL is owned by the
 * caller and MUST be revoked via imageUnref() when no longer needed
 * (e.g. when the corresponding component unmounts).
 */
export function imageRef(buf: Uint8Array, mime?: string): string {
  // Bytes can come over IPC as either an ArrayBuffer-backed view or
  // (rarely) a SharedArrayBuffer-backed view. The Blob constructor wants
  // the former; copy in the narrow case so we don't crash a future
  // render path that hands us one.
  let blobPart: BlobPart
  if (buf.buffer instanceof ArrayBuffer) {
    blobPart = buf as Uint8Array<ArrayBuffer>
  } else {
    const copy = new Uint8Array(buf.byteLength)
    copy.set(buf)
    blobPart = copy
  }
  return URL.createObjectURL(new Blob([blobPart], { type: mime || 'image/png' }))
}

/**
 * Release a blob URL previously returned by imageRef(). Idempotent —
 * calling it twice is safe (Chromium silently no-ops a second revoke).
 */
export function imageUnref(url: string): void {
  URL.revokeObjectURL(url)
}
