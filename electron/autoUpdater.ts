import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'

export function setupAutoUpdater(mainWindow: BrowserWindow | null): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    console.log('[SunSaltyBoard] Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', info)
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[SunSaltyBoard] No updates available')
  })

  autoUpdater.on('error', (err) => {
    console.warn('[SunSaltyBoard] Update check failed:', err.message)
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-download-progress', progress)
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded')
  })

  autoUpdater.checkForUpdates().catch(() => {})
}
