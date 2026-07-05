import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ClipboardItem, Category, Settings, SensitiveItem } from '../types/clipboard'

function mapItem(raw: any): ClipboardItem {
  return {
    id: raw.id,
    content: raw.content || '',
    contentHtml: raw.rich_text || undefined,
    dataType: ['text', 'richtext', 'image', 'files'][raw.type] as any,
    filePaths: raw.file_paths ? raw.file_paths.split('\n').filter(Boolean) : undefined,
    categoryIds: raw.categories || [],
    isFavorite: raw.favorite,
    createdAt: raw.created_at,
    imageData: undefined,
    imageMime: undefined,
  }
}

function mapItems(raw: any[]): ClipboardItem[] {
  return raw.map(mapItem)
}

export async function getHistory(): Promise<ClipboardItem[]> {
  const raw = await invoke<unknown[]>('get_items', { limit: 10000, offset: 0 })
  return mapItems(raw)
}

export async function searchHistory(query: string): Promise<ClipboardItem[]> {
  const raw = await invoke<unknown[]>('search_items', { query, limit: 100 })
  return mapItems(raw)
}

export function pasteItem(_id: number) {
  invoke('paste_item')
}

export function pasteByIndex(_index: number) {
  getHistory().then(() => {
    invoke('paste_item')
  })
}

export function deleteItem(id: number) {
  invoke('delete_item', { id })
}

export async function undoDelete(): Promise<ClipboardItem | null> {
  return null
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
  invoke('clear_history', { preserveFavorites: true })
}

export async function getSettings(): Promise<Settings> {
  const raw = await invoke<Record<string, string>>('get_settings')
  return {
    maxItems: parseInt(raw.maxItems || '10000', 10),
    hotkey: raw.hotkey || 'Alt+Shift+V',
    expirationDays: parseInt(raw.expirationDays || '365', 10),
    theme: (raw.theme as 'light' | 'dark') || 'dark',
    locale: raw.locale || 'en',
    exclusionApps: raw.exclusionApps ? raw.exclusionApps.split('\n') : [],
    exclusionPatterns: raw.exclusionPatterns ? raw.exclusionPatterns.split('\n') : [],
  }
}

export function updateSettings(settings: Partial<Settings>) {
  Object.entries(settings).forEach(([key, value]) => {
    const v = Array.isArray(value) ? value.join('\n') : String(value)
    invoke('update_setting', { key, value: v })
  })
}

export async function getStats(): Promise<{ totalItems: number; favoriteItems: number; dbSize: number }> {
  const raw = await invoke<{ total_items: number; today_items: number }>('get_stats')
  return { totalItems: raw.total_items, favoriteItems: 0, dbSize: 0 }
}

export async function getSensitiveItems(): Promise<SensitiveItem[]> {
  return []
}

export function onHistoryUpdate(callback: (items: ClipboardItem[]) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen<unknown[]>('clipboard-changed', () => {
    getHistory().then(callback)
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

export function onUpdateAvailable(callback: (info: any) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen('tauri://update-available', (event) => {
    callback(event.payload || {})
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export function onUpdateNotAvailable(callback: (info: any) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen('tauri://update-status', (_event) => {
    callback({})
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export function onUpdateDownloadProgress(callback: (progress: any) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen('tauri://update-download-progress', (event) => {
    callback(event.payload || {})
  }).then(fn => { unsub = fn })
  return () => { if (unsub) unsub() }
}

export function onUpdateDownloaded(callback: (info: any) => void): () => void {
  let unsub: UnlistenFn | undefined
  listen('tauri://update-installed', (event) => {
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
