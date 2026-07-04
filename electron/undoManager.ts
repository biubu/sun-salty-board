// Multi-slot undo for clipboard item deletes.
//
// Previous implementation was a single-entry slot: when a user deleted two
// items in quick succession, only the second was undoable. We now keep a
// time-bounded stack:
//   * Each prepareUndo pushes an entry with an absolute expiry timestamp
//     (Date.now() + UNDO_WINDOW_MS).
//   * Stack is bounded; excess oldest entries are evicted silently.
//   * A single sweepOnAccess pass removes expired entries when we read.
//   * consumeUndo() returns and removes the most recent entry. If that one
//     expired, it falls through to the next freshest.
//
// This mirrors the 5s undo bar the renderer shows, so the UI and storage
// stay in sync: stale entries never resurface.
import type { ClipboardItem } from './worker'

export interface UndoEntry {
  id: number
  content: string
  content_html: string | null
  data_type: string
  image_data: Uint8Array | null
  image_mime: string | null
  file_paths: string | null
  source_app: string | null
  source_device: string | null
  is_favorite: number
  created_at: string
  // Category associations captured at delete-time. Stored as a comma-separated
  // list of ids so the JSON-shaped IPC payload stays simple (sql.js binds
  // arrays as TEXT); worker.ts parses it back when undoing.
  category_ids: number[]
}

const UNDO_WINDOW_MS = 5_000
const MAX_UNDO_ENTRIES = 8

let entries: Array<{ entry: UndoEntry; expiresAt: number }> = []

function sweepExpired(): void {
  const now = Date.now()
  if (entries.length === 0) return
  const fresh = entries.filter((e) => e.expiresAt > now)
  if (fresh.length !== entries.length) entries = fresh
}

export function prepareUndo(data: UndoEntry): void {
  const now = Date.now()
  // If the same item id is already pending (e.g. user clicked delete twice on
  // a row after a quick re-render), overwrite so we don't double-restore.
  const existingIdx = entries.findIndex((e) => e.entry.id === data.id)
  if (existingIdx !== -1) {
    entries[existingIdx] = { entry: data, expiresAt: now + UNDO_WINDOW_MS }
  } else {
    entries.push({ entry: data, expiresAt: now + UNDO_WINDOW_MS })
  }
  // Cap stack size: drop oldest if we're over the limit.
  if (entries.length > MAX_UNDO_ENTRIES) {
    entries = entries.slice(entries.length - MAX_UNDO_ENTRIES)
  }
}

export function getPendingUndo(): UndoEntry | null {
  sweepExpired()
  if (entries.length === 0) return null
  return entries[entries.length - 1].entry
}

export function consumeUndo(): UndoEntry | null {
  sweepExpired()
  if (entries.length === 0) return null
  return entries.pop()!.entry
}

export function clearPending(): void {
  entries = []
}

// Adapter: ClipboardItem → UndoEntry, kept here so worker.ts doesn't
// have to know about field naming.
export function clipboardItemToUndoEntry(item: ClipboardItem): UndoEntry {
  return {
    id: item.id,
    content: item.content,
    content_html: item.contentHtml ?? null,
    data_type: item.dataType,
    image_data: item.imageData ?? null,
    image_mime: item.imageMime ?? null,
    file_paths: item.filePaths ? JSON.stringify(item.filePaths) : null,
    source_app: item.sourceApp ?? null,
    source_device: item.sourceDevice ?? null,
    is_favorite: item.isFavorite ? 1 : 0,
    created_at: item.createdAt,
    category_ids: item.categoryIds ?? [],
  }
}
