export {}

declare global {
  interface Window {
    electronAPI: {
      onHistoryUpdate: (callback: (items: import('./App').ClipboardItem[]) => void) => () => void
      onOpenSettings: (callback: () => void) => () => void
      pasteItem: (id: number) => void
      pasteByIndex: (index: number) => void
      deleteItem: (id: number) => void
      undoDelete: () => Promise<import('./App').ClipboardItem | null>
      toggleFavorite: (id: number) => void
      searchHistory: (query: string) => Promise<import('./App').ClipboardItem[]>
      getHistory: () => Promise<import('./App').ClipboardItem[]>
      getCategories: () => Promise<Category[]>
      createCategory: (name: string) => Promise<Category>
      renameCategory: (id: number, name: string) => Promise<void>
      deleteCategory: (id: number) => Promise<void>
      assignCategory: (itemId: number, categoryId: number) => void
      removeCategory: (itemId: number, categoryId: number) => void
      clearHistory: () => void
      getSettings: () => Promise<Settings>
      updateSettings: (settings: Record<string, unknown>) => void
      getStats: () => Promise<{ totalItems: number; favoriteItems: number; dbSize: number }>
      getSensitiveItems: () => Promise<SensitiveItem[]>
      getSyncPeers: () => Promise<SyncPeer[]>
      onUpdateAvailable: (callback: (info: unknown) => void) => () => void
      onUpdateDownloaded: (callback: () => void) => () => void
    }
  }
}

export interface Category {
  id: number
  name: string
}

export interface Settings {
  maxItems: number
  hotkey: string
  expirationDays: number
  syncEnabled: boolean
  theme: 'light' | 'dark'
  locale: string
  exclusionApps: string[]
  exclusionPatterns: string[]
}

export interface SensitiveItem {
  id: number
  content: string
  dataType: string
  capturedAt: number
}

export interface SyncPeer {
  id: string
  hostname: string
  deviceName: string
  address: string
  port: number
}
