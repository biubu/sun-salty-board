import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onHistoryUpdate: (callback: (items: unknown[]) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, items: unknown[]) => callback(items)
    ipcRenderer.on('history-update', handler)
    return () => ipcRenderer.removeListener('history-update', handler)
  },

  onOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('open-settings', handler)
    return () => ipcRenderer.removeListener('open-settings', handler)
  },

  pasteItem: (id: number) => ipcRenderer.send('paste-item', id),
  pasteByIndex: (index: number) => ipcRenderer.send('paste-by-index', index),
  deleteItem: (id: number) => ipcRenderer.send('delete-item', id),
  undoDelete: () => ipcRenderer.invoke('undo-delete'),
  toggleFavorite: (id: number) => ipcRenderer.send('toggle-favorite', id),

  searchHistory: (query: string) => ipcRenderer.invoke('search-history', query),
  getHistory: () => ipcRenderer.invoke('get-history-items'),

  getCategories: () => ipcRenderer.invoke('get-categories'),
  createCategory: (name: string) => ipcRenderer.invoke('create-category', name),
  renameCategory: (id: number, name: string) => ipcRenderer.invoke('rename-category', id, name),
  deleteCategory: (id: number) => ipcRenderer.invoke('delete-category', id),
  assignCategory: (itemId: number, categoryId: number) =>
    ipcRenderer.send('assign-category', itemId, categoryId),
  removeCategory: (itemId: number, categoryId: number) =>
    ipcRenderer.send('remove-category', itemId, categoryId),

  clearHistory: () => ipcRenderer.send('clear-history'),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.send('update-settings', settings),

  getStats: () => ipcRenderer.invoke('get-stats'),
  getSensitiveItems: () => ipcRenderer.invoke('get-sensitive-items'),

  onUpdateAvailable: (callback: (info: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: unknown) => callback(info)
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },
  onUpdateNotAvailable: (callback: (info: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: unknown) => callback(info)
    ipcRenderer.on('update-not-available', handler)
    return () => ipcRenderer.removeListener('update-not-available', handler)
  },
  onUpdateDownloadProgress: (callback: (progress: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('update-download-progress', handler)
    return () => ipcRenderer.removeListener('update-download-progress', handler)
  },
  onUpdateDownloaded: (callback: (info: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: unknown) => callback(info)
    ipcRenderer.on('update-downloaded', handler)
    return () => ipcRenderer.removeListener('update-downloaded', handler)
  },
  onUpdateError: (callback: (err: { message: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, err: { message: string }) => callback(err)
    ipcRenderer.on('update-error', handler)
    return () => ipcRenderer.removeListener('update-error', handler)
  },
  checkForUpdate: () => ipcRenderer.send('check-for-update'),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  applyUpdate: () => ipcRenderer.send('apply-update'),
})
