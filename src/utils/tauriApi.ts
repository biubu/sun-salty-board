import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ClipboardItem, Category, Settings } from '../types/clipboard'

interface RawClipboardItem {
  id: number
  type: number
  content: string | null
  rich_text?: string | null
  file_paths?: string | null
  image_data?: number[] | null
  image_mime?: string | null
  categories?: number[] | null
  favorite: boolean
  created_at: string
}

const DATA_TYPES = ['text', 'richtext', 'image', 'files'] as const

function mapItem(raw: RawClipboardItem): ClipboardItem {
  // The Rust side serialises `image_data` as a `Vec<u8>` which the IPC
  // channel deserialises into a plain JS array of numbers. Front-end code
  // expects a Uint8Array so it can hand the buffer to `Blob` directly.
  let imageData: Uint8Array | undefined
  if (raw.image_data && Array.isArray(raw.image_data)) {
    imageData = new Uint8Array(raw.image_data)
  }
  const typeIndex = DATA_TYPES[raw.type]
  return {
    id: raw.id,
    content: raw.content || '',
    contentHtml: raw.rich_text || undefined,
    dataType: typeIndex ?? 'text',
    filePaths: raw.file_paths
      ? raw.file_paths.split('\n').filter(Boolean)
      : undefined,
    imageData,
    imageMime: raw.image_mime || undefined,
    categoryIds: raw.categories || [],
    isFavorite: raw.favorite,
    createdAt: raw.created_at,
  }
}

function mapItems(raw: RawClipboardItem[]): ClipboardItem[] {
  return raw.map(mapItem)
}

export async function getHistory(): Promise<ClipboardItem[]> {
  const raw = await invoke<RawClipboardItem[]>('get_items', { limit: 10000, offset: 0 })
  return mapItems(raw)
}

export async function searchHistory(query: string): Promise<ClipboardItem[]> {
  const raw = await invoke<RawClipboardItem[]>('search_items', { query, limit: 100 })
  return mapItems(raw)
}

let pasteInFlight = false

// Cache the session type after the first lookup. The session doesn't
// change for the life of the process and the command is cheap, but we
// only need it once per mount of App.tsx so the cache avoids spamming
// the IPC channel on every paste.
let sessionTypeCache: SessionType | null = null

export type SessionType =
  | 'macos'
  | 'windows'
  | 'linux-x11'
  | 'linux-wayland'
  | 'linux-other'

export async function getSessionType(): Promise<SessionType> {
  if (sessionTypeCache) return sessionTypeCache
  const raw = await invoke<string>('get_session_type')
  const normalised: SessionType =
    raw === 'macos' || raw === 'windows' ||
    raw === 'linux-x11' || raw === 'linux-wayland' ||
    raw === 'linux-other'
      ? raw
      : 'linux-other'
  sessionTypeCache = normalised
  return normalised
}

// Called by App.tsx when the host process is reused (HMR / dev) so the
// cached value can be reset without a full reload.
export function _resetSessionTypeCacheForTesting() {
  sessionTypeCache = null
}

// Optional hook invoked just before the window hides on a paste. App.tsx
// uses it to flash a "press Ctrl+V to paste" toast on Wayland sessions
// where xdotool can't inject keystrokes and the user has to trigger
// paste themselves. Resolves once the toast has been shown long enough
// to read; the paste flow then proceeds to hide the window.
export type BeforeHideHook = () => Promise<void> | void

export async function pasteItem(itemId: number, beforeHide?: BeforeHideHook) {
  if (!Number.isFinite(itemId) || itemId <= 0) {
    console.warn('[pasteItem] ignoring invalid itemId', itemId)
    return
  }
  if (pasteInFlight) {
    invoke('log_to_rust', { level: 'warn', msg: `[pasteItem] already in flight, ignoring duplicate click itemId=${itemId}` }).catch(() => {})
    return
  }
  invoke('log_to_rust', { level: 'info', msg: `[pasteItem] ENTER itemId=${itemId}` }).catch(() => {})
  pasteInFlight = true
  try {
    if (beforeHide) {
      await beforeHide()
    }
    try {
      await invoke('hide_window')
    } catch (e) {
      console.error('[pasteItem] hide_window failed:', e)
      throw e
    }
    await new Promise(r => setTimeout(r, 200))
    try {
      await invoke('paste_item', { itemId })
    } catch (e) {
      console.error('[pasteItem] paste_item failed:', e)
      throw e
    }
  } finally {
    setTimeout(() => { pasteInFlight = false }, 800)
  }
}

export function hideWindow() {
  invoke('hide_window')
}

export function deleteItem(id: number) {
  invoke('delete_item', { id })
}

export async function undoDelete(): Promise<ClipboardItem | null> {
  const raw = await invoke<RawClipboardItem | null>('undo_delete')
  return raw ? mapItem(raw) : null
}

