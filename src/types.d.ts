import type {
  ClipboardItem,
  Category,
  Settings,
  SensitiveItem,
} from './types/clipboard'

export {}

declare global {
  interface Window {
    electronAPI: {
      onHistoryUpdate: (callback: (items: ClipboardItem[]) => void) => () => void
      onOpenSettings: (callback: () => void) => () => void
      pasteItem: (id: number) => void
      pasteByIndex: (index: number) => void
      deleteItem: (id: number) => void
      undoDelete: () => Promise<ClipboardItem | null>
      toggleFavorite: (id: number) => void
      searchHistory: (query: string) => Promise<ClipboardItem[]>
      getHistory: () => Promise<ClipboardItem[]>
      getCategories: () => Promise<Category[]>
      createCategory: (name: string) => Promise<Category>
      renameCategory: (id: number, name: string) => Promise<void>
      deleteCategory: (id: number) => Promise<void>
      assignCategory: (itemId: number, categoryId: number) => void
      removeCategory: (itemId: number, categoryId: number) => void
      clearHistory: () => void
      getSettings: () => Promise<Settings>
      updateSettings: (settings: Partial<Settings>) => void
      getStats: () => Promise<{ totalItems: number; favoriteItems: number; dbSize: number }>
      getSensitiveItems: () => Promise<SensitiveItem[]>
      onUpdateAvailable: (callback: (info: unknown) => void) => () => void
      onUpdateNotAvailable: (callback: (info: unknown) => void) => () => void
      onUpdateDownloadProgress: (callback: (progress: unknown) => void) => () => void
      onUpdateDownloaded: (callback: (info: unknown) => void) => () => void
      onUpdateError: (callback: (err: { message: string }) => void) => () => void
      checkForUpdate: () => void
      downloadUpdate: () => void
      applyUpdate: () => void
    }
  }
}
