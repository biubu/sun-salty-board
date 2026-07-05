import {
  app, BrowserWindow, ipcMain, Tray, Menu,
  globalShortcut, nativeImage, clipboard, screen, dialog,
} from 'electron'
import { execFile } from 'child_process'
import path from 'path'
import { createWorker, WorkerBridge, ClipboardItem } from './worker'
import type { ClipboardEvent } from './platform-monitor'
import {
  startMonitoring, stopMonitoring, setPollingInterval,
  setExclusionApps, setExclusionPatterns,
} from './platform-monitor'
import { setupAutoUpdater } from './autoUpdater'
import { autoUpdater } from 'electron-updater'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let workerBridge: WorkerBridge | null = null

const isDev = !app.isPackaged
let isQuitting = false
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

app.on('before-quit', () => {
  isQuitting = true
})

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
      sandbox: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('blur', () => {
    // Hide on blur so the overlay doesn't linger behind other windows.
    // Exception: in dev we keep it open so DevTools focus doesn't dismiss it.
    if (!isDev) mainWindow?.hide()
  })

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
    showWindowAtCursor()
  }
}

// Always show (never toggle) and re-anchor under the cursor. Used by tray menu
// items that must surface a specific view (e.g. Settings) even when the
// overlay is already visible — otherwise the IPC handler fires but the user
// sees no UI because the window never receives the show() call.
function showWindowAtCursor(): void {
  if (!mainWindow) return
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea
  const [winWidth, winHeight] = mainWindow.getSize()
  const winX = Math.max(dx, Math.min(cursorPoint.x - Math.round(winWidth / 2), dx + dw - winWidth))
  const winY = Math.max(dy, Math.min(cursorPoint.y + 24, dy + dh - winHeight))
  mainWindow.setPosition(winX, winY)
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('overlay-opened')
}

function createTray(): void {
  // macOS expects an alpha-only template image for the menu bar; the colored
  // app icon would render as a solid blob once setTemplateImage(true) drops
  // its RGB channels and keeps only the (fully opaque) alpha mask.
  //
  // Tray icons live inside app.asar (`files: resources/**\*` in
  // electron-builder.yml bundles them). Electron's asar shim rewrites reads
  // from inside the archive, including nativeImage.createFromPath, so the
  // same __dirname-relative path works in dev and in the packaged .app.
  // The previous dual-branch pointed process.resourcesPath at a tree shape
  // that doesn't exist post-packaging — only app.asar, app.asar.unpacked,
  // and .icns live there — and the icon silently rendered as an empty
  // bitmap, leaving the tray slot blank.
  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, '../resources/trayIconTemplate.png')
    : path.join(__dirname, '../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  }
  tray = new Tray(icon)
  tray.setToolTip('SunSaltyBoard')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open History', click: toggleWindow },
    {
      label: 'Settings',
      click: () => {
        // The window is usually hidden when the tray menu is open; sending
        // IPC alone would update renderer state without surfacing the UI.
        showWindowAtCursor()
        mainWindow?.webContents.send('open-settings')
      },
    },
    { type: 'separator' },
    {
      label: 'About',
      click: () => {
        // Use the packaged app version when installed, fall back to package.json
        // in dev where app.getVersion() still works but the version field is the
        // last published release rather than the current source.
        const version = app.getVersion()
        dialog.showMessageBox({
          type: 'info',
          title: 'About SunSaltyBoard',
          message: 'SunSaltyBoard',
          detail: `Version ${version}\n\nA cross-platform clipboard manager with high-capacity history and full-text search.`,
          buttons: ['OK'],
        })
      },
    },
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
  workerBridge?.flush()
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

function onClipboardEvent(event: ClipboardEvent): void {
  if (event.sensitive) {
    workerBridge?.addSensitiveItem(event.content, event.dataType)
    return
  }

  workerBridge?.storeItem({
    content: event.content,
    contentHtml: event.contentHtml,
    dataType: event.dataType,
    imageData: event.imageData,
    filePaths: event.filePaths,
    sourceApp: event.sourceApp,
  })
  sendHistoryUpdate()
}

app.on('ready', async () => {
  workerBridge = await createWorker()

  const settings = workerBridge.getSettings()
  registerHotkey(settings.hotkey)

  if (settings.exclusionApps?.length) setExclusionApps(settings.exclusionApps)
  if (settings.exclusionPatterns?.length) setExclusionPatterns(settings.exclusionPatterns)

  ipcMain.handle('get-history-items', () => {
    return workerBridge?.getItems() ?? []
  })

  function doPaste(item: ClipboardItem): void {
    if (item.dataType === 'image' && item.imageData) {
      clipboard.writeImage(nativeImage.createFromBuffer(new Uint8Array(item.imageData)))
    } else {
      clipboard.writeText(item.content)
    }
    mainWindow?.hide()
    if (process.platform === 'darwin') {
      app.hide()
      setTimeout(simulatePaste, 80)
    } else {
      setTimeout(simulatePaste, 150)
    }
  }

  ipcMain.on('paste-item', (_e, id: number) => {
    const item = workerBridge?.getItemById(id)
    if (item) doPaste(item)
  })

  ipcMain.on('paste-by-index', (_e, index: number) => {
    const items = workerBridge?.getItems() ?? []
    // Treat the digit shortcut as 1-based so "press 1 → paste first item"
    // matches the on-screen numbering. index === 0 is accepted as a synonym
    // for "10th item" so all ten slots (0–9) remain addressable.
    const target = index === 0 ? 9 : index - 1
    if (target >= 0 && target < items.length) {
      doPaste(items[target])
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
  })

  // Reserved hook for future overlay-only keyboard handling. The renderer
  // currently handles digit-key shortcuts locally via
  // window.electronAPI.pasteByIndex (pasteItem IPC), so this is a no-op
  // stub kept for ABI compatibility with future overlays.
  ipcMain.on('overlay-keydown', (_e, _key: string) => { /* no-op */ })

  ipcMain.handle('get-stats', () => {
    return workerBridge?.getStats() ?? { totalItems: 0, favoriteItems: 0, dbSize: 0 }
  })

  ipcMain.handle('get-sensitive-items', () => {
    return workerBridge?.getSensitiveItems() ?? []
  })

  ipcMain.on('apply-update', () => {
    if (autoUpdater.updateDownloaded) {
      // quitAndInstall(isSilent=false, isForceRunAfter=true) restarts the
      // app and applies the update without waiting for a graceful quit.
      // We deliberately do NOT removeAllListeners — other UI events
      // (download-progress for any in-flight update) should keep flowing.
      autoUpdater.quitAndInstall(false, true)
    }
  })

  ipcMain.on('check-for-update', () => {
    autoUpdater.checkForUpdates().catch((err) => {
      mainWindow?.webContents.send('update-error', { message: err?.message ?? String(err) })
    })
  })

  ipcMain.on('download-update', () => {
    autoUpdater.downloadUpdate().catch((err) => {
      mainWindow?.webContents.send('update-error', { message: err?.message ?? String(err) })
    })
  })

  createWindow()
  if (!isDev) {
    setupAutoUpdater(mainWindow)
  }
  createTray()

  startMonitoring(onClipboardEvent, 500)
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
  workerBridge?.close()
})
