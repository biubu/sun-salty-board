import {
  app, BrowserWindow, ipcMain, Tray, Menu,
  globalShortcut, nativeImage, clipboard, screen,
} from 'electron'
import { execFile } from 'child_process'
import path from 'path'
import { createWorker, WorkerBridge } from './worker'
import {
  startMonitoring, stopMonitoring, setPollingInterval,
  setExclusionApps, setExclusionPatterns, setCtrlState,
} from './platform-monitor'
import {
  startSync, stopSync, broadcastClipboard, getPeers, setDeviceName,
} from './sync'
import { setupAutoUpdater } from './autoUpdater'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let workerBridge: WorkerBridge | null = null

const isDev = !app.isPackaged
let isQuitting = false

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 600,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('blur', () => mainWindow?.hide())

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

function toggleWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    const { x, y, width, height } = display.workArea
    const [winWidth, winHeight] = mainWindow.getSize()
    mainWindow.setPosition(
      Math.round(x + (width - winWidth) / 2),
      Math.round(y + (height - winHeight) / 2),
    )
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('overlay-opened')
  }
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 })
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  }
  tray = new Tray(icon)
  tray.setToolTip('SunSaltyBoard')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open History', click: toggleWindow },
    { label: 'Settings', click: () => mainWindow?.webContents.send('open-settings') },
    { type: 'separator' },
    { label: 'About', click: () => {} },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
  tray.on('click', toggleWindow)
}

function registerHotkey(hotkey: string): void {
  globalShortcut.unregisterAll()
  const registered = globalShortcut.register(hotkey, toggleWindow)
  if (!registered) {
    console.warn(`[SunSaltyBoard] Failed to register hotkey ${hotkey} (conflict)`)
  }
}

function sendHistoryUpdate(): void {
  mainWindow?.webContents.send('history-update', workerBridge?.getItems() ?? [])
}

function simulatePaste(): void {
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], (err) => {
      if (err) console.warn('[SunSaltyBoard] Failed to simulate paste:', err.message)
    })
  } else if (process.platform === 'win32') {
    execFile('powershell', ['-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")'], (err) => {
      if (err) console.warn('[SunSaltyBoard] Failed to simulate paste:', err.message)
    })
  } else {
    execFile('xdotool', ['key', 'ctrl+v'], (err) => {
      if (err) console.warn('[SunSaltyBoard] Failed to simulate paste:', err.message)
    })
  }
}

function onClipboardEvent(event: {
  content: string
  contentHtml?: string
  dataType: string
  imageData?: Uint8Array
  filePaths?: string[]
  sourceApp: string
  sensitive?: boolean
}): void {
  if (event.sensitive) {
    workerBridge?.addSensitiveItem(event.content, event.dataType)
    return
  }

  workerBridge?.storeItem({
    content: event.content,
    contentHtml: event.contentHtml,
    dataType: event.dataType as any,
    imageData: event.imageData,
    filePaths: event.filePaths,
    sourceApp: event.sourceApp,
  })
  sendHistoryUpdate()

  const settings = workerBridge?.getSettings()
  if (settings?.syncEnabled) {
    broadcastClipboard({
      type: 'clipboard',
      content: event.content,
      contentHtml: event.contentHtml,
      dataType: event.dataType,
      imageData: event.imageData ? Array.from(event.imageData) : undefined,
      filePaths: event.filePaths,
      sourceDevice: settings?.hotkey || 'unknown',
      timestamp: new Date().toISOString(),
    })
  }
}

function onSyncReceive(msg: {
  content: string
  contentHtml?: string
  dataType: string
  imageData?: number[]
  filePaths?: string[]
  sourceDevice: string
  timestamp: string
}): void {
  workerBridge?.storeItem({
    content: msg.content,
    contentHtml: msg.contentHtml,
    dataType: msg.dataType as any,
    imageData: msg.imageData ? new Uint8Array(msg.imageData) : undefined,
    filePaths: msg.filePaths,
    sourceApp: '',
    sourceDevice: msg.sourceDevice,
  })
  sendHistoryUpdate()
}

