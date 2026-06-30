import { useState, useEffect } from 'react'
import type { Settings, SyncPeer } from '../types'

type SettingsPanelProps = {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings>({
    maxItems: 10000,
    hotkey: 'Alt+Shift+V',
    expirationDays: 30,
    syncEnabled: false,
    theme: 'dark',
    exclusionApps: [],
    exclusionPatterns: [],
  })
  const [isListening, setIsListening] = useState(false)
  const [stats, setStats] = useState({ totalItems: 0, favoriteItems: 0, dbSize: 0 })
  const [peers, setPeers] = useState<SyncPeer[]>([])
  const [newApp, setNewApp] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'exclusions' | 'sync'>('general')

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
    window.electronAPI.getStats().then(setStats)
    window.electronAPI.getSyncPeers().then(setPeers)
  }, [])

  const update = (key: keyof Settings, value: string | number | boolean | string[]) => {
    const updated = { ...settings, [key]: value }
    setSettings(updated)
    window.electronAPI.updateSettings({ [key]: typeof value === 'object' ? JSON.stringify(value) : String(value) })
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
        <h1>Settings</h1>
        <button className="action-btn back" onClick={onClose}>&larr; Back</button>
      </div>

      <div className="settings-tabs">
        <button
          className={`tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >General</button>
        <button
          className={`tab ${activeTab === 'exclusions' ? 'active' : ''}`}
          onClick={() => setActiveTab('exclusions')}
        >Exclusions</button>
        <button
          className={`tab ${activeTab === 'sync' ? 'active' : ''}`}
          onClick={() => setActiveTab('sync')}
        >Sync</button>
      </div>

      {activeTab === 'general' && (
        <>
          <div className="settings-group">
            <label className="settings-label">Maximum items</label>
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
            <label className="settings-label">Expiration (days)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={settings.expirationDays}
              onChange={(e) => update('expirationDays', parseInt(e.target.value, 10) || 30)}
            />
          </div>

          <div className="settings-group">
            <label className="settings-label">Global hotkey</label>
            <div className="hotkey-input-row">
              <input
                className="hotkey-input"
                readOnly
                value={isListening ? 'Press shortcut...' : settings.hotkey}
                onClick={startHotkeyListen}
              />
              <button className="filter-chip" onClick={() => update('hotkey', 'Alt+Shift+V')}>
                Reset
              </button>
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-label">Theme</label>
            <select
              value={settings.theme}
              onChange={(e) => update('theme', e.target.value)}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div className="settings-group">
            <label className="settings-label">Clear History</label>
            {showClearConfirm ? (
              <div className="confirm-row">
                <span>Clear all history? Favorites preserved.</span>
                <button className="filter-chip danger" onClick={handleClearHistory}>Confirm</button>
                <button className="filter-chip" onClick={() => setShowClearConfirm(false)}>Cancel</button>
              </div>
            ) : (
              <button className="filter-chip danger" onClick={() => setShowClearConfirm(true)}>
                Clear All History
              </button>
            )}
          </div>

          <div className="settings-group stats-group">
            <label className="settings-label">Stats</label>
            <div className="stats-row">
              <span>Total items: {stats.totalItems.toLocaleString()}</span>
              <span>Favorites: {stats.favoriteItems.toLocaleString()}</span>
              <span>DB size: {formatSize(stats.dbSize)}</span>
            </div>
          </div>
        </>
      )}

      {activeTab === 'exclusions' && (
        <>
          <div className="settings-group">
            <label className="settings-label">Exclude by application</label>
            <div className="add-row">
              <input
                type="text"
                placeholder="e.g. 1Password, KeePass"
                value={newApp}
                onChange={(e) => setNewApp(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExclusionApp()}
              />
              <button className="filter-chip" onClick={addExclusionApp}>Add</button>
            </div>
            <div className="list-tags">
              {settings.exclusionApps.map((app) => (
                <span key={app} className="tag">
                  {app}
                  <button className="tag-remove" onClick={() => removeExclusionApp(app)}>&times;</button>
                </span>
              ))}
              {settings.exclusionApps.length === 0 && (
                <span className="empty-hint">No application exclusions</span>
              )}
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-label">Exclude by content pattern (regex)</label>
            <div className="add-row">
              <input
                type="text"
                placeholder="e.g. ^password:"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExclusionPattern()}
              />
              <button className="filter-chip" onClick={addExclusionPattern}>Add</button>
            </div>
            <div className="list-tags">
              {settings.exclusionPatterns.map((p) => (
                <span key={p} className="tag">
                  /{p}/
                  <button className="tag-remove" onClick={() => removeExclusionPattern(p)}>&times;</button>
                </span>
              ))}
              {settings.exclusionPatterns.length === 0 && (
                <span className="empty-hint">No content pattern exclusions</span>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'sync' && (
        <>
          <div className="settings-group">
            <label className="settings-label">LAN sync</label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.syncEnabled}
                onChange={(e) => update('syncEnabled', e.target.checked)}
              />
              <span>Enable network sync</span>
            </label>
          </div>

          <div className="settings-group">
            <label className="settings-label">Discovered peers</label>
            {peers.length === 0 ? (
              <span className="empty-hint">No peers discovered on LAN</span>
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
    </div>
  )
}