export function toggleFavorite(id: number) {
  invoke('toggle_favorite', { id })
}

export async function getCategories(): Promise<Category[]> {
  return invoke<Category[]>('list_categories')
}

export async function createCategory(name: string): Promise<Category> {
  return invoke<Category>('create_category', { name })
}

export async function renameCategory(id: number, name: string): Promise<void> {
  return invoke<void>('rename_category', { id, name })
}

export async function deleteCategory(id: number): Promise<void> {
  return invoke<void>('delete_category', { id })
}

export function assignCategory(itemId: number, categoryId: number) {
  invoke('assign_category', { itemId, categoryId })
}

export function removeCategory(itemId: number, categoryId: number) {
  invoke('remove_category', { itemId, categoryId })
}

export function clearHistory() {
  return invoke<void>('clear_history', { preserveFavorites: true })
}

export async function getSettings(): Promise<Settings> {
  const raw = await invoke<Record<string, string>>('get_settings')
  let hotkey = raw.hotkey || ''
  if (!hotkey) {
    // The DB hasn't seeded `hotkey` yet (fresh install). Read whatever
    // the Rust side actually has registered so the UI matches reality.
    try {
      hotkey = await invoke<string>('get_hotkey')
    } catch {
      hotkey = 'Alt+Shift+V'
    }
  }
  return {
    maxItems: parseInt(raw.maxItems || '10000', 10),
    hotkey,
    expirationDays: parseInt(raw.expirationDays || '30', 10),
    theme: (raw.theme as 'light' | 'dark') || 'dark',
    locale: raw.locale || 'en',
    exclusionApps: raw.exclusionApps ? raw.exclusionApps.split('\n') : [],
    exclusionPatterns: raw.exclusionPatterns ? raw.exclusionPatterns.split('\n') : [],
  }
}

export function updateSettings(settings: Partial<Settings>) {
  Object.entries(settings).forEach(([key, value]) => {
    const v = Array.isArray(value) ? value.join('\n') : String(value)
    if (key === 'hotkey') {
      // Persist AND ask the OS layer to re-register the binding. Doing
      // only the DB write leaves a stale `Alt+Shift+V` bound at runtime;
      // doing only the OS call drops the user's choice the next launch.
      invoke('update_setting', { key, value: v })
      invoke('set_hotkey', { hotkey: v }).catch((e: unknown) => {
        console.error('[settings] set_hotkey failed', e)
      })
    } else {
      invoke('update_setting', { key, value: v })
    }
  })
}

export async function getStats(): Promise<{ totalItems: number; favoriteItems: number; dbSize: number }> {
  const raw = await invoke<{ total_items: number; today_items: number; favorite_items: number; db_size: number }>('get_stats')
  return { totalItems: raw.total_items, favoriteItems: raw.favorite_items, dbSize: raw.db_size }
}

export function onHistoryUpdate(callback: (item: ClipboardItem) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen<RawClipboardItem>('clipboard-changed', (event) => {
    const item = mapItem(event.payload)
    callback(item)
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

// The Rust `clear_history` command emits this after deleting rows so the UI
// can drop its in-memory list. Without it, the items state stays populated
// until the next manual refresh.
export function onHistoryCleared(callback: () => void): () => void {
  let unsub: UnlistenFn | undefined
  listen('history-cleared', () => {
    callback()
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export function onOpenSettings(callback: () => void): () => void {
  let unsub: UnlistenFn | undefined
  listen('navigate', (event) => {
    if (event.payload === 'settings') callback()
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export interface UpdateAvailableInfo {
  version?: string
  notes?: string
  pub_date?: string
  [key: string]: unknown
}

export interface UpdateProgressInfo {
  contentLength?: number
  chunkLength?: number
  percent?: number
  [key: string]: unknown
}

export function onUpdateAvailable(callback: (info: UpdateAvailableInfo) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen<UpdateAvailableInfo>('tauri://update-available', (event) => {
    callback(event.payload || {})
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export function onUpdateNotAvailable(callback: (info: UpdateAvailableInfo) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen<UpdateAvailableInfo>('tauri://update-status', () => {
    callback({})
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export function onUpdateDownloadProgress(callback: (progress: UpdateProgressInfo) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen<UpdateProgressInfo>('tauri://update-download-progress', (event) => {
    callback(event.payload || {})
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export function onUpdateDownloaded(callback: (info: UpdateAvailableInfo) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen<UpdateAvailableInfo>('tauri://update-installed', (event) => {
    callback(event.payload || {})
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export function onUpdateError(callback: (err: { message: string }) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen('tauri://update-error', (event) => {
    callback({ message: String(event.payload || 'Unknown error') })
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export function checkForUpdate() {
  invoke('plugin:updater|check')
}

export function downloadUpdate() {
  invoke('plugin:updater|download')
}

export function applyUpdate() {
  invoke('plugin:updater|install')
}