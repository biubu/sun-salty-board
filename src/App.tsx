import { useState, useEffect, useMemo, useRef, useContext, useCallback } from 'react'
import HistoryPanel from './components/HistoryPanel'
import SearchBar from './components/SearchBar'
import FilterChips from './components/FilterChips'
import SettingsPanel from './components/SettingsPanel'
import { I18nContext, type Locale } from './utils/i18n'
import type { ClipboardItem } from './types/clipboard'
import * as api from './utils/tauriApi'
import type { SessionType } from './utils/tauriApi'

export type FilterType = 'all' | 'text' | 'richtext' | 'image' | 'files' | 'favorites'

const MAX_ITEMS = 10000

export default function App() {
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [sessionType, setSessionType] = useState<SessionType>('linux-other')
  const [toast, setToast] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const { t, setLocale } = useContext(I18nContext)
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex
  const debouncedQueryRef = useRef(debouncedQuery)
  debouncedQueryRef.current = debouncedQuery
  // Mirror sessionType into a ref so the global keydown listener — which
  // is registered exactly once with [] deps — always sees the latest
  // value without us having to re-register on every IPC resolution.
  const sessionTypeRef = useRef(sessionType)
  sessionTypeRef.current = sessionType

  const refreshItems = useCallback(async (query?: string) => {
    const result = query ? await api.searchHistory(query) : await api.getHistory()
    setItems(result)
  }, [])

  useEffect(() => {
    refreshItems()
  }, [refreshItems])

  // One-time probe of the host session so we know whether we can
  // synthesise keystrokes for paste (X11/macOS/Windows) or whether
  // the user has to do Ctrl+V themselves (Wayland). Cached in the
  // api module so subsequent calls are free.
  useEffect(() => {
    api.getSessionType().then(setSessionType).catch(() => {
      // Default to the most pessimistic value; the toast path is
      // harmless on platforms where it won't fire.
      setSessionType('linux-other')
    })
  }, [])

  // Shows the toast for ~1.4s — long enough to read, short enough
  // that paste still feels snappy. The 50ms fade-in delay gives the
  // CSS transition room to play without flashing. Reads sessionType
  // through a ref so the global keydown listener (registered once with
  // empty deps) always sees the resolved value.
  const showWaylandToast = useCallback(async () => {
    if (sessionTypeRef.current !== 'linux-wayland') return
    setToast(t('toast.copied_manual_paste'))
    await new Promise((r) => setTimeout(r, 1400))
    setToast(null)
  }, [t])

  // Wraps api.pasteItem with the Wayland toast hook so the user
  // sees "press Ctrl+V" before the window hides. On every other
  // platform the hook is a no-op and the flow is unchanged.
  const pasteItemWithToast = useCallback((itemId: number) => {
    return api.pasteItem(itemId, showWaylandToast)
  }, [showWaylandToast])

  useEffect(() => {
    api.getSettings().then((s) => {
      document.documentElement.setAttribute('data-theme', s.theme)
      setLocale((s.locale as Locale) || 'en')
    })
  }, [setLocale])

  useEffect(() => {
    const unsub1 = api.onHistoryUpdate((newItem) => {
      if (debouncedQueryRef.current) {
        refreshItems(debouncedQueryRef.current)
      } else {
        setItems(prev => [newItem, ...prev].slice(0, MAX_ITEMS))
      }
    })
    const unsub2 = api.onHistoryCleared(() => {
      // Backend has wiped the rows; drop the in-memory list so the empty
      // state shows up immediately. Preserve any active search filter by
      // re-running it against the (now empty) backend result.
      if (debouncedQueryRef.current) {
        refreshItems(debouncedQueryRef.current)
      } else {
        setItems([])
      }
    })
    const unsub3 = api.onOpenSettings(() => setShowSettings(true))
    return () => { unsub1(); unsub2(); unsub3() }
  }, [refreshItems])

  // 200ms debounce so a fast typist doesn't refilter the whole list on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 200)
    return () => clearTimeout(id)
  }, [searchQuery])

  // When debounced query changes, fetch from backend
  useEffect(() => {
    refreshItems(debouncedQuery || undefined)
  }, [debouncedQuery, refreshItems])

  const filteredItems = useMemo(() => {
    let result = items
    if (activeFilter === 'favorites') {
      result = result.filter((item) => item.isFavorite)
    } else if (activeFilter === 'text') {
      result = result.filter((item) => item.dataType === 'text' || item.dataType === 'richtext')
    } else if (activeFilter !== 'all') {
      result = result.filter((item) => item.dataType === activeFilter)
    }
    if (selectedCategoryId !== null) {
      result = result.filter((item) => item.categoryIds.includes(selectedCategoryId))
    }
    return result
  }, [items, activeFilter, selectedCategoryId])

  useEffect(() => {
    setSelectedIndex((i) => (i >= filteredItems.length ? 0 : i))
  }, [filteredItems.length])

  const filteredRef = useRef(filteredItems)
  filteredRef.current = filteredItems

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1
        const item = filteredRef.current[idx]
        if (item) pasteItemWithToast(item.id)
      } else if (e.key === '0') {
        const item = filteredRef.current[9]
        if (item) pasteItemWithToast(item.id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i > 0 ? i - 1 : filteredRef.current.length - 1))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i < filteredRef.current.length - 1 ? i + 1 : 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = filteredRef.current[selectedIndexRef.current]
        if (item) pasteItemWithToast(item.id)
      } else if (e.key === 'Escape') {
        api.hideWindow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (showSettings) {
    return <SettingsPanel onClose={() => setShowSettings(false)} />
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-header-row">
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
          <button
            className="settings-btn"
            onClick={() => setShowSettings(true)}
            title={t('settings.title')}
            aria-label={t('settings.title')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
        <FilterChips
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          selectedCategoryId={selectedCategoryId}
          onCategoryChange={setSelectedCategoryId}
        />
      </header>
      <main className="app-main">
        <HistoryPanel
          items={filteredItems}
          selectedIndex={selectedIndex}
          onSelect={(item) => pasteItemWithToast(item.id)}
          onDelete={(id) => {
            api.deleteItem(id)
          }}
          onToggleFavorite={(id) => {
            api.toggleFavorite(id)
          }}
        />
      </main>
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}