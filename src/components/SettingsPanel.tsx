import { useState, useEffect, useContext } from 'react'
import type { Settings, SyncPeer } from '../types/clipboard'
import { I18nContext, type Locale } from '../utils/i18n'

type SettingsPanelProps = {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t, locale, setLocale } = useContext(I18nContext)
  const [settings, setSettings] = useState<Settings>({
    maxItems: 10000,
    hotkey: 'Alt+Shift+V',
    expirationDays: 30,
    syncEnabled: false,
    theme: 'dark',
    locale: 'en',
    exclusionApps: [],
    exclusionPatterns: [],
  })
  const [isListening, setIsListening] = useState(false)
  const [stats, setStats] = useState({ totalItems: 0, favoriteItems: 0, dbSize: 0 })
  const [peers, setPeers] = useState<SyncPeer[]>([])
  const [newApp, setNewApp] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'exclusions' | 'sync' | 'updates'>('general')
  const [updateAvailable, setUpdateAvailable] = useState<{ version?: string } | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState<{ version?: string } | null>(null)
  const [updateProgress, setUpdateProgress] = useState<{ percent: number } | null>(null)
  const [updateNone, setUpdateNone] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
    window.electronAPI.getStats().then(setStats)
    window.electronAPI.getSyncPeers().then(setPeers)
    const unsubAvail = window.electronAPI.onUpdateAvailable((info) => {
      const maybe = info as { version?: string }
      setUpdateChecking(false)
      setUpdateAvailable({ version: maybe?.version })
      setUpdateDownloaded(null)
      setUpdateNone(false)
      setUpdateError(null)
    })
    const unsubNone = window.electronAPI.onUpdateNotAvailable(() => {
      // Only surface "you're up to date" if the user explicitly asked;
      // auto-checks at startup stay silent to avoid banner noise.
      setUpdateChecking(false)
      if (updateChecking) setUpdateNone(true)
      setUpdateAvailable(null)
    })
    const unsubProgress = window.electronAPI.onUpdateDownloadProgress((p) => {
      const maybe = p as { percent?: number }
      if (typeof maybe?.percent === 'number') setUpdateProgress({ percent: maybe.percent })
    })
    const unsubDl = window.electronAPI.onUpdateDownloaded((info) => {
      const maybe = info as { version?: string }
      setUpdateDownloaded({ version: maybe?.version })
      setUpdateProgress(null)
    })
    const unsubErr = window.electronAPI.onUpdateError((err) => {
      setUpdateError(err?.message ?? 'Update check failed')
      setUpdateChecking(false)
      setUpdateProgress(null)
    })
    return () => { unsubAvail(); unsubNone(); unsubProgress(); unsubDl(); unsubErr() }
  }, [updateChecking])

  const handleCheckForUpdate = () => {
    setUpdateChecking(true)
    setUpdateError(null)
    setUpdateNone(false)
    setUpdateAvailable(null)
    setUpdateDownloaded(null)
    setUpdateProgress(null)
    window.electronAPI.checkForUpdate()
    // If neither available nor not-available nor error fires within 30s,
    // reset the spinner — autoUpdater silently no-ops when the publish
    // provider is unreachable on some networks, and the UI shouldn't stay
    // stuck in "Checking…" forever.
    window.setTimeout(() => setUpdateChecking(false), 30_000)
  }

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const updated = { ...settings, [key]: value }
    setSettings(updated)
    // Pass the raw value through; the worker is responsible for serialising
    // object values to its settings-store format. Centralising this avoids
    // subtle drift between renderer and main about what "an object setting"
    // looks like.
    window.electronAPI.updateSettings({ [key]: value } as Partial<Settings>)
    if (key === 'theme') {
      document.documentElement.setAttribute('data-theme', value as string)
    }
    if (key === 'locale') {
      setLocale(value as Locale)
    }
  }

  const startHotkeyListen = () => {
    setIsListening(true)
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      const parts: string[] = []
      if (e.metaKey) parts.push('Cmd')
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      const key = e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift'
        ? '' : e.key.toUpperCase()
      if (key && parts.length > 0) {
        const hotkey = [...parts, key].join('+')
        update('hotkey', hotkey)
        setIsListening(false)
        document.removeEventListener('keydown', handler)
      }
    }
    document.addEventListener('keydown', handler)
  }

  const addExclusionApp = () => {
    if (!newApp.trim()) return
    const updated = [...settings.exclusionApps, newApp.trim()]
    update('exclusionApps', updated)
    setNewApp('')
  }

  const removeExclusionApp = (app: string) => {
    const updated = settings.exclusionApps.filter((a) => a !== app)
    update('exclusionApps', updated)
  }

  const addExclusionPattern = () => {
    if (!newPattern.trim()) return
    const updated = [...settings.exclusionPatterns, newPattern.trim()]
    update('exclusionPatterns', updated)
    setNewPattern('')
  }

  const removeExclusionPattern = (pattern: string) => {
    const updated = settings.exclusionPatterns.filter((p) => p !== pattern)
    update('exclusionPatterns', updated)
  }

  const handleClearHistory = () => {
    window.electronAPI.clearHistory()
    setShowClearConfirm(false)
    window.electronAPI.getStats().then(setStats)
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h1>{t('settings.title')}</h1>
        <button className="action-btn back" onClick={onClose}>&larr; {t('settings.back')}</button>
      </div>

      {(updateAvailable || updateDownloaded) && (
        <div className="update-banner" role="status">
          <span>
            {updateDownloaded
              ? `✓ v${updateDownloaded.version || updateAvailable?.version || '?'} ${t('settings.update_ready')}`
              : `↓ v${updateAvailable?.version || '?'} ${t('settings.update_available')}`}
          </span>
          {updateDownloaded && (
            <button
              className="filter-chip"
              onClick={() => window.electronAPI.applyUpdate()}
            >
              {t('settings.update_restart')}
            </button>
          )}
        </div>
      )}

      <div className="settings-tabs">
        <button
          className={`tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >{t('settings.general')}</button>
        <button
          className={`tab ${activeTab === 'exclusions' ? 'active' : ''}`}
          onClick={() => setActiveTab('exclusions')}
        >{t('settings.exclusions')}</button>
        <button
          className={`tab ${activeTab === 'sync' ? 'active' : ''}`}
          onClick={() => setActiveTab('sync')}
        >{t('settings.sync')}</button>
        <button
          className={`tab ${activeTab === 'updates' ? 'active' : ''}`}
          onClick={() => setActiveTab('updates')}
        >{t('settings.update_section')}</button>
      </div>

      {activeTab === 'general' && (
        <>
          <div className="settings-group">
            <label className="settings-label">{t('settings.max_items')}</label>
            <input
              type="range"
              min={100}
              max={100000}
              step={100}
              value={settings.maxItems}
              onChange={(e) => update('maxItems', parseInt(e.target.value, 10))}
            />
            <span className="settings-value">{settings.maxItems.toLocaleString()}</span>
          </div>

          <div className="settings-group">
            <label className="settings-label">{t('settings.expiration')}</label>
            <input
              type="number"
              min={1}
              max={365}
              value={settings.expirationDays}
              onChange={(e) => update('expirationDays', parseInt(e.target.value, 10) || 30)}
            />
          </div>

          <div className="settings-group">
            <label className="settings-label">{t('settings.hotkey')}</label>
            <div className="hotkey-input-row">
              <input
                className="hotkey-input"
                readOnly
                value={isListening ? t('settings.hotkey_press') : settings.hotkey}
                onClick={startHotkeyListen}
              />
              <button className="filter-chip" onClick={() => update('hotkey', 'Alt+Shift+V')}>
                {t('settings.reset')}
              </button>
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-label">{t('settings.theme')}</label>
            <select
              value={settings.theme}
              onChange={(e) => update('theme', e.target.value as Settings['theme'])}
            >
              <option value="dark">{t('settings.theme_dark')}</option>
              <option value="light">{t('settings.theme_light')}</option>
            </select>
          </div>

          <div className="settings-group">
            <label className="settings-label">{t('settings.language')}</label>
            <select
              value={locale}
              onChange={(e) => update('locale', e.target.value)}
            >
              <option value="en">{t('settings.lang_en')}</option>
              <option value="zh">{t('settings.lang_zh')}</option>
            </select>
          </div>

          <div className="settings-group">
            <label className="settings-label">{t('settings.clear_history')}</label>
            {showClearConfirm ? (
              <div className="confirm-row">
                <span>{t('settings.clear_confirm')}</span>
                <button className="filter-chip danger" onClick={handleClearHistory}>{t('settings.clear_confirm_btn')}</button>
                <button className="filter-chip" onClick={() => setShowClearConfirm(false)}>{t('settings.clear_cancel')}</button>
              </div>
            ) : (
              <button className="filter-chip danger" onClick={() => setShowClearConfirm(true)}>
                {t('settings.clear_all')}
              </button>
            )}
          </div>

          <div className="settings-group stats-group">
            <label className="settings-label">{t('settings.stats')}</label>
            <div className="stats-row">
              <span>{t('settings.stats_total', { n: stats.totalItems.toLocaleString() })}</span>
              <span>{t('settings.stats_fav', { n: stats.favoriteItems.toLocaleString() })}</span>
              <span>{t('settings.stats_db', { s: formatSize(stats.dbSize) })}</span>
            </div>
          </div>
        </>
      )}

      {activeTab === 'exclusions' && (
        <>
          <div className="settings-group">
            <label className="settings-label">{t('settings.exclude_app')}</label>
            <div className="add-row">
              <input
                type="text"
                placeholder={t('settings.exclude_app_placeholder')}
                value={newApp}
                onChange={(e) => setNewApp(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExclusionApp()}
              />
              <button className="filter-chip" onClick={addExclusionApp}>{t('settings.add')}</button>
            </div>
            <div className="list-tags">
              {settings.exclusionApps.map((app) => (
                <span key={app} className="tag">
                  {app}
                  <button className="tag-remove" onClick={() => removeExclusionApp(app)}>&times;</button>
                </span>
              ))}
              {settings.exclusionApps.length === 0 && (
                <span className="empty-hint">{t('settings.no_exclude_app')}</span>
              )}
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-label">{t('settings.exclude_pattern')}</label>
            <div className="add-row">
              <input
                type="text"
                placeholder={t('settings.exclude_pattern_placeholder')}
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExclusionPattern()}
              />
              <button className="filter-chip" onClick={addExclusionPattern}>{t('settings.add')}</button>
            </div>
            <div className="list-tags">
              {settings.exclusionPatterns.map((p) => (
                <span key={p} className="tag">
                  /{p}/
                  <button className="tag-remove" onClick={() => removeExclusionPattern(p)}>&times;</button>
                </span>
              ))}
              {settings.exclusionPatterns.length === 0 && (
                <span className="empty-hint">{t('settings.no_exclude_pattern')}</span>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'sync' && (
        <>
          <div className="settings-group">
            <label className="settings-label">{t('settings.lan_sync')}</label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.syncEnabled}
                onChange={(e) => update('syncEnabled', e.target.checked)}
              />
              <span>{t('settings.sync_enable')}</span>
            </label>
          </div>

          <div className="settings-group">
            <label className="settings-label">{t('settings.peers')}</label>
            {peers.length === 0 ? (
              <span className="empty-hint">{t('settings.no_peers')}</span>
            ) : (
              <div className="peer-list">
                {peers.map((peer) => (
                  <div key={peer.id} className="peer-item">
                    <span>{peer.deviceName || peer.hostname}</span>
                    <span className="peer-address">{peer.address}:{peer.port}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'updates' && (
        <>
          <div className="settings-group">
            <label className="settings-label">{t('settings.update_section')}</label>
            <button
              className="filter-chip"
              onClick={handleCheckForUpdate}
              disabled={updateChecking}
            >
              {updateChecking ? t('settings.update_checking') : t('settings.update_check')}
            </button>
          </div>

          {updateNone && (
            <div className="update-banner" role="status">
              <span>✓ {t('settings.update_none')}</span>
            </div>
          )}

          {updateError && (
            <div className="update-banner update-banner-error" role="alert">
              <span>⚠ {t('settings.update_error')}: {updateError}</span>
            </div>
          )}

          {updateAvailable && !updateDownloaded && (
            <div className="update-banner" role="status">
              <span>
                ↓ v{updateAvailable.version || '?'}{' '}
                {updateProgress
                  ? t('settings.update_progress', { p: Math.floor(updateProgress.percent) })
                  : t('settings.update_available')}
              </span>
            </div>
          )}

          {updateProgress && !updateDownloaded && (
            <div className="update-progress" role="progressbar"
                 aria-valuenow={Math.floor(updateProgress.percent)}
                 aria-valuemin={0} aria-valuemax={100}>
              <div className="update-progress-bar" style={{ width: `${updateProgress.percent}%` }} />
            </div>
          )}

          {updateDownloaded && (
            <div className="update-banner" role="status">
              <span>
                ✓ v{updateDownloaded.version || '?'} {t('settings.update_ready')}
              </span>
              <button
                className="filter-chip"
                onClick={() => window.electronAPI.applyUpdate()}
              >
                {t('settings.update_restart')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