app.on('ready', async () => {
  workerBridge = await createWorker()

  const settings = workerBridge.getSettings()
  registerHotkey(settings.hotkey)

  if (settings.exclusionApps?.length) setExclusionApps(settings.exclusionApps)
  if (settings.exclusionPatterns?.length) setExclusionPatterns(settings.exclusionPatterns)

  ipcMain.on('get-history', () => {
    sendHistoryUpdate()
  })

  ipcMain.handle('get-history-items', () => {
    return workerBridge?.getItems() ?? []
  })

  ipcMain.on('paste-item', (_e, id: number) => {
    const item = workerBridge?.getItemById(id)
    if (item) {
      if (item.dataType === 'image' && item.imageData) {
        clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(item.imageData)))
      } else if (item.dataType === 'files' && item.filePaths) {
        clipboard.writeText(item.content)
      } else {
        clipboard.writeText(item.content)
      }
    }
    mainWindow?.hide()
    setTimeout(simulatePaste, 80)
  })

  ipcMain.on('paste-by-index', (_e, index: number) => {
    const items = workerBridge?.getItems() ?? []
    if (index >= 0 && index < items.length) {
      const item = items[index]
      if (item.dataType === 'image' && item.imageData) {
        clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(item.imageData)))
      } else {
        clipboard.writeText(item.content)
      }
      mainWindow?.hide()
      setTimeout(simulatePaste, 80)
    }
  })

  ipcMain.on('delete-item', (_e, id: number) => {
    workerBridge?.deleteItem(id)
    sendHistoryUpdate()
  })

  ipcMain.handle('undo-delete', () => {
    const restored = workerBridge?.undoDelete()
    sendHistoryUpdate()
    return restored ?? null
  })

  ipcMain.on('toggle-favorite', (_e, id: number) => {
    workerBridge?.toggleFavorite(id)
    sendHistoryUpdate()
  })

  ipcMain.handle('search-history', (_e, query: string) => {
    return workerBridge?.searchHistory(query) ?? []
  })

  ipcMain.handle('get-categories', () => {
    return workerBridge?.getCategories() ?? []
  })

  ipcMain.handle('create-category', (_e, name: string) => {
    return workerBridge?.createCategory(name)
  })

  ipcMain.handle('rename-category', (_e, id: number, name: string) => {
    workerBridge?.renameCategory(id, name)
  })

  ipcMain.handle('delete-category', (_e, id: number) => {
    workerBridge?.deleteCategory(id)
  })

  ipcMain.on('assign-category', (_e, itemId: number, categoryId: number) => {
    workerBridge?.assignCategory(itemId, categoryId)
  })

  ipcMain.on('remove-category', (_e, itemId: number, categoryId: number) => {
    workerBridge?.removeCategory(itemId, categoryId)
  })

  ipcMain.on('clear-history', () => {
    workerBridge?.clearHistory()
    sendHistoryUpdate()
  })

  ipcMain.handle('get-settings', () => {
    return workerBridge?.getSettings() ?? {}
  })

  ipcMain.on('update-settings', (_e, s: Record<string, unknown>) => {
    workerBridge?.updateSettings(s)
    if (s.hotkey && typeof s.hotkey === 'string') {
      registerHotkey(s.hotkey)
    }
    if (s.pollingInterval && typeof s.pollingInterval === 'number') {
      setPollingInterval(s.pollingInterval)
    }
    if (s.exclusionApps) {
      setExclusionApps(s.exclusionApps as string[])
    }
    if (s.exclusionPatterns) {
      setExclusionPatterns(s.exclusionPatterns as string[])
    }
    if (s.syncEnabled !== undefined) {
      if (s.syncEnabled) {
        setDeviceName(app.getName())
        startSync(onSyncReceive)
      } else {
        stopSync()
      }
    }
  })

  ipcMain.on('overlay-keydown', (_e, key: string) => {
    const num = parseInt(key, 10)
    if (num >= 1 && num <= 9) {
      mainWindow?.webContents.send('paste-by-index', num - 1)
    }
  })

  ipcMain.handle('get-stats', () => {
    return workerBridge?.getStats() ?? { totalItems: 0, favoriteItems: 0, dbSize: 0 }
  })

  ipcMain.handle('get-sensitive-items', () => {
    return workerBridge?.getSensitiveItems() ?? []
  })

  ipcMain.handle('get-sync-peers', () => {
    return getPeers()
  })

  createWindow()
  if (!isDev) {
    setupAutoUpdater(mainWindow)
  }
  createTray()

  startMonitoring(onClipboardEvent, 500)

  if (settings.syncEnabled) {
    setDeviceName(app.getName())
    startSync(onSyncReceive)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      toggleWindow()
    }
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopMonitoring()
  stopSync()
  workerBridge?.close()
})
