import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'

export function setupAutoUpdater(mainWindow: BrowserWindow | null): void {
  // Auto-download in the background as soon as an update is found; the user
  // gets a "Restart & install" prompt once the payload lands. Keeps the UI
  // honest (a clickable progress bar) without forcing a manual download step.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    console.log('[SunSaltyBoard] Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', info)
  })

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('update-not-available', info)
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-download-progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    // Forward to the renderer so the Settings panel can show "Update check
    // failed" instead of staying silent. We log on the main side too because
    // a misconfigured publish provider should be visible during dev.
    console.warn('[SunSaltyBoard] Update error:', err.message)
    mainWindow?.webContents.send('update-error', { message: err.message })
  })

  // Fire-and-forget; failures are surfaced through the 'error' handler above.
  autoUpdater.checkForUpdates().catch(() => {})
}